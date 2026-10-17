import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { demoArtUrl, isDemoArt } from "../lib/demoArt";
import { useSettings, type AppSettings } from "../lib/settings";
import type { ListingRequest, Place, ReviewRow, Topic } from "../lib/types";
import { rupees, timeAgo, parseCoords, extractPlaceId } from "../lib/util";
import { Icon, useToast, type IconName } from "../components/ui";
import { ReviewCard, REVIEW_SELECT, REVIEW_FEED } from "../components/ReviewCard";
import { CoordsField } from "../components/CoordsField";
import "../styles/manage.css";

type Tab = "requests" | "places" | "reviews" | "alerts" | "claims" | "billing" | "settings";
const TABS: [Tab, IconName, string][] = [["requests", "ticket", "Requests"], ["places", "store", "Places"], ["reviews", "star", "Reviews"], ["alerts", "flag", "Alerts"], ["claims", "shield", "Claims"], ["billing", "wallet", "Billing"], ["settings", "settings", "Settings"]];

interface Summary { to_review: number; live_places: number; collected_inr: number }

export default function Admin() {
  const [tab, setTab] = useState<Tab>("requests");
  const [sum, setSum] = useState<Summary | null>(null);
  const [n, setN] = useState(0);
  const refresh = () => setN((x) => x + 1);

  useEffect(() => {
    supabase.rpc("admin_summary").then(({ data }) => setSum(((data as Summary[]) || [])[0] ?? null));
  }, [n]);

  return (
    <div className="page">
      <div className="ad-head">
        <span className="icon-chip lg violet"><Icon name="shield" size={26} /></span>
        <h1 className="grow">Admin</h1>
        <Link to="/me" className="icon-btn" aria-label="Your profile"><Icon name="user" size={20} /></Link>
      </div>
      <div className="kpis">
        <div className="kpi ad-kpi"><span className="icon-chip sm amber"><Icon name="ticket" size={16} /></span><div className="n">{sum?.to_review ?? "–"}</div><div className="l">to review</div></div>
        <div className="kpi ad-kpi"><span className="icon-chip sm"><Icon name="store" size={16} /></span><div className="n">{sum?.live_places ?? "–"}</div><div className="l">live places</div></div>
        <div className="kpi ad-kpi"><span className="icon-chip sm sky"><Icon name="wallet" size={16} /></span><div className="n">{sum ? rupees(sum.collected_inr) : "–"}</div><div className="l">collected</div></div>
      </div>
      <div className="tabs ad-tabs" role="tablist">
        {TABS.map(([k, icon, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><Icon name={icon} size={18} />{label}</button>
        ))}
      </div>
      {tab === "requests" && <Requests key={n} onChange={refresh} />}
      {tab === "places" && <Places key={n} onChange={refresh} />}
      {tab === "reviews" && <Reviews />}
      {tab === "alerts" && <Alerts />}
      {tab === "claims" && <Claims />}
      {tab === "billing" && <Billing />}
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
      {rows === null ? <div className="skeleton" /> : rows.length === 0 ? <div className="empty"><span className="icon-chip lg"><Icon name="checkCircle" size={26} /></span><p>{filter === "open" ? "No requests waiting." : "No requests yet."}</p></div> :
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
  const [tables, setTables] = useState(String(r.tables ?? 10));
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
            <div>{r.wants_qr ? `${r.tables ? `${r.tables} table QRs` : "Table QRs"} (${r.qr_style || "neon"})` : "Listing only"}</div>
            <div>Plan <b>{r.plan || "trial"}</b>{r.billing_interval ? `, ${r.billing_interval === "year" ? "yearly" : "monthly"}` : ""} · {r.amount_inr > 0 ? (r.status === "pending" ? "waiting for payment" : "paid") : "free trial"}</div>
            {r.note && <div className="muted">“{r.note}”</div>}
          </div>
          {r.status === "pending" && r.amount_inr > 0 && (
            <div className="row">
              <input className="input" placeholder="Paid outside the app? Reference (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
              <button className="btn small green" style={{ height: 50 }} disabled={busy} onClick={markPaid}><Icon name="wallet" size={16} />Mark paid</button>
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
              {r.status === "pending" && r.amount_inr > 0 && <div className="notice warn small">Not paid yet. If you approve now the shop starts on the free trial; give a plan later from Billing.</div>}
              <div className="row">
                <button className="btn small green grow" disabled={busy} onClick={approve}><Icon name="checkCircle" size={17} />Approve and go live</button>
                <button className="btn small danger" disabled={busy} onClick={decline} aria-label="Decline"><Icon name="close" size={17} />Decline</button>
              </div>
            </>
          )}
          {r.place_id && (
            <div className="row wrap" style={{ gap: 16 }}>
              <Link to={`/admin/place/${r.place_id}`} className="link-btn"><Icon name="settings" size={15} />Place and QR codes</Link>
              <Link to={`/manage/${r.place_id}`} className="link-btn"><Icon name="box" size={15} />Products</Link>
            </div>
          )}
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
              <span className="icon-chip sm"><Icon name="store" size={16} /></span>
              <div className="grow stack tight">
                <span className="strong">{p.name}</span>
                <span className="small muted">{[p.category, p.area, p.city].filter(Boolean).join(" · ")}</span>
              </div>
              <span className="stack tight" style={{ alignItems: "flex-end" }}>
                <span className={`badge ${p.status === "live" ? "" : p.status === "lapsed" ? "warn" : "red"}`}>{p.status}</span>
                {p.listed_until && <span className={`tiny ${soon(p.listed_until) ? "strong" : "muted"}`} style={soon(p.listed_until) ? { color: "#7a5410" } : undefined}>until {p.listed_until}</span>}
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
      { key: "visit_window_hours", value: Math.max(1, Number(v.visit_window_hours) || 6) },
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
      {field("support_phone", "WhatsApp number for businesses", "tel", "919800000000")}
      {field("visit_window_hours", "Hours a QR scan counts as a visit", "number")}
      <button className="btn green block"><Icon name="check" size={18} />Save settings</button>
      <p className="tiny muted">Plan prices and QR limits are under Billing.</p>
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

/* ---------- Alerts: reports and unusual patterns ---------- */
interface Alert { kind: string; place_id: string | null; place_name: string | null; review_id: string | null; detail: string; n: number; seen_at: string | null }
const ALERT_LOOK: Record<string, [IconName, string]> = {
  reported: ["flag", "Reported review"], burst: ["zap", "Burst of 5-star reviews"], far_scans: ["pin", "Scans far from the shop"],
  link_skew: ["link", "Link reviews much higher"], busy_device: ["alert", "One phone, many reviews"],
};

function Alerts() {
  const toast = useToast();
  const [rows, setRows] = useState<Alert[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => {
    setRows(null);
    supabase.rpc("admin_alerts").then(({ data, error }) => {
      setErr(error ? (error.code === "PGRST202" ? "Run the latest database update to see alerts." : errorText(error)) : "");
      setRows((data as Alert[]) || []);
    });
  };
  useEffect(load, []);

  async function act(a: Alert, hide: boolean) {
    if (hide && !confirm("Hide this review from everyone?")) return;
    if (hide) {
      const { error } = await supabase.from("reviews").update({ status: "hidden" }).eq("id", a.review_id!);
      if (error) { toast(errorText(error)); return; }
    }
    const { error } = await supabase.from("review_reports").update({ resolved_at: new Date().toISOString() }).eq("review_id", a.review_id!).is("resolved_at", null);
    if (error) { toast(errorText(error)); return; }
    toast(hide ? "Review hidden" : "Kept, report closed");
    load();
  }

  return (
    <div className="stack">
      <p className="small muted">Reports from people and patterns that often mean fake reviews. Nothing here says who anyone is.</p>
      {err && <div className="notice err row"><span className="grow">{err}</span><button className="link-btn" onClick={load}>Retry</button></div>}
      {rows === null ? <div className="skeleton" /> : rows.length === 0 && !err ? <div className="empty"><p>All quiet. Nothing needs a look.</p></div> :
        rows.map((a, i) => {
          const [icon, title] = ALERT_LOOK[a.kind] || ["alert", a.kind];
          return (
            <div key={i} className="card stack" style={{ gap: 8 }}>
              <div className="row">
                <span className={`icon-chip sm ${a.kind === "reported" ? "coral" : "amber"}`}><Icon name={icon} size={16} /></span>
                <span className="grow stack tight"><span className="strong">{title}</span>{a.place_name && <span className="tiny muted">{a.place_name}</span>}</span>
                {a.seen_at && <span className="tiny muted">{timeAgo(a.seen_at)}</span>}
              </div>
              <p className="small" style={{ overflowWrap: "anywhere" }}>{a.detail}{a.kind === "reported" && a.n > 1 ? ` (${a.n} reports)` : ""}</p>
              <div className="row" style={{ gap: 8 }}>
                {a.place_id && <Link to={`/p/${a.place_id}`} className="btn small ghost"><Icon name="store" size={15} />Open shop</Link>}
                {a.kind === "reported" && a.review_id && <>
                  <button className="btn small ghost" onClick={() => act(a, false)}>Keep</button>
                  <button className="btn small danger" onClick={() => act(a, true)}>Hide review</button>
                </>}
              </div>
            </div>
          );
        })}
    </div>
  );
}

/* ---------- Shop claims ---------- */
interface ClaimRow { id: string; place_id: string; place_name: string; area: string | null; kind: string; near: boolean | null; photo_path: string | null; role: string | null; phone: string | null; claimer_name: string | null; has_owner: boolean; created_at: string }

function ClaimPhoto({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (isDemoArt(path)) { setSrc(demoArtUrl(path, 600)); return; }
    supabase.storage.from("claim-photos").createSignedUrl(path, 600).then(({ data }) => setSrc(data?.signedUrl ?? null));
  }, [path]);
  return src ? <img src={src} alt="Shop front" className="cl-photo" /> : null;
}

function Claims() {
  const toast = useToast();
  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => {
    supabase.rpc("admin_claims").then(({ data, error }) => {
      setErr(error ? (error.code === "PGRST202" ? "Run the latest database update to see claims." : errorText(error)) : "");
      setRows((data as ClaimRow[]) || []);
    });
  };
  useEffect(load, []);
  async function decide(c: ClaimRow, ok: boolean) {
    if (ok && c.has_owner && !confirm("This shop already has an owner. Give it to this person instead?")) return;
    const { error } = await supabase.rpc("decide_claim", { p_claim: c.id, p_approve: ok });
    if (error) toast(errorText(error)); else { toast(ok ? "Approved. They can manage the shop now." : "Rejected"); load(); }
  }
  return (
    <div className="stack">
      {err && <div className="notice err">{err}</div>}
      {rows === null ? <div className="skeleton" /> : rows.length === 0 && !err ? <div className="empty"><p>No claims waiting.</p></div> :
        rows.map((c) => (
          <div key={c.id} className="card stack" style={{ gap: 8 }}>
            <div className="row">
              <span className={`icon-chip sm ${c.kind === "access" ? "amber" : ""}`}><Icon name={c.kind === "access" ? "lock" : "store"} size={16} /></span>
              <span className="grow stack tight">
                <Link to={`/p/${c.place_id}`} className="strong" style={{ color: "inherit" }}>{c.place_name}</Link>
                <span className="tiny muted">{c.claimer_name || "Someone"}{c.role ? `, ${c.role}` : ""}{c.phone ? ` · ${c.phone}` : ""} · {timeAgo(c.created_at)}</span>
              </span>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className={`badge ${c.near ? "" : "warn"}`}><Icon name="pin" size={12} />{c.near === true ? "Was at the shop" : c.near === false ? "Far from the shop" : "Location unknown"}</span>
              {c.kind === "access" && <span className="badge warn"><Icon name="alert" size={12} />Shop already has an owner</span>}
            </div>
            {c.photo_path && <ClaimPhoto path={c.photo_path} />}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn small green grow" onClick={() => decide(c, true)}>Approve</button>
              <button className="btn small ghost grow" onClick={() => decide(c, false)}>Reject</button>
            </div>
          </div>
        ))}
    </div>
  );
}

/* ---------- Plan payments ---------- */
interface BillRow { id: string; place_id: string; place_name: string; plan: string; billing_interval: string; currency: string; amount_minor: number; status: string; provider_payment_id: string | null; created_at: string; paid_at: string | null }

function Billing() {
  const [view, setView] = useState<"payments" | "shops" | "prices">("payments");
  return (
    <div className="stack">
      <div className="chips">
        {([["payments", "Payments"], ["shops", "Shops and plans"], ["prices", "Plan prices"]] as const).map(([k, l]) => (
          <button key={k} className={`chip ${view === k ? "on" : ""}`} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      {view === "payments" && <Payments />}
      {view === "shops" && <ShopPlans />}
      {view === "prices" && <PlanPrices />}
    </div>
  );
}

function Payments() {
  const [rows, setRows] = useState<BillRow[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    supabase.rpc("admin_billing", { p_limit: 200 }).then(({ data, error }) => {
      setErr(error ? (error.code === "PGRST202" ? "Run the latest database update to see payments." : errorText(error)) : "");
      setRows((data as BillRow[]) || []);
    });
  }, []);
  const paid = (rows || []).filter((r) => r.status === "paid");
  const total = paid.reduce((n, r) => n + r.amount_minor, 0) / 100;
  return (
    <div className="stack">
      {err && <div className="notice err">{err}</div>}
      {rows && !err && <div className="card row"><span className="icon-chip"><Icon name="rupee" size={18} /></span><span className="grow stack tight"><span className="strong">₹{total.toLocaleString("en-IN")}</span><span className="tiny muted">{paid.length} Razorpay payments</span></span></div>}
      {rows === null ? <div className="skeleton" /> : rows.length === 0 && !err ? <div className="empty"><p>No Razorpay payments yet.</p></div> :
        rows.map((r) => (
          <div key={r.id} className="card row" style={{ gap: 10 }}>
            <span className={`icon-chip sm ${r.status === "paid" ? "" : r.status === "created" ? "amber" : "coral"}`}><Icon name={r.status === "paid" ? "check" : "clock"} size={15} /></span>
            <span className="grow stack tight">
              {r.place_id ? <Link to={`/p/${r.place_id}`} className="strong" style={{ color: "inherit" }}>{r.place_name}</Link> : <span className="strong">{r.place_name} <span className="tiny muted">(sign-up)</span></span>}
              <span className="tiny muted">{r.plan}, 1 {r.billing_interval} · {r.status === "created" ? "not paid" : r.status} · {timeAgo(r.paid_at || r.created_at)}{r.provider_payment_id ? ` · ${r.provider_payment_id}` : ""}</span>
            </span>
            <span className="strong">₹{(r.amount_minor / 100).toLocaleString("en-IN")}</span>
          </div>
        ))}
    </div>
  );
}

interface ShopPlan { place_id: string; place_name: string; area: string | null; plan: string; plan_name: string; status: string; period_end: string; qr_used: number; qr_limit: number; reviews_open: boolean }
interface PlanDef { code: string; name: string; qr_limit: number; price_inr_year: number | null; price_inr_month: number | null; price_usd_year: number | null; price_usd_month: number | null }

function ShopPlans() {
  const toast = useToast();
  const [rows, setRows] = useState<ShopPlan[] | null>(null);
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ plan: "starter", months: "12", amount: "", ref: "" });
  const [find, setFind] = useState("");
  const load = () => {
    supabase.rpc("admin_shop_plans").then(({ data, error }) => {
      setErr(error ? (error.code === "PGRST202" ? "Run the latest database update to see plans." : errorText(error)) : "");
      setRows((data as ShopPlan[]) || []);
    });
  };
  useEffect(() => { load(); supabase.from("plans").select("*").order("sort_order").then(({ data }) => setPlans((data as PlanDef[]) || [])); }, []);

  async function give(r: ShopPlan) {
    const { error } = await supabase.rpc("admin_set_plan", { p_place: r.place_id, p_plan: f.plan, p_months: parseInt(f.months, 10) || 0, p_amount_inr: parseInt(f.amount, 10) || 0, p_ref: f.ref || null });
    if (error) toast(errorText(error)); else { toast("Plan updated"); setOpen(null); load(); }
  }
  const shown = (rows || []).filter((r) => !find.trim() || r.place_name.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <div className="stack">
      {err && <div className="notice err">{err}</div>}
      <div className="search"><Icon name="search" color="var(--muted)" /><input type="search" placeholder="Find a shop" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a shop" /></div>
      {rows === null ? <div className="skeleton" /> : shown.map((r) => (
        <div key={r.place_id} className="card stack" style={{ gap: 8 }}>
          <button className="row" style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", gap: 10 }} onClick={() => setOpen(open === r.place_id ? null : r.place_id)}>
            <span className={`icon-chip sm ${r.reviews_open ? "" : "coral"}`}><Icon name={r.reviews_open ? "check" : "clock"} size={15} /></span>
            <span className="grow stack tight"><span className="strong">{r.place_name}</span>
              <span className="tiny muted">{r.plan_name} · {r.status === "expired" ? "ended" : `until ${new Date(r.period_end).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`} · {r.qr_used}/{r.qr_limit} QRs</span></span>
            <span className={`badge ${r.reviews_open ? "" : "warn"}`}>{r.reviews_open ? "Reviews on" : "Paused"}</span>
          </button>
          {open === r.place_id && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="grid2">
                <div className="field"><label>Plan</label>
                  <select className="input" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>{plans.filter((p) => p.code !== "trial").map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
                <div className="field"><label>Months</label><input className="input" type="number" min={1} max={36} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></div>
              </div>
              <div className="grid2">
                <div className="field"><label>Received ₹ (optional)</label><input className="input" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
                <div className="field"><label>Reference</label><input className="input" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="Cash, UPI id…" /></div>
              </div>
              <button className="btn small green" onClick={() => give(r)}><Icon name="check" size={16} />Give or extend plan</button>
              <Link to={`/admin/place/${r.place_id}`} className="link-btn tiny"><Icon name="settings" size={14} />Place and QR codes</Link>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PlanPrices() {
  const toast = useToast();
  const [plans, setPlans] = useState<PlanDef[] | null>(null);
  const load = () => supabase.from("plans").select("*").order("sort_order").then(({ data }) => setPlans((data as PlanDef[]) || []));
  useEffect(() => { load(); }, []);
  const edit = (code: string, k: keyof PlanDef, v: string) => setPlans((ps) => (ps || []).map((p) => (p.code === code ? { ...p, [k]: k === "name" ? v : Number(v) } : p)));
  async function save(p: PlanDef) {
    const { error } = await supabase.rpc("admin_update_plan", {
      p_code: p.code, p_name: p.name, p_qr_limit: p.qr_limit, p_price_inr_year: p.price_inr_year ?? 0, p_price_inr_month: p.price_inr_month ?? 0,
      p_price_usd_year: p.price_usd_year ?? 0, p_price_usd_month: p.price_usd_month ?? 0,
    });
    if (error) toast(errorText(error)); else { toast(`${p.name} saved`); load(); }
  }
  if (!plans) return <div className="skeleton" />;
  return (
    <div className="stack">
      <p className="small muted">New prices apply to new payments. Sign-up requests already sent keep the price they showed.</p>
      {plans.map((p) => (
        <div key={p.code} className="card stack" style={{ gap: 8 }}>
          <div className="grid2">
            <div className="field"><label>Name</label><input className="input" value={p.name} onChange={(e) => edit(p.code, "name", e.target.value)} /></div>
            <div className="field"><label>Review QRs</label><input className="input" type="number" min={1} value={p.qr_limit} onChange={(e) => edit(p.code, "qr_limit", e.target.value)} /></div>
          </div>
          {p.code !== "trial" && (
            <>
              <div className="grid2">
                <div className="field"><label>₹ yearly</label><input className="input" type="number" min={0} value={p.price_inr_year ?? 0} onChange={(e) => edit(p.code, "price_inr_year", e.target.value)} /></div>
                <div className="field"><label>₹ monthly</label><input className="input" type="number" min={0} value={p.price_inr_month ?? 0} onChange={(e) => edit(p.code, "price_inr_month", e.target.value)} /></div>
              </div>
              <div className="grid2">
                <div className="field"><label>$ yearly (later)</label><input className="input" type="number" min={0} value={p.price_usd_year ?? 0} onChange={(e) => edit(p.code, "price_usd_year", e.target.value)} /></div>
                <div className="field"><label>$ monthly (later)</label><input className="input" type="number" min={0} value={p.price_usd_month ?? 0} onChange={(e) => edit(p.code, "price_usd_month", e.target.value)} /></div>
              </div>
            </>
          )}
          <button className="btn small green" onClick={() => save(p)}><Icon name="check" size={16} />Save {p.name}</button>
        </div>
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
      <div className="section-title"><span className="icon-chip sm sky"><Icon name={table === "topics" ? "grid" : "tag"} size={16} /></span>{title}</div>
      <div className="chips">{list.map((x) => (
        <span key={x.id} className="chip row" style={{ gap: 6 }}>{x.text}
          <button type="button" className="link-btn" aria-label={`Remove ${x.text}`} onClick={() => remove(table, x.id, x.text)}><Icon name="close" size={14} color="var(--muted)" /></button>
        </span>
      ))}</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(table, value, () => setValue("")); }}>
        <input className="input" placeholder={ph} value={value} onChange={(e) => setValue(e.target.value)} aria-label={ph} />
        <button className="btn small" style={{ height: 50 }} aria-label="Add"><Icon name="plus" size={18} /></button>
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
