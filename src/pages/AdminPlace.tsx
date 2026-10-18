import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import type { Place, QrCode, QrStyle } from "../lib/types";
import { isUuid } from "../lib/types";
import { qrUrl, parseCoords, QR_STYLES, extractPlaceId } from "../lib/util";
import { Icon, QrImage, Spinner, TopBar, useToast } from "../components/ui";
import { CoordsField } from "../components/CoordsField";
import { downloadQr, QrPrintSheet } from "../components/manage/ShopQr";
import { PLACE_COLS } from "./Place";
import { googleConfigured } from "../lib/google";
import { syncPinFromGoogle } from "../lib/pin";
import { GoogleFind, GooglePreview } from "../components/manage/Google";
import { LinkIcon, linkLabel } from "../components/LinkIcon";
import type { PlaceLink } from "../components/manage/LinksEditor";
import type { PlaceUpdate } from "../components/manage/Updates";
import { timeAgo } from "../lib/util";
import "../styles/manage.css";

const STYLE_COLORS: Record<QrStyle, { dark: string; light: string }> = QR_STYLES;

export default function AdminPlace() {
  const { id = "" } = useParams();
  const toast = useToast();
  const [p, setP] = useState<Place | null | undefined>(undefined);
  const [codes, setCodes] = useState<QrCode[]>([]);
  const [coords, setCoords] = useState("");
  const [coords0, setCoords0] = useState("");
  const [hours, setHours] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newStyle, setNewStyle] = useState<QrStyle>("paper");
  const [busy, setBusy] = useState(false);
  const [topItem, setTopItem] = useState<string>("");
  const [links, setLinks] = useState<PlaceLink[]>([]);
  const [updates, setUpdates] = useState<PlaceUpdate[]>([]);
  const [findGoogle, setFindGoogle] = useState(false);

  const loadCodes = () => {
    if (!id || !isUuid(id)) return;
    return supabase.from("qr_codes").select("id, place_id, token, style, table_label, active").eq("place_id", id).order("created_at")
      .then(({ data }) => setCodes((data as QrCode[]) || []));
  };

  useEffect(() => {
    if (!id || !isUuid(id)) {
      setP(null);
      return;
    }
    supabase.from("places").select(PLACE_COLS).eq("id", id).maybeSingle().then(({ data }) => {
      const pl = (data as Place) ?? null;
      setP(pl);
      if (pl?.hours) setHours(Object.entries(pl.hours).map(([d, h]) => `${d}: ${h}`).join("\n"));
    });
    supabase.rpc("place_latlng", { p_place: id }).then(({ data }) => {
      const c = ((data as { lat: number; lng: number }[]) || [])[0];
      if (c) { const t = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; setCoords(t); setCoords0(t); }
    });
    supabase.from("item_stats").select("avg_rating, review_count, items(name)").eq("place_id", id).gte("review_count", 3).order("avg_rating", { ascending: false }).limit(1)
      .then(({ data }) => {
        const t = ((data || []) as unknown as { avg_rating: number; review_count: number; items: { name: string } | null }[])[0];
        if (t) setTopItem(`Most loved: ${t.items?.name}, ${Number(t.avg_rating).toFixed(1)} from ${t.review_count}`);
      });
    supabase.from("places").select("links").eq("id", id).maybeSingle()
      .then(({ data }) => setLinks(((data as { links?: PlaceLink[] } | null)?.links) || []));
    supabase.from("place_updates").select("id, body, link_url, created_at").eq("place_id", id).order("created_at", { ascending: false }).limit(5)
      .then(({ data }) => setUpdates((data as PlaceUpdate[]) || []));
    loadCodes();
  }, [id]);

  if (p === undefined) return <div className="page"><Spinner /></div>;
  if (!p) return <div className="page"><TopBar /><div className="empty"><h2>Place not found</h2></div></div>;

  const set = <K extends keyof Place>(k: K, val: Place[K]) => setP({ ...p, [k]: val });

  async function save() {
    const rawGid = (p!.google_place_id || "").trim();
    const gid = rawGid ? extractPlaceId(rawGid) : null;
    if (rawGid && !gid) { toast("That isn't a Google Place ID. Use an ID like ChIJ…, or leave it empty."); return; }
    if (coords.trim() && !parseCoords(coords)) { toast("Check the map location"); return; }
    setBusy(true);
    const hoursObj: Record<string, string> = {};
    for (const line of hours.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) hoursObj[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const { error } = await supabase.from("places").update({
      name: p!.name, category: p!.category, area: p!.area || null, city: p!.city, about: p!.about || null,
      price_level: p!.price_level || null, google_place_id: gid,
      status: p!.status, hours: Object.keys(hoursObj).length ? hoursObj : null,
    }).eq("id", id);
    let err = error;
    if (!err) {
      // Google's pin for a Google-linked place; the typed one only when it changed (or Google can't be read).
      const g = gid && googleConfigured ? await syncPinFromGoogle(id, gid) : null;
      if (!(g && g.ok) && coords.trim() !== coords0) {
        const m = parseCoords(coords);
        const r = await supabase.rpc("set_place_location", { p_place: id, p_lat: m ? m.lat : null, p_lng: m ? m.lng : null });
        err = r.error;
        if (!r.error) setCoords0(coords.trim());
      } else if (g && g.ok) {
        const t = `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}`;
        setCoords(t); setCoords0(t);
      }
    }
    setBusy(false);
    toast(err ? errorText(err) : "Saved");
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

  const download = (c: QrCode) => downloadQr(p!.name, c);

  const active = codes.filter((c) => c.active);

  return (
    <div className="page">
      <div className="no-print stack" style={{ gap: 20 }}>
        <TopBar title={p.name} sub={[p.category, p.area, p.city].filter(Boolean).join(" · ")}
          right={<Link to={`/p/${p.id}`} className="icon-btn" aria-label="Open public page"><Icon name="eye" size={20} /></Link>} />

        <Link to={`/manage/${p.id}`} className="ad-manage-link">
          <span className="icon-chip lg"><Icon name="box" size={24} /></span>
          <span className="grow stack tight"><span className="strong" style={{ fontSize: 16 }}>Products and photos</span><span className="small" style={{ opacity: 0.9 }}>Cover, logo, menu, hours</span></span>
          <Icon name="chev" size={22} />
        </Link>

        <div className="mg-section">
          <div className="mg-section-head"><span className="icon-chip sm"><Icon name="settings" size={16} /></span>Details</div>
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
          </div>
          <CoordsField value={coords} onChange={setCoords} />
          <div className="field">
            <div className="row" style={{ gap: 6 }}><label htmlFor="gpid" className="grow">Google Place ID</label>
              {googleConfigured && <button type="button" className="link-btn tiny" onClick={() => setFindGoogle(!findGoogle)}><Icon name={findGoogle ? "close" : "search"} size={14} />{findGoogle ? "Close" : p.google_place_id ? "Replace" : "Find on Google"}</button>}
            </div>
            {findGoogle && <GoogleFind autoFocus onPick={(m) => { set("google_place_id", m.id); setFindGoogle(false); toast("Picked. Save to keep it."); }} />}
            <input id="gpid" className="input" value={p.google_place_id || ""} onChange={(e) => set("google_place_id", e.target.value)} placeholder="ChIJ…" />
            {googleConfigured && extractPlaceId(p.google_place_id) && <GooglePreview id={extractPlaceId(p.google_place_id)!} note="Live from Google" />}
            {!googleConfigured && <span className="tiny muted">Google previews are off: VITE_GOOGLE_MAPS_KEY isn't set.</span>}
          </div>
          <div className="field"><label>About</label><textarea className="textarea" style={{ minHeight: 80 }} value={p.about || ""} onChange={(e) => set("about", e.target.value)} /></div>
          <div className="field"><label>Hours (one per line, “Mon–Fri: 12–11 pm”)</label><textarea className="textarea" style={{ minHeight: 70 }} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
          <div className="field"><label>Status</label>
            <select className="select" value={p.status} onChange={(e) => set("status", e.target.value as Place["status"])}>
              <option value="live">Live</option><option value="lapsed">Lapsed</option><option value="removed">Removed</option>
            </select>
            <span className="tiny muted">Plans and payments are under Admin, Billing.</span>
          </div>
          <button className="btn green block" disabled={busy} onClick={save}><Icon name="check" size={18} />{busy ? "Saving…" : "Save"}</button>
        </div>

        <div className="mg-section">
          <div className="mg-section-head"><span className="icon-chip sm violet"><Icon name="link" size={16} /></span><span className="grow">Links</span><Link to={`/manage/${p.id}?tab=links`} className="link-btn tiny"><Icon name="edit" size={14} />Edit</Link></div>
          {links.length === 0 ? <p className="small muted">No links yet.</p> : (
            <div className="ln-preview">
              {links.map((l, i) => (
                <a key={i} className="ln-tile" href={l.url} target="_blank" rel="noreferrer" title={l.url}><LinkIcon kind={l.kind} size={28} /><span className="ellipsis">{linkLabel(l)}</span></a>
              ))}
            </div>
          )}
        </div>

        <div className="mg-section">
          <div className="mg-section-head"><span className="icon-chip sm coral"><Icon name="message" size={16} /></span><span className="grow">Recent updates</span><Link to={`/manage/${p.id}?tab=updates`} className="link-btn tiny"><Icon name="edit" size={14} />Manage</Link></div>
          {updates.length === 0 ? <p className="small muted">No updates posted.</p> : (
            <div className="list">
              {updates.map((u) => (
                <div key={u.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                  <span className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{u.body}</span>
                  <span className="tiny muted row" style={{ gap: 6 }}>{timeAgo(u.created_at)}{u.link_url && <a className="ellipsis" href={u.link_url} target="_blank" rel="noreferrer">{u.link_url.replace(/^https?:\/\/(www\.)?/, "")}</a>}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mg-section">
          <div className="mg-section-head"><span className="icon-chip sm amber"><Icon name="qr" size={16} /></span><span className="grow">Table QR codes</span>{active.length > 0 && <button className="btn small ghost" onClick={() => window.print()}><Icon name="print" size={16} />Print all</button>}</div>
          <form className="row" onSubmit={addCode}>
            <input className="input" placeholder="Label, e.g. Table 6" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <select className="select" style={{ width: 130 }} value={newStyle} onChange={(e) => setNewStyle(e.target.value as QrStyle)}>
              <option value="paper">White</option><option value="neon">Neon</option><option value="aurora">Aurora</option><option value="matrix">Matrix</option>
            </select>
            <button className="btn small" style={{ height: 50 }}><Icon name="plus" size={18} /></button>
          </form>
          {codes.length === 0 ? <div className="empty"><Icon name="qr" size={28} /><p>No codes yet.</p></div> : (
            <div className="list">
              {codes.map((c) => (
                <div key={c.id} className="list-item">
                  <QrImage text={qrUrl(c.token)} size={56} dark={STYLE_COLORS[c.style].dark} light={STYLE_COLORS[c.style].light} />
                  <div className="grow stack tight">
                    <span className="strong">{c.table_label || "Untitled"}</span>
                    <span className="tiny muted">{c.style} · {c.active ? "active" : "turned off"}</span>
                  </div>
                  <button className="icon-btn" aria-label="Download PNG" onClick={() => download(c)}><Icon name="download" size={18} /></button>
                  <button className={`mg-act ${c.active ? "on" : ""}`} style={{ width: 44, height: 44 }} aria-label={c.active ? "Turn off" : "Turn on"} aria-pressed={c.active} onClick={() => toggleCode(c)}><Icon name={c.active ? "eye" : "eyeOff"} size={18} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <QrPrintSheet place={p} codes={codes} topItem={topItem} />
    </div>
  );
}
