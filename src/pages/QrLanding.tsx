import { setFocusShop } from "../lib/focus";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { lastGuestError, useAuth } from "../lib/auth";
import { getLocation } from "../lib/util";
import { Icon, Spinner } from "../components/ui";
import "../styles/review.css";

interface Peek { place_id: string; place_name: string; area: string | null; table_label?: string | null; status?: "ok" | "used" | "expired" }
interface Visit { visit_id: string; expires_at: string }

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
  // One visit per code per signed-in user per page view (StrictMode runs effects twice).
  const scannedFor = useRef<string | null>(null);
  const unlockFn = link ? "redeem_review_link" : "scan_qr";
  // Table scans send where the phone is (if allowed), so far-away scans count less. Only "near or not" is kept.
  async function unlock() {
    if (link) return supabase.rpc(unlockFn, { p_token: token });
    const at = await getLocation();
    const r = await supabase.rpc(unlockFn, { p_token: token, p_lat: at?.lat ?? null, p_lng: at?.lng ?? null });
    return r.error?.code === "PGRST202" ? supabase.rpc(unlockFn, { p_token: token }) : r;
  }
  const startingGuest = useRef(false);

  useEffect(() => {
    let alive = true;
    setPeek(undefined);
    setPeekErr("");
    supabase.rpc(link ? "peek_review_link" : "peek_qr", { p_token: token }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setPeekErr(friendly(error)); return; }
      const pk = ((data as Peek[]) || [])[0] ?? null;
      if (pk?.place_id) setFocusShop(pk.place_id);
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
  const next = `/${link ? "r" : "q"}/${token}`;

  async function rateAsGuest() {
    // Start a guest session and unlock the verified visit before moving on.
    setStarting(true); setGuestErr(""); startingGuest.current = true;
    const ok = await startGuest();
    setStarting(false);
    if (ok) {
      const { data } = await supabase.auth.getSession();
      scannedFor.current = `${data.session?.user.id}:${token}:${scanTry}`;
      const { error } = await unlock();
      if (error) { startingGuest.current = false; setGuestErr(`Couldn't unlock this table: ${friendly(error)}`); return; }
      navTo(`/review/${peek!.place_id}`);
    } else {
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
        <span className="rvx-mono" aria-hidden="true">{peek.place_name.trim().charAt(0).toUpperCase()}</span>
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
        {!session && !loading && <Link to={`/signin?next=${encodeURIComponent(next)}`} className="rvx-skip" style={{ textAlign: "center" }}>Sign in instead (optional)</Link>}
      </section>

      {!loading && !scanErr && (
        <div className="rvx-foot">
          {session ? (
            <Link to={`/review/${peek.place_id}`} className="rvx-cta" aria-disabled={scanning} onClick={(e) => { if (scanning) e.preventDefault(); }}><span>Rate what you had</span><Icon name="chev" size={20} /></Link>
          ) : (
            <button type="button" className="rvx-cta" disabled={starting} onClick={rateAsGuest}><span>{starting ? "Opening…" : "Rate what you had"}</span><Icon name="chev" size={20} /></button>
          )}
        </div>
      )}
    </div>
  );
}
