import { useRef, useState } from "react";
import { supabase, errorText } from "../lib/supabase";
import { shrinkImage } from "../lib/media";
import { renderPdfPages } from "../lib/pdfMenu";
import { callAi } from "../lib/assist";
import type { PlaceLink } from "./place/ShopLinks";
import type { Mode } from "../lib/modes";
import { Icon, Spinner, useToast } from "./ui";
import { DietDot, DIET_OPTIONS } from "./place/shop";

interface Row { name: string; price_inr: number | null; section: string; description: string; diet?: string[]; keep: boolean }

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * AI Menu Onboarding: Vision OCR for photos & PDF, URL scraper for websites,
 * or raw menu text pasting. Parses dishes, prices, and categories in seconds.
 */
export function MenuImport({ placeId, mode, nextSort, links: _links = [], start = "photo", onClose, onSaved }: {
  placeId: string; mode: Mode; nextSort: number; links?: PlaceLink[]; start?: "photo" | "text" | "url"; onClose: () => void; onSaved: (count: number) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState<"photo" | "url" | "text">(start);
  const [files, setFiles] = useState<File[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [rawText, setRawText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | false>(false);
  const [err, setErr] = useState("");

  async function read() {
    setErr("");
    setBusy("Reading your menu with AI…");
    try {
      let payload: Record<string, unknown> = { placeId };

      if (method === "photo") {
        if (!files.length) throw new Error("Add at least one photo or PDF of your menu.");
        const imagePayloads: { data: string; media_type: string }[] = [];
        for (const file of files) {
          if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
            setBusy("Rendering PDF menu pages…");
            const pageBlobs = await renderPdfPages(file, 4);
            for (const b of pageBlobs) {
              imagePayloads.push({ data: await toBase64(b), media_type: "image/jpeg" });
            }
          } else {
            const sh = await shrinkImage(file, 1600, 0.8);
            imagePayloads.push({ data: await toBase64(sh), media_type: "image/jpeg" });
          }
        }
        if (!imagePayloads.length) throw new Error("Could not process the selected files.");
        payload.images = imagePayloads.slice(0, 4);
        setBusy("Analyzing menu with AI…");
      } else if (method === "url") {
        if (!urlInput.trim()) throw new Error("Enter your website or delivery URL.");
        payload.url = urlInput.trim();
      } else {
        if (!rawText.trim()) throw new Error("Paste your menu text first.");
        payload.text = rawText.trim();
      }

      const j = await callAi<{ items?: Omit<Row, "keep">[] }>("menu", payload);
      if (!j.items) throw new Error("Couldn't read the menu. Please check the input and try again.");
      if (!j.items.length) throw new Error(`No ${mode.itemPlural} found. Try a clearer photo, direct website link, or paste text.`);
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
    setBusy(`Adding ${keep.length} dishes…`);
    const itemsToUpsert = keep.map((r, i) => ({
      place_id: placeId,
      name: r.name.trim(),
      price_inr: r.price_inr,
      section: r.section.trim() || null,
      description: r.description.trim() || null,
      diet: r.diet?.length ? r.diet : null,
      is_listed: true,
      is_hidden: false,
      sort_order: nextSort + i,
    }));
    let { error } = await supabase.from("items").upsert(itemsToUpsert, { onConflict: "place_id,name_normalized" });
    if (error && (error.code === "42703" || /column "diet"/i.test(error.message))) {
      const fallbackItems = itemsToUpsert.map(({ diet: _d, ...rest }) => rest);
      const res = await supabase.from("items").upsert(fallbackItems, { onConflict: "place_id,name_normalized" });
      error = res.error;
    }
    setBusy(false);
    if (error) { setErr(errorText(error)); return; }
    toast(`${keep.length} ${keep.length === 1 ? mode.item : mode.itemPlural} added to your menu!`);
    onSaved(keep.length);
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const kept = rows?.filter((r) => r.keep).length ?? 0;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mg-sheet" role="dialog" aria-modal="true" aria-label="Automated AI Menu Onboarding" onClick={(e) => e.stopPropagation()}>
        <div className="mg-sheet-head">
          <span className="icon-chip coral"><Icon name="spark" size={20} /></span>
          <h2>{rows ? `Verify Extracted ${mode.catalog}` : `Automated AI Menu Setup`}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>

        {busy ? (
          <div className="stack center" style={{ padding: 32 }}>
            <Spinner />
            <span className="small muted" style={{ marginTop: 8 }}>{busy}</span>
          </div>
        ) : !rows ? (
          <>
            <div className="pn-seg" role="tablist" aria-label="Import source" style={{ marginBottom: 12 }}>
              <button
                role="tab"
                aria-selected={method === "photo"}
                className={method === "photo" ? "on" : ""}
                onClick={() => setMethod("photo")}
              >
                <Icon name="camera" size={14} /> Photo / PDF
              </button>
              <button
                role="tab"
                aria-selected={method === "url"}
                className={method === "url" ? "on" : ""}
                onClick={() => setMethod("url")}
              >
                <Icon name="globe" size={14} /> Website / Delivery URL
              </button>
              <button
                role="tab"
                aria-selected={method === "text"}
                className={method === "text" ? "on" : ""}
                onClick={() => setMethod("text")}
              >
                <Icon name="edit" size={14} /> Paste Text
              </button>
            </div>

            {method === "photo" && (
              <>
                <p className="small muted">
                  Take a photo of your printed menu or upload up to 4 pages. Our vision model extracts dishes, categories, and prices automatically.
                </p>
                <input
                  ref={input}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  hidden
                  onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files || [])].slice(0, 4)); e.target.value = ""; }}
                />
                <div className="mi-thumbs">
                  {files.map((f, i) => {
                    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
                    return (
                      <span key={i} className="thumb mi-thumb">
                        {isPdf ? (
                          <span style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", background: "var(--bg-sub, #f3f4f6)", borderRadius: 8, padding: 4 }}>
                            <Icon name="fileText" size={24} />
                            <span className="tiny ellipsis" style={{ maxWidth: 60, marginTop: 2, fontSize: 10 }}>PDF</span>
                          </span>
                        ) : (
                          <img src={URL.createObjectURL(f)} alt={`Page ${i + 1}`} />
                        )}
                        <button className="mi-x" aria-label="Remove" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
                      </span>
                    );
                  })}
                  {files.length < 4 && (
                    <button type="button" className="thumb mi-thumb mi-add" onClick={() => input.current?.click()}>
                      <Icon name="imagePlus" size={26} /><span className="tiny strong">{files.length ? "Add page" : "Add photo / PDF"}</span>
                    </button>
                  )}
                </div>
              </>
            )}

            {method === "url" && (
              <div className="stack" style={{ gap: 8 }}>
                <p className="small muted">
                  Paste your website menu, UberEats, DoorDash, or Yelp link. We'll scrape and organize your items in under 30 seconds.
                </p>
                <input
                  className="input"
                  placeholder="e.g. https://www.ubereats.com/store/your-restaurant"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            {method === "text" && (
              <div className="stack" style={{ gap: 8 }}>
                <p className="small muted">
                  Paste plain text copied from your POS system, Word document, or PDF rate sheet:
                </p>
                <textarea
                  className="textarea"
                  placeholder="e.g. Margherita Pizza - $14\nTruffle Fries - $8\nTiramisu - $9"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  rows={4}
                  autoFocus
                />
              </div>
            )}

            {err && <div className="notice err">{err}</div>}

            <button
              className="btn green block"
              disabled={(method === "photo" && !files.length) || (method === "url" && !urlInput.trim()) || (method === "text" && !rawText.trim())}
              onClick={read}
              style={{ marginTop: 8 }}
            >
              <Icon name="spark" size={18} />
              Extract {mode.catalog} with AI (under 30s)
            </button>
          </>
        ) : (
          <>
            <p className="small muted">
              AI extracted <b>{rows.length}</b> {rows.length === 1 ? mode.item : mode.itemPlural}. Untick anything you don't want, or tap to edit:
            </p>
            <div className="mi-rows">
              {rows.map((r, i) => (
                <div key={i} className={`mi-row ${r.keep ? "" : "off"}`}>
                  <input type="checkbox" checked={r.keep} onChange={(e) => set(i, { keep: e.target.checked })} aria-label={`Keep ${r.name}`} />
                  <span className="grow stack tight" style={{ minWidth: 0 }}>
                    <span className="row" style={{ alignItems: "center", gap: 4 }}>
                      <DietDot diet={r.diet} />
                      <input className="mi-name" value={r.name} maxLength={80} onChange={(e) => set(i, { name: e.target.value })} aria-label="Name" />
                    </span>
                    {(r.section || r.description) && (
                      <span className="tiny muted ellipsis">{[r.section, r.description].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                  <span className="mi-price">
                    <span className="tiny muted">$</span>
                    <input
                      inputMode="numeric"
                      value={r.price_inr ?? ""}
                      placeholder="–"
                      aria-label="Price"
                      onChange={(e) => {
                        const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                        set(i, { price_inr: Number.isFinite(n) ? n : null });
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
            {err && <div className="notice err">{err}</div>}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn ghost" onClick={() => { setRows(null); setErr(""); }}>
                <Icon name="back" size={18} /> Re-extract
              </button>
              <button className="btn green grow" disabled={!kept} onClick={save}>
                <Icon name="check" size={18} /> Save {kept} {kept === 1 ? mode.item : mode.itemPlural}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
