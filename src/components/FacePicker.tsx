import { RATING_WORDS } from "../lib/reviews";

/** The same four faces as the review flow, for editing a review later. Each shows its star value. */
const FACES = [
  { rating: 2, key: "meh" },
  { rating: 3, key: "ok" },
  { rating: 4, key: "good" },
  { rating: 5, key: "love" },
] as const;

function FaceSvg({ k }: { k: (typeof FACES)[number]["key"] }) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      {k === "love" ? <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /> : <>
        <circle cx="12" cy="12" r="9" />
        <path d={k === "meh" ? "M8.5 16c1-1.2 2.2-1.8 3.5-1.8s2.5.6 3.5 1.8M9 10h.01M15 10h.01" : k === "ok" ? "M8.5 15h7M9 10h.01M15 10h.01" : "M8.5 14.5c1 .9 2.2 1.3 3.5 1.3s2.5-.4 3.5-1.3M9 10h.01M15 10h.01"} />
      </>}
    </svg>
  );
}

export function FacePicker({ value, onChange }: { value: number; onChange: (r: number) => void }) {
  // A 1-star review from before the faces existed still shows as "Not for me".
  const on = value >= 5 ? 5 : value >= 4 ? 4 : value >= 3 ? 3 : value ? 2 : 0;
  return (
    <div className="face-pick" role="radiogroup" aria-label="How was it?">
      {FACES.map((f) => (
        <button key={f.key} type="button" role="radio" aria-checked={on === f.rating} className={on === f.rating ? "on" : ""} onClick={() => onChange(f.rating)}>
          <FaceSvg k={f.key} />
          <span>{RATING_WORDS[f.rating]}</span>
          <small>{f.rating} ★</small>
        </button>
      ))}
    </div>
  );
}
