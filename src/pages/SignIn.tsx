import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { canGoBack } from "../lib/nav";
import { Icon, Spinner } from "../components/ui";
import { Glyph } from "../components/home/Kit";
import "../styles/signin.css";

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

/** Pressing Back onto the sign-in page while already signed in: step over it instead of bouncing forward. */
function StepBack() {
  const nav = useNavigate();
  useEffect(() => { nav(-1); }, [nav]);
  return <div className="page"><Spinner /></div>;
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
  // Whether this screen was opened with a full account already there (a Back press), not signed in on it.
  const arrivedSigned = useRef<boolean | undefined>(undefined);

  if (loading) return <div className="page"><Spinner /></div>;
  if (arrivedSigned.current === undefined) arrivedSigned.current = Boolean(session && !isGuest);
  if (session && !isGuest) return arrivedSigned.current && canGoBack() ? <StepBack /> : <Navigate to={next} replace />;
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
      const { data, error } = await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (!error && data?.url) { window.location.replace(data.url); return; }
    }
    // replace(), not a normal visit: Back after signing in returns to the app, not to Google's finished page.
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
    if (error) setErr(errorText(error));
    else if (data?.url) window.location.replace(data.url);
  }

  const alreadyHasAccount = Boolean(authError && /already|exists/i.test(authError));
  const leave = () => nav(skipTo, { replace: true });

  return (
    <div className="si">
      <div className="si-top">
        <div className="si-brand"><span className="si-mark">T</span>Trusted Picks</div>
        <button type="button" className="si-skip" onClick={leave}>{isGuest ? "Not now" : "Skip"}</button>
      </div>

      <header className="si-hero">
        <span className="si-ico"><Icon name={isGuest ? "lock" : "people"} size={24} /></span>
        <h1>{isGuest ? "Keep your reviews" : "Picks from people you trust"}</h1>
        <p>{isGuest ? "Sign in once and your reviews follow you to any phone." : "Sign in to see what your friends loved. Reviewing never needs an account."}</p>
      </header>

      <div className="si-perks">
        {([
          ["star", isGuest ? "Your reviews on every device" : "Keep your reviews in one place"],
          ["people", "See what friends loved nearby"],
          ["eyeOff", "Anonymous unless you show your name"],
        ] as const).map(([icon, t]) => (
          <div key={t} className="si-perk"><span className="ci"><Icon name={icon} size={17} /></span>{t}</div>
        ))}
      </div>

      {authError && <div className="notice err">Sign-in didn't finish: {authError}</div>}
      {alreadyHasAccount && isGuest && (
        <button className="btn ghost block" onClick={async () => { await signOut(); setTaken(true); clearAuthError(); }}>
          Sign in to my existing account instead
        </button>
      )}

      {sent ? (
        <div className="si-sent">
          <span className="ci"><Glyph name="mail" size={22} /></span>
          <h2>Check your email</h2>
          <p>{sent === "link"
            ? <>We sent a sign-in link to <b>{email}</b>. Tap it and you stay signed in on this device.</>
            : <>We sent a link to <b>{email}</b>. Tap it to confirm and your reviews move to that account.</>}</p>
          <button className="btn quiet" onClick={() => setSent("")}>Use a different email</button>
        </div>
      ) : (
        <div className="si-actions">
          <button className="btn ghost block si-google" onClick={google}><GoogleLogo />Continue with Google</button>
          <div className="si-or">or use your email</div>
          <form className="si-actions" onSubmit={sendLink}>
            <input id="email" className="input" type="email" required autoComplete="email" aria-label="Email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn green block" disabled={busy}><Icon name="send" size={18} />{busy ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
          {err && <div className="notice err">{err}</div>}
        </div>
      )}

      <p className="si-note"><Icon name="lock" size={12} />No passwords. You stay signed in on this device.</p>
    </div>
  );
}
