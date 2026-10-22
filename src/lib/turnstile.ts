/**
 * Cloudflare Turnstile, invisible: only for bot floods, off by default. To turn it on, set VITE_TURNSTILE_SITE_KEY
 * (Vercel env) and turn on CAPTCHA protection with Turnstile in Supabase (Authentication > Attack Protection).
 * Real people normally see nothing; Turnstile shows a small check box only when it's unsure.
 * With no site key this returns undefined and sign-in works exactly as before.
 */
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface Turnstile {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
}
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<Turnstile | null> | null = null;
function load(): Promise<Turnstile | null> {
  loading ??= new Promise((ok) => {
    if (window.turnstile) { ok(window.turnstile); return; }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => ok(window.turnstile ?? null);
    s.onerror = () => { loading = null; ok(null); };
    document.head.appendChild(s);
  });
  return loading;
}

/** A one-time token for Supabase Auth's captchaToken, or undefined when Turnstile is off or can't load. */
export async function captchaToken(): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  const ts = await load();
  if (!ts) return undefined;
  const box = document.createElement("div");
  box.className = "ts-box";
  document.body.appendChild(box);
  return new Promise((ok) => {
    let id = "";
    const done = (t?: string) => { try { ts.remove(id); } catch { /* already gone */ } box.remove(); ok(t); };
    id = ts.render(box, {
      sitekey: SITE_KEY, appearance: "interaction-only", execution: "execute",
      callback: (t: string) => done(t), "error-callback": () => done(undefined), "timeout-callback": () => done(undefined),
    });
    ts.execute(id);
  });
}
