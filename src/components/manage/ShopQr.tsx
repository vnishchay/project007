import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import type { Place, QrCode } from "../../lib/types";
import { qrUrl, QR_STYLES } from "../../lib/util";
import { Icon, QrImage, qrPngDataUrl, useToast } from "../ui";

export async function downloadQr(placeName: string, c: QrCode) {
  const col = QR_STYLES[c.style];
  const url = await qrPngDataUrl(qrUrl(c.token), col.dark, col.light);
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
            <QrImage text={qrUrl(c.token)} size={200} dark={col.dark} light={col.light} />
            <span className="strong">Scan to rate what you had</span>
            {topItem && <span className="small" style={{ opacity: 0.7 }}>{topItem}</span>}
            <span className="small strong" style={{ color: c.style === "paper" ? "var(--green)" : col.dark }}>● Trusted Picks</span>
          </div>
        );
      })}
    </div>
  );
}

/** For the owner: make more table codes, up to what the plan allows, or go buy more. */
function AddQrs({ placeId, active, onMade }: { placeId: string; active: number; onMade: () => void }) {
  const toast = useToast();
  const [limit, setLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.rpc("my_plan", { p_place: placeId }).then(({ data }) => setLimit(((data as { qr_limit: number }[] | null) || [])[0]?.qr_limit ?? null));
  }, [placeId, active]);
  async function make(total: number) {
    setBusy(true);
    const r = await supabase.rpc("make_table_qrs", { p_place: placeId, p_tables: total, p_style: "paper" });
    setBusy(false);
    if (r.error) { toast(errorText(r.error)); return; }
    onMade();
  }
  if (limit == null) return null;
  const room = limit - active;
  return (
    <div className="card row wrap" style={{ gap: 10 }}>
      <span className="grow small"><b>{active} of {limit}</b> table codes in use</span>
      {room > 0 ? <>
        <button className="btn small ghost" disabled={busy} onClick={() => make(active + 1)}><Icon name="plus" size={16} />One more</button>
        {room > 1 && <button className="btn small" disabled={busy} onClick={() => make(limit)}><Icon name="qr" size={16} />Make all {limit}</button>}
      </> : <Link to="?tab=plan" replace className="btn small ghost"><Icon name="crown" size={16} />Get more codes</Link>}
    </div>
  );
}

/** The shop's table QR codes if this account can read them, else a way to get some. */
export function ShopQr({ place, isAdmin, onCodes }: { place: Place; isAdmin: boolean; onCodes: (c: QrCode[]) => void }) {
  const [codes, setCodes] = useState<QrCode[] | null>(null);
  const load = useCallback(() => {
    supabase.from("qr_codes").select("id, place_id, token, style, table_label, active").eq("place_id", place.id).order("created_at")
      .then(({ data }) => { const c = (data as QrCode[]) || []; setCodes(c); onCodes(c); });
  }, [place.id, onCodes]);
  useEffect(load, [load]);

  if (codes === null) return <div className="skeleton" style={{ height: 180 }} />;
  const active = codes.filter((c) => c.active);

  if (!active.length) return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="mg-promo">
        <span className="mg-promo-art"><Icon name="qr" size={150} width={1.5} /></span>
        <span className="icon-chip lg" style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}><Icon name="qr" size={26} /></span>
        <h2 style={{ fontSize: 20, color: "#fff" }}>Table QR codes</h2>
        <div className="stack tight small" style={{ opacity: 0.95 }}>
          <span className="row" style={{ gap: 6 }}><Icon name="scan" size={15} />Customers scan at the table</span>
          <span className="row" style={{ gap: 6 }}><Icon name="verified" size={15} />Every review is verified</span>
          <span className="row" style={{ gap: 6 }}><Icon name="print" size={15} />Print-ready, four styles</span>
        </div>
      </div>
      <AddQrs placeId={place.id} active={0} onMade={load} />
      {isAdmin && <Link to={`/admin/place/${place.id}`} className="btn ghost block"><Icon name="plus" size={18} />Create codes in admin</Link>}
    </div>
  );

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row">
        <span className="section-title grow"><span className="icon-chip sm"><Icon name="qr" size={16} /></span>{active.length} table {active.length === 1 ? "code" : "codes"}</span>
        <button className="btn small ghost" onClick={() => window.print()}><Icon name="print" size={17} />Print all</button>
      </div>
      <div className="mg-qr-grid">
        {active.map((c) => {
          const col = QR_STYLES[c.style];
          return (
            <div key={c.id} className={`mg-qr ${c.style === "paper" ? "" : "dark"}`}>
              <QrImage text={qrUrl(c.token)} size={132} dark={col.dark} light={col.light} />
              <div className="row between">
                <span className="small strong ellipsis">{c.table_label || "Table"}</span>
                <button className="mg-act" aria-label={`Download ${c.table_label || "QR"}`} onClick={() => downloadQr(place.name, c)}><Icon name="download" size={16} /></button>
              </div>
            </div>
          );
        })}
      </div>
      <AddQrs placeId={place.id} active={active.length} onMade={load} />
      {isAdmin && <Link to={`/admin/place/${place.id}`} className="link-btn"><Icon name="settings" size={15} />Add or turn off codes</Link>}
    </div>
  );
}
