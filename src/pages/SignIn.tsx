import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Icon } from "../components/ui";

export default function SignIn() {
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (session) return <Navigate to={next} replace />;
  const redirectTo = `${window.location.origin}${next}`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    if (error) setErr(errorText(error)); else setSent(true);
  }

  async function google() {
    setErr("");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) setErr(errorText(error));
  }

  return (
    <div className="page" style={{ justifyContent: "center" }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="avatar lg" style={{ background: "var(--green-soft)", color: "var(--green)" }}><Icon name="check" size={26} width={2.6} /></span>
        <h1>Sign in to Trusted Picks</h1>
        <p className="muted">Rate what you had, see what your friends loved, and get a verified badge when you scan a table QR.</p>
      </div>

      {sent ? (
        <div className="notice ok">Check <b>{email}</b> for a sign-in link. You can close this tab after you tap it.</div>
      ) : (
        <form className="stack" onSubmit={sendLink}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn block" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
        </form>
      )}

      <div className="row" style={{ gap: 12 }}><div className="divider grow" /><span className="tiny muted">or</span><div className="divider grow" /></div>
      <button className="btn ghost block" onClick={google}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Continue with Google
      </button>
      {err && <div className="notice err">{err}</div>}
    </div>
  );
}
