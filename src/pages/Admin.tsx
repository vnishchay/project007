import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useSettings, type AppSettings } from "../lib/settings";
import type { ListingRequest, Place, ReviewRow, Topic } from "../lib/types";
import { rupees, timeAgo, parseCoords, extractPlaceId } from "../lib/util";
import { Icon, useToast } from "../components/ui";
import { ReviewCard, REVIEW_SELECT, REVIEW_FEED } from "../components/ReviewCard";
import { CoordsField } from "../components/CoordsField";

interface Summary { to_review: number; live_places: number; collected_inr: number }

export default function Admin() {
  const [tab, setTab] = useState<"requests" | "places" | "reviews" | "settings">("requests");
  const [sum, setSum] = useState<Summary | null>(null);
  const [n, setN] = useState(0);
  const refresh = () => setN((x) => x + 1);

  useEffect(() => {
    supabase.rpc("admin_summary").then(({ data }) => setSum(((data as Summary[]) || [])[0] ?? null));
  }, [n]);

  return (
    <div className="page">
      <div className="row between"><h1>Admin</h1><Link to="/me" className="btn small ghost"><Icon name="user" size={16} />Your profile</Link></div>
      <div className="kpis">
        <div className="kpi"><div className="n">{sum?.to_review ?? "–"}</div><div className="l">to review</div></div>
        <div className="kpi"><div className="n">{sum?.live_places ?? "–"}</div><div className="l">live places</div></div>
        <div className="kpi"><div className="n">{sum ? rupees(sum.collected_inr) : "–"}</div><div className="l">collected</div></div>
      </div>
      <div className="tabs">
        <button className={tab === "requests" ? "on" : ""} onClick={() => setTab("requests")}>Requests</button>
        <button className={tab === "places" ? "on" : ""} onClick={() => setTab("places")}>Places</button>
        <button className={tab === "reviews" ? "on" : ""} onClick={() => setTab("reviews")}>Reviews</button>
        <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>Settings</button>
      </div>
      {tab === "requests" && <Requests key={n} onChange={refresh} />}
      {tab === "places" && <Places key={n} onChange={refresh} />}
      {tab === "reviews" && <Reviews />}
      {tab === "settings" && <><Settings /><Vocabulary /></>}
    </div>
  );
}

