import { clearFocusShop, setFocusShop } from "../lib/focus";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deviceId } from "../lib/device";
import { supabase, errorText } from "../lib/supabase";
import { lastGuestError, useAuth } from "../lib/auth";
import { getLocation } from "../lib/util";
import { Icon, Spinner } from "../components/ui";
import { DietDot, loadShopItems, type ShopItem } from "../components/place/shop";
import { ItemThumb } from "../components/place/ItemThumb";
import { playHapticTap } from "../lib/haptics";
import { MODES, modeOf, type Mode } from "../lib/modes";
import "../styles/review.css";

interface Peek { place_id: string; place_name: string; area: string | null; table_label?: string | null; status?: "ok" | "used" | "expired" }
interface Visit { visit_id: string; expires_at: string }
type Refusal = "scan" | "owner" | "paused" | "guest_used";

const REFUSED: Record<Refusal, [string, string]> = {
  guest_used: ["You've reviewed here from this phone", "Without signing in, each phone gets one visit per place. Sign in to rate more of what you had."],
  owner: ["This is your shop", "Owners can't review their own shop."],
  paused: ["Reviews are paused here for now", "You can still see what people loved at this shop."],
  scan: ["Couldn't unlock your review", "Scan the QR code again, or ask the staff for a new one."],
};

/** How diners rated one thing on the menu. */
interface Said { count: number; loved: number; lovedPct: number; avg: number }

interface TopItem extends ShopItem {
  reviewCount: number;
  ratingAvg?: number;
  lovedPct?: number;
}

/** Share who loved it, with three imaginary "loved" votes out of four so one lucky 5-star never tops forty great ones. */
const lovedRank = (x?: { count: number; loved: number }) => (x ? (x.loved + 2.25) / (x.count + 3) : -1);

