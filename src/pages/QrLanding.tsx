import { setFocusShop } from "../lib/focus";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { getLocation } from "../lib/util";
import { Icon, Spinner, TopBar } from "../components/ui";
import { Chip, EmptyArt, Glyph, Retry } from "../components/home/Kit";
import "../styles/home.css";

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

  if (peekErr) return (
    <div className="page">
      <TopBar />
      <Retry msg={`Couldn't check this ${link ? "review link" : "table code"}: ${peekErr}`} onRetry={() => setPeekTry((n) => n + 1)} />
    </div>
  );
  if (peek === undefined) return <div className="page"><Spinner /></div>;
  const dead = !peek ? (link ? "This review link doesn't work" : "This code isn't active")
    : peek.status === "expired" ? "This review link has expired"
    : peek.status === "used" && !session ? "This review link was already used" : null;
  if (!peek || dead) return (
    <div className="page"><TopBar />
      <div className="card">
        <EmptyArt icon={link ? "link" : "qr"} tone="coral" title={dead!}>
          <span className="small">{link ? "Ask the shop to send you a new link." : "Ask the staff for a new table card."}</span>
          <Link className="btn small ghost" to="/"><Icon name="search" size={16} />Search places</Link>
        </EmptyArt>
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
      if (error) { startingGuest.current = false; setGuestErr(friendly(error)); return; }
      navTo(`/review/${peek!.place_id}`);
    } else {
      startingGuest.current = false;
      setGuestErr("Reviewing without an account isn't switched on yet. Sign in to continue.");
    }
  }

  return (
    <div className="page" style={{ gap: 18 }}>
      <header className="hero" style={{ alignItems: "center", textAlign: "center", paddingTop: 22 }}>
        <span className="success-burst"><Icon name={visit ? "verified" : "store"} size={36} color="#fff" width={2.2} /></span>
        <h1 style={{ overflowWrap: "anywhere" }}>{peek.place_name}</h1>
        <div className="row wrap" style={{ justifyContent: "center", gap: 6 }}>
          {link && <span className="pill white"><Icon name="link" size={13} />Review link from the shop</span>}
          {peek.table_label && <span className="pill white"><Icon name="qr" size={13} />{peek.table_label}</span>}
          {peek.area && <span className="pill white"><Icon name="pin" size={13} />{peek.area}</span>}
        </div>
      </header>

      <div aria-live="polite">
        {loading ? <Spinner /> : session ? (
          visit ? (
            <div className="callout sky" role="status">
              <Chip icon="verified" tone="sky" />
              <span className="grow stack tight"><span className="strong">You can review now</span><span className="tiny row" style={{ gap: 4 }}><Icon name="clock" size={12} />{until ? `Until ${until}` : "For the next few hours"}</span></span>
            </div>
          ) : scanErr ? (
            <Retry msg={`Couldn't unlock your review: ${scanErr}`} onRetry={() => setScanTry((n) => n + 1)} />
          ) : scanning ? (
            <div className="callout sky"><Chip icon="verified" tone="sky" /><span className="small grow">Unlocking your verified visit…</span></div>
          ) : null
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="callout green"><Chip icon="star" size="sm" /><span className="small strong grow">Rate what you had, no account needed</span></div>
            <div className="callout violet"><Chip icon="eyeOff" tone="violet" size="sm" /><span className="small strong grow">Anonymous by default</span></div>
            <div className="callout sky"><Chip icon="verified" tone="sky" size="sm" /><span className="small strong grow">Verified visit badge</span></div>
          </div>
        )}
      </div>

      <div className="stack" style={{ marginTop: "auto" }}>
        {loading || scanErr ? null : session ? (
          <Link to={`/review/${peek.place_id}`} className="btn green block"><Icon name="star" size={18} />Rate what you had</Link>
        ) : (
          <>
            <button className="btn green block" disabled={starting} onClick={rateAsGuest}><Icon name="star" size={18} />{starting ? "Opening…" : "Rate what you had"}</button>
            {guestErr && <div className="notice err">{guestErr}</div>}
            <Link to={`/signin?next=${encodeURIComponent(next)}`} className="btn ghost block"><Icon name="login" size={18} />Sign in (optional)</Link>
          </>
        )}
        <Link to={`/p/${peek.place_id}`} className="btn quiet block"><Glyph name="heart" size={18} />See what others loved</Link>
      </div>
    </div>
  );
}