/* ---------- Requests ---------- */
function Requests({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<ListingRequest[] | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [err, setErr] = useState("");

  const load = () => {
    let q = supabase.from("listing_requests").select("*").order("created_at", { ascending: false }).limit(200);
    if (filter === "open") q = q.in("status", ["pending", "paid"]);
    q.then(({ data, error }) => { setErr(error ? errorText(error) : ""); setRows((data as ListingRequest[]) || []); });
  };
  useEffect(load, [filter]);

  return (
    <div className="stack">
      <div className="chips">
        <button className={`chip ${filter === "open" ? "on" : ""}`} onClick={() => setFilter("open")}>To review</button>
        <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All</button>
      </div>
      {err && <div className="notice err row"><span className="grow">{err}</span><button className="link-btn" onClick={load}>Retry</button></div>}
      {rows === null ? <div className="skeleton" /> : rows.length === 0 ? <div className="empty"><p>{filter === "open" ? "No requests waiting." : "No requests yet."}</p></div> :
        rows.map((r) => <RequestAdminCard key={r.id} r={r} onDone={() => { load(); onChange(); }} />)}
    </div>
  );
}

function RequestAdminCard({ r, onDone }: { r: ListingRequest; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [gid, setGid] = useState(r.google_place_id || "");
  const [coords, setCoords] = useState("");
  const [tables, setTables] = useState("10");
  const [busy, setBusy] = useState(false);
  const code = `TP-${r.id.slice(0, 8).toUpperCase()}`;

  async function run(fn: () => Promise<{ error: unknown }>, ok: string) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) toast(errorText(error)); else { toast(ok); onDone(); }
  }

  const markPaid = () => run(async () => await supabase.rpc("mark_request_paid", { p_request: r.id, p_provider_ref: ref.trim() || null }), "Marked paid");
  const decline = () => { if (confirm(`Decline ${r.business_name}?`)) run(async () => await supabase.rpc("decline_listing", { p_request: r.id }), "Declined"); };
  const approve = () => run(async () => {
    const raw = gid.trim();
    const id = raw ? extractPlaceId(raw) : "";
    if (raw && !id) return { error: "That isn't a Google Place ID. Paste an ID like ChIJ…, or leave it empty." };
    if (id !== (r.google_place_id || "")) {
      const u = await supabase.from("listing_requests").update({ google_place_id: id || null }).eq("id", r.id);
      if (u.error) return u;
    }
    const m = parseCoords(coords);
    const n = Math.max(0, Math.min(200, parseInt(tables, 10) || 0));
    const labels = r.wants_qr ? Array.from({ length: n }, (_, i) => `Table ${i + 1}`) : [];
    return await supabase.rpc("approve_listing", { p_request: r.id, p_lat: m ? m.lat : null, p_lng: m ? m.lng : null, p_table_labels: labels });
  }, "Approved and live");

  const badge = r.status === "pending" ? "warn" : r.status === "paid" ? "" : r.status === "declined" ? "red" : "gray";
  return (
    <div className="card">
      <button className="row between" style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <span className="stack tight grow">
          <span className="strong">{r.business_name}</span>
          <span className="small muted">{[r.category, r.area, r.city].filter(Boolean).join(" · ")} · {timeAgo(r.created_at)}</span>
        </span>
        <span className="stack tight" style={{ alignItems: "flex-end" }}>
          <span className={`badge ${badge}`}>{r.status}</span>
          <span className="small strong">{rupees(r.amount_inr)}</span>
        </span>
      </button>
      {open && (
        <div className="stack">
          <div className="small" style={{ lineHeight: 1.6 }}>
            <div>Ref <b>{code}</b> · <a href={`tel:${r.phone}`}>{r.phone}</a></div>
            <div>{r.wants_qr ? `Wants table QR (${r.qr_style || "neon"})` : "Listing only"}</div>
            {r.note && <div className="muted">“{r.note}”</div>}
          </div>
          {r.status === "pending" && (
            <div className="row">
              <input className="input" placeholder="UPI / payment ref (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
              <button className="btn small green" style={{ height: 50 }} disabled={busy} onClick={markPaid}>Mark paid</button>
            </div>
          )}
          {(r.status === "pending" || r.status === "paid") && (
            <>
              <div className="field">
                <label>Google Place ID</label>
                <input className="input" value={gid} onChange={(e) => setGid(e.target.value)} placeholder="ChIJ…" />
                <a className="tiny" href="https://developers.google.com/maps/documentation/places/web-service/place-id#find-id" target="_blank" rel="noreferrer">Find a Place ID</a>
              </div>
              <CoordsField value={coords} onChange={setCoords} />
              <div className="grid2">
                {r.wants_qr && <div className="field"><label>Tables</label><input className="input" type="number" min={0} max={200} value={tables} onChange={(e) => setTables(e.target.value)} /></div>}
              </div>
              {r.status === "pending" && <div className="notice warn small">Not marked paid yet. Approving anyway records no payment.</div>}
              <div className="row">
                <button className="btn small grow" disabled={busy} onClick={approve}>Approve and go live</button>
                <button className="btn small danger" disabled={busy} onClick={decline}>Decline</button>
              </div>
            </>
          )}
          {r.place_id && <Link to={`/admin/place/${r.place_id}`} className="link-btn">Manage place and QR codes</Link>}
        </div>
      )}
    </div>
  );
}

