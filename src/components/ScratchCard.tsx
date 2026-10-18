import { useState, useCallback } from "react";
import { Icon, useToast } from "./ui";
import { copyText } from "../lib/util";

interface ScratchCardProps {
  stars: number;
  placeName?: string;
  onRevealed?: () => void;
}

export function ScratchCard({ stars, placeName, onRevealed }: ScratchCardProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const toast = useToast();

  const code = stars === 5 ? "CHEF-VIP" : stars === 4 ? "TASTE10" : "VIP-CARE";
  const perkTitle =
    stars === 5
      ? "Complimentary Dessert or Drink"
      : stars === 4
      ? "10% VIP Dining Courtesy"
      : "Priority Table Reservation";

  const perkDescription =
    stars === 5
      ? "Enjoy a complimentary house dessert or signature cocktail on your next visit."
      : stars === 4
      ? "Present this pass for 10% off your next dining bill."
      : "Enjoy priority reservation privileges and a welcome beverage next time.";

  const handleUnlock = useCallback(() => {
    setIsRevealed(true);
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(15);
      }
    } catch {
      /* ignore */
    }
    onRevealed?.();
  }, [onRevealed]);

  const handleCopy = async () => {
    await copyText(code);
    setCodeCopied(true);
    toast("Pass code copied to clipboard");
    setTimeout(() => setCodeCopied(false), 2500);
  };

  return (
    <section className="vip-pass-card" aria-label="Table dining perk">
      <div className="vip-pass-header">
        <div className="vip-pass-brand">
          <span className="vip-pass-badge">
            <Icon name="verified" size={13} />
            <span>Table Perk Unlocked</span>
          </span>
          <span className="vip-pass-place">
            {placeName ? placeName : "Dining Reward"}
          </span>
        </div>
      </div>

      <div className={`vip-pass-body ${isRevealed ? "is-unlocked" : ""}`}>
        {!isRevealed ? (
          <div className="vip-pass-locked">
            <div className="vip-pass-icon-ring">
              <Icon name="gift" size={24} />
            </div>
            <div className="vip-pass-locked-meta">
              <strong className="vip-pass-title">VIP Dining Courtesy</strong>
              <p className="vip-pass-sub">
                A special thank you from the kitchen for sharing your dish review.
              </p>
            </div>
            <button
              type="button"
              className="vip-pass-unlock-btn"
              onClick={handleUnlock}
              aria-label="Unlock your dining perk"
            >
              <span>Tap to Reveal Perk</span>
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        ) : (
          <div className="vip-pass-unlocked">
            <div className="vip-pass-perk-header">
              <div className="vip-pass-perk-icon">
                <Icon name="check" size={18} />
              </div>
              <div>
                <strong className="vip-pass-perk-title">{perkTitle}</strong>
                <p className="vip-pass-perk-sub">{perkDescription}</p>
              </div>
            </div>

            <div className="vip-pass-code-container">
              <div className="vip-pass-code-details">
                <span className="vip-pass-label">PASS CODE</span>
                <span className="vip-pass-code">{code}</span>
              </div>
              <button
                type="button"
                className="vip-pass-copy-btn"
                onClick={handleCopy}
                aria-label={`Copy code ${code}`}
              >
                <Icon name={codeCopied ? "check" : "copy"} size={14} />
                <span>{codeCopied ? "Copied" : "Copy"}</span>
              </button>
            </div>

            <div className="vip-pass-footer">
              <span className="vip-pass-footnote">
                Show this digital pass to your server or host on your next visit.
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
