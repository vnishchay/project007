import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Icon, Spinner } from "../components/ui";

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
  );
}

// Signing in is optional. After it, people land on Discover, or back on the review or
// QR page they came from. Never on their profile.
function landingPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (next === "/me" || next.startsWith("/me?") || next.startsWith("/signin")) return "/";
  return next;
}

export default function SignIn() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const next = landingPath(params.get("next"));
  const { session, loading, isGuest, authError, clearAuthError, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<"" | "link" | "confirm">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [taken, setTaken] = useState(false);

  if (loading) return <div className="page"><Spinner /></div>;
  if (session && !isGuest) return <Navigate to={next} replace />;
  const redirectTo = `${window.location.origin}${next}`;
  // Pages that work without an account; anything else goes back to Discover.
  const skipTo = /^\/(q|review|p|saved)\//.test(next) ? next : "/";

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); clearAuthError();
    const address = email.trim();
    if (isGuest && !taken) {
      // Turn this guest into a full account, keeping the reviews already written.
      const { error } = await supabase.auth.updateUser({ email: address }, { emailRedirectTo: redirectTo });
      setBusy(false);
      if (!error) { setSent("confirm"); return; }
      if (/already|registered|exists/i.test(error.message)) { setTaken(true); setErr("That email already has an account. Send a sign-in link to it instead."); return; }
      setErr(errorText(error));
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({ email: address, options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    if (error) setErr(errorText(error)); else setSent("link");
  }

  async function google() {
    setErr(""); clearAuthError();
    if (isGuest && !taken) {
      // Keeps the guest's reviews. Needs "Allow manual linking" in Supabase; falls back to a normal sign-in.
      const { error } = await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo } });
      if (!error) return;
    }
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) setErr(errorText(error));
  }

  const alreadyHasAccount = Boolean(authError && /already|exists/i.test(authError));

  return (
    <div className="page" style={{ justifyContent: "center" }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="avatar lg" style={{ background: "var(--green-soft)", color: "var(--green)" }}><Icon name="check" size={26} width={2.6} /></span>
        <h1>{isGuest ? "Keep your reviews" : "Sign in to Trusted Picks"}</h1>
        <p className="muted">
          {isGuest
            ? "Optional. Sign in to keep your reviews on any device, show your name if you want to, and see what friends loved. Your reviews stay anonymous unless you choose otherwise."
            : "Optional. You can rate places and post to Google without an account. Sign in to keep your reviews on every device and see what friends loved."}
        </p>
      </div>

      {authError && <div className="notice err">Sign-in didn't finish: {authError}</div>}
      {alreadyHasAccount && isGuest && (
        <button className="btn ghost block" onClick={async () => { await signOut(); setTaken(true); clearAuthError(); }}>
          Sign in to my existing account instead
        </button>
      )}

      {sent === "link" ? (
        <div className="notice ok">Check <b>{email}</b> for a sign-in link. You stay signed in on this device after you tap it.</div>
      ) : sent === "confirm" ? (
        <div className="notice ok">Check <b>{email}</b> and tap the link to confirm. Your reviews move to that account.</div>
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
      <button className="btn ghost block" onClick={google}><GoogleLogo />Continue with Google</button>
      {err && <div className="notice err">{err}</div>}

      {isGuest
        ? <button className="btn quiet block" onClick={() => nav(skipTo, { replace: true })}>Not now</button>
        : <Link to={skipTo} className="btn quiet block">Continue without signing in</Link>}
      <p className="tiny muted center">One sign-in keeps you signed in on this device until you sign out.</p>
    </div>
  );
}
