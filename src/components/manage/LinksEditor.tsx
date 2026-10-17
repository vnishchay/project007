import { useEffect, useRef, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { guessLinkKind, LinkIcon, linkLabel, LINK_KINDS } from "../LinkIcon";
import type { Place } from "../../lib/types";
import { Icon, useToast } from "../ui";

export type PlaceLink = NonNullable<Place["links"]>[number];
type Row = { kind: string; url: string; label: string; key: string };

const MAX = 12;
const DEFAULT_LABEL: Record<string, string> = {
  swiggy: "Swiggy", zomato: "Zomato", magicpin: "magicpin", eatsure: "EatSure",
  instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", whatsapp: "WhatsApp us", website: "Website",
  phone: "Call us", email: "Email us", maps: "Directions", justdial: "Justdial", other: "Link",
};
const QUICK: { kind: string; hint: string }[] = [
  { kind: "swiggy", hint: "Paste your Swiggy link" },
  { kind: "zomato", hint: "Paste your Zomato link" },
  { kind: "instagram", hint: "@yourshop or Instagram link" },
  { kind: "whatsapp", hint: "WhatsApp number, e.g. 98xxxxxxxx" },
  { kind: "website", hint: "yourshop.com" },
];

const kindName = (k: string) => LINK_KINDS.find((x) => x.kind === k)?.label ?? "Link";
const key = () => Math.random().toString(36).slice(2);

/** Turns what the owner typed into a link the database accepts, or null. */
export function normalizeLink(raw: string, hint?: string): string | null {
  let t = raw.trim();
  if (!t) return null;
  const digits = t.replace(/[^\d]/g, "");
  if (hint === "whatsapp" && /^[+\d\s()-]+$/.test(t)) {
    const num = digits.length === 10 ? `91${digits}` : digits;
    return num.length >= 10 ? `https://wa.me/${num}` : null;
  }
  if (hint === "instagram" && /^@?[\w.]{2,30}$/.test(t)) return `https://instagram.com/${t.replace(/^@/, "")}`;
  if (/^\+?[\d\s()-]{7,}$/.test(t)) return digits.length >= 7 ? `tel:${t.startsWith("+") ? "+" : ""}${digits}` : null;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t)) return `mailto:${t}`;
  if (/^(tel:|mailto:)/i.test(t)) return t;
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    return /\./.test(u.hostname) ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

const shortUrl = (u: string) => u.replace(/^(https?:\/\/(www\.)?|tel:|mailto:)/i, "").replace(/\/$/, "");

