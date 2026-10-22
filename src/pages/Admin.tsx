import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { olderThan } from "../lib/reviews";
import { demoArtUrl, isDemoArt } from "../lib/demoArt";
import { useSettings, type AppSettings } from "../lib/settings";
import type { Place, ReviewRow, Topic } from "../lib/types";
import { rupees, timeAgo, parseCoords, extractPlaceId } from "../lib/util";
import { syncPinFromGoogle } from "../lib/pin";
import { Icon, TopBar, useToast, type IconName } from "../components/ui";
import { ReviewCard, REVIEW_SELECT, REVIEW_FEED } from "../components/ReviewCard";
import { CoordsField } from "../components/CoordsField";
import { GoogleFind, areaCityFromAddress, matchCategory } from "../components/manage/Google";
import "../styles/manage.css";

type Tab = "verify" | "places" | "reviews" | "alerts" | "claims" | "billing" | "stats" | "settings";
const TABS: [Tab, IconName, string][] = [["verify", "shield", "Verify"], ["places", "store", "Places"], ["reviews", "star", "Reviews"], ["alerts", "flag", "Alerts"], ["claims", "shield", "Claims"], ["billing", "wallet", "Billing"], ["stats", "chart", "Stats"], ["settings", "settings", "Settings"]];

interface Summary { to_review: number; live_places: number; collected_inr: number }

export default function Admin() {
  const [tab, setTab] = useState<Tab>("verify");
  const [sum, setSum] = useState<Summary | null>(null);
  const [n, setN] = useState(0);
  const refresh = () => setN((x) => x + 1);

  useEffect(() => {
    supabase.rpc("admin_summary").then(({ data }) => setSum(((data as Summary[]) || [])[0] ?? null));
  }, [n]);

  return (
    <div className="page">
      <TopBar title="Admin" />
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
      {tab === "verify" && <Verify key={n} onChange={refresh} />}
      {tab === "places" && <Places key={n} onChange={refresh} />}
      {tab === "reviews" && <Reviews />}
      {tab === "alerts" && <Alerts />}
      {tab === "claims" && <Claims />}
      {tab === "billing" && <Billing />}
      {tab === "stats" && <Stats />}
      {tab === "settings" && <><Settings /><Vocabulary /></>}
    </div>
  );
}

/* ---------- Verify: shops list themselves; the team checks the Google page and links ---------- */
interface ToVerify { id: string; name: string; category: string; area: string | null; city: string; google_place_id: string | null; links: { kind: string; url: string }[] | null; contact_phone: string | null; verification_note: string | null; owner_name: string | null; created_at: string; has_location: boolean }

