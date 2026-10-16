import { supabase } from "../../lib/supabase";
import type { IconName } from "../ui";

/** A product at a shop. Before the shop columns exist, only id, name and topic_id are filled. */
export interface ShopItem {
  id: string;
  name: string;
  topic_id: number | null;
  image_path: string | null;
  description: string | null;
  price_inr: number | null;
  sort_order: number;
  is_listed: boolean;
}

export const ITEM_COLS = "id, place_id, topic_id, name, image_path, description, price_inr, sort_order, is_listed, is_hidden";

/** The database hasn't been updated with the shop columns yet. */
export function missingColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist/i.test(e.message || "")));
}

/** Products a place shows (not hidden), shop-listed ones first. */
export async function loadShopItems(placeId: string): Promise<{ items: ShopItem[]; error: { message: string; code?: string } | null }> {
  const r = await supabase.from("items").select(ITEM_COLS).eq("place_id", placeId).eq("is_hidden", false);
  if (!r.error) return { items: (r.data || []).map(toItem), error: null };
  if (!missingColumn(r.error)) return { items: [], error: r.error };
  const old = await supabase.from("items").select("id, name, topic_id").eq("place_id", placeId);
  return { items: (old.data || []).map(toItem), error: old.error };
}

function toItem(x: Record<string, unknown>): ShopItem {
  return {
    id: x.id as string,
    name: x.name as string,
    topic_id: (x.topic_id as number | null) ?? null,
    image_path: (x.image_path as string | null) ?? null,
    description: (x.description as string | null) ?? null,
    price_inr: (x.price_inr as number | null) ?? null,
    sort_order: (x.sort_order as number | null) ?? 0,
    is_listed: Boolean(x.is_listed),
  };
}

/** Listed products by the shop's order, then customer-named ones by how often they're reviewed. */
export function sortShopItems<T extends ShopItem>(items: T[], count: (i: T) => number = () => 0): T[] {
  const listed = items.filter((i) => i.is_listed).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const rest = items.filter((i) => !i.is_listed).sort((a, b) => Number(Boolean(b.image_path)) - Number(Boolean(a.image_path)) || count(b) - count(a) || a.name.localeCompare(b.name));
  return [...listed, ...rest];
}

export interface ShopLook { icon: IconName; grad: string; tint: string; menu: string }

/** Icon and colours for a kind of shop, used when it has no photos. */
export function shopLook(category: string | null | undefined): ShopLook {
  const c = (category || "").toLowerCase();
  if (/salon|barber|spa|beauty|hair|nail|parlour|parlor/.test(c)) return { icon: "scissors", grad: "linear-gradient(135deg, #5634e0 0%, #7b5cff 55%, #c3b5ff 100%)", tint: "violet", menu: "Services" };
  if (/cafe|café|coffee|tea|chai/.test(c)) return { icon: "coffee", grad: "linear-gradient(135deg, #6b3f1d 0%, #a0622d 55%, #f3a712 100%)", tint: "amber", menu: "Menu" };
  if (/bakery|cake|dessert|sweet|patisserie|ice cream/.test(c)) return { icon: "cake", grad: "linear-gradient(135deg, #b2401f 0%, #ee6c4d 55%, #ffc9a8 100%)", tint: "coral", menu: "Menu" };
  if (/restaurant|pizz|food|biryani|kitchen|dhaba|bar|grill|diner|eat|bistro|mess/.test(c)) return { icon: "food", grad: "linear-gradient(135deg, #b2401f 0%, #ee6c4d 50%, #f3a712 100%)", tint: "coral", menu: "Menu" };
  if (/shop|store|boutique|mart|cloth|fashion|gift|book/.test(c)) return { icon: "bag", grad: "linear-gradient(135deg, #1d5fd1 0%, #3a86ff 55%, #9cc3ff 100%)", tint: "sky", menu: "Products" };
  return { icon: "store", grad: "var(--grad-hero)", tint: "", menu: "Products" };
}

export function priceLabel(n: number | null | undefined): string | null {
  return n == null ? null : `₹${n.toLocaleString("en-IN")}`;
}
