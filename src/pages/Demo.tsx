import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon, RvxBack, useToast } from "../components/ui";
import { generateStoryCard } from "../lib/story";
import "../styles/place.css";
import "../styles/review.css";
import "../styles/home.css";

const DEMO_PLACES: Record<
  string,
  {
    name: string;
    category: string;
    area: string;
    rating: number;
    dishes: { name: string; price: string; stars: number; photo: string; tags: string[] }[];
  }
> = {
  "joes-diner": {
    name: "Joe's All-American Diner",
    category: "American Diner",
    area: "South Congress, Austin",
    rating: 4.8,
    dishes: [
      { name: "Smoked Brisket Smashburger", price: "$16.50", stars: 5, photo: "burger", tags: ["Juicy", "Crispy Edge", "Huge Portion", "Smoky"] },
      { name: "Truffle Parmesan Fries", price: "$8.50", stars: 5, photo: "fries", tags: ["Crispy", "Rich Truffle", "Hot & Fresh"] },
      { name: "Salted Caramel Shake", price: "$7.00", stars: 4, photo: "drink", tags: ["Thick", "Creamy", "Not Too Sweet"] },
    ],
  },
  "bandra-bistro": {
    name: "Bandra Bistro & Bar",
    category: "Italian & Continental",
    area: "Pali Hill, Mumbai",
    rating: 4.9,
    dishes: [
      { name: "Handmade Truffle Tagliolini", price: "₹650", stars: 5, photo: "pasta", tags: ["Rich Truffle", "Silky", "Al Dente", "Generous"] },
      { name: "Artisanal Burrata Toast", price: "₹490", stars: 5, photo: "bread", tags: ["Super Creamy", "Fresh Pesto", "Crisp Sourdough"] },
      { name: "Classic Espresso Tiramisu", price: "₹380", stars: 4, photo: "dessert", tags: ["Light", "Bold Coffee", "Melt in Mouth"] },
    ],
  },
  default: {
    name: "Artisan Kitchen & Craft Bar",
    category: "Modern European",
    area: "Downtown",
    rating: 4.8,
    dishes: [
      { name: "Signature Truffle Tagliolini", price: "$22.00", stars: 5, photo: "pasta", tags: ["Rich Truffle", "Al Dente", "Silky", "Must Try"] },
      { name: "Crispy Duck Arancini", price: "$14.50", stars: 5, photo: "bread", tags: ["Crispy", "Savory", "Great Portion"] },
      { name: "Matcha Basque Cheesecake", price: "$9.50", stars: 4, photo: "dessert", tags: ["Creamy", "Balanced", "Artisanal"] },
    ],
  },
};