/** Swiggy, Zomato, Instagram, website…: one tidy list of links on the shop page. */
export function LinksEditor({ placeId, links, onSaved }: { placeId: string; links: PlaceLink[]; onSaved: (l: PlaceLink[]) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => links.map((l) => ({ kind: l.kind, url: l.url, label: l.label ?? "", key: key() })));
  const [url, setUrl] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const saved = JSON.stringify(links.map(({ kind, url, label }) => ({ kind, url, label: (label ?? "").trim() })));
  const current = rows.map(({ kind, url, label }) => ({ kind, url, label: label.trim() }));
  const dirty = JSON.stringify(current) !== saved;

  useEffect(() => { if (hint) input.current?.focus(); }, [hint]);

  function add(e?: React.FormEvent) {
    e?.preventDefault();
    setErr("");
    if (rows.length >= MAX) { setErr(`Up to ${MAX} links.`); return; }
    const u = normalizeLink(url, hint ?? undefined);
    if (!u) { setErr(hint === "whatsapp" ? "Enter a full phone number." : "That doesn't look like a link."); return; }
    if (rows.some((r) => r.url === u)) { setErr("That link is already in your list."); return; }
    let kind = guessLinkKind(u);
    if (hint && (kind === "website" || kind === "other") && hint !== "website") kind = hint;
    setRows((xs) => [...xs, { kind, url: u, label: DEFAULT_LABEL[kind] ?? kindName(kind), key: key() }]);
    setUrl(""); setHint(null);
  }

  const move = (i: number, d: -1 | 1) => setRows((xs) => {
    const j = i + d;
    if (j < 0 || j >= xs.length) return xs;
    const c = [...xs];
    [c[i], c[j]] = [c[j]!, c[i]!];
    return c;
  });
  const patch = (k: string, label: string) => setRows((xs) => xs.map((r) => (r.key === k ? { ...r, label } : r)));
  const remove = (k: string) => setRows((xs) => xs.filter((r) => r.key !== k));

  async function save() {
    setBusy(true); setErr("");
    const clean = current.map((l) => ({ ...l, label: l.label || linkLabel(l) }));
    const { error } = await supabase.from("places").update({ links: clean }).eq("id", placeId);
    setBusy(false);
    if (error) { setErr(errorText(error)); return; }
    onSaved(clean);
    toast("Links saved");
  }

  const has = new Set(rows.map((r) => r.kind));

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="mg-section">
        <div className="mg-section-head"><span className="icon-chip sm violet"><Icon name="link" size={16} /></span><span className="grow">Your links</span><span className="tiny muted">{rows.length}/{MAX}</span></div>
        <p className="small muted" style={{ marginTop: -6 }}>Delivery apps, socials, WhatsApp: one tap from your page.</p>
        <div className="ln-quick" role="group" aria-label="Quick add">
          {QUICK.filter((q) => !has.has(q.kind) || q.kind === "website").map((q) => (
            <button type="button" key={q.kind} className={`ln-chip ${hint === q.kind ? "on" : ""}`} onClick={() => { setHint(hint === q.kind ? null : q.kind); setErr(""); }}>
              <LinkIcon kind={q.kind} size={22} />{kindName(q.kind)}
            </button>
          ))}
        </div>
        <form className="gf-bar" onSubmit={add}>
          {hint ? <LinkIcon kind={hint} size={24} /> : <Icon name="link" size={18} color="var(--muted)" />}
          <input ref={input} className="grow" value={url} onChange={(e) => { setUrl(e.target.value); setErr(""); }}
            inputMode={hint === "whatsapp" ? "tel" : "url"} aria-label="Link to add"
            placeholder={QUICK.find((q) => q.kind === hint)?.hint ?? "Paste any link"} />
          <button className="btn small green" disabled={!url.trim()}><Icon name="plus" size={16} />Add</button>
        </form>
        {err && <div className="notice err small">{err}</div>}

        {rows.length === 0 ? (
          <div className="ln-empty">
            <span className="ln-empty-art" aria-hidden="true">{["swiggy", "zomato", "instagram", "whatsapp"].map((k) => <LinkIcon key={k} kind={k} size={34} />)}</span>
            <span className="small muted">Add Swiggy, Zomato, Instagram or your website.</span>
          </div>
        ) : (
          <div className="mg-list">
            {rows.map((r, i) => (
              <div key={r.key} className="ln-row">
                <LinkIcon kind={r.kind} size={40} />
                <span className="grow stack tight" style={{ minWidth: 0 }}>
                  <input className="ln-label" value={r.label} maxLength={40} aria-label={`Name for ${shortUrl(r.url)}`} placeholder={kindName(r.kind)} onChange={(e) => patch(r.key, e.target.value)} />
                  <span className="tiny muted ellipsis">{shortUrl(r.url)}</span>
                </span>
                <span className="mg-updown">
                  <button type="button" className="mg-act" aria-label={`Move ${r.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={14} /></button>
                  <button type="button" className="mg-act" aria-label={`Move ${r.label} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}><Icon name="arrowDown" size={14} /></button>
                </span>
                <button type="button" className="mg-act" aria-label={`Remove ${r.label}`} onClick={() => remove(r.key)}><Icon name="trash" size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mg-section">
          <div className="mg-section-head"><span className="icon-chip sm"><Icon name="eye" size={16} /></span>On your page</div>
          <div className="ln-preview">
            {rows.map((r) => (
              <a key={r.key} className="ln-tile" href={r.url} target="_blank" rel="noreferrer">
                <LinkIcon kind={r.kind} size={30} /><span className="ellipsis">{r.label.trim() || kindName(r.kind)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {(dirty || busy) && (
        <div className="mg-savebar">
          <button type="button" className="btn green block" disabled={busy} onClick={save}><Icon name="check" size={19} />{busy ? "Saving…" : "Save links"}</button>
        </div>
      )}
    </div>
  );
}
