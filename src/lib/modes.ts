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
    grad: "linear-gradient(135deg, #9c4733 0%, #ee6c4d 55%, #ffb38a 100%)",
    catalog: "Menu", item: "dish", itemPlural: "dishes", ratePrompt: "What did you have?", itemExample: "Fish curry",
    sections: ["Starters", "Mains", "Breads", "Desserts", "Drinks"],
  },
  store: {
    kind: "store", label: "Shop", icon: "bag", tint: "sky",
    grad: "linear-gradient(135deg, #37609a 0%, #3a86ff 55%, #9cc4ff 100%)",
    catalog: "Products", item: "product", itemPlural: "products", ratePrompt: "What did you buy?", itemExample: "Cotton kurta",
    sections: ["New arrivals", "Best sellers", "Offers"],
  },
  beauty: {
    kind: "beauty", label: "Salon & spa", icon: "scissors", tint: "violet",
    grad: "linear-gradient(135deg, #54489a 0%, #7b5cff 55%, #c9b8ff 100%)",
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
    grad: "linear-gradient(135deg, #9c3820 0%, #c2492b 55%, #d9a441 100%)",
    catalog: "Services", item: "service", itemPlural: "services", ratePrompt: "What did they do for you?", itemExample: "AC service",
    sections: ["Services", "Packages"],
  },
  other: {
    kind: "other", label: "Other business", icon: "store", tint: "green",
    grad: "linear-gradient(135deg, #c2492b 0%, #d4623f 55%, #d9a441 100%)",
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

/**
 * How each business type runs day to day: what a QR spot is called and where it goes, what its
 * customers are called, the quick review tags for a visit, and examples that fit (deals, stamp rewards).
 * Every visit tag here is a row in the tags table (kind "visit", migration 53).
 */
export type VisitVerdict = "meh" | "ok" | "good" | "love";
type VisitTags = Record<VisitVerdict, { title: string; tags: string[] }>;
export type DealHintKind = "percent" | "flat" | "free" | "bogo" | "happy_hour" | "other";

export interface Biz {
  /** one QR spot ("table", "chair") and where the codes go */
  spot: string;
  spots: string;
  qrWhere: string;
  /** what its customers are called */
  customer: string;
  customers: string;
  visitTags: VisitTags;
  dealHints: Record<DealHintKind, string>;
  /** the timed deal: "Happy hour" for food and drink, "Quiet hours" elsewhere */
  timedDeal: string;
  stampReward: string;
  /** Services mostly work at the customer's place, so a one-time review link comes before table QRs. */
  linkFirst: boolean;
  /** "Who were you with?" fits a meal, not a dentist. */
  socialVisit: boolean;
}

const T = (meh: string[], ok: string[], good: string[], love: string[]): VisitTags => ({
  meh: { title: "What let it down?", tags: meh },
  ok: { title: "What stood out?", tags: ok },
  good: { title: "What was good?", tags: good },
  love: { title: "What made it great?", tags: love },
});

export const BIZ: Record<Kind, Biz> = {
  food: {
    spot: "table", spots: "tables", qrWhere: "on every table or at the counter", customer: "diner", customers: "diners",
    visitTags: T(["Poor food", "Poor service", "Long wait", "Noisy", "Too pricey", "Not clean"], ["Food", "Service", "Value", "Long wait", "Too pricey", "Noisy"],
      ["Food", "Service", "Ambience", "Value", "Quick"], ["Amazing food", "Lovely staff", "Great vibe", "Great value", "Super quick"]),
    dealHints: { percent: "on all pizzas", flat: "on bills over 500", free: "Tiramisu with any pizza", bogo: "on all lemonades", happy_hour: "2 for 1 drinks", other: "Kids eat free on Sundays" },
    timedDeal: "Happy hour", stampReward: "a free dessert", linkFirst: false, socialVisit: true,
  },
  store: {
    spot: "counter", spots: "counters", qrWhere: "at the billing counter or on the bill", customer: "customer", customers: "customers",
    visitTags: T(["Poor quality", "Pushy selling", "Long wait", "Unhelpful staff", "Too pricey"], ["Good variety", "Staff", "Value", "Long wait", "Too pricey"],
      ["Good variety", "Genuine products", "Helpful staff", "Value", "Quick"], ["Great variety", "Lovely staff", "Great value", "Genuine products", "Easy returns"]),
    dealHints: { percent: "on the new collection", flat: "on bills over 2000", free: "Free gift wrap", bogo: "on all socks", happy_hour: "Extra 10% off on weekday mornings", other: "Free alteration on any kurta" },
    timedDeal: "Quiet hours", stampReward: "₹200 off your next bill", linkFirst: false, socialVisit: false,
  },
  beauty: {
    spot: "chair", spots: "chairs", qrWhere: "at each mirror or at reception", customer: "client", customers: "clients",
    visitTags: T(["Not happy with result", "Long wait", "Rushed", "Not clean", "Overcharged"], ["Result", "Staff", "Hygienic", "Value", "Long wait"],
      ["Great result", "Skilled staff", "Hygienic", "Relaxing", "On time"], ["Loved the result", "Skilled staff", "So relaxing", "Spotless", "Great value"]),
    dealHints: { percent: "on hair colour", flat: "on facials over 1500", free: "Free head massage with any haircut", bogo: "on manicures", happy_hour: "20% off on weekday afternoons", other: "Bring a friend, both get 10% off" },
    timedDeal: "Quiet hours", stampReward: "a free haircut", linkFirst: false, socialVisit: false,
  },
  health: {
    spot: "desk", spots: "desks", qrWhere: "at reception or in the waiting area", customer: "patient", customers: "patients",
    visitTags: T(["Long wait", "Rushed", "Didn't explain", "Not clean", "Overcharged"], ["Doctor", "Staff", "Short wait", "Clean", "Fees"],
      ["Caring doctor", "Explains clearly", "Short wait", "Clean", "Helpful staff"], ["Caring doctor", "Explains clearly", "Felt better", "Spotless", "Kind staff"]),
    dealHints: { percent: "on full body checkups", flat: "on dental cleaning", free: "Free BP and sugar check", bogo: "on eye tests for families", happy_hour: "10% off morning appointments", other: "Free follow-up within 7 days" },
    timedDeal: "Quiet hours", stampReward: "a free checkup", linkFirst: false, socialVisit: false,
  },
  fitness: {
    spot: "counter", spots: "counters", qrWhere: "at the front desk or in the studio", customer: "member", customers: "members",
    visitTags: T(["Crowded", "Old equipment", "Not clean", "Pushy selling", "Unhelpful staff"], ["Trainers", "Equipment", "Clean", "Value", "Crowded"],
      ["Good trainers", "Good equipment", "Clean", "Good vibe", "Value"], ["Great trainers", "Great equipment", "Great vibe", "Spotless", "Great value"]),
    dealHints: { percent: "on 3-month memberships", flat: "on yearly plans", free: "Free trial class", bogo: "Bring a friend free", happy_hour: "Off-peak plan 30% off", other: "Free diet plan with any membership" },
    timedDeal: "Off-peak hours", stampReward: "a free personal training session", linkFirst: false, socialVisit: false,
  },
  education: {
    spot: "class", spots: "classrooms", qrWhere: "in each classroom or at the front desk", customer: "student", customers: "students",
    visitTags: T(["Rushed", "Late", "Didn't explain", "Too pricey", "Crowded classes"], ["Teachers", "Explains clearly", "Value for fees", "Personal attention", "Late"],
      ["Good teachers", "Explains clearly", "Personal attention", "Value for fees", "On time"], ["Great teachers", "Explains clearly", "Personal attention", "Great results", "Value for fees"]),
    dealHints: { percent: "on the full course fee", flat: "on early sign-up", free: "Free demo class", bogo: "Siblings join at half fee", happy_hour: "Weekend batch 10% off", other: "Free study material with any course" },
    timedDeal: "Quiet hours", stampReward: "a free extra class", linkFirst: false, socialVisit: false,
  },
  services: {
    spot: "card", spots: "cards", qrWhere: "on your bill, visiting card or van", customer: "customer", customers: "customers",
    visitTags: T(["Late", "Overcharged", "Poor quality", "Didn't fix it", "Rude staff"], ["On time", "Fair quote", "Quality", "Staff", "Late"],
      ["On time", "Fair quote", "Did it right first time", "Skilled staff", "Tidy work"], ["Did it right first time", "On time", "Fair quote", "Tidy work", "Lovely staff"]),
    dealHints: { percent: "on your first service", flat: "on AC service over 1000", free: "Free inspection with any repair", bogo: "Second appliance at half price", happy_hour: "Weekday visits 10% off", other: "Free 30-day redo if it isn't right" },
    timedDeal: "Quiet hours", stampReward: "a free service visit", linkFirst: true, socialVisit: false,
  },
  other: {
    spot: "counter", spots: "counters", qrWhere: "at your counter or on the bill", customer: "customer", customers: "customers",
    visitTags: T(["Poor service", "Long wait", "Unhelpful staff", "Too pricey", "Not clean"], ["Service", "Staff", "Value", "Long wait", "Too pricey"],
      ["Service", "Staff", "Value", "Quick", "Clean"], ["Great service", "Lovely staff", "Great vibe", "Great value", "Super quick"]),
    dealHints: { percent: "on everything this week", flat: "on bills over 500", free: "A free extra with any order", bogo: "on our best seller", happy_hour: "10% off on weekday mornings", other: "Bring a friend, both save" },
    timedDeal: "Quiet hours", stampReward: "a free extra", linkFirst: false, socialVisit: false,
  },
};

export const bizOf = (kind: string | null | undefined, category?: string | null): Biz => BIZ[modeOf(kind, category).kind];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Table", "Chair", "Card": the default name of one QR code. */
export const spotLabel = (b: Biz) => cap(b.spot);
