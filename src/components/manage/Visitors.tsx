import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase, errorText } from "../../lib/supabase";
import { timeAgo } from "../../lib/util";
import { Avatar, Icon, useConfirm, useToast, type IconName } from "../ui";

interface Visitor {
  user_id: string; display_name: string | null; avatar_path: string | null; is_guest: boolean; visits: number;
  last_visit: string; last_table: string | null; at_shop: boolean; can_offer: boolean; last_offer_at: string | null;
  /** Older databases (before migration 48) don't send these; groups and tags then simply stay hidden. */
  first_visit?: string; visits_60?: number; offers_used?: number; tag_ids?: string[];
}
export type TagColor = "sky" | "green" | "amber" | "coral" | "violet" | "gray";
interface Tag { id: string; label: string; color: TagColor; people: number }

const DAYS = [7, 30, 90] as const;
const COLORS: TagColor[] = ["sky", "green", "amber", "coral", "violet", "gray"];
const DAY = 86_400_000;

/** The groups the app makes by itself, from visits and offers. "Haven't been back" needs the 90-day list. */
const AUTO: { id: string; label: string; icon: IconName; days?: 90; fits: (v: Visitor) => boolean }[] = [
  { id: "new", label: "New this week", icon: "spark", fits: (v) => Boolean(v.first_visit) && Date.now() - new Date(v.first_visit!).getTime() < 7 * DAY },
  { id: "regular", label: "Regulars", icon: "crown", fits: (v) => (v.visits_60 ?? 0) >= 3 },
  { id: "away", label: "Haven't been back", icon: "clock", days: 90, fits: (v) => Date.now() - new Date(v.last_visit).getTime() > 30 * DAY },
  { id: "used", label: "Used an offer", icon: "ticket", fits: (v) => (v.offers_used ?? 0) > 0 },
];

function friendlyOfferError(e: unknown): string {
  const t = errorText(e);
  if (/reviews?,? (or )?ratings/i.test(t)) return "Offers can't mention reviews, ratings, stars or feedback. Google removes reviews that were rewarded.";
  if (/already have a tag called/i.test(t)) return "You already have a tag with that name.";
  if (/up to 12 tags/i.test(t)) return "You can have up to 12 tags. Delete one first.";
  if (/customer_tags_color_check/i.test(t)) return "Pick one of the colours.";
  if (/PGRST202|shop_visitors|send_visitor_offer|customer_tag/i.test(t)) return "This isn't available yet.";
  return t;
}

/**
 * People who scanned this shop's QR codes, in groups: the app's own (New, Regulars, Haven't been back,
 * Used an offer) and the owner's tags. Pick a group, then "Write offer to Regulars (12)".
 * Tags are private to the shop and never say anything about reviews.
 */