/* ---------- Places ---------- */
function Places({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Place[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", category: "", area: "", city: "", google_place_id: "" });
  const [coords, setCoords] = useState("");
  const [show, setShow] = useState<"all" | "renewals">("all");
  const [find, setFind] = useState("");

  const load = () => {
    supabase.from("places").select("id, name, category, area, city, status, listed_until, google_place_id, about, hours, price_level, created_at").order("created_at", { ascending: false }).limit(300)
      .then(({ data }) => setRows((data as Place[]) || []));
  };
  useEffect(load, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const gid = f.google_place_id.trim() ? extractPlaceId(f.google_place_id) : null;
    if (f.google_place_id.trim() && !gid) { toast("That isn't a Google Place ID"); return; }
    const c = coords.trim() ? parseCoords(coords) : null;
    if (coords.trim() && !c) { toast("Check the map location"); return; }
    const until = new Date(); until.setFullYear(until.getFullYear() + 1);
    const { data, error } = await supabase.from("places").insert({
      name: f.name.trim(), category: f.category.trim(), area: f.area.trim() || null, city: f.city.trim(), google_place_id: gid,
      status: "live", listed_until: until.toISOString().slice(0, 10),
    }).select("id").single();
    if (error) { toast(errorText(error)); return; }
    if (c) {
      const r = await supabase.rpc("set_place_location", { p_place: (data as { id: string }).id, p_lat: c.lat, p_lng: c.lng });
      if (r.error) toast(errorText(r.error));
    }
    toast("Place added"); setAdding(false); setF({ name: "", category: "", area: "", city: "", google_place_id: "" }); setCoords(""); load(); onChange();
  }

  const soon = (d: string | null) => d && new Date(d).getTime() - Date.now() < 30 * 86400000;
  const due = (p: Place) => p.status === "lapsed" || (p.status === "live" && Boolean(soon(p.listed_until)));
  const t = find.trim().toLowerCase();
  const shown = (rows || [])
    .filter((p) => show === "all" || due(p))
    .filter((p) => !t || [p.name, p.category, p.area, p.city].some((x) => (x || "").toLowerCase().includes(t)))
    .sort((a, b) => show === "renewals" ? String(a.listed_until).localeCompare(String(b.listed_until)) : 0);

  return (
    <div className="stack">
      {adding ? (
        <form className="card" onSubmit={add}>
          <h2>Add a place</h2>
          <div className="grid2">
            <input className="input" required placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input className="input" required placeholder="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
            <input className="input" placeholder="Area" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />
            <input className="input" required placeholder="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </div>
          <input className="input" placeholder="Google Place ID (optional)" value={f.google_place_id} onChange={(e) => setF({ ...f, google_place_id: e.target.value })} />
          <CoordsField value={coords} onChange={setCoords} />
          <div className="row"><button className="btn small grow">Add</button><button type="button" className="btn small ghost" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      ) : <button className="btn ghost block" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add a place directly</button>}
      <div className="chips">
        <button className={`chip ${show === "all" ? "on" : ""}`} onClick={() => setShow("all")}>All</button>
        <button className={`chip ${show === "renewals" ? "on" : ""}`} onClick={() => setShow("renewals")}>Renewals due ({(rows || []).filter(due).length})</button>
      </div>
      <div className="search"><Icon name="search" color="var(--muted)" /><input aria-label="Find a place" placeholder="Find a place" value={find} onChange={(e) => setFind(e.target.value)} /></div>
      {rows === null ? <div className="skeleton" /> : shown.length === 0 ? <div className="empty"><p>{show === "renewals" ? "No renewals due in the next 30 days." : "No places found."}</p></div> : (
        <div className="list">
          {shown.map((p) => (
            <Link key={p.id} to={`/admin/place/${p.id}`} className="list-item">
              <div className="grow stack tight">
                <span className="strong">{p.name}</span>
                <span className="small muted">{[p.category, p.area, p.city].filter(Boolean).join(" · ")}</span>
              </div>
              <span className="stack tight" style={{ alignItems: "flex-end" }}>
                <span className={`badge ${p.status === "live" ? "" : p.status === "lapsed" ? "warn" : "red"}`}>{p.status}</span>
                {p.listed_until && <span className={`tiny ${soon(p.listed_until) ? "strong" : "muted"}`} style={soon(p.listed_until) ? { color: "#8a5a00" } : undefined}>until {p.listed_until}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Settings ---------- */
function Settings() {
  const toast = useToast();
  const [s, reload] = useSettings();
  const [v, setV] = useState<AppSettings>(s);
  useEffect(() => setV(s), [s]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const rows = [
      { key: "listing_price_inr", value: Number(v.listing_price_inr) || 0 },
      { key: "qr_price_inr", value: Number(v.qr_price_inr) || 0 },
      { key: "visit_window_hours", value: Math.max(1, Number(v.visit_window_hours) || 6) },
      { key: "upi_id", value: v.upi_id.trim() },
      { key: "payee_name", value: v.payee_name.trim() },
      { key: "support_phone", value: v.support_phone.trim() },
    ];
    const { error } = await supabase.from("app_settings").upsert(rows);
    if (error) toast(errorText(error)); else { toast("Settings saved"); reload(); }
  }

  const field = (k: keyof AppSettings, label: string, type = "text", ph = "") => (
    <div className="field"><label htmlFor={k}>{label}</label><input id={k} className="input" type={type} placeholder={ph} value={String(v[k] ?? "")} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>
  );

  return (
    <form className="stack" onSubmit={save}>
      <div className="grid2">
        {field("listing_price_inr", "Listing ₹ / year", "number")}
        {field("qr_price_inr", "Table QR ₹ (once)", "number")}
      </div>
      {field("upi_id", "UPI ID for payments", "text", "yourname@okhdfcbank")}
      {field("payee_name", "Payee name")}
      {field("support_phone", "WhatsApp number for businesses", "tel", "919800000000")}
      {field("visit_window_hours", "Hours a QR scan counts as a visit", "number")}
      <button className="btn block">Save settings</button>
      <p className="tiny muted">New prices apply to new requests. Existing requests keep the amount they were sent with.</p>
    </form>
  );
}

/* ---------- Reviews (moderation) ---------- */
function Reviews() {
  const toast = useToast();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [show, setShow] = useState<"recent" | "hidden">("recent");
  const [err, setErr] = useState("");

  const load = () => {
    setRows(null);
    let q = supabase.from(REVIEW_FEED).select(REVIEW_SELECT).order("created_at", { ascending: false }).limit(100);
    if (show === "hidden") q = q.eq("status", "hidden");
    q.then(({ data, error }) => { setErr(error ? errorText(error) : ""); setRows((data as unknown as ReviewRow[]) || []); });
  };
  useEffect(load, [show]);

  async function setStatus(r: ReviewRow, status: "published" | "hidden") {
    const { error } = await supabase.from("reviews").update({ status }).eq("id", r.id);
    if (error) { toast(errorText(error)); return; }
    toast(status === "hidden" ? "Review hidden" : "Review restored");
    setRows((rs) => (rs || []).map((x) => (x.id === r.id ? { ...x, status } : x)).filter((x) => show !== "hidden" || x.status === "hidden"));
  }

  return (
    <div className="stack">
      <div className="chips">
        <button className={`chip ${show === "recent" ? "on" : ""}`} onClick={() => setShow("recent")}>Recent</button>
        <button className={`chip ${show === "hidden" ? "on" : ""}`} onClick={() => setShow("hidden")}>Hidden</button>
      </div>
      {err && <div className="notice err row"><span className="grow">{err}</span><button className="link-btn" onClick={load}>Retry</button></div>}
      {rows === null ? <div className="skeleton" /> : rows.length === 0 ? <div className="empty"><p>{show === "hidden" ? "No hidden reviews." : "No reviews yet."}</p></div> :
        rows.map((r) => (
          <ReviewCard key={r.id} r={r} showPlace>
            <div className="row between">
              {r.status === "hidden" ? <span className="badge red">Hidden</span> : <span className="badge gray">Published</span>}
              {r.status === "hidden"
                ? <button className="btn small ghost" onClick={() => setStatus(r, "published")}>Restore</button>
                : <button className="btn small danger" onClick={() => { if (confirm("Hide this review from everyone?")) setStatus(r, "hidden"); }}>Hide</button>}
            </div>
          </ReviewCard>
        ))}
    </div>
  );
}

/* ---------- Topics and tags ---------- */
function Vocabulary() {
  const toast = useToast();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [newTopic, setNewTopic] = useState("");
  const [newTag, setNewTag] = useState("");

  const load = () => {
    supabase.from("topics").select("id, name").order("name").then(({ data }) => setTopics((data as Topic[]) || []));
    supabase.from("tags").select("id, label").order("label").then(({ data }) => setTags((data as { id: number; label: string }[]) || []));
  };
  useEffect(load, []);

  async function add(table: "topics" | "tags", value: string, done: () => void) {
    const v = value.trim();
    if (!v) return;
    const { error } = await supabase.from(table).insert(table === "topics" ? { name: v } : { label: v });
    if (error) toast(errorText(error)); else { done(); load(); toast("Added"); }
  }
  async function remove(table: "topics" | "tags", id: number, name: string) {
    if (!confirm(`Remove “${name}”? It comes off every item or review that uses it.`)) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) toast(errorText(error)); else load();
  }

  const section = (title: string, table: "topics" | "tags", list: { id: number; text: string }[], value: string, setValue: (v: string) => void, ph: string) => (
    <div className="stack">
      <h2>{title}</h2>
      <div className="chips">{list.map((x) => (
        <span key={x.id} className="chip row" style={{ gap: 6 }}>{x.text}
          <button type="button" className="link-btn" aria-label={`Remove ${x.text}`} onClick={() => remove(table, x.id, x.text)}><Icon name="close" size={14} color="var(--muted)" /></button>
        </span>
      ))}</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(table, value, () => setValue("")); }}>
        <input className="input" placeholder={ph} value={value} onChange={(e) => setValue(e.target.value)} aria-label={ph} />
        <button className="btn small" style={{ height: 50 }}>Add</button>
      </form>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 20, marginTop: 8 }}>
      <div className="divider" />
      {section("Topics", "topics", topics.map((t) => ({ id: t.id, text: t.name })), newTopic, setNewTopic, "New topic, e.g. Momos")}
      {section("Review tags", "tags", tags.map((t) => ({ id: t.id, text: t.label })), newTag, setNewTag, "New tag, e.g. Great value")}
    </div>
  );
}
