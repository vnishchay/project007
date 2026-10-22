import { useEffect, useState } from "react";
import { addToWallet, homeWallet, walletStatus, type PassKind } from "../lib/wallet";
import { Icon, useToast } from "./ui";

/** "Add to Apple Wallet" or "Add to Google Wallet", whichever this device uses. Hidden until a wallet is set up. */
export function WalletButton({ pass, compact = false, label }: { pass: PassKind; compact?: boolean; label?: string }) {
  const toast = useToast();
  const [which, setWhich] = useState<"apple" | "google" | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    walletStatus().then((st) => {
      const want = homeWallet();
      if (alive) setWhich(st[want] ? want : st.apple ? "apple" : st.google ? "google" : null);
    });
    return () => { alive = false; };
  }, []);
  if (!which) return null;
  const text = label || `Add to ${which === "apple" ? "Apple" : "Google"} Wallet`;
  async function go() {
    setBusy(true);
    const err = await addToWallet(pass);
    setBusy(false);
    if (err) toast(err);
  }
  return compact
    ? <button type="button" className="mg-act" disabled={busy} aria-label={text} title={text} onClick={go}><Icon name="walletCards" size={16} /></button>
    : <button type="button" className="btn ghost block wallet-btn" disabled={busy} onClick={go}><Icon name="walletCards" size={18} />{busy ? "Making your pass…" : text}</button>;
}
