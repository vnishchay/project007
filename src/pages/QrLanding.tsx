import { clearFocusShop, setFocusShop } from "../lib/focus";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { deviceId } from "../lib/device";
import { supabase, errorText } from "../lib/supabase";
import { lastGuestError, useAuth } from "../lib/auth";
import { getLocation } from "../lib/util";
import { formatPrice } from "../lib/money";
import { Icon, Spinner } from "../components/ui";
import { DietDot, loadShopItems, type ShopItem } from "../components/place/shop";
import { ItemThumb } from "../components/place/ItemThumb";
import { playHapticTap } from "../lib/haptics";
import { MODES, modeOf, type Mode } from "../lib/modes";
import { placeMediaUrl } from "../lib/media";
import { ForYouHere } from "../components/ForYouHere";
import { laterNote } from "../components/Reminders";
import { turnOnReminders, type PushState } from "../lib/push";
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

/** Ratings an item needs before its "loved" share is shown; below that one lucky review reads as hype. */
const MIN_SAID = 3;
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
  // An NFC table tag opens this same page with a one-time signed tap (picc + cmac) instead of a plain scan.
  const [search] = useSearchParams();
  const tap = !link && search.get("picc") && search.get("cmac") ? { picc: search.get("picc")!, cmac: search.get("cmac")! } : null;
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
  const [refused, setRefused] = useState<Refusal | null>(null);
  // What diners said about each menu item, so the menu itself answers "what should I order?".
  const [said, setSaid] = useState<Record<string, Said>>({});
  // The shop's business type, for its words ("Menu" or "Services").
  const [mode, setMode] = useState<Mode | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  // The menu opens with the most loved first (once there are ratings), so it answers "what should I order?".
  const [lovedFirst, setLovedFirst] = useState(true);
  const [logo, setLogo] = useState<string | null>(null);
  // Picking a sixth thing: say why nothing happened.
  const [full, setFull] = useState(false);
  const [showPerks, setShowPerks] = useState(false);
  // What happens after "Rate later": the reminder, or where the review waits.
  const [later, setLater] = useState<string | null>(null);
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
    if (tap) {
      // A genuine tap proves the phone is at the table, so no location is asked for.
      const t = await supabase.rpc("tap_nfc", { p_token: token, p_picc: tap.picc, p_cmac: tap.cmac });
      if (t.error?.code !== "PGRST202") {
        // Drop the one-time values from the address, so sharing it shares the plain page.
        if (!t.error) navTo(`/q/${token}`, { replace: true });
        return t;
      }
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
        supabase.from("places").select("kind, category, currency, logo_path").eq("id", pk.place_id).maybeSingle()
          .then(({ data: pl }) => {
            if (!alive || !pl) return;
            setMode(modeOf(pl.kind as string | null, pl.category as string | null));
            setCurrency((pl as { currency?: string | null }).currency ?? null);
            setLogo(placeMediaUrl((pl as { logo_path?: string | null }).logo_path, 160));
          }, () => {});
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
          } catch {
            if (alive) setSaid({});
          }
        }).catch(() => {});
      }
      setPeek(pk);
    }, (e: unknown) => { if (alive) setPeekErr(friendly(e)); });
    return () => { alive = false; };
  }, [token, peekTry, link]);

  const toggleSelected = (item: ShopItem) => {
    if (!peek?.place_id) return;
    if (!selectedIds.includes(item.id) && selectedIds.length >= MAX_TAGGED) {
      setFull(true);
      window.setTimeout(() => setFull(false), 2400);
      return;
    }
    setFull(false);
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
        <span className="tx"><b><DietDot diet={item.diet} />{item.name}</b>{item.price_inr != null && <small>{formatPrice(item.price_inr, currency)}</small>}</span>
      </button>
    );
  };

  // Signed in: say up front if this account can't review here (its own shop, paused, already used),
  // without recording a visit or asking for location. The visit itself starts on the Rate tap.
  useEffect(() => {
    if (loading || !uid || !peek || peek.status === "expired" || startingGuest.current) return;
    let alive = true;
    checkCan(peek.place_id).then((no) => { if (alive && no && no !== "scan") setRefused(no); });
    return () => { alive = false; };
  }, [loading, uid, peek]); // eslint-disable-line react-hooks/exhaustive-deps

  const isFood = mode?.kind === "food";
  const catalog = (mode ?? MODES.other).catalog;
  const findLabel = isFood ? "Find on the menu" : `Find in ${catalog.toLowerCase()}`;
  const dead = peek === undefined ? null : !peek ? (link ? "This review link doesn't work" : "This code isn't active")
    : peek.status === "expired" ? "This review link has expired"
    : peek.status === "used" && !session ? "This review link was already used" : null;
  // Shop mode starts only once the code is usable, so a dead code never traps the tab on a shop.
  const usableShop = !loading && peek && !dead ? peek.place_id : null;
  useEffect(() => { if (usableShop) setFocusShop(usableShop, `/${link ? "r" : "q"}/${token}`); }, [usableShop, link, token]);

  const bar = (
    <div className="rvx-bar">
      {logo ? <span className="rvx-logo"><img src={logo} alt="" onError={() => setLogo(null)} /></span> : null}
      <span className="rvx-brand">{peek?.place_name && !dead ? peek.place_name : "Trusted Picks"}</span><span className="grow" />
    </div>
  );
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

  const until = visit?.expires_at ? new Date(visit.expires_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;

  /** Record the verified visit (location is asked for here, on the tap), then open the review (unless `go` is false). */
  async function openVisit(go = true): Promise<Visit | null> {
    setScanning(true); setScanErr(""); setRefused(null);
    const { data } = await supabase.auth.getSession();
    scannedFor.current = `${data.session?.user.id}:${token}:${Date.now()}`;
    const r = await unlock().then((x) => x, (e: unknown) => ({ data: null, error: e as Error }));
    if (r.error) { setScanning(false); setScanErr(friendly(r.error)); return null; }
    const no = await checkCan(peek!.place_id);
    setScanning(false);
    const v = ((r.data as Visit[]) || [])[0] ?? { visit_id: "", expires_at: "" };
    setVisit(v);
    setRefused(no);
    if (no) return null;
    if (go) navTo(`/review/${peek!.place_id}`);
    return v;
  }

  /** Guests review without an account: start a guest session first. False (with a plain message) if that fails. */
  async function ensureSession(): Promise<boolean> {
    if (session) return true;
    setGuestErr("");
    const ok = await startGuest();
    if (ok) return true;
    const why = lastGuestError;
    // The real reason is for the team; diners get a plain next step.
    console.warn("Guest review could not start:", why);
    setGuestErr(/rate limit|too many|429/i.test(why)
      ? "Lots of people are reviewing from this network right now. Wait a few minutes and tap again."
      : /anonymous|captcha|disabled/i.test(why)
      ? "Reviewing without an account isn't available here right now. Sign in to review, or try again later."
      : "We couldn't start your review just now. Check your connection and tap again.");
    return false;
  }

  async function rateAsGuest() {
    // Stay on "Opening…" until the visit is unlocked, so nobody reaches the review before it exists.
    setStarting(true); startingGuest.current = true;
    if (await ensureSession()) await openVisit();
    setStarting(false); startingGuest.current = false;
  }

  /** Not now: keep the review open (visit unlocked), switch on a reminder if this phone can get one. */
  async function rateLater() {
    setStarting(true); startingGuest.current = true;
    const v = (await ensureSession()) ? await openVisit(false) : null;
    setStarting(false); startingGuest.current = false;
    if (!v) return;
    let st: PushState = "unsupported";
    try { st = await turnOnReminders(); } catch { /* keep the in-app fallback */ }
    const end = v.expires_at ? new Date(v.expires_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;
    setLater(laterNote(st, end));
  }

  const q = menuQ.trim().toLowerCase();
  const hasSaid = Object.values(said).some((x) => x.count >= MIN_SAID);
  const matched = q ? menu.filter((it) => `${it.name} ${it.description || ""}`.toLowerCase().includes(q)) : menu;
  const found = lovedFirst && hasSaid ? [...matched].sort((a, b) => lovedRank(said[b.id]) - lovedRank(said[a.id])) : matched;
  const shown = q || menuAll ? found : found.slice(0, MENU_FIRST);
  const saidLine = (id: string) => {
    const x = said[id];
    if (!x) return null;
    return x.count >= MIN_SAID
      ? <span className="rvx-said"><Icon name="heart" size={12} fill="currentColor" />{x.lovedPct}% of {x.count} loved it</span>
      : <span className="rvx-said new">New</span>;
  };
  const busy = scanning || starting;
  const ctaLabel = busy ? "Opening…" : selectedIds.length > 0 ? `Rate your visit · ${selectedIds.length} picked` : "Rate your visit";

  return (
    <div className="rvx" data-stage="landing">
      {bar}
      <header className="rvx-hero">
        <div className="rvx-kicker">{[link ? "Review link" : "Welcome", peek.area].filter(Boolean).join(" · ")}</div>
        <h1>{peek.place_name}</h1>
        <div className="rvx-meta">
          {peek.table_label && <span className="rvx-pill"><Icon name="qr" size={14} />{peek.table_label}</span>}
          {visit && !refused && <span className="rvx-verified"><Icon name="verified" size={15} />Verified visit</span>}
        </div>
      </header>

      <ForYouHere placeId={peek.place_id} placeName={peek.place_name} signedIn={Boolean(session)} />

      {menu.length > 0 && (
        <section className="rvx-sec" aria-label={catalog}>
          <div className="rvx-row"><h3>{catalog}</h3>
            <span aria-live="polite" className={full ? "rvx-full" : ""}>{full ? `Up to ${MAX_TAGGED} at a time` : selectedIds.length ? `${selectedIds.length} of ${MAX_TAGGED} picked` : isFood ? "Tap what you're having" : "Tap what you got"}</span>
          </div>
          {specials.length > 0 && !q && (
            <>
              <span className="rvx-sub"><Icon name="star" size={14} />Chosen by the shop</span>
              <div className="rvx-scroll">{specials.map((it) => renderCard(it))}</div>
            </>
          )}
          {menu.length > 8 && (
            <label className="rvx-msearch">
              <Icon name="search" size={18} />
              <input type="search" value={menuQ} onChange={(e) => setMenuQ(e.target.value)} placeholder={findLabel} aria-label={findLabel} autoComplete="off" />
            </label>
          )}
          {hasSaid && (
            <div className="rvx-chips sm">
              <button type="button" className={`rvx-chip ${lovedFirst ? "on" : ""}`} aria-pressed={lovedFirst} onClick={() => setLovedFirst((v) => !v)}><Icon name="heart" size={14} />Most loved first</button>
            </div>
          )}
          <div className="rvx-menu">
            {shown.map((it) => {
              const on = selectedIds.includes(it.id);
              const line = saidLine(it.id);
              return (
                <button key={it.id} type="button" className={`rvx-mrow ${on ? "on" : ""}`} aria-pressed={on} aria-label={`${it.name}${on ? ", picked" : ""}`} onClick={() => toggleSelected(it)}>
                  <span className="th"><ItemThumb path={it.image_path} size={48} /></span>
                  <span className="tx"><b><DietDot diet={it.diet} />{it.name}</b>{(line || it.price_inr != null || it.description) && <small>{line}{[formatPrice(it.price_inr, currency) || "", it.description || ""].filter(Boolean).join(" · ")}</small>}</span>
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
      )}

      <section className="rvx-sec" aria-label="Your review">
        <div aria-live="polite">
          {loading ? <Spinner /> : refused ? (
            <div className="rvx-status warn" role="alert">
              <Icon name={refused === "guest_used" ? "lock" : "alert"} size={22} color="var(--danger)" />
              <span className="grow"><b>{REFUSED[refused][0]}</b><small>{REFUSED[refused][1]}</small></span>
            </div>
          ) : scanErr ? (
            <div className="rvx-status warn" role="alert">
              <Icon name="alert" size={22} color="var(--danger)" />
              <span className="grow"><b>Couldn't unlock your review</b><small>{scanErr}</small></span>
            </div>
          ) : visit ? (
            <div className="rvx-status" role="status">
              <Icon name="verified" size={22} color="var(--good)" />
              <span className="grow"><b>You can review now</b><small>{until ? `Until ${until}` : "For the next few hours"}</small></span>
            </div>
          ) : null}
        </div>
        {session && !refused && <SeenByShop placeId={peek.place_id} shop={peek.place_name} />}
        {guestErr && (
          <div className="notice err" role="alert">
            {guestErr}{" "}
            {/sign in/i.test(guestErr) && <Link to={`/signin?next=${encodeURIComponent(`/${link ? "r" : "q"}/${token}`)}`}>Sign in</Link>}
          </div>
        )}
      </section>

      {!loading && (
        <div className="rvx-foot">
          {refused ? (
            refused === "guest_used"
              ? <Link to={`/signin?next=${encodeURIComponent(`/review/${peek.place_id}`)}`} className="rvx-cta"><span>Sign in to rate more</span><Icon name="chev" size={20} /></Link>
              : <Link to={`/p/${peek.place_id}`} className="rvx-cta"><span>See what people loved here</span><Icon name="chev" size={20} /></Link>
          ) : (
            <button type="button" className="rvx-cta" disabled={busy}
              onClick={() => { playHapticTap(950); if (session) void openVisit(); else void rateAsGuest(); }}>
              <span>{scanErr ? "Try again" : ctaLabel}</span>
            </button>
          )}
          {!refused && !later && <button type="button" className="rvx-later" disabled={busy} onClick={() => void rateLater()}><Icon name="bell" size={16} />Not now? Rate later</button>}
          {later && !refused && <p className="rvx-later-note" role="status"><Icon name="bell" size={18} />{later}</p>}
          {!refused && (
            <button type="button" className="rvx-trust" aria-expanded={showPerks} onClick={() => setShowPerks((v) => !v)}>
              <span><Icon name="eyeOff" size={14} />{session ? "Anonymous unless you choose" : "No account"}</span>
              <span><Icon name="verified" size={14} />Verified visit</span>
              {!link && <span><Icon name="pin" size={14} />Checks you're here</span>}
              <span className="more"><Icon name="info" size={14} />{showPerks ? "Less" : "More"}</span>
            </button>
          )}
          {showPerks && !refused && (
            <ul className="rvx-trust-more">
              {!session && <li><Icon name="user" size={15} />No account needed</li>}
              <li><Icon name="eyeOff" size={15} />Anonymous unless you choose to show your name</li>
              <li><Icon name="verified" size={15} />Marked as a verified visit</li>
              {!link && !tap && <li><Icon name="pin" size={15} />We check you're at the shop. Only "near" or "far" is kept, never your location</li>}
              <li><Icon name="store" size={15} />{session ? "The shop sees your name and table, never your review" : "The shop sees you visited as \"Guest\", never your review"}</li>
            </ul>
          )}
          <Link to={`/p/${peek.place_id}`} className="rvx-link"><Icon name="eye" size={16} />See reviews</Link>
        </div>
      )}
    </div>
  );
}

/** Tells a diner the shop can see this visit, with one tap to hide from it (which also stops its offers). */
function SeenByShop({ placeId, shop }: { placeId: string; shop: string }) {
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.rpc("my_shop_privacy", { p_place: placeId }).then(({ data, error }) => {
      if (alive && !error) setHidden(Boolean(((data as { hidden: boolean }[]) || [])[0]?.hidden));
    }, () => {});
    return () => { alive = false; };
  }, [placeId]);
  if (hidden === null) return null;
  async function flip() {
    setBusy(true);
    const next = !hidden;
    const { error } = await supabase.rpc("set_shop_privacy", { p_place: placeId, p_hidden: next, p_no_offers: next });
    setBusy(false);
    if (!error) setHidden(next);
  }
  return (
    <div className="rvx-status rvx-seen" role="status">
      <Icon name={hidden ? "eyeOff" : "eye"} size={20} />
      <span className="grow">
        <b>{hidden ? `Hidden from ${shop}` : `${shop} can see you visited`}</b>
        <small>{hidden ? "They can't see you, group you, or send you offers." : "Your name and table, so they can group visitors (like Regulars) and send offers. Never your review."}</small>
      </span>
      <button type="button" className="rvx-tool" disabled={busy} onClick={flip}>{hidden ? "Show" : "Hide me"}</button>
    </div>
  );
}
