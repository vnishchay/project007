import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import type { Place, QrCode, QrStyle } from "../lib/types";
import { qrUrl } from "../lib/util";
import { Icon, QrImage, Spinner, TopBar, qrPngDataUrl, useToast } from "../components/ui";
import { PLACE_COLS } from "./Place";

const STYLE_COLORS: Record<QrStyle, { dark: string; light: string }> = {
  paper: { dark: "#111311", light: "#FFFFFF" },
  neon: { dark: "#C6FF3D", light: "#07080D" },
  aurora: { dark: "#9B7BFF", light: "#07080D" },
  matrix: { dark: "#3DDC84", light: "#07080D" },
};

export default function AdminPlace() {
  const { id = "" } = useParams();
  const toast = useToast();
  const [p, setP] = useState<Place | null | undefined>(undefined);
  const [codes, setCodes] = useState<QrCode[]>([]);
  const [coords, setCoords] = useState("");
  const [hours, setHours] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newStyle, setNewStyle] = useState<QrStyle>("paper");
  const [busy, setBusy] = useState(false);
  const [topItem, setTopItem] = useState<string>("");

  const loadCodes = () => supabase.from("qr_codes").select("id, place_id, token, style, table_label, active").eq("place_id", id).order("created_at")
    .then(({ data }) => setCodes((data as QrCode[]) || []));

  useEffect(() => {
    supabase.from("places").select(PLACE_COLS).eq("id", id).maybeSingle().then(({ data }) => {
      const pl = (data as Place) ?? null;
      setP(pl);
      if (pl?.hours) setHours(Object.entries(pl.hours).map(([d, h]) => `${d}: ${h}`).join("\n"));
    });
    supabase.rpc("place_latlng", { p_place: id }).then(({ data }) => {
      const c = ((data as { lat: number; lng: number }[]) || [])[0];
      if (c) setCoords(`${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`);
    });
    supabase.from("item_stats").select("avg_rating, review_count, items(name)").eq("place_id", id).gte("review_count", 3).order("avg_rating", { ascending: false }).limit(1)
      .then(({ data }) => {
        const t = ((data || []) as unknown as { avg_rating: number; review_count: number; items: { name: string } | null }[])[0];
        if (t) setTopItem(`Most loved: ${t.items?.name}, ${Number(t.avg_rating).toFixed(1)} from ${t.review_count}`);
      });
    loadCodes();
  }, [id]);

  if (p === undefined) return <div className="page"><Spinner /></div>;
  if (!p) return <div className="page"><TopBar /><div className="empty"><h2>Place not found</h2></div></div>;

  const set = <K extends keyof Place>(k: K, val: Place[K]) => setP({ ...p, [k]: val });

  async function save() {
    setBusy(true);
    const hoursObj: Record<string, string> = {};
    for (const line of hours.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) hoursObj[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const { error } = await supabase.from("places").update({
      name: p!.name, category: p!.category, area: p!.area || null, city: p!.city, about: p!.about || null,
      price_level: p!.price_level || null, google_place_id: p!.google_place_id?.trim() || null,
      status: p!.status, listed_until: p!.listed_until || null, hours: Object.keys(hoursObj).length ? hoursObj : null,
    }).eq("id", id);
    let err = error;
    if (!err) {
      const m = coords.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      const r = await supabase.rpc("set_place_location", { p_place: id, p_lat: m ? Number(m[1]) : null, p_lng: m ? Number(m[2]) : null });
      err = r.error;
    }
    setBusy(false);
    toast(err ? errorText(err) : "Saved");
  }

  async function renew() {
    const ref = prompt("Payment reference for the renewal (optional)") ?? null;
    if (ref === null) return;
    const { data, error } = await supabase.rpc("renew_listing", { p_place: id, p_provider_ref: ref || null });
    if (error) toast(errorText(error)); else { setP(data as Place); toast("Renewed for a year"); }
  }

  async function addCode(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("qr_codes").insert({ place_id: id, style: newStyle, table_label: newLabel.trim() || null });
    if (error) toast(errorText(error)); else { setNewLabel(""); loadCodes(); }
  }

  async function toggleCode(c: QrCode) {
    const { error } = await supabase.from("qr_codes").update({ active: !c.active }).eq("id", c.id);
    if (error) toast(errorText(error)); else loadCodes();
  }

  async function download(c: QrCode) {
    const col = STYLE_COLORS[c.style];
    const url = await qrPngDataUrl(qrUrl(c.token), col.dark, col.light);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p!.name}-${c.table_label || "qr"}.png`.replace(/[^\w.-]+/g, "_");
    a.click();
  }

  const active = codes.filter((c) => c.active);

  return (
    <div className="page">
      <div className="no-print stack" style={{ gap: 20 }}>
        <TopBar title={p.name} sub={<Link to={`/p/${p.id}`}>Open public page</Link>} />

        <div className="stack">
          <h2>Details</h2>
          <div className="grid2">
            <div className="field"><label>Name</label><input className="input" value={p.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="field"><label>Category</label><input className="input" value={p.category} onChange={(e) => set("category", e.target.value)} /></div>
            <div className="field"><label>Area</label><input className="input" value={p.area || ""} onChange={(e) => set("area", e.target.value)} /></div>
            <div className="field"><label>City</label><input className="input" value={p.city} onChange={(e) => set("city", e.target.value)} /></div>
            <div className="field"><label>Price</label>
              <select className="select" value={p.price_level || ""} onChange={(e) => set("price_level", e.target.value ? Number(e.target.value) : null)}>
                <option value="">Not set</option><option value="1">₹</option><option value="2">₹₹</option><option value="3">₹₹₹</option><option value="4">₹₹₹₹</option>
              </select>
            </div>
            <div className="field"><label>Lat, lng</label><input className="input" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="18.5362, 73.8940" /></div>
          </div>
          <div className="field"><label>Google Place ID</label><input className="input" value={p.google_place_id || ""} onChange={(e) => set("google_place_id", e.target.value)} placeholder="ChIJ…" /></div>
          <div className="field"><label>About</label><textarea className="textarea" style={{ minHeight: 80 }} value={p.about || ""} onChange={(e) => set("about", e.target.value)} /></div>
          <div className="field"><label>Hours (one per line, “Mon–Fri: 12–11 pm”)</label><textarea className="textarea" style={{ minHeight: 70 }} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>Status</label>
              <select className="select" value={p.status} onChange={(e) => set("status", e.target.value as Place["status"])}>
                <option value="live">Live</option><option value="lapsed">Lapsed</option><option value="removed">Removed</option>
              </select>
            </div>
            <div className="field"><label>Listed until</label><input className="input" type="date" value={p.listed_until || ""} onChange={(e) => set("listed_until", e.target.value)} /></div>
          </div>
          <div className="row"><button className="btn grow" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button><button className="btn ghost" onClick={renew}>Renew 1 year</button></div>
        </div>

        <div className="stack">
          <div className="row between"><h2>Table QR codes</h2>{active.length > 0 && <button className="link-btn" onClick={() => window.print()}><Icon name="print" size={16} />Print all</button>}</div>
          <form className="row" onSubmit={addCode}>
            <input className="input" placeholder="Label, e.g. Table 6" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <select className="select" style={{ width: 130 }} value={newStyle} onChange={(e) => setNewStyle(e.target.value as QrStyle)}>
              <option value="paper">White</option><option value="neon">Neon</option><option value="aurora">Aurora</option><option value="matrix">Matrix</option>
            </select>
            <button className="btn small" style={{ height: 50 }}><Icon name="plus" size={18} /></button>
          </form>
          {codes.length === 0 ? <div className="empty"><p>No codes yet.</p></div> : (
            <div className="list">
              {codes.map((c) => (
                <div key={c.id} className="list-item">
                  <QrImage text={qrUrl(c.token)} size={56} dark={STYLE_COLORS[c.style].dark} light={STYLE_COLORS[c.style].light} />
                  <div className="grow stack tight">
                    <span className="strong">{c.table_label || "Untitled"}</span>
                    <span className="tiny muted">{c.style} · {c.active ? "active" : "turned off"}</span>
                  </div>
                  <button className="icon-btn" aria-label="Download PNG" onClick={() => download(c)}><Icon name="download" size={18} /></button>
                  <button className="btn small ghost" onClick={() => toggleCode(c)}>{c.active ? "Turn off" : "Turn on"}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Print sheet: one card per active code */}
      <div className="print-only stack" style={{ gap: 24 }}>
        {active.map((c) => {
          const col = STYLE_COLORS[c.style];
          return (
            <div key={c.id} className={`qr-card ${c.style === "paper" ? "" : "neon"}`} style={{ maxWidth: 380, margin: "0 auto" }}>
              <span className="small strong" style={{ opacity: 0.7 }}>{[c.table_label, p.area].filter(Boolean).join(" · ")}</span>
              <span style={{ fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em" }}>{p.name}</span>
              <QrImage text={qrUrl(c.token)} size={200} dark={col.dark} light={col.light} />
              <span className="strong">Scan to rate what you had</span>
              {topItem && <span className="small" style={{ opacity: 0.7 }}>{topItem}</span>}
              <span className="small strong" style={{ color: c.style === "paper" ? "var(--green)" : col.dark }}>● Trusted Picks</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
