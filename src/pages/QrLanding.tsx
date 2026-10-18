import { clearFocusShop, setFocusShop } from "../lib/focus";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deviceId } from "../lib/device";
import { supabase, errorText } from "../lib/supabase";
import { lastGuestError, useAuth } from "../lib/auth";
import { getLocation } from "../lib/util";
import { Icon, Spinner } from "../components/ui";
import "../styles/review.css";

interface Peek { place_id: string; place_name: string; area: string | null; table_label?: string | null; status?: "ok" | "used" | "expired" }
interface Visit { visit_id: string; expires_at: string }
type Refusal = "scan" | "owner" | "paused" | "guest_used";

const REFUSED: Record<Refusal, [string, string]> = {
  guest_used: ["You've reviewed here from this phone", "Without signing in, each phone gets one visit per place. Sign in to rate more of what you had."],
  owner: ["This is your shop", "Owners can't review their own shop."],
  paused: ["Reviews are paused here for now", "You can still see what people loved at this shop."],
  scan: ["Couldn't unlock your review", "Scan the table code again, or ask the staff for a new one."],
};

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
  // Unlocking can work while reviewing is still refused (a guest who already reviewed from this phone).
  const [refused, setRefused] = useState<Refusal | null>(null);
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
    supabase.rpc(link ? "peek_review_link" : "peek_qr", { p_token: token }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setPeekErr(friendly(error)); return; }
      setPeek(((data as Peek[]) || [])[0] ?? null);
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
        <h2>Couldn't check this {link ? "review link" : "table code"}</h2>
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
        <p>{link ? "Ask the shop to send you a new link." : "Ask the staff for a new table card."}</p>
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
        {visit && <span className="rvx-verified"><Icon name="verified" size={14} />Verified visit</span>}
        <div className="rvx-kicker">{link ? "Review link from the shop" : peek.table_label || "Welcome"}</div>
        <h1>{peek.place_name}</h1>
        <div className="rvx-meta">
          {peek.table_label && <span className="rvx-pill"><Icon name="qr" size={13} />{peek.table_label}</span>}
          {peek.area && <span className="rvx-pill"><Icon name="pin" size={13} />{peek.area}</span>}
        </div>
      </header>

      <section className="rvx-sec">
        <h2>Rate what you <i>had</i></h2>
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
          {session && visit && refused ? (
            refused === "guest_used" && <Link to={`/signin?next=${encodeURIComponent(`/review/${peek.place_id}`)}`} className="rvx-cta"><span>Sign in to rate more</span><Icon name="chev" size={20} /></Link>
          ) : session ? (
            <Link to={`/review/${peek.place_id}`} className="rvx-cta" aria-disabled={scanning || starting || !visit} onClick={(e) => { if (scanning || starting || !visit) e.preventDefault(); }}><span>Rate what you had</span><Icon name="chev" size={20} /></Link>
          ) : (
            <button type="button" className="rvx-cta" disabled={starting} onClick={rateAsGuest}><span>{starting ? "Opening…" : "Rate what you had"}</span><Icon name="chev" size={20} /></button>
          )}
        </div>
      )}
    </div>
  );
}
