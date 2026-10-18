import { setFocusShop } from "../lib/focus";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deviceId } from "../lib/device";
import { supabase, errorText } from "../lib/supabase";
import { lastGuestError, useAuth } from "../lib/auth";
import { getLocation } from "../lib/util";
import { Icon, Spinner } from "../components/ui";
import { DietDot, loadShopItems, type ShopItem } from "../components/place/shop";
import { ItemThumb } from "../components/place/ItemThumb";
import "../styles/review.css";

interface Peek { place_id: string; place_name: string; area: string | null; table_label?: string | null; status?: "ok" | "used" | "expired" }
interface Visit { visit_id: string; expires_at: string }
interface TopItem extends ShopItem {
  reviewCount: number;
  ratingAvg?: number;
  lovedPct?: number;
}

function friendly(e: unknown): string {
  const m = errorText(e);
  if (m === "Failed to fetch" || /network/i.test(m)) return "You seem to be offline.";
  return m;
}

/** Landing for a table QR (/q/:token) or a shop's one-time review link (/r/:token). Both unlock a visit. */
export default function QrLanding({ link = false }: { link?: boolean }) {
  const { token = "" } = useParams();
  const { session, loading, startGuest } = useAuth();
  const navTo = useNavigate();
  const [starting, setStarting] = useState(false);
  const [guestErr, setGuestErr] = useState("");
  const uid = session?.user.id;
  const [peek, setPeek] = useState<Peek | null | undefined>(undefined);
  const [peekErr, setPeekErr] = useState("");
  const [peekTry, setPeekTry] = useState(0);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [scanErr, setScanErr] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanTry, setScanTry] = useState(0);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!peek?.place_id) return;
    try {
      const raw = localStorage.getItem(`tp-plan:${peek.place_id}`) || sessionStorage.getItem(`tp_preselected_${peek.place_id}`);
      if (raw) {
        if (raw.startsWith("{")) {
          const parsed = JSON.parse(raw);
          if (parsed.expiresAt > Date.now() && Array.isArray(parsed.ids)) {
            setSelectedIds(parsed.ids);
          }
        } else if (raw) {
          setSelectedIds([raw]);
        }
      }
    } catch {}
  }, [peek?.place_id]);

  const toggleSelected = (item: TopItem) => {
    if (!peek?.place_id) return;
    const next = selectedIds.includes(item.id)
      ? selectedIds.filter((id) => id !== item.id)
      : [...selectedIds, item.id].slice(0, 5);
    setSelectedIds(next);
    try {
      localStorage.setItem(`tp-plan:${peek.place_id}`, JSON.stringify({ ids: next, expiresAt: Date.now() + 6 * 3600 * 1000 }));
      sessionStorage.setItem(`tp_preselected_${peek.place_id}`, next[0] || "");
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15);
    } catch {}
  };
  // One visit per code per signed-in user per page view (StrictMode runs effects twice).
  const scannedFor = useRef<string | null>(null);
  const unlockFn = link ? "redeem_review_link" : "scan_qr";
  // Table scans send where the phone is (if allowed), so far-away scans count less. Only "near or not" is kept.
  async function unlock() {
    if (link) {
      const r = await supabase.rpc(unlockFn, { p_token: token, p_device: deviceId() });
      return r.error?.code === "PGRST202" ? supabase.rpc(unlockFn, { p_token: token }) : r;
    }
    const at = await getLocation();
    const r = await supabase.rpc(unlockFn, { p_token: token, p_lat: at?.lat ?? null, p_lng: at?.lng ?? null });
    return r.error?.code === "PGRST202" ? supabase.rpc(unlockFn, { p_token: token }) : r;
  }
  const startingGuest = useRef(false);

  useEffect(() => {
    let alive = true;
    setPeek(undefined);
    setPeekErr("");
    supabase.rpc(link ? "peek_review_link" : "peek_qr", { p_token: token }).then(async ({ data, error }) => {
      if (!alive) return;
      if (error) { setPeekErr(friendly(error)); return; }
      const pk = ((data as Peek[]) || [])[0] ?? null;
      if (pk?.place_id) {
        setFocusShop(pk.place_id);
        loadShopItems(pk.place_id).then(async ({ items }) => {
          if (!alive || !items.length) return;
          try {
            const { data: revs } = await supabase.from("reviews").select("item_id, rating").eq("place_id", pk.place_id).eq("status", "published");
            const counts: Record<string, { sum: number; count: number; fourPlus: number }> = {};
            for (const r of (revs as { item_id: string; rating: number }[] | null) || []) {
              if (!counts[r.item_id]) counts[r.item_id] = { sum: 0, count: 0, fourPlus: 0 };
              counts[r.item_id].sum += r.rating;
              counts[r.item_id].count++;
              if (r.rating >= 4) counts[r.item_id].fourPlus++;
            }
            const sorted = items
              .filter((it) => (counts[it.id]?.count || 0) >= 1)
              .map((it) => {
                const c = counts[it.id] || { sum: 0, count: 0, fourPlus: 0 };
                return {
                  ...it,
                  reviewCount: c.count,
                  ratingAvg: c.count ? c.sum / c.count : undefined,
                  lovedPct: c.count ? Math.round((c.fourPlus / c.count) * 100) : 100,
                };
              })
              .sort((a, b) => (b.lovedPct ?? 0) - (a.lovedPct ?? 0) || b.reviewCount - a.reviewCount)
              .slice(0, 3);
            if (alive) setTopItems(sorted);
          } catch {
            if (alive) setTopItems([]);
          }
        }).catch(() => {});
      }
      setPeek(pk);
    }, (e: unknown) => { if (alive) setPeekErr(friendly(e)); });
    return () => { alive = false; };
  }, [token, peekTry, link]);

  useEffect(() => {
    if (loading || !uid || !peek || peek.status === "expired" || startingGuest.current) return;
    const key = `${uid}:${token}:${scanTry}`;
    if (scannedFor.current === key) return;
    scannedFor.current = key;
    setScanning(true);
    setScanErr("");
    unlock().then(({ data, error }) => {
      setScanning(false);
      if (error) { setScanErr(friendly(error)); return; }
      const v = ((data as Visit[]) || [])[0];
      setVisit(v ?? { visit_id: "", expires_at: "" });
    }, (e: unknown) => { setScanning(false); setScanErr(friendly(e)); });
  }, [loading, uid, peek, token, scanTry]); // eslint-disable-line react-hooks/exhaustive-deps

  const bar = <div className="rvx-bar"><span className="rvx-brand">Trusted Picks</span><span className="grow" /></div>;
  if (peekErr) return (
    <div className="rvx">
      {bar}
      <div className="rvx-gate">
        <span className="ico"><Icon name="alert" size={28} /></span>
        <h2>Couldn't check this {link ? "review link" : "table code"}</h2>
        <p>{peekErr}</p>
        <button type="button" className="rvx-cta" onClick={() => setPeekTry((n) => n + 1)}><span>Try again</span><Icon name="chev" size={20} /></button>
      </div>
    </div>
  );
  if (peek === undefined) return <div className="rvx"><div className="rvx-center"><Spinner /></div></div>;
  const dead = !peek ? (link ? "This review link doesn't work" : "This code isn't active")
    : peek.status === "expired" ? "This review link has expired"
    : peek.status === "used" && !session ? "This review link was already used" : null;
  if (!peek || dead) return (
    <div className="rvx">
      {bar}
      <div className="rvx-gate">
        <span className="ico"><Icon name={link ? "link" : "qr"} size={28} /></span>
        <h2>{dead}</h2>
        <p>{link ? "Ask the shop to send you a new link." : "Ask the staff for a new table card."}</p>
        <Link className="rvx-more" to="/"><Icon name="search" size={16} />Search places</Link>
      </div>
    </div>
  );

  const until = visit?.expires_at ? new Date(visit.expires_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : null;

  async function rateAsGuest() {
    // Start a guest session and unlock the verified visit before moving on.
    setStarting(true); setGuestErr(""); startingGuest.current = true;
    const ok = await startGuest();
    if (ok) {
      // Stay on "Opening…" until the visit is unlocked, so nobody reaches the review before it exists.
      const { data } = await supabase.auth.getSession();
      scannedFor.current = `${data.session?.user.id}:${token}:${scanTry}`;
      setScanning(true);
      const r = await unlock().then((x) => x, (e: unknown) => ({ data: null, error: e as Error }));
      setScanning(false); setStarting(false); startingGuest.current = false;
      if (r.error) { setScanErr(friendly(r.error)); return; }
      const v = ((r.data as Visit[]) || [])[0];
      setVisit(v ?? { visit_id: "", expires_at: "" });
      navTo(`/review/${peek!.place_id}`);
    } else {
      setStarting(false);
      startingGuest.current = false;
      const why = lastGuestError;
      setGuestErr(/anonymous/i.test(why) && /disabled/i.test(why)
        ? "Reviewing without an account is switched off for this app. In Supabase open Authentication, Sign In / Providers and turn on Allow anonymous sign-ins."
        : /captcha/i.test(why) ? "Supabase bot protection (CAPTCHA) is on, which blocks guest reviews. Turn it off under Authentication, Attack Protection."
        : /rate limit|too many|429/i.test(why) ? "Too many guests started from this network in the last hour. Wait a few minutes and tap again."
        : `We couldn't start your review just now (${why || "no reason given"}). Tap again.`);
    }
  }

  return (
    <div className="rvx" data-stage="landing">
      {bar}
      <header className="rvx-hero">
        {visit && <span className="rvx-verified"><Icon name="verified" size={14} />Verified visit</span>}
        <div className="rvx-kicker">{link ? "Review link from the shop" : peek.table_label || "Welcome"}</div>
        <h1>{peek.place_name}</h1>
        <div className="rvx-meta">
          {peek.table_label && <span className="rvx-pill"><Icon name="qr" size={13} />{peek.table_label}</span>}
          {peek.area && <span className="rvx-pill"><Icon name="pin" size={13} />{peek.area}</span>}
        </div>
      </header>

      {topItems.length > 0 && (
        <section className="rvx-sec" aria-label="Top rated dishes here">
          <div className="premeal-guide">
            <div className="premeal-head">
              <div className="stack tight">
                <strong style={{ fontSize: 14, color: "#fff" }}>Top 3 Dishes Here Right Now</strong>
                <span className="tiny muted">Pre-meal recommendation guide</span>
              </div>
              <span className="premeal-badge">
                <Icon name="verified" size={12} color="#4ade80" /> Verified Picks
              </span>
            </div>

            <div className="premeal-grid">
              {topItems.map((item, idx) => {
                const isSelected = selectedIds.includes(item.id);
                const ranks = ["🥇 #1 Loved", "🥈 #2 Pick", "🥉 #3 Choice"];
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`premeal-card ${isSelected ? "selected" : ""}`}
                    onClick={() => toggleSelected(item)}
                    aria-pressed={isSelected}
                  >
                    <span className={`premeal-rank ${idx === 0 ? "gold" : ""}`}>
                      {ranks[idx] || `★ #${idx + 1}`}
                    </span>
                    <div className="premeal-thumb-wrap">
                      <ItemThumb path={item.image_path} />
                    </div>
                    <div className="premeal-info">
                      <span className="premeal-name"><DietDot diet={item.diet} />{item.name}</span>
                      <div className="premeal-meta">
                        {item.lovedPct != null ? (
                          <span className="premeal-star" style={{ color: "#e5c78f" }}>
                            🔥 {item.lovedPct}% loved
                          </span>
                        ) : item.ratingAvg ? (
                          <span className="premeal-star">
                            ★ {item.ratingAvg.toFixed(1)}
                          </span>
                        ) : (
                          <span className="tiny muted">Popular</span>
                        )}
                        {item.reviewCount > 0 && (
                          <span>{item.reviewCount} {item.reviewCount === 1 ? "review" : "reviews"}</span>
                        )}
                      </div>
                      <span className="premeal-cta-pill">
                        {isSelected ? "✓ Having this" : "+ Having this"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedIds.length > 0 && (
              <span className="tiny strong row" style={{ gap: 5, justifyContent: "center", marginTop: 6, color: "var(--champ, #e5c78f)" }}>
                <Icon name="check" size={13} color="currentColor" />
                {selectedIds.length} {selectedIds.length === 1 ? "dish" : "dishes"} pre-selected! Ready for your 10s review after dining.
              </span>
            )}
          </div>
        </section>
      )}

      <section className="rvx-sec">
        <h2>Rate what you <i>had</i></h2>
        <div aria-live="polite">
          {loading ? <Spinner /> : session ? (
            visit ? (
              <div className="rvx-status" role="status">
                <Icon name="verified" size={22} color="#7fbf9e" />
                <span className="grow"><b>You can review now</b><small>{until ? `Until ${until}` : "For the next few hours"}</small></span>
              </div>
            ) : scanErr ? (
              <div className="rvx-status warn" role="alert">
                <Icon name="alert" size={22} color="#ff9a78" />
                <span className="grow"><b>Couldn't unlock your review</b><small>{scanErr}</small></span>
                <button type="button" className="rvx-tool" onClick={() => setScanTry((n) => n + 1)}>Retry</button>
              </div>
            ) : scanning ? (
              <div className="rvx-status"><Spinner /><span className="grow"><b>Unlocking your verified visit…</b></span></div>
            ) : null
          ) : (
            <div className="rvx-perks">
              <div className="rvx-perk"><span className="ci"><Icon name="star" size={17} /></span>No account needed</div>
              <div className="rvx-perk"><span className="ci"><Icon name="eyeOff" size={17} /></span>Anonymous by default</div>
              <div className="rvx-perk"><span className="ci"><Icon name="verified" size={17} /></span>Gets a verified visit badge</div>
            </div>
          )}
        </div>
        {guestErr && <div className="notice err" role="alert">{guestErr}</div>}
        <Link to={`/p/${peek.place_id}`} className="rvx-more"><Icon name="eye" size={16} />See what others loved first</Link>
      </section>

      {!loading && !scanErr && (
        <div className="rvx-foot">
          {session ? (
            <Link to={`/review/${peek.place_id}`} className="rvx-cta" aria-disabled={scanning || starting || !visit} onClick={(e) => { if (scanning || starting || !visit) e.preventDefault(); }}><span>Rate what you had</span><Icon name="chev" size={20} /></Link>
          ) : (
            <button type="button" className="rvx-cta" disabled={starting} onClick={rateAsGuest}><span>{starting ? "Opening…" : "Rate what you had"}</span><Icon name="chev" size={20} /></button>
          )}
        </div>
      )}
    </div>
  );
}
