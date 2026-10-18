import { useRef, useState } from "react";
import { supabase, errorText } from "../lib/supabase";
import { shrinkImage } from "../lib/media";
import { addPhotos, callAi } from "../lib/assist";
import { LinkIcon, guessLinkKind } from "./LinkIcon";
import type { PlaceLink } from "./place/ShopLinks";
import type { Mode } from "../lib/modes";
import { Icon, Spinner, useToast } from "./ui";

interface Row { name: string; price_inr: number | null; section: string; description: string; keep: boolean }

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

const ONLINE = [{ kind: "zomato", name: "Zomato" }, { kind: "swiggy", name: "Swiggy" }];

/**
 * Snap the menu or price list (or paste it from Zomato / Swiggy), AI reads it into products, the owner
 * checks and saves, and stock pictures are added to the new products. Photos and text go to the "ai"
 * edge function and aren't stored. Zomato and Swiggy don't allow automatic copying, so their menus come
 * in through screenshots or pasted text.
 */
export function MenuImport({ placeId, mode, nextSort, links = [], start = "photo", onClose, onSaved }: {
  placeId: string; mode: Mode; nextSort: number; links?: PlaceLink[]; start?: "photo" | "text"; onClose: () => void; onSaved: (count: number) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | false>(false);
  const [err, setErr] = useState("");
  const [source, setSource] = useState<"photo" | "text">(start);
  const [text, setText] = useState("");
  const [pics, setPics] = useState(true);
  const online = ONLINE.map((o) => ({ ...o, url: links.find((l) => (l.kind || guessLinkKind(l.url)) === o.kind)?.url })).filter((o) => o.url);

  async function read() {
    setErr(""); setBusy("Reading your menu…");
    try {
      const images = source === "photo" ? await Promise.all(files.map(async (f) => {
        // The server takes photos up to about 1.1 MB each; a very detailed one is sent smaller.
        let data = await toBase64(await shrinkImage(f, 1600, 0.8));
        if (data.length > 1_400_000) data = await toBase64(await shrinkImage(f, 1200, 0.7));
        return { data, media_type: "image/jpeg" };
      })) : [];
      const j = await callAi<{ items?: Omit<Row, "keep">[] }>("menu", { placeId, images, ...(source === "text" ? { text } : {}) });
      if (!j.items) throw new Error("Couldn't read the menu. Try a clearer photo.");
      if (!j.items.length) throw new Error(`No ${mode.itemPlural} found. Try a closer, straighter photo, or paste more of the menu.`);
      setRows(j.items.map((i) => ({ ...i, keep: true })));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    // One row per name; names already on the menu are left exactly as the owner set them.
    const seen = new Set<string>();
    const keep = (rows || []).filter((r) => {
      const k = r.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (!r.keep || !k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!keep.length) return;
    setBusy(`Adding ${keep.length}…`);
    const { data: added, error } = await supabase.from("items").upsert(
      keep.map((r, i) => ({
        place_id: placeId, name: r.name.trim(), price_inr: r.price_inr, section: r.section.trim() || null,
        description: r.description.trim() || null, is_listed: true, is_hidden: false, sort_order: nextSort + i,
      })),
      { onConflict: "place_id,name_normalized", ignoreDuplicates: true },
    ).select("id");
    if (error) { setBusy(false); setErr(errorText(error)); return; }
    const count = added?.length ?? keep.length;
    let note = "";
    if (pics) {
      // Up to three rounds of 40, so a big menu gets its pictures in one go.
      try {
        for (let round = 0; round < 3; round++) {
          setBusy(round ? "Finding more pictures…" : "Finding pictures…");
          const r = await addPhotos(placeId);
          if (!r.assigned || !r.remaining) break;
        }
      } catch (e) {
        note = ` Pictures can be added later: ${errorText(e)}`;
      }
    }
    setBusy(false);
    const skipped = keep.length - count;
    toast(`${count} ${count === 1 ? mode.item : mode.itemPlural} added.${skipped ? ` ${skipped} already on your list were left as they are.` : ""}${note}`.trim());
    onSaved(count);
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const kept = rows?.filter((r) => r.keep).length ?? 0;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mg-sheet" role="dialog" aria-modal="true" aria-label="Add your menu" onClick={(e) => e.stopPropagation()}>
        <div className="mg-sheet-head">
          <span className="icon-chip coral"><Icon name="camera" size={20} /></span>
          <h2>{rows ? `Check your ${mode.catalog.toLowerCase()}` : `Add your ${mode.catalog.toLowerCase()}`}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>

        {busy ? <div className="stack center" style={{ padding: 24 }}><Spinner /><span className="small muted">{busy}</span></div> : !rows ? (
          <>
            {online.length > 0 && (
              <div className="mi-online">
                {online.map((o) => <LinkIcon key={o.kind} kind={o.kind} size={34} />)}
                <span className="grow stack tight">
                  <span className="strong small">Your menu is on {online.map((o) => o.name).join(" and ")}</span>
                  <span className="tiny muted">They don't allow automatic copying, so this takes a minute: open it, then screenshot the menu or select all, copy and paste it here.</span>
                  <span className="row wrap" style={{ gap: 8, marginTop: 4 }}>
                    {online.map((o) => <a key={o.kind} className="btn small ghost" href={o.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} />Open {o.name}</a>)}
                  </span>
                </span>
              </div>
            )}
            <div className="mi-seg" role="tablist" aria-label="How to add your menu">
              <button type="button" role="tab" aria-selected={source === "photo"} className={source === "photo" ? "on" : ""} onClick={() => setSource("photo")}><Icon name="camera" size={16} />Photos</button>
              <button type="button" role="tab" aria-selected={source === "text"} className={source === "text" ? "on" : ""} onClick={() => setSource("text")}><Icon name="copy" size={16} />Paste text</button>
            </div>
            {source === "photo" ? (
              <>
                <p className="small muted">Take a clear photo of your menu or price list, or add screenshots. Up to 4 pages. We read the {mode.itemPlural} and prices; you check them before anything is saved.</p>
                <input ref={input} type="file" accept="image/*" multiple hidden
                  onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files || [])].slice(0, 4)); e.target.value = ""; }} />
                <div className="mi-thumbs">
                  {files.map((f, i) => (
                    <span key={i} className="thumb mi-thumb">
                      <img src={URL.createObjectURL(f)} alt={`Page ${i + 1}`} />
                      <button className="mi-x" aria-label="Remove" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
                    </span>
                  ))}
                  {files.length < 4 && (
                    <button type="button" className="thumb mi-thumb mi-add" onClick={() => input.current?.click()}>
                      <Icon name="imagePlus" size={26} /><span className="tiny strong">{files.length ? "Add page" : "Add photo"}</span>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="small muted">Paste the menu as it appears. Prices, ratings and button text are fine: we pick out the {mode.itemPlural}.</p>
                <textarea className="textarea" rows={7} value={text} maxLength={24000} onChange={(e) => setText(e.target.value)} placeholder={"Margherita Pizza\n₹299\nPeppy Paneer Pizza\n₹349…"} aria-label="Menu text" />
              </>
            )}
            {err && <div className="notice err">{err}</div>}
            <button className="btn green block" disabled={source === "photo" ? !files.length : text.trim().length < 8} onClick={read}><Icon name="spark" size={18} />Read my {mode.catalog.toLowerCase()}</button>
          </>
        ) : (
          <>
            <p className="small muted">Untick anything you don't want. Tap to fix a name or price.</p>
            <div className="mi-rows">
              {rows.map((r, i) => (
                <div key={i} className={`mi-row ${r.keep ? "" : "off"}`}>
                  <input type="checkbox" checked={r.keep} onChange={(e) => set(i, { keep: e.target.checked })} aria-label={`Keep ${r.name}`} />
                  <span className="grow stack tight" style={{ minWidth: 0 }}>
                    <input className="mi-name" value={r.name} maxLength={80} onChange={(e) => set(i, { name: e.target.value })} aria-label="Name" />
                    {(r.section || r.description) && <span className="tiny muted ellipsis">{[r.section, r.description].filter(Boolean).join(" · ")}</span>}
                  </span>
                  <span className="mi-price"><Icon name="rupee" size={13} />
                    <input inputMode="numeric" value={r.price_inr ?? ""} placeholder="–" aria-label="Price"
                      onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10); set(i, { price_inr: Number.isFinite(n) ? n : null }); }} />
                  </span>
                </div>
              ))}
            </div>
            <label className="mi-pics"><input type="checkbox" checked={pics} onChange={(e) => setPics(e.target.checked)} /><span className="grow stack tight"><span className="strong small">Add pictures for me</span><span className="tiny muted">Nice stock photos on every {mode.item}. You can swap in your own any time.</span></span><Icon name="spark" size={18} color="var(--green)" /></label>
            {err && <div className="notice err">{err}</div>}
            <div className="row">
              <button className="btn ghost" aria-label="Start over" onClick={() => { setRows(null); setErr(""); }}><Icon name="refresh" size={18} /></button>
              <button className="btn green grow" disabled={!kept} onClick={save}><Icon name="check" size={18} />Add {kept} {kept === 1 ? mode.item : mode.itemPlural}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