export function Visitors({ placeId, picked, setPicked, onWrite, reload = 0 }: {
  placeId: string; picked: Set<string>; setPicked: (f: (p: Set<string>) => Set<string>) => void; onWrite: () => void; reload?: number;
}) {
  const toast = useToast();
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [list, setList] = useState<Visitor[] | null>(null);
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [group, setGroup] = useState<string>("all");
  const [err, setErr] = useState("");
  const [tagging, setTagging] = useState<Visitor | null>(null);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    let alive = true;
    setErr("");
    supabase.rpc("shop_visitors", { p_place: placeId, p_days: days }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(friendlyOfferError(error)); setList([]); return; }
      const rows = (data as Visitor[]) || [];
      setList(rows);
      setPicked((p) => new Set([...p].filter((id) => rows.some((r) => r.user_id === id && r.can_offer))));
    });
    return () => { alive = false; };
  }, [placeId, days, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTags = useCallback(() => {
    supabase.rpc("shop_customer_tags", { p_place: placeId }).then(({ data, error }) => setTags(error ? null : ((data as Tag[]) || [])), () => setTags(null));
  }, [placeId]);
  useEffect(() => { loadTags(); }, [loadTags, reload]);

  const grouped = Boolean(list?.some((v) => v.first_visit !== undefined));
  const fits = useCallback((v: Visitor, g: string) => {
    if (g === "all") return true;
    if (g.startsWith("tag:")) return (v.tag_ids || []).includes(g.slice(4));
    return AUTO.find((a) => a.id === g)?.fits(v) ?? true;
  }, []);
  const shown = useMemo(() => (list || []).filter((v) => fits(v, group)), [list, group, fits]);
  const reachable = useMemo(() => shown.filter((v) => v.can_offer), [shown]);
  const allOn = reachable.length > 0 && reachable.every((v) => picked.has(v.user_id));
  const groupLabel = group === "all" ? "" : group.startsWith("tag:") ? tags?.find((t) => `tag:${t.id}` === group)?.label ?? "" : AUTO.find((a) => a.id === group)?.label ?? "";
  // The button names the group when exactly that group's reachable people are picked.
  const wholeGroup = groupLabel && allOn && picked.size === reachable.length;

  function pickGroup(g: string) {
    const a = AUTO.find((x) => x.id === g);
    if (a?.days && days < a.days) setDays(a.days);
    setGroup(g);
    setPicked(() => new Set());
  }
  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function setTag(v: Visitor, t: Tag, on: boolean) {
    const { error } = await supabase.rpc("set_customer_tag", { p_place: placeId, p_user: v.user_id, p_tag: t.id, p_on: on });
    if (error) { toast(friendlyOfferError(error)); return; }
    const ids = on ? [...(v.tag_ids || []), t.id] : (v.tag_ids || []).filter((x) => x !== t.id);
    setList((xs) => (xs || []).map((x) => (x.user_id === v.user_id ? { ...x, tag_ids: ids } : x)));
    setTagging((cur) => (cur && cur.user_id === v.user_id ? { ...cur, tag_ids: ids } : cur));
    setTags((ts) => (ts || []).map((x) => (x.id === t.id ? { ...x, people: x.people + (on ? 1 : -1) } : x)));
  }

  const count = (g: string) => (list || []).filter((v) => fits(v, g)).length;
  const tagById = new Map((tags || []).map((t) => [t.id, t]));

  return (
    <div className="stack" style={{ gap: 10, paddingBottom: picked.size ? 72 : 0 }}>
      <div className="mg-group-title">
        <span className="icon-chip sm sky"><Icon name="people" size={16} /></span>
        <span className="grow">Who scanned</span>
        {list && list.length > 0 && <span className="badge gray">{list.length}</span>}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {DAYS.map((d) => (
          <button key={d} type="button" className={`chip ${days === d ? "on" : ""}`} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>
        ))}
      </div>

      {grouped && (
        <nav className="chips scroll vg-groups" aria-label="Customer groups">
          <button type="button" className={`chip ${group === "all" ? "on" : ""}`} aria-pressed={group === "all"} onClick={() => pickGroup("all")}>Everyone<span className="vg-n">{list?.length ?? 0}</span></button>
          {AUTO.map((a) => (
            <button key={a.id} type="button" className={`chip ${group === a.id ? "on" : ""}`} aria-pressed={group === a.id} onClick={() => pickGroup(a.id)}>
              <Icon name={a.icon} size={14} />{a.label}<span className="vg-n">{count(a.id)}</span>
            </button>
          ))}
          {(tags || []).map((t) => (
            <button key={t.id} type="button" className={`chip vg-tagchip ${t.color} ${group === `tag:${t.id}` ? "on" : ""}`} aria-pressed={group === `tag:${t.id}`} onClick={() => pickGroup(`tag:${t.id}`)}>
              <Icon name="tag" size={14} />{t.label}<span className="vg-n">{count(`tag:${t.id}`)}</span>
            </button>
          ))}
          {tags && <button type="button" className="chip dashed" onClick={() => setManaging(true)}><Icon name={tags.length ? "edit" : "plus"} size={14} />{tags.length ? "Tags" : "New tag"}</button>}
        </nav>
      )}

      <div className="row" style={{ gap: 8 }}>
        <p className="tiny muted row grow" style={{ gap: 6, margin: 0 }}><Icon name="lock" size={13} />Names only, never emails, phones or reviews. Tags are private to you.</p>
        {reachable.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => setPicked(() => (allOn ? new Set() : new Set(reachable.map((v) => v.user_id))))}>
            <Icon name={allOn ? "close" : "checkCircle"} size={15} />{allOn ? "Clear" : "Pick all"}
          </button>
        )}
      </div>
      {err && <div className="notice err small">{err}</div>}
      {list === null ? <div className="skeleton" style={{ height: 72 }} /> : shown.length === 0 ? (
        !err && <p className="small muted">{group === "all" ? `Nobody yet in the last ${days} days. People appear here after they scan a table QR code.` : `Nobody in ${groupLabel || "this group"} in the last ${days} days.`}</p>
      ) : (
        <div className="menu">
          {shown.map((v) => {
            const name = v.display_name || (v.is_guest ? "Guest" : "Customer");
            const on = picked.has(v.user_id);
            const sub = [v.visits > 1 ? `${v.visits} visits` : "1 visit", timeAgo(v.last_visit), v.last_table].filter(Boolean).join(" · ");
            const mine = (v.tag_ids || []).map((id) => tagById.get(id)).filter((t): t is Tag => Boolean(t));
            return (
              <div key={v.user_id} className="menu-row vg-row">
                <button type="button" className="vg-pick" style={v.can_offer ? undefined : { opacity: 0.6 }} disabled={!v.can_offer} aria-pressed={on} aria-label={`${on ? "Unpick" : "Pick"} ${name}`} onClick={() => toggle(v.user_id)}>
                  <Avatar id={v.user_id} name={name} path={v.avatar_path} size="sm" />
                  <span className="grow stack tight" style={{ minWidth: 0 }}>
                    <span className="t ellipsis">{name}{v.at_shop && <span title="Scanned at the shop" style={{ marginLeft: 5, verticalAlign: -2 }}><Icon name="verified" size={14} color="var(--accent)" /></span>}</span>
                    <span className="s ellipsis">{v.can_offer ? sub : v.last_offer_at && Date.now() - new Date(v.last_offer_at).getTime() < DAY ? `Already got an offer ${timeAgo(v.last_offer_at)}` : "Turned offers off"}</span>
                    {mine.length > 0 && <span className="vg-tags">{mine.map((t) => <span key={t.id} className={`vg-tag ${t.color}`}>{t.label}</span>)}</span>}
                  </span>
                  <Icon name={on ? "checkCircle" : "plus"} size={18} color={on ? "var(--accent)" : "var(--muted)"} />
                </button>
                {tags && <button type="button" className="mg-act" aria-label={`Tags for ${name}`} title="Tags" onClick={() => setTagging(v)}><Icon name="tag" size={16} /></button>}
              </div>
            );
          })}
        </div>
      )}
      {picked.size > 0 && (
        <div className="mg-sticky">
          <button type="button" className="btn green block" onClick={onWrite}><Icon name="gift" size={18} />{wholeGroup ? `Write offer to ${groupLabel} (${picked.size})` : `Write offer to ${picked.size}`}</button>
        </div>
      )}

      {tagging && tags && (
        <PersonTags who={tagging} tags={tags} onToggle={(t, on) => void setTag(tagging, t, on)} onNew={() => { setTagging(null); setManaging(true); }} onClose={() => setTagging(null)} />
      )}
      {managing && <TagManager placeId={placeId} tags={tags || []} onChanged={loadTags} onClose={() => setManaging(false)} />}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row"><h2 className="grow" style={{ margin: 0, fontSize: 20 }}>{title}</h2><button type="button" className="mg-act" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** One person's tags: tap to put on or take off. */
