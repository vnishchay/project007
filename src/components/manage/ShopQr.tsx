import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import type { Place, QrCode, QrStyle } from "../../lib/types";
import { byTableLabel } from "../../lib/types";
import { qrUrl, QR_STYLES } from "../../lib/util";
import { BrandQr, brandQrPngDataUrl, Icon, useConfirm, useToast } from "../ui";
import { bizOf, spotLabel } from "../../lib/modes";
import { markPrinted } from "./Insights";
import { NfcSheet } from "./NfcSheet";
import { WalletButton } from "../WalletButton";

export async function downloadQr(placeName: string, c: QrCode) {
  const col = QR_STYLES[c.style];
  const url = await brandQrPngDataUrl(qrUrl(c.token), col.dark, col.light);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${placeName}-${c.table_label || "qr"}.png`.replace(/[^\w.-]+/g, "_");
  a.click();
}

/** Printable table cards, one per active code. Shown only when printing. */
export function QrPrintSheet({ place, codes, topItem }: { place: Pick<Place, "name" | "area">; codes: QrCode[]; topItem?: string }) {
  return (
    <div className="print-only stack" style={{ gap: 24 }}>
      {codes.filter((c) => c.active).map((c) => {
        const col = QR_STYLES[c.style];
        return (
          <div key={c.id} className={`qr-card ${c.style === "paper" ? "" : "neon"}`} style={{ maxWidth: 380, margin: "0 auto" }}>
            <span className="small strong" style={{ opacity: 0.7 }}>{[c.table_label, place.area].filter(Boolean).join(" · ")}</span>
            <span style={{ fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em" }}>{place.name}</span>
            <BrandQr text={qrUrl(c.token)} size={200} dark={col.dark} light={col.light} />
            <span className="strong">Scan to see what people love here</span>
            <span className="small" style={{ opacity: 0.7 }}>and rate your visit</span>
            {topItem && <span className="small" style={{ opacity: 0.7 }}>{topItem}</span>}
            <span className="small strong" style={{ color: c.style === "paper" ? "var(--accent)" : col.dark }}>● Trusted Picks</span>
          </div>
        );
      })}
    </div>
  );
}

/** For the owner: make more table codes, up to what the plan allows, or go buy more. */
function AddQrs({ placeId, active, style, onMade }: { placeId: string; active: number; style: QrStyle; onMade: () => void }) {
  const toast = useToast();
  const [limit, setLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.rpc("my_plan", { p_place: placeId }).then(({ data }) => setLimit(((data as { qr_limit: number }[] | null) || [])[0]?.qr_limit ?? null));
  }, [placeId, active]);
  async function make(total: number) {
    setBusy(true);
    const r = await supabase.rpc("make_table_qrs", { p_place: placeId, p_tables: total, p_style: style });
    setBusy(false);
    if (r.error) { toast(errorText(r.error)); return; }
    onMade();
  }
  if (limit == null) return null;
  const room = limit - active;
  return (
    <div className="card row wrap" style={{ gap: 10 }}>
      <span className="grow small"><b>{active} of {limit}</b> codes in use</span>
      {room > 0 ? <>
        <button className="btn small ghost" disabled={busy} onClick={() => make(active + 1)}><Icon name="plus" size={16} />One more</button>
        {room > 1 && <button className="btn small" disabled={busy} onClick={() => make(limit)}><Icon name="qr" size={16} />Make all {limit}</button>}
      </> : <Link to="?tab=plan" replace className="btn small ghost"><Icon name="crown" size={16} />Get more codes</Link>}
    </div>
  );
}

/** The shop's table QR codes if this account can read them, else a way to get some. */
export function ShopQr({ place, isAdmin, onCodes }: { place: Place; isAdmin: boolean; onCodes: (c: QrCode[]) => void }) {
  // Where codes go and what one is called: tables for food, chairs for salons, the bill or visiting card for services.
  const biz = bizOf(place.kind, place.category);
  const toast = useToast();
  const confirm = useConfirm();
  const [codes, setCodes] = useState<QrCode[] | null>(null);
  const [nfcFor, setNfcFor] = useState<QrCode | null>(null);
  const [naming, setNaming] = useState<{ id: string; text: string } | null>(null);
  const load = useCallback(() => {
    supabase.from("qr_codes").select("id, place_id, token, style, table_label, active").eq("place_id", place.id).order("created_at")
      .then(({ data }) => { const c = ((data as QrCode[]) || []).sort(byTableLabel); setCodes(c); onCodes(c); });
  }, [place.id, onCodes]);
  useEffect(load, [load]);

  /** Rename a code, or turn a lost one off and back on. */
  async function update(c: QrCode, patch: { label?: string; active?: boolean }) {
    const { error } = await supabase.rpc("owner_update_qr", { p_qr: c.id, p_label: patch.label ?? null, p_active: patch.active ?? null });
    if (error) { toast(error.code === "PGRST202" ? "This isn't available yet." : errorText(error)); return false; }
    load();
    return true;
  }
  async function turnOff(c: QrCode) {
    const ok = await confirm({ title: `Turn off ${c.table_label || "this code"}?`, body: "Scanning it will stop opening reviews. Use this for a lost or damaged card. You can turn it back on.", ok: "Turn off", danger: true });
    if (ok && await update(c, { active: false })) toast(`${c.table_label || "Code"} turned off`, { label: "Undo", onClick: () => void update(c, { active: true }) });
  }

  if (codes === null) return <div className="skeleton" style={{ height: 180 }} />;
  const active = codes.filter((c) => c.active);
  const off = codes.filter((c) => !c.active);
  // New codes match the style already on the tables.
  const styleCount = new Map<QrStyle, number>();
  for (const c of active) styleCount.set(c.style, (styleCount.get(c.style) ?? 0) + 1);
  const style: QrStyle = [...styleCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "paper";

  if (!active.length) return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="mg-promo">
        <span className="mg-promo-art"><Icon name="qr" size={150} width={1.5} /></span>
        <span className="icon-chip lg" style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}><Icon name="qr" size={26} /></span>
        <h2 style={{ fontSize: 20, color: "#fff" }}>Your review QR codes</h2>
        <div className="stack tight small" style={{ opacity: 0.95 }}>
          <span className="row" style={{ gap: 6 }}><Icon name="scan" size={15} />Put them {biz.qrWhere}</span>
          <span className="row" style={{ gap: 6 }}><Icon name="verified" size={15} />Every review is verified</span>
          <span className="row" style={{ gap: 6 }}><Icon name="print" size={15} />Print-ready, four styles</span>
        </div>
      </div>
      <AddQrs placeId={place.id} active={0} style={off[0]?.style ?? "paper"} onMade={load} />
      {off.length > 0 && <OffCodes codes={off} onOn={(c) => void update(c, { active: true })} />}
      {isAdmin && <Link to={`/admin/place/${place.id}`} className="btn ghost block"><Icon name="plus" size={18} />Create codes in admin</Link>}
    </div>
  );

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row">
        <span className="section-title grow"><span className="icon-chip sm"><Icon name="qr" size={16} /></span>{active.length} {active.length === 1 ? "code" : "codes"}</span>
        <button className="btn small ghost" onClick={() => { markPrinted(place.id); window.print(); }}><Icon name="print" size={17} />Print all</button>
      </div>
      <div className="mg-qr-grid">
        {active.map((c) => {
          const col = QR_STYLES[c.style];
          return (
            <div key={c.id} className={`mg-qr ${c.style === "paper" ? "" : "dark"}`}>
              <BrandQr text={qrUrl(c.token)} size={132} dark={col.dark} light={col.light} />
              {naming?.id === c.id ? (
                <form className="row" style={{ gap: 4, width: "100%" }} onSubmit={async (e) => { e.preventDefault(); if (await update(c, { label: naming.text })) setNaming(null); }}>
                  <input className="input" style={{ height: 40, fontSize: 15 }} autoFocus maxLength={40} value={naming.text} aria-label="Code name" onChange={(e) => setNaming({ id: c.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") setNaming(null); }} />
                  <button className="mg-act" aria-label="Save name"><Icon name="check" size={16} /></button>
                </form>
              ) : (
                <button type="button" className="mg-qr-name" onClick={() => setNaming({ id: c.id, text: c.table_label || "" })} aria-label={`Rename ${c.table_label || "this code"}`}>
                  <span className="ellipsis">{c.table_label || spotLabel(biz)}</span><Icon name="edit" size={13} />
                </button>
              )}
              <div className="row" style={{ justifyContent: "center" }}>
                <span className="mg-acts">
                  <WalletButton compact pass={{ kind: "shop", qrId: c.id }} label={`Add ${c.table_label || "this code"} to your wallet`} />
                  <button className="mg-act" aria-label={`NFC tag for ${c.table_label || "this code"}`} title="NFC tag" onClick={() => setNfcFor(c)}><Icon name="nfc" size={16} /></button>
                  <button className="mg-act" aria-label={`Download ${c.table_label || "QR"}`} onClick={() => downloadQr(place.name, c)}><Icon name="download" size={16} /></button>
                  <button className="mg-act" aria-label={`Turn off ${c.table_label || "this code"}`} title="Turn off" onClick={() => void turnOff(c)}><Icon name="eyeOff" size={16} /></button>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <AddQrs placeId={place.id} active={active.length} style={style} onMade={load} />
      {off.length > 0 && <OffCodes codes={off} onOn={(c) => void update(c, { active: true })} />}
      <div className="notice row" style={{ gap: 10 }}>
        <span className="icon-chip sm sky"><Icon name="nfc" size={16} /></span>
        <span className="grow">Want tap-to-review too? Tap <Icon name="nfc" size={13} /> on a code to set up an NFC tag next to it.</span>
      </div>
      {isAdmin && <Link to={`/admin/place/${place.id}`} className="link-btn"><Icon name="settings" size={15} />Admin: all codes</Link>}
      {nfcFor && <NfcSheet code={nfcFor} onClose={() => setNfcFor(null)} />}
    </div>
  );
}

/** Codes the owner turned off, with a way back on (counts against the plan again). */
function OffCodes({ codes, onOn }: { codes: QrCode[]; onOn: (c: QrCode) => void }) {
  return (
    <section className="stack" style={{ gap: 8 }} aria-label="Turned off codes">
      <span className="small strong row" style={{ gap: 6 }}><Icon name="eyeOff" size={15} />Turned off</span>
      <div className="menu">
        {codes.map((c) => (
          <div key={c.id} className="menu-row" style={{ cursor: "default" }}>
            <span className="icon-chip sm"><Icon name="qr" size={16} /></span>
            <span className="grow t ellipsis">{c.table_label || "Code"}</span>
            <button type="button" className="btn small ghost" onClick={() => onOn(c)}><Icon name="refresh" size={15} />Turn on</button>
          </div>
        ))}
      </div>
    </section>
  );
}
