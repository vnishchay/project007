import { useCallback, useEffect, useState } from "react";
import { supabase, errorText } from "../lib/supabase";

/** Normalises a phone number to E.164 exactly like the SQL set_my_phone. Returns null if it can't be a full number. */
export function toE164(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (!/^\s*\+/.test(raw)) {
    digits = digits.replace(/^0+/, "");
    if (digits.length === 10) digits = "91" + digits;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

export async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("This browser can't fingerprint numbers here. Open the app over https.");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether the signed-in user has a phone fingerprint stored. undefined while loading. */
export function useMyPhoneSet() {
  const [isSet, setIsSet] = useState<boolean | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setError(null);
    const { data, error: e } = await supabase.rpc("my_phone_is_set");
    if (e) { setError(errorText(e)); return; }
    setIsSet(Boolean(data));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { isSet, setIsSet, error, reload };
}

/** Form to save (or clear) your own number so friends who have it can find you. */
export function ContactsPhoneForm({ onSaved, onCancel, cancelLabel = "Skip", allowRemove = false }: {
  onSaved: (isSet: boolean) => void; onCancel?: () => void; cancelLabel?: string; allowRemove?: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(value: string) {
    setErr(null);
    if (value.trim() && !toE164(value)) { setErr("Enter a full phone number, e.g. 98765 43210 or +44 7700 900123."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("set_my_phone", { p_phone: value });
    setBusy(false);
    if (error) { setErr(errorText(error)); return; }
    setPhone("");
    onSaved(Boolean(data));
  }

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save(phone); }}>
      <div className="field">
        <label htmlFor="my-phone">Your phone number</label>
        <input
          id="my-phone" className="input" type="tel" inputMode="tel" autoComplete="tel"
          placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)}
          aria-describedby="my-phone-help" required
        />
        <span id="my-phone-help" className="tiny muted">
          Only a fingerprint (hash) of the number is stored, never the number itself. Numbers without a country code are taken as Indian (+91).
        </span>
      </div>
      {err && <div className="notice err" role="alert">{err}</div>}
      <div className="row wrap">
        <button className="btn small" disabled={busy}>{busy ? "Saving…" : "Save number"}</button>
        {allowRemove && (
          <button type="button" className="btn small danger" disabled={busy} onClick={() => save("")}>Remove number</button>
        )}
        {onCancel && <button type="button" className="btn small quiet" disabled={busy} onClick={onCancel}>{cancelLabel}</button>}
      </div>
    </form>
  );
}
