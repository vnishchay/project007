import { useState } from "react";
import { Icon } from "./ui";
import { ItemThumb } from "./place/ItemThumb";

export interface DuelItem {
  id?: string;
  name: string;
  rating?: number;
  imagePath?: string | null;
  score?: number;
}

interface HeadToHeadModalProps {
  currentDish: DuelItem;
  compareDish: DuelItem;
  onDecided: (winnerId: string, currentScore: number) => void;
  onSkip: () => void;
}

export function HeadToHeadModal({ currentDish, compareDish, onDecided, onSkip }: HeadToHeadModalProps) {
  const [winner, setWinner] = useState<"current" | "compare" | null>(null);
  const [decidedScore, setDecidedScore] = useState<number | null>(null);

  const handleSelect = (pick: "current" | "compare") => {
    setWinner(pick);
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(15);
      }
    } catch {
      /* ignore */
    }

    const finalScore = pick === "current" ? 9.6 : 8.8;
    setDecidedScore(finalScore);

    setTimeout(() => {
      onDecided(pick === "current" ? currentDish.name : compareDish.name, finalScore);
    }, 750);
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Dish comparison">
      <div className="dish-duel-sheet">
        <div className="dish-duel-header">
          <div className="dish-duel-title-wrap">
            <span className="badge amber">
              <Icon name="star" size={12} />
              <span>Taste Comparison</span>
            </span>
            <h2 className="dish-duel-heading">Which dish did you prefer?</h2>
            <p className="dish-duel-sub">
              Help calibrate the kitchen's signature rankings with your dining feedback.
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onSkip}
            aria-label="Close comparison"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {decidedScore ? (
          <div className="dish-duel-result">
            <div className="dish-duel-check">
              <Icon name="check" size={24} />
            </div>
            <strong className="dish-duel-winner-name">
              {winner === "current" ? currentDish.name : compareDish.name}
            </strong>
            <span className="dish-duel-score-pill">
              Ranked #{winner === "current" ? "1" : "2"} Choice · {decidedScore} / 10
            </span>
          </div>
        ) : (
          <div className="dish-duel-grid">
            {/* Option A */}
            <button
              type="button"
              className={`dish-duel-option ${winner === "current" ? "selected" : ""}`}
              onClick={() => handleSelect("current")}
              aria-label={`Choose ${currentDish.name}`}
            >
              <div className="dish-duel-thumb">
                <ItemThumb path={currentDish.imagePath ?? null} icon="coffee" />
              </div>
              <strong className="dish-duel-name">{currentDish.name}</strong>
              <span className="dish-duel-tag">Today's Pick</span>
            </button>

            <div className="dish-duel-divider" aria-hidden="true">
              <span>or</span>
            </div>

            {/* Option B */}
            <button
              type="button"
              className={`dish-duel-option ${winner === "compare" ? "selected" : ""}`}
              onClick={() => handleSelect("compare")}
              aria-label={`Choose ${compareDish.name}`}
            >
              <div className="dish-duel-thumb">
                <ItemThumb path={compareDish.imagePath ?? null} icon="store" />
              </div>
              <strong className="dish-duel-name">{compareDish.name}</strong>
              <span className="dish-duel-tag muted">House Favorite</span>
            </button>
          </div>
        )}

        <div className="dish-duel-footer">
          <button
            type="button"
            className="btn quiet small"
            onClick={onSkip}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
