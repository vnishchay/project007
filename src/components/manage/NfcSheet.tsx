import { useEffect, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import type { QrCode } from "../../lib/types";
import { copyText, qrUrl } from "../../lib/util";
import { Icon, Spinner, useToast } from "../ui";

interface Setup { key_hex: string; linked: boolean; taps: number; last_tap_at: string | null }

/** The address an NTAG 424 DNA tag is set to open. The zeros are where the tag writes each tap's values. */
export const nfcUrl = (token: string) => `${qrUrl(token)}?picc=${"0".repeat(32)}&cmac=${"0".repeat(16)}`;

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const toast = useToast();
  return (
    <div className="nfc-copy">
      <span className="tiny muted">{label}</span>
      <div className="row" style={{ gap: 8 }}>
        <code className={`grow ${mono ? "nfc-key" : ""}`}>{value}</code>
        <button type="button" className="mg-act" aria-label={`Copy ${label.toLowerCase()}`} title="Copy"
          onClick={async () => toast((await copyText(value)) ? `${label} copied` : "Couldn't copy. Select it and copy instead.")}>
          <Icon name="copy" size={16} />
        </button>
      </div>
    </div>
  );
}

/** Owner sheet: set up the NFC tag that sits next to one table's QR code. */
export function NfcSheet({ code, onClose }: { code: QrCode; onClose: () => void }) {
  const [s, setS] = useState<Setup | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  async function load(newKey = false) {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("nfc_tag_setup", { p_qr: code.id, p_new_key: newKey });
    setBusy(false);
    if (error) { setErr(error.code === "PGRST202" ? "NFC tags aren't available yet." : errorText(error)); return; }
    setS(((data as Setup[]) || [])[0] ?? null);
    setConfirmNew(false);
  }
  useEffect(() => { load(); }, [code.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = code.table_label || "this table";
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mg-sheet" role="dialog" aria-modal="true" aria-label={`NFC tag for ${label}`} onClick={(e) => e.stopPropagation()}>
        <div className="mg-grabber" />
        <div className="mg-sheet-head">
          <span className="icon-chip sm sky"><Icon name="nfc" size={16} /></span>
          <h2>NFC tag for {label}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>

        <p className="small muted">Customers tap their phone on the tag instead of scanning. Each tap makes a one-time link, so a photo or copy of it can't be used to review from somewhere else. The QR code keeps working for phones without NFC.</p>

        {err && <div className="notice err">{err}</div>}
        {!s && !err && <Spinner />}
        {s && (
          <>
            <div className={`notice ${s.linked ? "ok" : ""} row`} style={{ gap: 10 }}>
              <Icon name={s.linked ? "checkCircle" : "info"} size={18} />
              <span className="grow">{s.linked
                ? <>Working. Last tap {s.last_tap_at ? new Date(s.last_tap_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}.</>
                : <>Not tapped yet. Set the tag up below, then tap it with your phone to test.</>}</span>
            </div>

            <ol className="nfc-steps small">
              <li>Get <b>NTAG 424 DNA</b> stickers or cards. Plain NFC tags can't make one-time links.</li>
              <li>Program the tag with <b>NXP TagXplorer</b> and a USB NFC reader, or send these details to your tag seller:
                <div className="stack" style={{ gap: 10, marginTop: 10 }}>
                  <CopyRow label="Link" value={nfcUrl(code.token)} />
                  <CopyRow label="Key" value={s.key_hex} mono />
                </div>
              </li>
              <li>Turn on <b>SUN / Secure Dynamic Messaging</b>: encrypted PICC data (tag ID and tap counter) at the zeros after <code>picc=</code>, SDM MAC at the zeros after <code>cmac=</code>, and MAC input starting at the MAC itself.</li>
              <li>Put the key in <b>key slot 1</b> and use slot 1 for both SDM meta read and SDM file read.</li>
              <li>Tap it with your phone. This shop's page should open, and this sheet should say "Working".</li>
            </ol>

            <div className="notice warn small row" style={{ gap: 8 }}><Icon name="lock" size={16} /><span className="grow">Keep the key private. Anyone with it could make fake taps for this table.</span></div>

            {confirmNew ? (
              <div className="card soft stack" style={{ gap: 10 }}>
                <span className="small">A new key stops the current tag from working until it's programmed again.</span>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn small ghost grow" onClick={() => setConfirmNew(false)}>Keep this key</button>
                  <button type="button" className="btn small grow" disabled={busy} onClick={() => load(true)}><Icon name="refresh" size={16} />Make a new key</button>
                </div>
              </div>
            ) : (
              <button type="button" className="link-btn" onClick={() => setConfirmNew(true)}><Icon name="refresh" size={15} />Lost the tag? Make a new key</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
