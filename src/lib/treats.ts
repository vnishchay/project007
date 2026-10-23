import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { formatPrice } from "./money";

// Offers, shop deals and stamp cards ("treats"): what a shop page shows, what your pocket holds,
// and how each one reads on a ticket. Nothing here depends on reviewing.

export type DealKind = "percent" | "flat" | "free" | "bogo" | "happy_hour" | "other";

export interface Deal {
  id: string; place_id: string; kind: DealKind; amount: number | null; title: string; terms: string | null;
  days: number[] | null; starts_at: string | null; ends_at: string | null; valid_until: string | null;
  per_person: "daily" | "once"; on_now: boolean; ends_ts: string | null; used_at: string | null;
  place_name?: string; logo_path?: string | null;
}
export interface Offer {
  id: string; body: string; link_url: string | null; created_at: string; valid_till: string; seen: boolean; used_at: string | null;
  place_id?: string; place_name?: string; logo_path?: string | null;
}
export interface Stamps {
  place_id: string; goal: number; reward: string; stamps: number; days: string[]; today: boolean; used: number;
  place_name?: string; logo_path?: string | null;
}
export interface Used { kind: "offer" | "deal" | "stamps"; place_id: string; place_name: string; title: string; deal_kind?: DealKind; amount?: number | null; used_at: string }
export interface Treats { deals: Deal[]; offers: Offer[]; stamps: Stamps | null }
export interface Pocket { offers: Offer[]; deals: Deal[]; stamps: Stamps[]; used: Used[] }

/** One kind's look: the colour of its ticket and the small word above the big one. */
export const KINDS: Record<DealKind, { label: string; tone: string; icon: "tag" | "banknote" | "gift" | "zap" | "clock" | "ticket" }> = {
  percent: { label: "% off", tone: "ink", icon: "tag" },
  flat: { label: "Money off", tone: "violet", icon: "banknote" },
  free: { label: "Free item", tone: "gold", icon: "gift" },
  bogo: { label: "2 for 1", tone: "sky", icon: "zap" },
  happy_hour: { label: "Happy hour", tone: "green", icon: "clock" },
  other: { label: "Something else", tone: "coral", icon: "ticket" },
};

/** The big words on the ticket: "20% OFF", "₹100 OFF", "FREE", "2 for 1". */
export function dealHeadline(d: Pick<Deal, "kind" | "amount" | "title">, currency?: string | null): string {
  switch (d.kind) {
    case "percent": return `${Math.round(Number(d.amount) || 0)}% OFF`;
    case "flat": return `${formatPrice(d.amount, currency) ?? ""} OFF`;
    case "free": return "FREE";
    case "bogo": return "2 for 1";
    case "happy_hour": return "Happy hour";
    default: return d.title;
  }
}
/** The line under it. For "other", the title is already the headline. */
export const dealLine = (d: Pick<Deal, "kind" | "title">) => (d.kind === "other" ? "" : d.title);

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "4 pm", "4:30 pm" from "16:00", in the phone's own style. */
export function clockText(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: m ? "2-digit" : undefined });
}
/** When it runs: "Every Tue", "Mon–Fri · 4 pm–7 pm", "Every day". */
export function dealWhen(d: Pick<Deal, "days" | "starts_at" | "ends_at">): string {
  const days = d.days && d.days.length < 7 ? [...d.days].sort((a, b) => a - b) : null;
  let dayText = "Every day";
  if (days) {
    const run = days.length > 2 && days.every((x, i) => i === 0 || x === days[i - 1]! + 1);
    dayText = days.length === 1 ? `Every ${DAY[days[0]!]}` : run ? `${DAY[days[0]!]}–${DAY[days[days.length - 1]!]}` : days.map((x) => DAY[x]).join(", ");
    if (days.length === 5 && days.join() === "1,2,3,4,5") dayText = "Weekdays";
    if (days.length === 2 && days.join() === "0,6") dayText = "Weekends";
  }
  return d.starts_at && d.ends_at ? `${dayText} · ${clockText(d.starts_at)}–${clockText(d.ends_at)}` : dayText;
}
export function dateText(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** "1:42:10" or "12 min" until a time. */
export function untilText(ts: string, now: number): string {
  const s = Math.max(0, Math.floor((new Date(ts).getTime() - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** The time now, ticking every `ms` (for countdowns and the counter clock). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

const EMPTY: Treats = { deals: [], offers: [], stamps: null };
/** A shop's deals, stamp card and my offers there. Empty (never an error) on a database without migration 50. */
export async function loadTreats(placeId: string): Promise<Treats> {
  const { data, error } = await supabase.rpc("place_treats", { p_place: placeId });
  if (error || !data) return EMPTY;
  const t = data as Partial<Treats>;
  return { deals: t.deals || [], offers: t.offers || [], stamps: t.stamps || null };
}

export async function loadPocket(): Promise<Pocket | null> {
  const { data, error } = await supabase.rpc("my_pocket");
  if (error || !data) return null;
  const p = data as Partial<Pocket>;
  return { offers: p.offers || [], deals: p.deals || [], stamps: p.stamps || [], used: p.used || [] };
}

/** Unwrapping an offer is what marks it seen. */
export function markUnwrapped(id: string) {
  return supabase.rpc("mark_offers_seen", { p_ids: [id] }).then(() => {}, () => {});
}

/** Using something at the counter: an offer, a deal or a stamp reward. Returns when it was used. */
export type Usable = { kind: "offer"; id: string } | { kind: "deal"; id: string } | { kind: "stamps"; placeId: string };
export async function redeemTreat(u: Usable): Promise<string> {
  const r = u.kind === "offer" ? await supabase.rpc("use_offer", { p_id: u.id })
    : u.kind === "deal" ? await supabase.rpc("use_deal", { p_deal: u.id })
    : await supabase.rpc("use_stamp_reward", { p_place: u.placeId });
  if (r.error) throw r.error;
  return String(r.data || new Date().toISOString());
}
