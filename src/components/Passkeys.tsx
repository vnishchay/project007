import { useCallback, useEffect, useState } from "react";
import { supabase, errorText } from "../lib/supabase";
import { Icon, useToast } from "./ui";
import { Chip, SectionTitle } from "./home/Kit";
import { captchaToken } from "../lib/turnstile";

/** Whether this browser can make or use a passkey at all. */
export const passkeysSupported = () => typeof window !== "undefined" && "PublicKeyCredential" in window && Boolean(navigator.credentials);

interface Passkey { id: string; friendly_name?: string; created_at: string; last_used_at?: string }

/** The browser said no (closed the prompt, timed out): not worth an error message. */
const cancelled = (e: unknown) => /NotAllowed|abort|cancel/i.test(`${(e as { name?: string })?.name ?? ""} ${errorText(e)}`);

const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** A name for a new passkey, so the list says which phone or laptop it lives on. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

/** Profile section: add, list and remove passkeys for this account. Full accounts only, never guests. */
export function PasskeysCard() {
  const toast = useToast();
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.auth.passkey.list();
    // Passkeys not turned on for this project yet: hide the section instead of showing an error.
    if (error) { setOff(true); return; }
    setKeys(data || []);
  }, []);
  useEffect(() => { if (passkeysSupported()) load(); }, [load]);

  if (!passkeysSupported() || off || keys === null) return null;

  async function add() {
    setBusy(true);
    const { data, error } = await supabase.auth.registerPasskey();
    if (error) { setBusy(false); if (!cancelled(error)) toast(errorText(error)); return; }
    if (data?.id) await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: deviceName() });
    await load();
    setBusy(false);
    toast("Passkey added. Next time, sign in with your fingerprint or face.");
  }

  async function remove(k: Passkey) {
    setBusy(true);
    const { error } = await supabase.auth.passkey.delete({ passkeyId: k.id });
    if (error) toast(errorText(error));
    await load();
    setBusy(false);
  }

  return (
    <section className="stack" style={{ gap: 10 }}>
      <SectionTitle icon="key" tone="sky">Passkeys</SectionTitle>
      <div className="menu">
        {keys.map((k) => (
          <div key={k.id} className="menu-row">
            <Chip icon="fingerprint" tone="sky" />
            <span className="grow stack tight" style={{ minWidth: 0 }}>
              <span className="t ellipsis">{k.friendly_name || "Passkey"}</span>
              <span className="s ellipsis">{k.last_used_at ? `Last used ${when(k.last_used_at)}` : `Added ${when(k.created_at)}`}</span>
            </span>
            <button type="button" className="mg-act" disabled={busy} aria-label={`Remove ${k.friendly_name || "passkey"}`} title="Remove" onClick={() => remove(k)}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        <button type="button" className="menu-row" disabled={busy} onClick={add}>
          <Chip icon="plus" tone="sky" />
          <span className="grow stack tight" style={{ minWidth: 0 }}>
            <span className="t ellipsis">{keys.length ? "Add a passkey on this device" : "Sign in with your fingerprint or face"}</span>
            <span className="s ellipsis">No email link needed next time</span>
          </span>
          <Icon name="chev" size={18} color="var(--muted)" />
        </button>
      </div>
    </section>
  );
}

/** Sign-in button for a passkey saved on this device. The sign-in page moves on by itself once the session arrives. */
export function PasskeySignIn({ onError }: { onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!passkeysSupported()) return null;
  async function go() {
    setBusy(true); onError("");
    const { error } = await supabase.auth.signInWithPasskey({ options: { captchaToken: await captchaToken() } });
    setBusy(false);
    if (error && !cancelled(error)) onError(/not.*(enabled|found)|404|disabled/i.test(errorText(error)) ? "Passkey sign-in isn't available yet. Use Google or email." : errorText(error));
  }
  return (
    <button type="button" className="btn ghost block" disabled={busy} onClick={go}>
      <Icon name="fingerprint" size={18} />{busy ? "Waiting for your passkey…" : "Sign in with a passkey"}
    </button>
  );
}