/** The review rates up to this many things in one go. */
const MAX_TAGGED = 5;
/** Menu rows shown before "Show all". */
const MENU_FIRST = 24;

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
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  // What diners said about each menu item, so the menu itself answers "what should I order?".
  const [said, setSaid] = useState<Record<string, Said>>({});
  // The shop's business type, for its words ("Menu" or "Services").
  const [mode, setMode] = useState<Mode | null>(null);
  const [lovedFirst, setLovedFirst] = useState(false);
  // The shop's own special picks (products it chose to list), shown like a mini shop page.
  const [specials, setSpecials] = useState<ShopItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // The whole menu, so diners can tag anything they're having, not just the shop's picks.
  const [menu, setMenu] = useState<ShopItem[]>([]);
  const [menuQ, setMenuQ] = useState("");
  const [menuAll, setMenuAll] = useState(false);
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
  /** Ask the server the same question the review page will, so the landing never promises a review it will refuse. */
  async function checkCan(placeId: string): Promise<Refusal | null> {
    const r = await supabase.rpc("can_review", { p_place: placeId, p_device: deviceId() }).then((x) => x, () => null);
    if (!r || r.error) return null;
    const row = (r.data as { allowed: boolean; reason: string }[] | null)?.[0];
    return row && !row.allowed ? ((row.reason in REFUSED ? row.reason : "scan") as Refusal) : null;
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
        supabase.from("places").select("kind, category").eq("id", pk.place_id).maybeSingle()
          .then(({ data: pl }) => { if (alive && pl) setMode(modeOf(pl.kind as string | null, pl.category as string | null)); }, () => {});
        try {
          const raw = localStorage.getItem(`tp-plan:${pk.place_id}`) || sessionStorage.getItem(`tp_preselected_${pk.place_id}`);
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
        loadShopItems(pk.place_id).then(async ({ items }) => {
          if (!alive || !items.length) return;
          const ordered = [...items].sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name));
          setSpecials(ordered.filter((it) => it.is_listed).slice(0, 6));
          setMenu(ordered);
          try {
            const { data: revs } = await supabase.from("review_feed").select("item_id, rating").eq("place_id", pk.place_id).order("created_at", { ascending: false }).limit(500);
            const counts: Record<string, { sum: number; count: number; fourPlus: number }> = {};
            for (const r of (revs as { item_id: string; rating: number }[] | null) || []) {
              if (!counts[r.item_id]) counts[r.item_id] = { sum: 0, count: 0, fourPlus: 0 };
              counts[r.item_id].sum += r.rating;
              counts[r.item_id].count++;
              if (r.rating >= 4) counts[r.item_id].fourPlus++;
            }
            const byItem: Record<string, Said> = {};
            for (const [id, c] of Object.entries(counts)) byItem[id] = { count: c.count, loved: c.fourPlus, lovedPct: Math.round((c.fourPlus / c.count) * 100), avg: c.sum / c.count };
            if (alive) setSaid(byItem);
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
              .sort((a, b) => lovedRank(byItem[b.id]) - lovedRank(byItem[a.id]) || b.reviewCount - a.reviewCount)
              .slice(0, 5);
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

  const toggleSelected = (item: ShopItem) => {
    if (!peek?.place_id) return;
    if (!selectedIds.includes(item.id) && selectedIds.length >= MAX_TAGGED) return;
    const next = selectedIds.includes(item.id)
      ? selectedIds.filter((id) => id !== item.id)
      : [...selectedIds, item.id];
    setSelectedIds(next);
    playHapticTap(850);
    try {
      localStorage.setItem(`tp-plan:${peek.place_id}`, JSON.stringify({ ids: next, expiresAt: Date.now() + 6 * 3600 * 1000 }));
      sessionStorage.setItem(`tp_preselected_${peek.place_id}`, next[0] || "");
    } catch {}
  };

  const renderCard = (item: ShopItem) => {
    const isSelected = selectedIds.includes(item.id);
    return (
      <button key={item.id} type="button" className={`rvx-pcard ${isSelected ? "on" : ""}`} onClick={() => toggleSelected(item)} aria-pressed={isSelected} aria-label={`${item.name}${isSelected ? ", picked" : ""}`}>
        <span className="ph"><ItemThumb path={item.image_path} />
          <span className="rvx-add-btn" aria-hidden="true"><Icon name={isSelected ? "check" : "plus"} size={16} width={2.4} /></span>
        </span>
        <span className="tx"><b><DietDot diet={item.diet} />{item.name}</b>{item.price_inr != null && <small>₹{item.price_inr}</small>}</span>
      </button>
    );
  };

  useEffect(() => {
    if (loading || !uid || !peek || peek.status === "expired" || startingGuest.current) return;
    const key = `${uid}:${token}:${scanTry}`;
    if (scannedFor.current === key) return;
    scannedFor.current = key;
    setScanning(true);
    setScanErr("");
    setRefused(null);
    unlock().then(async ({ data, error }) => {
      if (error) { setScanning(false); setScanErr(friendly(error)); return; }
      const no = await checkCan(peek.place_id);
      setScanning(false);
      setRefused(no);
      const v = ((data as Visit[]) || [])[0];
      setVisit(v ?? { visit_id: "", expires_at: "" });
    }, (e: unknown) => { setScanning(false); setScanErr(friendly(e)); });
  }, [loading, uid, peek, token, scanTry]); // eslint-disable-line react-hooks/exhaustive-deps

  const isFood = mode?.kind === "food";
  const catalog = (mode ?? MODES.other).catalog;
  const lovedTitle = isFood ? "What to order here" : "Most loved here";
  const findLabel = isFood ? "Find on the menu" : `Find in ${catalog.toLowerCase()}`;
  const dead = peek === undefined ? null : !peek ? (link ? "This review link doesn't work" : "This code isn't active")
    : peek.status === "expired" ? "This review link has expired"
    : peek.status === "used" && !session ? "This review link was already used" : null;
  // Shop mode starts only once the code is usable, so a dead code never traps the tab on a shop.
  const usableShop = !loading && peek && !dead ? peek.place_id : null;
  useEffect(() => { if (usableShop) setFocusShop(usableShop, `/${link ? "r" : "q"}/${token}`); }, [usableShop, link, token]);

  const bar = <div className="rvx-bar"><span className="rvx-brand">Trusted Picks</span><span className="grow" /></div>;
  if (peekErr) return (
    <div className="rvx">
      {bar}
      <div className="rvx-gate">
        <span className="ico"><Icon name="alert" size={28} /></span>
        <h2>Couldn't check this {link ? "review link" : "QR code"}</h2>
        <p>{peekErr}</p>
        <button type="button" className="rvx-cta" onClick={() => setPeekTry((n) => n + 1)}><span>Try again</span><Icon name="chev" size={20} /></button>
      </div>
    </div>
  );
  if (peek === undefined) return <div className="rvx"><div className="rvx-center"><Spinner /></div></div>;
  if (!peek || dead) return (
    <div className="rvx">
      {bar}
      <div className="rvx-gate">
        <span className="ico"><Icon name={link ? "link" : "qr"} size={28} /></span>
        <h2>{dead}</h2>
        <p>{link ? "Ask the shop to send you a new link." : "Ask the staff for a new QR card."}</p>
        <Link className="rvx-more" to="/" onClick={() => clearFocusShop()}><Icon name="search" size={16} />Search places</Link>
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
      if (r.error) { setScanning(false); setStarting(false); startingGuest.current = false; setScanErr(friendly(r.error)); return; }
      const no = await checkCan(peek!.place_id);
      setScanning(false); setStarting(false); startingGuest.current = false;
      const v = ((r.data as Visit[]) || [])[0];
      setVisit(v ?? { visit_id: "", expires_at: "" });
      setRefused(no);
      if (!no) navTo(`/review/${peek!.place_id}`);
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
        <div className="rvx-kicker">{[link ? "Review link" : "Welcome", peek.area].filter(Boolean).join(" · ")}</div>
        <h1>{peek.place_name}</h1>
        <div className="rvx-meta">
          {peek.table_label && <span className="rvx-pill"><Icon name="qr" size={14} />{peek.table_label}</span>}
          {visit && !refused && <span className="rvx-verified"><Icon name="verified" size={15} />Verified visit</span>}
          <Link to={`/p/${peek.place_id}`} className="rvx-pill" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            <Icon name="store" size={14} />View profile & ratings ↗
          </Link>
        </div>
      </header>

      {specials.length > 0 && (
        <section className="rvx-sec" aria-label="Special picks">
          <div className="rvx-row"><h3>Special picks</h3><span>Chosen by the shop</span></div>
          <div className="rvx-scroll">{specials.map((it) => renderCard(it))}</div>
        </section>
      )}

      {topItems.length > 0 && (
        <section className="rvx-sec" aria-label={lovedTitle}>
          <div className="rvx-row"><h3>{lovedTitle}</h3><span>Most loved by customers</span></div>
          <div className="rvx-scroll rvx-loved">
            {topItems.map((it) => (
              <button key={it.id} type="button" className={selectedIds.includes(it.id) ? "on" : ""} aria-pressed={selectedIds.includes(it.id)} onClick={() => toggleSelected(it)}>
                <span className="face"><ItemThumb path={it.image_path} size={32} />{selectedIds.includes(it.id) && <span className="ok"><Icon name="check" size={16} width={2.6} /></span>}</span>
                {it.name}<span className="pct">{it.lovedPct != null ? `${it.lovedPct}% of ${it.reviewCount}` : `★ ${it.ratingAvg?.toFixed(1)}`}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {menu.length > 0 && (() => {
        const q = menuQ.trim().toLowerCase();
        const matched = q ? menu.filter((it) => `${it.name} ${it.description || ""}`.toLowerCase().includes(q)) : menu;
        const hasSaid = Object.keys(said).length > 0;
        const found = lovedFirst && hasSaid
          ? [...matched].sort((a, b) => lovedRank(said[b.id]) - lovedRank(said[a.id]))
          : matched;
        const shown = q || menuAll ? found : found.slice(0, MENU_FIRST);
        return (
          <section className="rvx-sec" aria-label={catalog}>
            <div className="rvx-row"><h3>{catalog}</h3><span aria-live="polite">{selectedIds.length ? `${selectedIds.length} of ${MAX_TAGGED} picked` : isFood ? "Tap what you're having" : "Tap what you got"}</span></div>
            {menu.length > 8 && (
              <label className="rvx-msearch">
                <Icon name="search" size={18} />
                <input type="search" value={menuQ} onChange={(e) => setMenuQ(e.target.value)} placeholder={findLabel} aria-label={findLabel} autoComplete="off" />
              </label>
            )}
            {hasSaid && (
              <div className="rvx-chips sm">
                <button type="button" className={`rvx-chip static ${lovedFirst ? "on" : ""}`} style={{ cursor: "pointer" }} aria-pressed={lovedFirst} onClick={() => setLovedFirst((v) => !v)}><Icon name="heart" size={14} />Most loved first</button>
              </div>
            )}
            <div className="rvx-menu">
              {shown.map((it) => {
                const on = selectedIds.includes(it.id);
                return (
                  <button key={it.id} type="button" className={`rvx-mrow ${on ? "on" : ""}`} aria-pressed={on} aria-label={`${it.name}${on ? ", picked" : ""}`} onClick={() => toggleSelected(it)}>
                    <span className="th"><ItemThumb path={it.image_path} size={48} /></span>
                    <span className="tx"><b><DietDot diet={it.diet} />{it.name}</b>{(said[it.id] || it.price_inr != null || it.description) && <small>{said[it.id] && <span className="rvx-said"><Icon name="heart" size={12} fill="currentColor" />{said[it.id]!.lovedPct}% of {said[it.id]!.count}</span>}{[it.price_inr != null ? `₹${it.price_inr}` : "", it.description || ""].filter(Boolean).join(" · ")}</small>}</span>
                    <span className="rvx-add-btn" aria-hidden="true"><Icon name={on ? "check" : "plus"} size={16} width={2.4} /></span>
                  </button>
                );
              })}
              {q && !found.length && <p className="rvx-mrow" style={{ cursor: "default", color: "var(--muted)" }}>No match for "{menuQ.trim()}". You can type it in later.</p>}
            </div>
            {!q && !menuAll && found.length > MENU_FIRST && (
              <button type="button" className="rvx-more" onClick={() => setMenuAll(true)}><Icon name="down" size={16} />Show all {found.length}</button>
            )}
          </section>
        );
      })()}

      <section className="rvx-sec" aria-label="Your review">
        <div aria-live="polite">
          {loading ? <Spinner /> : session ? (
            visit && refused ? (
              <div className="rvx-status warn" role="alert">
                <Icon name={refused === "guest_used" ? "lock" : "alert"} size={22} color="#ff9a78" />
                <span className="grow"><b>{REFUSED[refused][0]}</b><small>{REFUSED[refused][1]}</small></span>
              </div>
            ) : visit ? (
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
              <div className="rvx-perk"><span className="ci"><Icon name="user" size={17} /></span>No account needed</div>
              <div className="rvx-perk"><span className="ci"><Icon name="eyeOff" size={17} /></span>Anonymous unless you choose otherwise</div>
              <div className="rvx-perk"><span className="ci"><Icon name="verified" size={17} /></span>Marked as a verified visit</div>
            </div>
          )}
        </div>
        {guestErr && <div className="notice err" role="alert">{guestErr}</div>}
        <Link to={`/p/${peek.place_id}`} className="rvx-more"><Icon name="eye" size={18} />See all reviews</Link>
      </section>

      {!loading && !scanErr && (
        <div className="rvx-foot">
          {session && visit && refused ? (
            refused === "guest_used" && <Link to={`/signin?next=${encodeURIComponent(`/review/${peek.place_id}`)}`} className="rvx-cta"><span>Sign in to rate more</span><Icon name="chev" size={20} /></Link>
          ) : session ? (
            <Link
              to={`/review/${peek.place_id}`}
              className="rvx-cta"
              aria-disabled={scanning || starting || !visit}
              onClick={(e) => {
                if (scanning || starting || !visit) { e.preventDefault(); return; }
                playHapticTap(950);
              }}
            >
              <span>{selectedIds.length > 0 ? `Rate your visit · ${selectedIds.length} picked` : "Rate your visit"}</span>
            </Link>
          ) : (
            <button
              type="button"
              className="rvx-cta"
              disabled={starting}
              onClick={() => {
                playHapticTap(950);
                rateAsGuest();
              }}
            >
              <span>{starting ? "Opening…" : selectedIds.length > 0 ? `Rate your visit · ${selectedIds.length} picked` : "Rate your visit"}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
