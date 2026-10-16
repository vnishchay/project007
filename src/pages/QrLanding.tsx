import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Icon, Spinner, TopBar } from "../components/ui";

interface Peek { place_id: string; place_name: string; area: string | null; table_label: string | null }
interface Visit { visit_id: string; expires_at: string }

function friendly(e: unknown): string {
  const m = errorText(e);
  if (m === "Failed to fetch" || /network/i.test(m)) return "You seem to be offline.";
  return m;
}

export default function QrLanding() {
  const { token = "" } = useParams();
  const { session, loading } = useAuth();
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
    if (loading || !uid || !peek) return;
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
      <div className="notice err" role="alert">
        <div className="stack" style={{ gap: 8 }}>
          <span>Couldn't check this table code: {peekErr}</span>
          <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => setPeekTry((n) => n + 1)}>Retry</button>
        </div>
      </div>
    </div>
  );
  if (peek === undefined) return <div className="page"><Spinner /></div>;
  if (!peek) return (
    <div className="page"><TopBar /><div className="empty">
      <h2>This code isn't active</h2>
      <p>Ask the staff for a new table card, or search for the place instead.</p>
      <Link className="btn ghost" to="/">Search places</Link>
    </div></div>
  );

  const where = [peek.table_label, peek.area].filter(Boolean).join(" · ");
  const until = visit?.expires_at ? new Date(visit.expires_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : null;
  const next = `/q/${token}`;

  return (
    <div className="page">
      <TopBar />
      <div className="stack center" style={{ alignItems: "center", gap: 10, marginTop: 8 }}>
        <span className="avatar lg" style={{ background: "var(--green-soft)" }}><Icon name={visit ? "check" : "store"} size={28} color="var(--green)" width={2.6} /></span>
        <h1 style={{ overflowWrap: "anywhere" }}>{peek.place_name}</h1>
        {where && <span className="muted">{where}</span>}
      </div>

      <div aria-live="polite">
        {loading ? <Spinner /> : session ? (
          visit ? (
            <div className="notice ok center" role="status"><b>Verified visit unlocked.</b> Reviews you write here{until ? ` until ${until}` : " in the next few hours"} get the verified badge and count for more with people who trust you.</div>
          ) : scanErr ? (
            <div className="notice err" role="alert">
              <div className="stack" style={{ gap: 8 }}>
                <span>Couldn't unlock a verified visit: {scanErr}. You can still review, just without the badge.</span>
                <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => setScanTry((n) => n + 1)}>Try again</button>
              </div>
            </div>
          ) : scanning ? (
            <div className="row" style={{ justifyContent: "center" }}><span className="small muted">Unlocking your verified visit…</span></div>
          ) : null
        ) : (
          <div className="notice">Sign in to rate what you had. Your review will carry a <b>verified visit</b> badge because you scanned the table code.</div>
        )}
      </div>

      <div className="stack" style={{ marginTop: "auto" }}>
        {loading ? null : session ? (
          <Link to={`/review/${peek.place_id}`} className="btn block">Rate what you had</Link>
        ) : (
          <Link to={`/signin?next=${encodeURIComponent(next)}`} className="btn block">Sign in to review</Link>
        )}
        <Link to={`/p/${peek.place_id}`} className="btn quiet block">See what others loved here</Link>
      </div>
    </div>
  );
}
