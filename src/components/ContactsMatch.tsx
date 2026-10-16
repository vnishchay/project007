import { useState } from "react";
import { supabase, errorText } from "../lib/supabase";
import type { FollowSource } from "../lib/follows";
import { CirclePersonRow, type PersonLite } from "./CirclePersonRow";
import { ContactsPhoneForm, sha256Hex, toE164, useMyPhoneSet } from "./ContactsPhone";
import { Icon, Spinner } from "./ui";

interface ContactsManagerLike { select: (props: string[], opts: { multiple: boolean }) => Promise<{ tel?: string[] }[]> }

function pickerAvailable(): boolean {
  return typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in window;
}

/** Hashes numbers on the device; only the hashes are sent. */
async function hashNumbers(raw: string[]): Promise<string[]> {
  const e164 = new Set<string>();
  for (const r of raw) { const n = toE164(r); if (n) e164.add(n); }
  const hashes = await Promise.all([...e164].map(sha256Hex));
  return [...new Set(hashes)].slice(0, 2000);
}

export function ContactsMatch({ following, pending, onToggle }: {
  following: Set<string>; pending: Set<string>; onToggle: (id: string, source: FollowSource) => void;
}) {
  const phone = useMyPhoneSet();
  const [skipped, setSkipped] = useState(false);
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState<number | null>(null);
  const [matches, setMatches] = useState<PersonLite[] | null>(null);
  const hasPicker = pickerAvailable();

  async function match(raw: string[]) {
    setErr(null);
    setBusy(true);
    try {
      const hashes = await hashNumbers(raw);
      setChecked(hashes.length);
      if (!hashes.length) { setMatches([]); setErr("No full phone numbers found. Put one number per line or separate them with commas."); return; }
      const { data, error } = await supabase.rpc("match_contacts", { p_hashes: hashes });
      if (error) { setErr(errorText(error)); return; }
      setMatches((data as PersonLite[]) || []);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    try {
      const contacts = (navigator as unknown as { contacts: ContactsManagerLike }).contacts;
      const picked = await contacts.select(["tel"], { multiple: true });
      const nums = picked.flatMap((c) => c.tel || []);
      if (!nums.length) return; // dismissed or no numbers
      await match(nums);
    } catch (e) {
      // The picker throws if dismissed in some browsers; only report real failures.
      if ((e as { name?: string }).name !== "AbortError") setErr(errorText(e));
    }
  }

  const needPhone = phone.isSet === false && !skipped;

  return (
    <section className="card" aria-labelledby="contacts-h">
      <div className="row">
        <Icon name="people" color="var(--green)" />
        <h2 id="contacts-h" className="grow">Find friends from contacts</h2>
        {open && (
          <button type="button" className="icon-btn" style={{ width: 36, height: 36 }} aria-label="Close" onClick={() => setOpen(false)}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {!open ? (
        <>
          <p className="small muted">See which of your contacts already use Trusted Picks. Numbers are fingerprinted on your phone and never uploaded.</p>
          <button type="button" className="btn small green" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>Find friends</button>
        </>
      ) : phone.error ? (
        <div className="notice err row" role="alert">
          <span className="grow">Couldn't check your number: {phone.error}</span>
          <button type="button" className="link-btn strong" onClick={phone.reload}>Retry</button>
        </div>
      ) : phone.isSet === undefined ? (
        <Spinner />
      ) : needPhone ? (
        <div className="stack">
          <p className="small"><span className="strong">Step 1 of 2.</span> Add your own number so friends who have it saved can find you too.</p>
          <ContactsPhoneForm onSaved={(v) => phone.setIsSet(v)} onCancel={() => setSkipped(true)} />
        </div>
      ) : (
        <div className="stack">
          <p className="small">
            {phone.isSet ? <span className="strong">Step 2 of 2. </span> : null}
            {hasPicker ? "Pick contacts to check." : "Paste phone numbers to check, one per line or separated by commas."}{" "}
            <span className="muted">Only fingerprints (hashes) leave your device.</span>
          </p>
          {hasPicker ? (
            <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={pick} disabled={busy}>
              {busy ? "Checking…" : "Choose contacts"}
            </button>
          ) : (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); match(paste.split(/[\n,;]+/)); }}>
              <label htmlFor="contacts-paste" className="small strong">Phone numbers</label>
              <textarea id="contacts-paste" className="textarea" value={paste} onChange={(e) => setPaste(e.target.value)}
                placeholder={"98765 43210\n+44 7700 900123"} rows={4} />
              <button className="btn small" style={{ alignSelf: "flex-start" }} disabled={busy || !paste.trim()}>
                {busy ? "Checking…" : "Find friends"}
              </button>
            </form>
          )}
          {err && <div className="notice err" role="alert">{err}</div>}
          {matches && !err && (
            matches.length === 0 ? (
              <p className="small muted" role="status">None of the {checked} number{checked === 1 ? "" : "s"} you checked {checked === 1 ? "is" : "are"} on Trusted Picks yet. Invite them below.</p>
            ) : (
              <div className="stack tight">
                <span className="small strong" role="status">{matches.length} of your contacts {matches.length === 1 ? "is" : "are"} here</span>
                <div className="list">
                  {matches.map((p) => (
                    <CirclePersonRow key={p.id} p={p} on={following.has(p.id)} busy={pending.has(p.id)} onToggle={() => onToggle(p.id, "contacts")} sub="In your contacts" />
                  ))}
                </div>
              </div>
            )
          )}
          {!phone.isSet && (
            <button type="button" className="link-btn small" style={{ alignSelf: "flex-start" }} onClick={() => setSkipped(false)}>
              Add your own number so friends can find you
            </button>
          )}
        </div>
      )}
    </section>
  );
}
