import type { IconName } from "../components/ui";

/**
 * Business types ("modes"). Each one decides the words and sections a business page shows,
 * what customers rate, and which review tags they see. Stored in places.kind.
 */
export type Kind = "food" | "store" | "beauty" | "health" | "fitness" | "education" | "services" | "other";

export interface Mode {
  kind: Kind;
  /** what the business type is called ("Restaurant & cafe") */
  label: string;
  icon: IconName;
  /** colour of the hero when there's no cover photo */
  grad: string;
  tint: "green" | "amber" | "coral" | "sky" | "violet";
  /** the list of things it offers ("Menu", "Plans & classes") */
  catalog: string;
  /** one of those things ("dish", "plan") */
  item: string;
  itemPlural: string;
  /** what the review screen asks ("What did you have?") */
  ratePrompt: string;
  /** placeholder for a product name in the manager */
  itemExample: string;
  /** suggested sections for products */
  sections: string[];
}

export const MODES: Record<Kind, Mode> = {
  food: {
    kind: "food", label: "Restaurant & cafe", icon: "food", tint: "coral",
    grad: "linear-gradient(135deg, #b2401f 0%, #ee6c4d 55%, #ffb38a 100%)",
    catalog: "Menu", item: "dish", itemPlural: "dishes", ratePrompt: "What did you have?", itemExample: "Fish curry",
    sections: ["Starters", "Mains", "Breads", "Desserts", "Drinks"],
  },
  store: {
    kind: "store", label: "Shop", icon: "bag", tint: "sky",
    grad: "linear-gradient(135deg, #1d5fd1 0%, #3a86ff 55%, #9cc4ff 100%)",
    catalog: "Products", item: "product", itemPlural: "products", ratePrompt: "What did you buy?", itemExample: "Cotton kurta",
    sections: ["New arrivals", "Best sellers", "Offers"],
  },
  beauty: {
    kind: "beauty", label: "Salon & spa", icon: "scissors", tint: "violet",
    grad: "linear-gradient(135deg, #5634e0 0%, #7b5cff 55%, #c9b8ff 100%)",
    catalog: "Services", item: "service", itemPlural: "services", ratePrompt: "What did you get done?", itemExample: "Haircut and beard trim",
    sections: ["Hair", "Skin", "Nails", "Packages"],
  },
  health: {
    kind: "health", label: "Clinic & health", icon: "heart", tint: "sky",
    grad: "linear-gradient(135deg, #0f766e 0%, #14b8a6 55%, #99f6e4 100%)",
    catalog: "Services", item: "service", itemPlural: "services", ratePrompt: "What was your visit for?", itemExample: "General consultation",
    sections: ["Consultations", "Tests", "Treatments"],
  },
  fitness: {
    kind: "fitness", label: "Gym & studio", icon: "flame", tint: "amber",
    grad: "linear-gradient(135deg, #9a3412 0%, #f97316 55%, #fdba74 100%)",
    catalog: "Plans & classes", item: "plan or class", itemPlural: "plans and classes", ratePrompt: "What did you try?", itemExample: "Monthly membership",
    sections: ["Memberships", "Classes", "Personal training", "Trainers"],
  },
  education: {
    kind: "education", label: "School & coaching", icon: "award", tint: "green",
    grad: "linear-gradient(135deg, #1e3a8a 0%, #4f46e5 55%, #a5b4fc 100%)",
    catalog: "Courses", item: "course", itemPlural: "courses", ratePrompt: "Which course or teacher?", itemExample: "Class 10 maths",
    sections: ["Courses", "Batches", "Teachers", "Fees"],
  },
  services: {
    kind: "services", label: "Services", icon: "settings", tint: "green",
    grad: "linear-gradient(135deg, #b53213 0%, #e8491f 55%, #ffc23f 100%)",
    catalog: "Services", item: "service", itemPlural: "services", ratePrompt: "What did they do for you?", itemExample: "AC service",
    sections: ["Services", "Packages"],
  },
  other: {
    kind: "other", label: "Other business", icon: "store", tint: "green",
    grad: "linear-gradient(135deg, #e8491f 0%, #ff7a3d 55%, #ffc23f 100%)",
    catalog: "What we offer", item: "item", itemPlural: "items", ratePrompt: "What did you try?", itemExample: "Your best seller",
    sections: [],
  },
};

export const KINDS = Object.keys(MODES) as Kind[];

export function modeOf(kind: string | null | undefined, category?: string | null): Mode {
  if (kind && kind in MODES && kind !== "other") return MODES[kind as Kind];
  return MODES[guessKind(category)];
}

/** Same rules as the database's guess_place_kind(). */
export function guessKind(category: string | null | undefined): Kind {
  const c = (category || "").toLowerCase();
  if (/restaurant|cafe|café|coffee|bakery|cake|pizz|biryani|dhaba|bar|pub|kitchen|food|sweet|dessert|juice|tea|mess|tiffin|caterer/.test(c)) return "food";
  if (/salon|spa|beauty|parlour|parlor|barber|nail|makeup|tattoo/.test(c)) return "beauty";
  if (/gym|fitness|yoga|studio|dance|martial|crossfit|pilates|sports|swim/.test(c)) return "fitness";
  if (/school|coaching|tuition|class|academy|institute|college|tutor|learning/.test(c)) return "education";
  if (/clinic|doctor|dental|dentist|hospital|physio|pharmacy|chemist|vet|diagnostic|lab/.test(c)) return "health";
  if (/shop|store|mart|boutique|retail|grocery|kirana|electronics|book|fashion|jewel|optical|hardware|florist/.test(c)) return "store";
  if (/repair|service|laundry|tailor|cleaning|mechanic|garage|plumber|electrician|travel|photograph/.test(c)) return "services";
  return "other";
}

/** Review tags that fit a business type (tags.kinds null = every type). */
export function tagFits(tag: { kinds?: string[] | null }, kind: Kind): boolean {
  return !tag.kinds || tag.kinds.length === 0 || tag.kinds.includes(kind);
}

/** wa.me link, optionally with a ready-typed message. */
export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/** "9812345678" or "+91 98123 45678" -> "919812345678"; null if it isn't a phone number. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (!input.trim().startsWith("+")) {
    d = d.replace(/^0+/, "");
    if (d.length === 10) d = "91" + d;
  }
  return d.length >= 10 && d.length <= 15 ? d : null;
}
