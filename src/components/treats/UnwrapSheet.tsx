import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dateText, markUnwrapped, type Offer } from "../../lib/treats";
import { WalletButton } from "../WalletButton";
import { Icon } from "../ui";

const CONFETTI = ["#ffd8a8", "#ff6a45", "#ffffff", "#ffb35c", "#ff6a45", "#ffffff", "#ffd8a8", "#ff9f87"];

/**
 * A personal offer from a shop. The first time, it's a wrapped box to tap open; after that it opens
 * straight to the coupon. From here it goes to the counter screen or into Apple/Google Wallet.
 */
export function UnwrapSheet({ offer, shop, onOpened, onUse, onClose }: {
  offer: Offer; shop: string; onOpened: () => void; onUse: () => void; onClose: () => void;
}) {
  const [stage, setStage] = useState<"wrapped" | "opening" | "open">(offer.seen ? "open" : "wrapped");
  const [burst, setBurst] = useState(false);
  const boxRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (stage === "wrapped" ? boxRef.current : closeRef.current)?.focus();
    // Only on mount: focus moves with the user after that.
  }, []);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeFn.current(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);

  function unwrap() {
    setStage("opening");
    navigator.vibrate?.(25);
    void markUnwrapped(offer.id);
    onOpened();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => { setStage("open"); setBurst(!reduce); }, reduce ? 0 : 330);
  }

  return createPortal(
    <div className="tr-full tr-gift-bg" role="dialog" aria-modal="true" aria-label={`An offer from ${shop}`}>
      <div className="tr-top">
        <button ref={closeRef} type="button" className="tr-x" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button>
        <span className="tr-shop">From {shop}</span>
        <span style={{ width: 44 }} />
      </div>
      {stage !== "open" ? (
        <div className="tr-giftstage">
          <h1>{shop} left<br />something for you</h1>
          <button ref={boxRef} type="button" className={`tr-box ${stage === "opening" ? "opening" : ""}`} onClick={unwrap} aria-label="Unwrap your offer">
            <span className="rv" /><span className="rh" /><span className="bw l" /><span className="bw r" />
          </button>
          <span style={{ fontSize: 15, opacity: 0.85 }}>Tap the box to unwrap</span>
        </div>
      ) : (
        <div className="stack" style={{ flex: 1, justifyContent: "center", gap: 16 }}>
          {burst && <div className="tr-confetti" aria-hidden="true">{CONFETTI.map((c, i) => <i key={i} style={{ left: `${8 + i * 11.5}%`, background: c, animationDelay: `${(i % 4) * 0.07}s` }} />)}</div>}
          <div className="tr-coupon">
            <div className="in">
              <span className="k">JUST FOR YOU</span>
              <span className="big">{offer.body}</span>
            </div>
            <div className="ft">
              <span><small>Valid till</small><b>{dateText(offer.valid_till)}</b></span>
              <span style={{ textAlign: "right" }}><small>Uses</small><b>1 time</b></span>
            </div>
          </div>
          <button type="button" className="tr-btn light" onClick={onUse}><Icon name="ticket" size={20} />Use it at the counter</button>
          {offer.link_url && <a className="tr-btn dark" href={offer.link_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={18} />Offer details</a>}
          <WalletButton pass={{ kind: "offer", id: offer.id }} />
          <p className="tr-note">Kept in your pocket. Never linked to your review.</p>
        </div>
      )}
    </div>,
    document.body,
  );
}