function PersonTags({ who, tags, onToggle, onNew, onClose }: { who: Visitor; tags: Tag[]; onToggle: (t: Tag, on: boolean) => void; onNew: () => void; onClose: () => void }) {
  const name = who.display_name || (who.is_guest ? "Guest" : "Customer");
  return (
    <Sheet title={`Tags for ${name}`} onClose={onClose}>
      {tags.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No tags yet. Make a few, like VIP, Family or Office lunch.</p> : (
        <div className="row wrap" style={{ gap: 8 }}>
          {tags.map((t) => {
            const on = (who.tag_ids || []).includes(t.id);
            return <button key={t.id} type="button" className={`chip vg-tagchip ${t.color} ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onToggle(t, !on)}><Icon name={on ? "check" : "tag"} size={14} />{t.label}</button>;
          })}
        </div>
      )}
      <button type="button" className="btn ghost block" onClick={onNew}><Icon name="plus" size={18} />New tag</button>
      <p className="tiny muted" style={{ margin: 0 }}>Only you see tags. If {name} hides from your shop, their tags go too.</p>
    </Sheet>
  );
}

/** Make, rename, recolour and delete the shop's tags (up to 12). Tap a tag to edit it. */
function TagManager({ placeId, tags, onChanged, onClose }: { placeId: string; tags: Tag[]; onChanged: () => void; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<TagColor>("sky");
  const [editing, setEditing] = useState<Tag | null>(null);
  const [busy, setBusy] = useState(false);

  function edit(t: Tag | null) {
    setEditing(t);
    setLabel(t ? t.label : "");
    setColor(t ? t.color : "sky");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("save_customer_tag", { p_place: placeId, p_label: label.trim(), p_color: color, p_id: editing?.id ?? null });
    setBusy(false);
    if (error) { toast(friendlyOfferError(error)); return; }
    if (editing) toast("Tag saved");
    edit(null); onChanged();
  }
  async function remove(t: Tag) {
    if (!(await confirm({ title: `Delete “${t.label}”?`, body: t.people ? `It comes off ${t.people} ${t.people === 1 ? "person" : "people"}.` : undefined, ok: "Delete", danger: true }))) return;
    const { error } = await supabase.rpc("delete_customer_tag", { p_place: placeId, p_id: t.id });
    if (error) { toast(friendlyOfferError(error)); return; }
    if (editing?.id === t.id) edit(null);
    onChanged();
  }

  return (
    <Sheet title="Your customer tags" onClose={onClose}>
      {tags.length > 0 && (
        <div className="sheet-list">
          <div className="menu">
            {tags.map((t) => (
              <div key={t.id} className={`menu-row vg-row ${editing?.id === t.id ? "vg-editing" : ""}`}>
                <button type="button" className="vg-pick" aria-label={`Edit ${t.label}`} onClick={() => edit(editing?.id === t.id ? null : t)}>
                  <span className={`vg-tag ${t.color}`}>{t.label}</span>
                  <span className="grow tiny muted">{t.people} {t.people === 1 ? "person" : "people"}</span>
                  <Icon name="edit" size={15} color="var(--muted)" />
                </button>
                <button type="button" className="mg-act" aria-label={`Delete ${t.label}`} onClick={() => void remove(t)}><Icon name="trash" size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {editing || tags.length < 12 ? (
        <form className="stack" style={{ gap: 10 }} onSubmit={save}>
          {editing && <span className="tiny muted">Editing “{editing.label}”</span>}
          <input className="input" value={label} maxLength={24} onChange={(e) => setLabel(e.target.value)} placeholder="VIP, Family, Office lunch…" aria-label="Tag name" />
          <div className="row" style={{ gap: 8 }} role="radiogroup" aria-label="Colour">
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`vg-swatch ${c} ${color === c ? "on" : ""}`} onClick={() => setColor(c)} />
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {editing && <button type="button" className="btn ghost grow" onClick={() => edit(null)}>Cancel</button>}
            <button className="btn green grow block" disabled={busy || !label.trim()}><Icon name={editing ? "check" : "plus"} size={18} />{busy ? "Saving…" : editing ? "Save tag" : "Add tag"}</button>
          </div>
        </form>
      ) : <p className="small muted" style={{ margin: 0 }}>That's the most tags a shop can have. Delete one to make another.</p>}
      <p className="tiny muted" style={{ margin: 0 }}>Tags help you send the right offer to the right people. Keep them about visits, not about the person: no notes, no reviews.</p>
    </Sheet>
  );
}
