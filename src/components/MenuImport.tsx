import { useRef, useState } from "react";
import { supabase, errorText } from "../lib/supabase";
import { shrinkImage } from "../lib/media";
import { callAi } from "../lib/assist";
import type { Mode } from "../lib/modes";
import { Icon, Spinner, useToast } from "./ui";

interface Row { name: string; price_inr: number | null; section: string; description: string; keep: boolean }

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Snap the menu or price list, AI reads it into products, the owner checks and saves.
 * The photos go to the "ai" edge function and aren't stored.
 */
export function MenuImport({ placeId, mode, nextSort, onClose, onSaved }: {
  placeId: string; mode: Mode; nextSort: number; onClose: () => void; onSaved: (count: number) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | false>(false);
  const [err, setErr] = useState("");

  async function read() {
    setErr(""); setBusy("Reading your menu…");
    try {
      const images = await Promise.all(files.map(async (f) => ({ data: await toBase64(await shrinkImage(f, 1600, 0.8)), media_type: "image/jpeg" })));
      const j = await callAi<{ items?: Omit<Row, "keep">[] }>("menu", { placeId, images });
      if (!j.items) throw new Error("Couldn't read the menu. Try a clearer photo.");
      if (!j.items.length) throw new Error(`No ${mode.itemPlural} found in this photo. Try a closer, straighter shot.`);
      setRows(j.items.map((i) => ({ ...i, keep: true })));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const keep = (rows || []).filter((r) => r.keep && r.name.trim());
    if (!keep.length) return;
    setBusy(`Adding ${keep.length}…`);
    const { error } = await supabase.from("items").upsert(
      keep.map((r, i) => ({
        place_id: placeId, name: r.name.trim(), price_inr: r.price_inr, section: r.section.trim() || null,
        description: r.description.trim() || null, is_listed: true, is_hidden: false, sort_order: nextSort + i,
      })),
      { onConflict: "place_id,name_normalized" },
    );
    setBusy(false);
    if (error) { setErr(errorText(error)); return; }
    toast(`${keep.length} ${keep.length === 1 ? mode.item : mode.itemPlural} added`);
    onSaved(keep.length);
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const kept = rows?.filter((r) => r.keep).length ?? 0;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mg-sheet" role="dialog" aria-modal="true" aria-label="Add from a menu photo" onClick={(e) => e.stopPropagation()}>
        <div className="mg-sheet-head">
          <span className="icon-chip coral"><Icon name="camera" size={20} /></span>
          <h2>{rows ? `Check your ${mode.catalog.toLowerCase()}` : `${mode.catalog} from a photo`}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>

        {busy ? <div className="stack center" style={{ padding: 24 }}><Spinner /><span className="small muted">{busy}</span></div> : !rows ? (
          <>
            <p className="small muted">Take a clear photo of your menu or price list. Up to 4 pages. We read the {mode.itemPlural} and prices; you check them before anything is saved.</p>
            <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden
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
            {err && <div className="notice err">{err}</div>}
            <button className="btn green block" disabled={!files.length} onClick={read}><Icon name="spark" size={18} />Read my {mode.catalog.toLowerCase()}</button>
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
            {err && <div className="notice err">{err}</div>}
            <div className="row">
              <button className="btn ghost" onClick={() => { setRows(null); setErr(""); }}><Icon name="camera" size={18} /></button>
              <button className="btn green grow" disabled={!kept} onClick={save}><Icon name="check" size={18} />Add {kept} {kept === 1 ? mode.item : mode.itemPlural}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