export default function Demo() {
  const { slug } = useParams();
  const toast = useToast();
  const demoData = (slug && DEMO_PLACES[slug.toLowerCase()]) || DEMO_PLACES["bandra-bistro"] || DEMO_PLACES.default;

  const [selectedDishIndex, setSelectedDishIndex] = useState(0);
  const [currentRating, setCurrentRating] = useState<number>(5);
  const [selectedVibe, setSelectedVibe] = useState<"must_try" | "solid" | "skip">("must_try");
  const [activeTags, setActiveTags] = useState<string[]>(["Rich Truffle", "Al Dente"]);
  const [isCompilingAi, setIsCompilingAi] = useState(false);
  const [copiedGoogle, setCopiedGoogle] = useState(false);
  const [storySharing, setStorySharing] = useState(false);
  const [simulatedFeedbackSent, setSimulatedFeedbackSent] = useState(false);

  const curDish = demoData.dishes[selectedDishIndex] || demoData.dishes[0]!;

  const generatedReviewText =
    selectedVibe === "skip"
      ? `Had the ${curDish.name} at ${demoData.name}. It wasn't quite up to expectations today—the texture and portion could have been better.`
      : `The ${curDish.name} at ${demoData.name} was incredible! ${activeTags.join(", ")}, cooked to absolute perfection. One of the best dishes in ${demoData.area}. Highly recommend!`;

  const handleVibe = (vibe: "must_try" | "solid" | "skip") => {
    setSelectedVibe(vibe);
    if (vibe === "must_try") {
      setCurrentRating(5);
    } else if (vibe === "solid") {
      setCurrentRating(4);
    } else {
      setCurrentRating(2);
    }
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(10);
      }
    } catch {
      /* ignore */
    }
    setIsCompilingAi(true);
    setTimeout(() => setIsCompilingAi(false), 300);
  };

  const toggleTag = (t: string) => {
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
    setIsCompilingAi(true);
    setTimeout(() => setIsCompilingAi(false), 250);
  };

  const handleCopyGoogle = () => {
    navigator.clipboard.writeText(generatedReviewText);
    setCopiedGoogle(true);
    try { if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15); } catch {}
    toast("Review copied to clipboard");
    setTimeout(() => setCopiedGoogle(false), 2500);
  };

  const handleShareStory = async () => {
    setStorySharing(true);
    try {
      const file = await generateStoryCard({
        itemName: curDish.name,
        placeName: demoData.name,
        rating: currentRating,
        body: generatedReviewText,
      });

      if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Verified food story" });
      } else if (file) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = `${curDish.name.toLowerCase().replace(/\s+/g, "-")}-story.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast("Story card saved (1080×1920)");
      }
    } catch {
      /* ignore */
    } finally {
      setStorySharing(false);
    }
  };

  return (
    <div className="rvx" style={{ paddingBottom: 60 }}>
      <p className="tiny muted center" role="note" style={{ margin: "8px 16px 0" }}>Sample shop with made-up dishes and prices, to try the review flow. Nothing here is a real business or is saved.</p>
      {/* Clean Apple-style top navigation bar */}
      <nav className="rvx-bar" style={{ justifyContent: "space-between" }}>
        <RvxBack />
        <div className="stack tight center">
          <span className="strong" style={{ fontSize: 15, color: "var(--ink)" }}>Tabletop experience</span>
          <span className="tiny muted">{demoData.name}</span>
        </div>
        <Link to="/business" className="btn small quiet" style={{ fontSize: 13, color: "var(--champ)" }}>
          QR Kit
        </Link>
      </nav>

      <header className="rvx-hero" style={{ marginTop: 8 }}>
        <span className="rvx-verified">
          <Icon name="verified" size={14} /> Verified Tabletop Demo
        </span>
        <div className="rvx-kicker">{demoData.category} · {demoData.area}</div>
        <h1>{demoData.name}</h1>
        <div className="rvx-meta">
          <span className="rvx-pill">
            <Icon name="star" size={13} fill="#d9a441" color="#d9a441" /> {demoData.rating} on Google
          </span>
          <span className="rvx-pill">
            <Icon name="qr" size={13} /> Table #4 Stand
          </span>
        </div>
      </header>

      {/* Pre-Meal Hook */}
      <section className="rvx-sec">
        <div className="premeal-guide">
          <div className="premeal-head">
            <div className="stack tight">
              <strong style={{ fontSize: 15, color: "#fff" }}>Top recommended dishes</strong>
              <span className="tiny muted">Verified by guests who dined at this table</span>
            </div>
            <span className="premeal-badge">
              <Icon name="verified" size={12} /> Verified
            </span>
          </div>

          <div className="premeal-grid">
            {demoData.dishes.map((dish, i) => {
              const active = selectedDishIndex === i;
              const ranks = ["#1 Most Loved", "#2 Signature", "#3 Popular"];
              return (
                <button
                  key={dish.name}
                  type="button"
                  className={`premeal-card ${active ? "selected" : ""}`}
                  onClick={() => setSelectedDishIndex(i)}
                  aria-label={`Select ${dish.name}`}
                >
                  <span className={`premeal-rank ${i === 0 ? "gold" : ""}`}>{ranks[i]}</span>
                  <div className="premeal-thumb-wrap" style={{ display: "grid", placeItems: "center" }}>
                    <span style={{ fontSize: 32 }}>
                      {i === 0 ? "🍝" : i === 1 ? "🥖" : "🍰"}
                    </span>
                  </div>
                  <div className="premeal-info">
                    <span className="premeal-name">{dish.name}</span>
                    <div className="premeal-meta">
                      <span className="premeal-star">★ 4.9</span>
                      <span className="tiny muted">{dish.price}</span>
                    </div>
                    <span className="premeal-cta-pill">
                      {active ? "Selected" : "Tap to review"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Interactive Rating Flow */}
      <section className="rvx-sec">
        <h2>Rate what you <i>ate</i></h2>
        <div className="card soft">
          <div className="row between" style={{ marginBottom: 4 }}>
            <strong style={{ fontSize: 17, color: "var(--ink)" }}>{curDish.name}</strong>
            <span className="muted small">{curDish.price}</span>
          </div>

          {/* 3-Tier Vibe Reactions */}
          <div className="rvx-vibes">
            <button
              type="button"
              className={`rvx-vibe-pill must-try ${selectedVibe === "must_try" ? "on" : ""}`}
              onClick={() => handleVibe("must_try")}
              aria-label="Rate as Must Try"
            >
              <span>Must try</span>
            </button>
            <button
              type="button"
              className={`rvx-vibe-pill solid ${selectedVibe === "solid" ? "on" : ""}`}
              onClick={() => handleVibe("solid")}
              aria-label="Rate as solid pick"
            >
              <span>Solid pick</span>
            </button>
            <button
              type="button"
              className={`rvx-vibe-pill skip ${selectedVibe === "skip" ? "on" : ""}`}
              onClick={() => handleVibe("skip")}
              aria-label="Rate as skip it"
            >
              <span>Skip it</span>
            </button>
          </div>


          {/* Flavor Tags */}
          <span className="tiny muted" style={{ display: "block", marginBottom: 6 }}>
            Select flavor characteristics:
          </span>
          <div className="rvx-chips sm" style={{ marginBottom: 12 }}>
            {curDish.tags.map((t) => {
              const on = activeTags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  className={`chip ${on ? "on" : ""}`}
                  onClick={() => toggleTag(t)}
                >
                  {t}
                </button>
              );
            })}
          </div>

          {/* Live Review Preview */}
          <div className="card" style={{ background: "var(--card)", padding: 14 }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <span className="tiny muted strong">
                Google Review Preview
              </span>
              <span className="badge gray">Dish-Level</span>
            </div>
            <p className="small" style={{ margin: 0, color: "var(--ink)", lineHeight: 1.5 }}>
              {isCompilingAi ? "Updating review…" : `"${generatedReviewText}"`}
            </p>
          </div>
        </div>
      </section>

      {/* Dual Exit: Reputation Shield vs Google Bridge */}
      <section className="rvx-sec">
        {selectedVibe === "skip" ? (
          <div className="card" style={{ border: "1px solid var(--line)", padding: 18 }}>
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <span className="icon-chip sm coral"><Icon name="shield" size={16} /></span>
              <div className="grow stack tight">
                <strong style={{ fontSize: 16 }}>Private note to the owner</strong>
                <span className="tiny muted">Message the chef or management directly</span>
              </div>
            </div>
            <p className="small muted" style={{ margin: "6px 0 10px 0", lineHeight: 1.45 }}>
              Something not right? Send a private note to the kitchen so they can prepare a dining voucher or resolve the issue immediately.
            </p>
            {!simulatedFeedbackSent ? (
              <button
                type="button"
                className="btn small danger block"
                onClick={() => {
                  setSimulatedFeedbackSent(true);
                  toast("Private message sent to manager dashboard");
                }}
              >
                <Icon name="message" size={15} /> Send Private Note to Chef
              </button>
            ) : (
              <div className="notice ok row" style={{ gap: 8 }}>
                <Icon name="check" size={14} /> Note delivered privately to restaurant management.
              </div>
            )}
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--line)" }}>
              <button type="button" className="btn quiet small block" onClick={handleCopyGoogle}>
                <Icon name="external" size={14} /> Open Public Google Reviews
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 18 }}>
            <div className="row" style={{ alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span className="icon-chip sm amber">
                <Icon name="star" size={18} />
              </span>
              <div className="grow stack tight">
                <strong style={{ fontSize: 16 }}>1-Tap Google Review</strong>
                <span className="tiny muted">Copies dish feedback and opens Google Maps</span>
              </div>
            </div>
            <button type="button" className="btn green block" onClick={handleCopyGoogle}>
              <Icon name="copy" size={16} />
              <span>{copiedGoogle ? "Copied! Ready to paste" : "Copy Review & Open Google"}</span>
            </button>
          </div>
        )}
      </section>

      {/* Digital VIP Table Pass */}
      <section className="rvx-sec">
      </section>

      {/* Instagram Story Share Action */}
      <section className="rvx-sec">
        <button
          type="button"
          className="btn ghost block"
          onClick={handleShareStory}
          disabled={storySharing}
        >
          <Icon name="share" size={16} />
          <span>{storySharing ? "Making your card…" : "Share"}</span>
        </button>
      </section>

      {/* Head-to-Head Modal */}
    </div>
  );
}