function Verify({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<ToVerify[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => {
    supabase.rpc("admin_places_to_verify").then(({ data, error }) => { setErr(error ? errorText(error) : ""); setRows((data as ToVerify[]) || []); });
  };
  useEffect(load, []);
  return (
    <div className="stack">
      {err && <div className="notice err row"><span className="grow">{err}</span><button className="link-btn" onClick={load}>Retry</button></div>}
      {rows === null ? <div className="skeleton" /> : rows.length === 0 ? <div className="empty"><span className="icon-chip lg"><Icon name="checkCircle" size={26} /></span><p>No shops waiting to be checked.</p></div> :
        rows.map((r) => <VerifyCard key={r.id} r={r} onDone={() => { load(); onChange(); }} />)}
    </div>
  );
}

function VerifyCard({ r, onDone }: { r: ToVerify; onDone: () => void }) {
  const toast = useToast();
  const [coords, setCoords] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(ok: boolean) {
    const c = coords.trim() ? parseCoords(coords) : null;
    if (coords.trim() && !c) { toast("Check the location"); return; }
    if (!ok && !note.trim()) { toast("Say why, so the owner can fix it"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("verify_place", { p_place: r.id, p_ok: ok, p_note: note.trim() || null, p_lat: c?.lat ?? null, p_lng: c?.lng ?? null });
    setBusy(false);
    if (error) toast(errorText(error)); else { toast(ok ? "Verified" : "Removed"); onDone(); }
  }
  const gmaps = r.google_place_id ? `https://www.google.com/maps/place/?q=place_id:${r.google_place_id}` : null;
  return (
    <div className="card">
      <div className="row between"><Link to={`/p/${r.id}`} className="strong ellipsis grow">{r.name}</Link><span className="tiny muted">{timeAgo(r.created_at)}</span></div>
      <span className="small muted">{[r.category, r.area, r.city].filter(Boolean).join(" · ")}{r.owner_name ? ` · by ${r.owner_name}` : ""}{r.contact_phone ? ` · ${r.contact_phone}` : ""}</span>
      {r.verification_note && <p className="small">{r.verification_note}</p>}
      <div className="stack tight">
        {gmaps ? <a className="small" href={gmaps} target="_blank" rel="noopener noreferrer">Google page: check name and address match</a> : <span className="small" style={{ color: "var(--danger)" }}>No Google page given</span>}
        {(r.links || []).map((l) => <a key={l.url} className="small ellipsis" href={l.url} target="_blank" rel="noopener noreferrer">{l.kind}: {l.url}</a>)}
      </div>
      {!r.has_location && <CoordsField value={coords} onChange={setCoords} />}
      <input className="input" placeholder="Note to the owner (needed to remove)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="grid2">
        <button className="btn small danger" disabled={busy} onClick={() => decide(false)}>Remove</button>
        <button className="btn small green" disabled={busy} onClick={() => decide(true)}><Icon name="check" size={16} />Verify</button>
      </div>
    </div>
  );
}

/* ---------- Places ---------- */
interface PlaceSub { plan: string; status: string; period_end: string }
type PlaceRow = Omit<Place, "listed_until"> & { subscriptions?: PlaceSub | PlaceSub[] | null };

function Places({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<PlaceRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", category: "", area: "", city: "", google_place_id: "" });
  const [coords, setCoords] = useState("");
  const [show, setShow] = useState<"all" | "renewals">("all");
  const [find, setFind] = useState("");
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noPin, setNoPin] = useState<Set<string>>(new Set());
  const PAGE = 50;
  const COLS = "id, name, category, area, city, status, google_place_id, about, hours, price_level, created_at";

  // Search and the renewals filter run in the database, a page at a time, so the list stays quick with thousands of places.
  // "Renewals due" = paid plans that end within 14 days (or have just ended and aren't marked expired yet).
  const query = (from: number) => {
    const renewals = show === "renewals";
    let q = supabase.from("places").select(`${COLS}, subscriptions${renewals ? "!inner" : ""}(plan, status, period_end)`).order("created_at", { ascending: false }).range(from, from + PAGE);
    const t = find.trim().replace(/[%,()*]/g, " ").trim();
    if (t) q = q.or(["name", "category", "area", "city"].map((c) => `${c}.ilike.%${t}%`).join(","));
    if (renewals) {
      q = q.neq("subscriptions.plan", "trial").in("subscriptions.status", ["active", "past_due", "cancelled"])
        .lte("subscriptions.period_end", new Date(Date.now() + 14 * 86400000).toISOString());
    }
    return q;
  };
  const load = () => {
    setRows(null);
    query(0).then(({ data }) => {
      const all = (data as unknown as PlaceRow[]) || [];
      setMore(all.length > PAGE);
      setRows(all.slice(0, PAGE));
    });
  };
  async function loadMore() {
    if (!rows || loadingMore) return;
    setLoadingMore(true);
    const { data } = await query(rows.length);
    setLoadingMore(false);
    const all = (data as unknown as PlaceRow[]) || [];
    setMore(all.length > PAGE);
    setRows((prev) => { const seen = new Set((prev || []).map((x) => x.id)); return [...(prev || []), ...all.slice(0, PAGE).filter((x) => !seen.has(x.id))]; });
  }
  useEffect(() => {
    const t = setTimeout(load, find ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find, show]);
  // Live shops without a map pin can't show up under "Near you".
  useEffect(() => {
    supabase.rpc("places_without_pin").then(({ data, error }) => { if (!error) setNoPin(new Set(((data as { place_id: string }[]) || []).map((r) => r.place_id))); });
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const gid = f.google_place_id.trim() ? extractPlaceId(f.google_place_id) : null;
    if (f.google_place_id.trim() && !gid) { toast("That isn't a Google Place ID"); return; }
    const c = coords.trim() ? parseCoords(coords) : null;
    if (coords.trim() && !c) { toast("Check the map location"); return; }
    const { data, error } = await supabase.from("places").insert({
      name: f.name.trim(), category: f.category.trim(), area: f.area.trim() || null, city: f.city.trim(), google_place_id: gid,
      status: "live",
    }).select("id").single();
    if (error) { toast(errorText(error)); return; }
    const newId = (data as { id: string }).id;
    // Google's pin when the place is linked to Google; otherwise the one typed in.
    const g = gid ? await syncPinFromGoogle(newId, gid) : null;
    if (c && !(g && g.ok)) {
      const r = await supabase.rpc("set_place_location", { p_place: newId, p_lat: c.lat, p_lng: c.lng });
      if (r.error) toast(errorText(r.error));
    }
    toast("Place added"); setAdding(false); setF({ name: "", category: "", area: "", city: "", google_place_id: "" }); setCoords(""); load(); onChange();
  }

  const soon = (d: string | null) => d && new Date(d).getTime() - Date.now() < 14 * 86400000;
  const subOf = (p: PlaceRow) => (Array.isArray(p.subscriptions) ? p.subscriptions[0] : p.subscriptions) ?? null;
  const shown = rows || [];

  return (
    <div className="stack">
      {adding ? (
        <form className="card" onSubmit={add}>
          <h2>Add a place</h2>
          <p className="tiny muted" style={{ margin: "-4px 0 8px" }}>
            Search Google Places to auto-fill details, or type them directly:
          </p>
          <GoogleFind
            placeholder="Search Google Places to auto-fill"
            onPick={(m) => {
              const { area, city } = areaCityFromAddress(m.address);
              setF({
                name: m.name,
                category: matchCategory(m) || f.category || "Restaurant",
                area: area || f.area,
                city: city || f.city || "Pune",
                google_place_id: m.id,
              });
            }}
          />
          <div className="grid2" style={{ marginTop: 8 }}>
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
        <button className={`chip ${show === "renewals" ? "on" : ""}`} onClick={() => setShow("renewals")}>Renewals due</button>
      </div>
      <div className="search"><Icon name="search" color="var(--muted)" /><input aria-label="Find a place" placeholder="Find a place" value={find} onChange={(e) => setFind(e.target.value)} /></div>
      {rows === null ? <div className="skeleton" /> : shown.length === 0 ? <div className="empty"><p>{show === "renewals" ? "No paid plans end in the next 14 days." : "No places found."}</p></div> : (
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
                {noPin.has(p.id) && <span className="badge warn"><Icon name="pin" size={11} />No pin</span>}
                {(() => {
                  const sub = subOf(p);
                  if (!sub || sub.plan === "trial" || sub.status === "expired") return null;
                  const end = sub.period_end;
                  return <span className={`tiny ${soon(end) ? "strong" : "muted"}`} style={soon(end) ? { color: "#7a5410" } : undefined}>{sub.plan} until {new Date(end).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>;
                })()}
              </span>
            </Link>
          ))}
          {more && <button type="button" className="btn ghost block" style={{ marginTop: 10 }} disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Loading…" : "Show more places"}</button>}
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

  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE = 40;
  const page = (before?: { created_at: string; id: string }) => {
    let q = supabase.from(REVIEW_FEED).select(REVIEW_SELECT).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE + 1);
    if (show === "hidden") q = q.eq("status", "hidden");
    if (before) q = q.or(olderThan(before));
    return q;
  };
  const load = () => {
    setRows(null);
    page().then(({ data, error }) => {
      setErr(error ? errorText(error) : "");
      const all = (data as unknown as ReviewRow[]) || [];
      setMore(all.length > PAGE);
      setRows(all.slice(0, PAGE));
    });
  };
  useEffect(load, [show]);
  async function loadMore() {
    const last = rows?.[rows.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    const { data, error } = await page(last);
    setLoadingMore(false);
    if (error) { toast(errorText(error)); return; }
    const all = (data as unknown as ReviewRow[]) || [];
    setMore(all.length > PAGE);
    setRows((prev) => { const seen = new Set((prev || []).map((x) => x.id)); return [...(prev || []), ...all.slice(0, PAGE).filter((x) => !seen.has(x.id))]; });
  }

  async function setStatus(r: ReviewRow, status: "published" | "hidden") {
    const { error } = await supabase.from("reviews").update({ status }).eq("id", r.id);
    if (error) { toast(errorText(error)); return; }
    toast(status === "hidden" ? "Review hidden" : "Review restored");
    setRows((rs) => (rs || []).map((x) => (x.id === r.id ? { ...x, status } : x)).filter((x) => show !== "hidden" || x.status === "hidden"));
  }

  /** The team can take down an owner's reply (only the owner can write one). */
  async function removeReply(r: ReviewRow) {
    const { error } = await supabase.rpc("reply_to_review", { p_review_id: r.id, p_text: "" });
    if (error) { toast(errorText(error)); return; }
    toast("Reply removed");
    setRows((rs) => (rs || []).map((x) => (x.id === r.id ? { ...x, owner_reply: null, owner_reply_at: null } : x)));
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
          <ReviewCard key={r.id} r={r} showPlace reveal>
            <div className="row between">
              {r.status === "hidden" ? <span className="badge red">Hidden</span> : <span className="badge gray">Published</span>}
              <span className="row" style={{ gap: 8 }}>
                {r.owner_reply && <button className="btn small ghost" onClick={() => { if (confirm("Remove the owner's reply?")) removeReply(r); }}><Icon name="trash" size={15} />Remove reply</button>}
                {r.status === "hidden"
                  ? <button className="btn small ghost" onClick={() => setStatus(r, "published")}>Restore</button>
                  : <button className="btn small danger" onClick={() => { if (confirm("Hide this review from everyone?")) setStatus(r, "hidden"); }}>Hide</button>}
              </span>
            </div>
          </ReviewCard>
        ))}
      {more && <button type="button" className="btn ghost block" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Loading…" : "Show older reviews"}</button>}
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

// Daily totals only (no people): page views counted by the app, plus the review funnel from the tables.
const STAT_LABELS: [string, string][] = [
  ["scans", "QR scans"], ["review_started", "Reviews started"], ["reviews", "Reviews posted"], ["google_opened", "Sent on to Google"],
  ["view_home", "Home views"], ["view_place", "Shop page views"], ["view_best", "Dish page views"], ["view_qr", "QR pages opened"],
  ["view_business", "Business page views"], ["view_pricing", "Pricing views"], ["new_places", "New shops"], ["installed", "App installs"],
];

function Stats() {
  const [rows, setRows] = useState<{ day: string; metric: string; n: number }[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    supabase.rpc("admin_daily_stats", { p_days: 30 }).then(({ data, error }) => {
      setErr(error ? (error.code === "PGRST202" ? "Run the latest database update to see stats." : errorText(error)) : "");
      setRows((data as { day: string; metric: string; n: number }[]) || []);
    });
  }, []);
  if (!rows) return <div className="skeleton" style={{ height: 160 }} />;
  const since = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days + 1); return d.toISOString().slice(0, 10); };
  const sum = (metric: string, days: number) => rows.filter((r) => r.metric === metric && r.day >= since(days)).reduce((n, r) => n + Number(r.n), 0);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  const scans = sum("scans", 30), posted = sum("reviews", 30), google = sum("google_opened", 30);
  return (
    <div className="stack">
      {err && <div className="notice err">{err}</div>}
      <div className="card stack tight">
        <b>Last 30 days</b>
        <span className="small muted">{scans} scans, {posted} reviews ({pct(posted, scans)} of scans), {google} sent on to Google ({pct(google, posted)} of reviews)</span>
      </div>
      <div className="list">
        <div className="list-item small muted"><span className="grow">Counted per day, never per person</span><span style={{ width: 56, textAlign: "right" }}>Today</span><span style={{ width: 56, textAlign: "right" }}>7 days</span><span style={{ width: 56, textAlign: "right" }}>30 days</span></div>
        {STAT_LABELS.map(([k, label]) => (
          <div key={k} className="list-item"><span className="grow">{label}</span><span style={{ width: 56, textAlign: "right" }}>{sum(k, 1)}</span><span style={{ width: 56, textAlign: "right" }}>{sum(k, 7)}</span><b style={{ width: 56, textAlign: "right" }}>{sum(k, 30)}</b></div>
        ))}
      </div>
    </div>
  );
}

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
      <BillingAlerts />
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

interface BillingAlert { id: string; kind: string; place_id: string | null; provider_order_id: string | null; provider_payment_id: string | null; amount_minor: number | null; expected_minor: number | null; created_at: string; places: { name: string } | null }
const ALERT_TEXT: Record<string, string> = {
  second_payment: "Paid twice: a second payment came in for an order that was already paid",
  amount_mismatch: "Wrong amount: the payment didn't match the order, so the plan didn't start",
  closed_order: "Paid after the order was closed (failed or refunded)",
  unknown_order: "Payment for an order we don't have",
  no_shop: "Paid order with no shop attached",
};

/** Money Razorpay captured that didn't simply start a plan. Nothing is refunded automatically: check in Razorpay. */
function BillingAlerts() {
  const toast = useToast();
  const [rows, setRows] = useState<BillingAlert[]>([]);
  const load = () => {
    supabase.from("billing_alerts").select("id, kind, place_id, provider_order_id, provider_payment_id, amount_minor, expected_minor, created_at, places(name)")
      .is("resolved_at", null).order("created_at", { ascending: false }).limit(50)
      .then(({ data, error }) => { if (!error) setRows((data as unknown as BillingAlert[]) || []); });
  };
  useEffect(load, []);
  async function done(id: string) {
    const { error } = await supabase.from("billing_alerts").update({ resolved_at: new Date().toISOString() }).eq("id", id);
    if (error) toast(errorText(error)); else setRows((r) => r.filter((x) => x.id !== id));
  }
  if (rows.length === 0) return null;
  const inr = (m: number | null) => (m == null ? "?" : `₹${(m / 100).toLocaleString("en-IN")}`);
  return (
    <div className="mg-section" style={{ gap: 10 }}>
      <div className="mg-section-head"><span className="icon-chip sm coral"><Icon name="alert" size={16} /></span><span className="grow">Payments needing attention</span><span className="badge red">{rows.length}</span></div>
      <p className="tiny muted">Nothing was refunded automatically. Check each one in Razorpay, refund there if needed, then mark it done.</p>
      {rows.map((r) => (
        <div key={r.id} className="list-item" style={{ gap: 10 }}>
          <span className="grow stack tight" style={{ minWidth: 0 }}>
            <span className="small strong">{ALERT_TEXT[r.kind] || r.kind}</span>
            <span className="tiny muted" style={{ overflowWrap: "anywhere" }}>
              {r.place_id ? <Link to={`/admin/place/${r.place_id}`}>{r.places?.name || "Shop"}</Link> : "No shop"} · {inr(r.amount_minor)}{r.kind === "amount_mismatch" ? ` (order ${inr(r.expected_minor)})` : ""} · {timeAgo(r.created_at)}
              {r.provider_payment_id ? ` · ${r.provider_payment_id}` : ""}{r.provider_order_id ? ` · ${r.provider_order_id}` : ""}
            </span>
          </span>
          <button type="button" className="btn small ghost" onClick={() => done(r.id)}><Icon name="check" size={15} />Done</button>
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
              <span className="tiny muted">{r.plan_name} · {r.status === "expired" ? "ended" : `until ${new Date(r.period_end).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`} · {r.qr_used}/{r.qr_limit} QRs</span></span>
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
