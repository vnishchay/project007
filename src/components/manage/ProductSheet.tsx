import { useEffect, useRef, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { placeMediaUrl, removePlaceMedia, uploadPlaceMedia } from "../../lib/media";
import type { Item, Topic } from "../../lib/types";
import type { Mode } from "../../lib/modes";
import { Icon, useToast } from "../ui";
import { DIET_OPTIONS } from "../place/shop";

export function friendlyItemError(e: unknown): string {
  const t = errorText(e);
  if (/duplicate key|items_place_id_name_normalized/i.test(t)) return "You already have a product with this name";
  return t;
}

/** Add or edit one product: photo, name, price, topic and a short line. */
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function ProductSheet({ placeId, item, topics, mode, reviews, nextSort, defaultTopic, canRename, taken, onClose, onSaved, onDeleted }: {
  placeId: string;
  item: Item | null;
  topics: Topic[];
  mode: Mode;
  reviews: number;
  nextSort: number;
  defaultTopic: number | null;
  canRename: boolean;
  taken: string[];
  onClose: () => void;
  onSaved: (it: Item, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const fileIn = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item?.price_inr != null ? String(item.price_inr) : "");
  const [topic, setTopic] = useState<number | null>(item ? item.topic_id : defaultTopic);
  const [desc, setDesc] = useState(item?.description ?? "");
  const [section, setSection] = useState(item?.section ?? "");
  const [diet, setDiet] = useState<string[]>(item?.diet ?? []);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(placeMediaUrl(item?.image_path));
  const [previewBad, setPreviewBad] = useState(false);
  const chips = useRef<HTMLDivElement>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hideOffer, setHideOffer] = useState(false);
  const nameLocked = Boolean(item) && reviews > 0 && !canRename;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  useEffect(() => { chips.current?.querySelector(".chip.on")?.scrollIntoView({ inline: "center", block: "nearest" }); }, []);
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f); setDropPhoto(false); setPreviewBad(false); setPreview(URL.createObjectURL(f));
  }

  const [dinerPhotos, setDinerPhotos] = useState<{ path: string; url: string }[]>([]);

  useEffect(() => {
    if (!item?.id) return;
    supabase
      .from("reviews")
      .select("photo_path")
      .eq("item_id", item.id)
      .not("photo_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (data && data.length) {
          const list = (data as { photo_path: string | null }[])
            .filter((r): r is { photo_path: string } => Boolean(r.photo_path))
            .map((r) => ({
              path: r.photo_path,
              url: supabase.storage.from("review-photos").getPublicUrl(r.photo_path).data.publicUrl,
            }));
          setDinerPhotos(list);
        }
      });
  }, [item?.id]);

  async function useDinerPhoto(dp: { path: string; url: string }) {
    setBusy(true);
    try {
      const res = await fetch(dp.url);
      const blob = await res.blob();
      const dinerFile = new File([blob], "diner-dish-photo.jpg", { type: "image/jpeg" });
      pick(dinerFile);
      toast(`Customer photo selected for this ${mode.item}!`);
    } catch {
      toast("Could not use customer photo");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, " ");
    if (!n) { setErr("Give it a name"); return; }
    if ((!item || norm(item.name) !== norm(n)) && taken.some((t) => norm(t) === norm(n))) { setErr("You already have a product with this name"); return; }
    const p = price.trim() ? Math.round(Number(price)) : null;
    if (p != null && (!Number.isFinite(p) || p < 0)) { setErr("Check the price"); return; }
    setBusy(true); setErr("");
    let image_path = dropPhoto ? null : item?.image_path ?? null;
    if (file) {
      try { image_path = await uploadPlaceMedia(placeId, file, 1200); } catch (x) {
        setBusy(false);
        const m = `Photo didn't upload: ${errorText(x)}`;
        setErr(m); toast(m);
        return;
      }
    }
    const row = { name: n, price_inr: p, topic_id: topic, description: desc.trim() || null, image_path, is_listed: true,
      diet: diet.length ? diet : null,
      ...(section.trim() || item?.section ? { section: section.trim().slice(0, 40) || null } : {}), ...(item && !item.is_listed ? { sort_order: nextSort } : {}) };
    let res = item
      ? await supabase.from("items").update(nameLocked ? { ...row, name: item.name } : row).eq("id", item.id).select("*").single()
      : await supabase.from("items").insert({ ...row, place_id: placeId, sort_order: nextSort, is_hidden: false }).select("*").single();
    if (res.error && (res.error.code === "42703" || /column "diet"/i.test(res.error.message))) {
      const { diet: _d, ...noDiet } = row;
      res = item
        ? await supabase.from("items").update(nameLocked ? { ...noDiet, name: item.name } : noDiet).eq("id", item.id).select("*").single()
        : await supabase.from("items").insert({ ...noDiet, place_id: placeId, sort_order: nextSort, is_hidden: false }).select("*").single();
    }
    setBusy(false);
    if (res.error) {
      if (file && image_path) removePlaceMedia(image_path).catch(() => {});
      setErr(friendlyItemError(res.error));
      return;
    }
    if (item?.image_path && item.image_path !== image_path) removePlaceMedia(item.image_path).catch(() => {});
    toast(item ? "Saved" : "Added");
    onSaved(res.data as Item, !item);
  }

  async function remove() {
    if (!item || !confirm(`Delete “${item.name}”?`)) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase.from("items").delete().eq("id", item.id).select("id");
    setBusy(false);
    if (error || !data?.length) {
      setErr(error ? `${friendlyItemError(error)}. You can hide it instead.` : "This product has reviews, so it stays. Hide it instead.");
      setHideOffer(true);
      return;
    }
    removePlaceMedia(item.image_path).catch(() => {});
    toast("Deleted");
    onDeleted(item.id);
  }

  async function hide() {
    if (!item) return;
    const { data, error } = await supabase.from("items").update({ is_hidden: true }).eq("id", item.id).select("*").single();
    if (error) { setErr(friendlyItemError(error)); return; }
    toast("Hidden from customers");
    onSaved(data as Item, false);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet mg-sheet" role="dialog" aria-modal="true" aria-label={item ? `Edit ${mode.item}` : `Add ${mode.item}`} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="mg-grabber" />
        <div className="mg-sheet-head">
          <span className={`icon-chip sm ${item ? "sky" : ""}`}><Icon name={item ? "edit" : "plus"} size={16} /></span>
          <h2>{item ? `Edit ${mode.item}` : `New ${mode.item}`}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>

        <button type="button" className={`mg-photo ${preview && !dropPhoto && !previewBad ? "has" : ""}`} onClick={() => fileIn.current?.click()} aria-label={preview ? "Change photo" : "Add photo"}>
          {preview && !dropPhoto && !previewBad ? <img src={preview} alt="" onError={() => setPreviewBad(true)} /> : (
            <span className="mg-photo-cta">
              <span className="icon-chip lg amber"><Icon name="imagePlus" size={26} /></span>
              Add photo
            </span>
          )}
          {preview && !dropPhoto && !previewBad && (
            <span className="mg-photo-tools">
              <span className="mg-cam" aria-hidden="true"><Icon name="camera" size={18} /></span>
              <span className="mg-cam" role="button" tabIndex={0} aria-label="Remove photo"
                onClick={(e) => { e.stopPropagation(); setFile(null); setDropPhoto(true); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setFile(null); setDropPhoto(true); } }}><Icon name="trash" size={17} /></span>
            </span>
          )}
        </button>
        <input ref={fileIn} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />

        {dinerPhotos.length > 0 && (
          <div className="stack tight" style={{ marginTop: 4, marginBottom: 6 }}>
            <span className="tiny muted strong row" style={{ gap: 4, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>
              <Icon name="camera" size={11} color="var(--ink-2)" /> Photos shared by customers
            </span>
            <div className="row" style={{ gap: 8, overflowX: "auto", paddingBottom: 4 }}>
              {dinerPhotos.map((dp) => (
                <button
                  key={dp.path}
                  type="button"
                  title={`Use as ${mode.item} picture`}
                  aria-label={`Use customer photo as ${mode.item} picture`}
                  onClick={() => useDinerPhoto(dp)}
                  style={{
                    border: "1.5px solid var(--line)",
                    borderRadius: 8,
                    overflow: "hidden",
                    width: 52,
                    height: 52,
                    padding: 0,
                    cursor: "pointer",
                    flexShrink: 0,
                    position: "relative",
                  }}
                >
                  <img src={dp.url} alt="Customer photo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label className="mg-label" htmlFor="pn"><Icon name="tag" size={15} />Name</label>
          <input id="pn" className="input" required maxLength={80} value={name} disabled={nameLocked} onChange={(e) => setName(e.target.value)} placeholder={mode.itemExample} />
          {nameLocked && <span className="mg-locked"><Icon name="lock" size={13} />Has reviews, so the name stays</span>}
        </div>

        <div className="field">
          <label className="mg-label" htmlFor="pp"><Icon name="rupee" size={15} />Price</label>
          <div className="mg-input-icon">
            <Icon name="rupee" size={16} />
            <input id="pp" className="input" inputMode="numeric" type="number" min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        {topics.length > 0 && (
          <div className="field">
            <span className="mg-label"><Icon name="grid" size={15} />Type</span>
            <div ref={chips} className="chips scroll" role="radiogroup" aria-label="Type">
              {topics.map((t) => (
                <button type="button" key={t.id} role="radio" aria-checked={topic === t.id} className={`chip ${topic === t.id ? "on" : ""}`} onClick={() => setTopic(topic === t.id ? null : t.id)}>{t.name}</button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label className="mg-label" htmlFor="ps"><Icon name="list" size={15} />Section <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label>
          <input id="ps" className="input" maxLength={40} value={section} onChange={(e) => setSection(e.target.value)} placeholder={mode.sections[0] ?? "Best sellers"} />
          {mode.sections.length > 0 && (
            <div className="chips scroll" role="group" aria-label="Section ideas">
              {mode.sections.map((s) => (
                <button type="button" key={s} className={`chip ${section.trim().toLowerCase() === s.toLowerCase() ? "on" : ""}`} onClick={() => setSection(section === s ? "" : s)}>{s}</button>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <span className="mg-label"><Icon name="tag" size={15} />Dietary tags <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></span>
          <div className="chips scroll" role="group" aria-label="Dietary tags">
            {DIET_OPTIONS.map((d) => {
              const active = diet.includes(d.id);
              return (
                <button
                  type="button"
                  key={d.id}
                  className={`chip ${active ? "on" : ""}`}
                  onClick={() => setDiet(active ? diet.filter((x) => x !== d.id) : [...diet, d.id])}
                  style={active ? { borderColor: d.color, color: d.color } : {}}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: d.color, display: "inline-block", marginRight: 5 }} />
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label className="mg-label" htmlFor="pd"><Icon name="message" size={15} />Short line</label>
          <input id="pd" className="input" maxLength={140} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="One line customers should know" />
        </div>

        {err && <div className="notice err small" role="alert">{err}</div>}
        {hideOffer && <button type="button" className="btn ghost block" onClick={hide}><Icon name="eyeOff" size={18} />Hide instead</button>}

        <div className="row">
          {item && reviews === 0 && (
            <button type="button" className="btn danger" aria-label="Delete product" disabled={busy} onClick={remove} style={{ width: 52, padding: 0 }}><Icon name="trash" size={19} /></button>
          )}
          <button className="btn green grow" disabled={busy}>{busy ? "Saving…" : <><Icon name="check" size={19} />{item ? "Save" : `Add ${mode.item}`}</>}</button>
        </div>
      </form>
    </div>
  );
}
