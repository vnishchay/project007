import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Icon, Spinner } from "../components/ui";

interface Peek { place_id: string; place_name: string; area: string | null; table_label: string | null }

export default function QrLanding() {
  const { token = "" } = useParams();
  const { session, loading } = useAuth();
  const [peek, setPeek] = useState<Peek | null | undefined>(undefined);
  const [verified, setVerified] = useState(false);
  const [err, setErr] = useState("");
  const scanned = useRef(false);

  useEffect(() => {
    supabase.rpc("peek_qr", { p_token: token }).then(({ data, error }) => {
      if (error) setErr(errorText(error));
      setPeek(((data as Peek[]) || [])[0] ?? null);
    });
  }, [token]);

  useEffect(() => {
    if (loading || !session || !peek || scanned.current) return;
    scanned.current = true;
    supabase.rpc("scan_qr", { p_token: token }).then(({ error }) => {
      if (error) setErr(errorText(error)); else setVerified(true);
    });
  }, [loading, session, peek, token]);

  if (peek === undefined) return <div className="page"><Spinner /></div>;
  if (!peek) return (
    <div className="page"><div className="empty">
      <h2>This code isn't active</h2>
      <p>{err || "Ask the staff for a new table card, or search for the place instead."}</p>
      <Link className="btn ghost" to="/">Search places</Link>
    </div></div>
  );

  const where = [peek.table_label, peek.area].filter(Boolean).join(" · ");
  return (
    <div className="page" style={{ justifyContent: "center" }}>
      <div className="stack center" style={{ alignItems: "center", gap: 10 }}>
        <span className="avatar lg" style={{ background: "var(--green-soft)" }}><Icon name="check" size={28} color="var(--green)" width={2.6} /></span>
        <h1>{peek.place_name}</h1>
        {where && <span className="muted">{where}</span>}
      </div>

      {session ? (
        verified ? (
          <div className="notice ok center"><b>Verified visit unlocked.</b> Reviews you write here in the next few hours get the verified badge and count for more with people who trust you.</div>
        ) : err ? <div className="notice err">{err}</div> : <Spinner />
      ) : (
        <div className="notice">Sign in to rate what you had. Your review will carry a <b>verified visit</b> badge because you scanned the table code.</div>
      )}

      <div className="stack">
        {session ? (
          <Link to={`/review/${peek.place_id}`} className="btn block">Rate what you had</Link>
        ) : (
          <Link to={`/signin?next=${encodeURIComponent(`/q/${token}`)}`} className="btn block">Sign in to review</Link>
        )}
        <Link to={`/p/${peek.place_id}`} className="btn quiet block">See what others loved here</Link>
      </div>
    </div>
  );
}
