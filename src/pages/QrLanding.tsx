import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Icon, Spinner, TopBar } from "../components/ui";
import { Chip, EmptyArt, Glyph, Retry } from "../components/home/Kit";
import "../styles/home.css";

interface Peek { place_id: string; place_name: string; area: string | null; table_label: string | null }
interface Visit { visit_id: string; expires_at: string }

function friendly(e: unknown): string {
  const m = errorText(e);
  if (m === "Failed to fetch" || /network/i.test(m)) return "You seem to be offline.";
  return m;
}

export default function QrLanding() {
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
  const startingGuest = useRef(false);

  useEffect(() => {
    let alive = true;
    setPeek(undefined);
    setPeekErr("");
    supabase.rpc("peek_qr", { p_token: token }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setPeekErr(friendly(error)); return; }
      setPeek(((data as Peek[]) || [])[0] ?? null);
    }, (e: unknown) => { if (alive) setPeekErr(friendly(e)); });
    return () => { alive = false; };
  }, [token, peekTry]);

  useEffect(() => {
    if (loading || !uid || !peek || startingGuest.current) return;
    const key = `${uid}:${token}:${scanTry}`;
    if (scannedFor.current === key) return;
    scannedFor.current = key;
    setScanning(true);
    setScanErr("");
    supabase.rpc("scan_qr", { p_token: token }).then(({ data, error }) => {
      setScanning(false);
      if (error) { setScanErr(friendly(error)); return; }
      const v = ((data as Visit[]) || [])[0];
      setVisit(v ?? { visit_id: "", expires_at: "" });
    }, (e: unknown) => { setScanning(false); setScanErr(friendly(e)); });
  }, [loading, uid, peek, token, scanTry]);

  if (peekErr) return (
    <div className="page">
      <TopBar />
      <Retry msg={`Couldn't check this table code: ${peekErr}`} onRetry={() => setPeekTry((n) => n + 1)} />
    </div>
  );
  if (peek === undefined) return <div className="page"><Spinner /></div>;
  if (!peek) return (
    <div className="page"><TopBar />
      <div className="card">
        <EmptyArt icon="qr" tone="coral" title="This code isn't active">
          <span className="small">Ask the staff for a new table card.</span>
          <Link className="btn small ghost" to="/"><Icon name="search" size={16} />Search places</Link>
        </EmptyArt>
      </div>
    </div>
  );

  const until = visit?.expires_at ? new Date(visit.expires_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : null;
  const next = `/q/${token}`;

  async function rateAsGuest() {
    // Start a guest session and unlock the verified visit before moving on.
    setStarting(true); setGuestErr(""); startingGuest.current = true;
    const ok = await startGuest();
    setStarting(false);
    if (ok) {
      const { data } = await supabase.auth.getSession();
      scannedFor.current = `${data.session?.user.id}:${token}:${scanTry}`;
      await supabase.rpc("scan_qr", { p_token: token });
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
          {peek.table_label && <span className="pill white"><Icon name="qr" size={13} />{peek.table_label}</span>}
          {peek.area && <span className="pill white"><Icon name="pin" size={13} />{peek.area}</span>}
        </div>
      </header>

      <div aria-live="polite">
        {loading ? <Spinner /> : session ? (
          visit ? (
            <div className="callout sky" role="status">
              <Chip icon="verified" tone="sky" />
              <span className="grow stack tight"><span className="strong">Verified visit unlocked</span><span className="tiny row" style={{ gap: 4 }}><Icon name="clock" size={12} />{until ? `Until ${until}` : "For the next few hours"} · counts for more</span></span>
            </div>
          ) : scanErr ? (
            <Retry msg={`Couldn't unlock a verified visit: ${scanErr}. You can still review.`} onRetry={() => setScanTry((n) => n + 1)} />
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
        {loading ? null : session ? (
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
