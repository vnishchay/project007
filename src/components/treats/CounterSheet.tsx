import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { errorText } from "../../lib/supabase";
import { redeemTreat, useNow, type Usable } from "../../lib/treats";
import type { PassKind } from "../../lib/wallet";
import { WalletButton } from "../WalletButton";
import { Icon, useToast } from "../ui";

const HOLD_MS = 1200;
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

/**
 * The treat, full screen, to show at the counter. The colours keep moving and the clock ticks, so a
 * screenshot can't pass for it. The staff press and hold to use it (no accidental taps), then it's stamped USED.
 * `usable` null: nothing to record (not signed in), so it's just shown.
 */
export function CounterSheet({ shop, big, line, note, tone = "gift", usable, usedAt, pass, onUsed, onClose }: {
  shop: string; big: string; line?: string; note?: string; tone?: string;
  usable: Usable | null; usedAt?: string | null; pass?: PassKind;
  onUsed?: (at: string) => void; onClose: () => void;
}) {
  const toast = useToast();
  const now = useNow(1000);
  const [used, setUsed] = useState<string | null>(usedAt ?? null);
  const [holding, setHolding] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeFn.current(); };
    window.addEventListener("keydown", onKey);
    // Keep the screen on while it's being shown.
    let lock: { release: () => Promise<void> } | null = null;
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wl?.request("screen").then((l) => { lock = l; }, () => {});
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      void lock?.release().catch(() => {});
      document.body.style.overflow = prev;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  async function commit() {
    if (!usable) return;
    setBusy(true);
    try {
      const at = await redeemTreat(usable);
      setUsed(at);
      navigator.vibrate?.([30, 40, 60]);
      onUsed?.(at);
    } catch (e) {
      toast(/isn't on right now/i.test(errorText(e)) ? "This deal isn't on right now." : /not enough stamps/i.test(errorText(e)) ? "Not enough stamps yet." : errorText(e));
    }
    setBusy(false);
  }
  const start = () => {
    if (used || busy || holding || !usable) return;
    setHolding(true);
    timer.current = window.setTimeout(() => { setHolding(false); void commit(); }, HOLD_MS);
  };
  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  const usedDate = used ? new Date(used) : null;
  return createPortal(
    <div className="tr-full tr-counter" role="dialog" aria-modal="true" aria-label={`${big} at ${shop}`}>
      <div className="tr-top">
        <button ref={closeRef} type="button" className="tr-x" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button>
        <span className="tr-shop">{usedDate ? "Used" : "Show this to the staff"}</span>
        <span style={{ width: 44 }} />
      </div>
      <div className={`tr-live ${usedDate ? "done" : `go tone-${tone}`}`}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="shop">{shop}</span>
          <span className={`big ${big.length > 12 ? "long" : ""}`}>{big}</span>
          {line && <span className="line">{line}</span>}
          {note && <span className="hint">{note}</span>}
        </div>
        {usedDate && <div className="tr-stamp" aria-hidden="true">USED</div>}
        <div className="stack" style={{ gap: 4 }}>
          <span className="lbl">{usedDate ? "USED AT" : "LIVE NOW"}</span>
          <span className="clock" aria-live="off">{clock(usedDate ?? new Date(now))}</span>
          <span className="hint">{usedDate
            ? `${usedDate.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}. This one is done.`
            : "The colours move and the clock ticks, so a screenshot can't pass for it."}</span>
        </div>
      </div>
      {!usedDate && usable && (
        <button type="button" className={`tr-hold ${holding ? "on" : ""}`} disabled={busy}
          onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); } }} onKeyUp={stop}
          aria-describedby="tr-hold-why">
          <span className="fill" aria-hidden="true" />
          <span>{busy ? "Saving…" : holding ? "Keep holding…" : "Staff: press and hold to use"}</span>
        </button>
      )}
      {!usedDate && usable && <p id="tr-hold-why" className="tr-note">Holding for a second means it can't be used by a stray tap. It can't be undone.</p>}
      {!usedDate && pass && <WalletButton pass={pass} />}
    </div>,
    document.body,
  );
}
