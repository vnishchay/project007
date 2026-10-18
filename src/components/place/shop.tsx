import { MODES, type Kind } from "../../lib/modes";
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
  diet?: string[] | null;
}

export const ITEM_COLS = "id, place_id, topic_id, name, image_path, description, price_inr, sort_order, is_listed, is_hidden, diet";
export const ITEM_COLS_LEGACY = "id, place_id, topic_id, name, image_path, description, price_inr, sort_order, is_listed, is_hidden";

export type DietType = "veg" | "non_veg" | "egg" | "vegan" | "jain" | "gluten_free";
export const DIET_OPTIONS: { id: DietType; label: string; color: string }[] = [
  { id: "veg", label: "Veg", color: "#16a34a" },
  { id: "non_veg", label: "Non-Veg", color: "#dc2626" },
  { id: "egg", label: "Egg", color: "#ca8a04" },
  { id: "vegan", label: "Vegan", color: "#059669" },
  { id: "jain", label: "Jain", color: "#ea580c" },
  { id: "gluten_free", label: "Gluten-Free", color: "#64748b" },
];

export function DietDot({ diet }: { diet?: string[] | null }) {
  if (!diet || !diet.length) return null;
  const isVeg = diet.includes("veg") || diet.includes("vegan");
  const isNonVeg = diet.includes("non_veg");
  const isEgg = diet.includes("egg");
  if (!isVeg && !isNonVeg && !isEgg) return null;

  const color = isNonVeg ? "#dc2626" : isEgg ? "#ca8a04" : "#16a34a";
  const title = isNonVeg ? "Non-Vegetarian" : isEgg ? "Contains Egg" : "Vegetarian";

  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 13,
        height: 13,
        border: `1.5px solid ${color}`,
        borderRadius: 2.5,
        padding: 1.5,
        flexShrink: 0,
        verticalAlign: "middle",
        marginRight: 4,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: isNonVeg ? 1 : "50%",
          backgroundColor: color,
        }}
      />
    </span>
  );
}

/** The database hasn't been updated with the shop columns yet. */
export function missingColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist/i.test(e.message || "")));
}

/** Products a place shows (not hidden), shop-listed ones first. */
export async function loadShopItems(placeId: string): Promise<{ items: ShopItem[]; error: { message: string; code?: string } | null }> {
  let r: { data: Record<string, unknown>[] | null; error: { message: string; code?: string } | null } =
    await supabase.from("items").select(ITEM_COLS).eq("place_id", placeId).eq("is_hidden", false) as any;
  if (missingColumn(r.error)) {
    r = await supabase.from("items").select(ITEM_COLS_LEGACY).eq("place_id", placeId).eq("is_hidden", false) as any;
  }
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
    diet: Array.isArray(x.diet) ? (x.diet as string[]) : null,
  };
}

/** Listed products by the shop's order, then customer-named ones by how often they're reviewed. */
export function sortShopItems<T extends ShopItem>(items: T[], count: (i: T) => number = () => 0): T[] {
  const listed = items.filter((i) => i.is_listed).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const rest = items.filter((i) => !i.is_listed).sort((a, b) => Number(Boolean(b.image_path)) - Number(Boolean(a.image_path)) || count(b) - count(a) || a.name.localeCompare(b.name));
  return [...listed, ...rest];
}

export interface ShopLook { icon: IconName; grad: string; tint: string; menu: string }

/** Icon, colours and catalogue name for a shop, from its business type, then its category. */
export function shopLook(category: string | null | undefined, kind?: string | null): ShopLook {
  const c = (category || "").toLowerCase();
  if (kind && kind !== "food" && kind !== "other" && kind in MODES) {
    const m = MODES[kind as Kind];
    return { icon: m.icon, grad: m.grad, tint: m.tint === "green" ? "" : m.tint, menu: m.catalog };
  }
  if (/salon|barber|spa|beauty|hair|nail|parlour|parlor/.test(c)) return { icon: "scissors", grad: "linear-gradient(135deg, #54489a 0%, #7b5cff 55%, #c3b5ff 100%)", tint: "violet", menu: "Services" };
  if (/cafe|café|coffee|tea|chai/.test(c)) return { icon: "coffee", grad: "linear-gradient(135deg, #6b3f1d 0%, #a0622d 55%, #f3a712 100%)", tint: "amber", menu: "Menu" };
  if (/bakery|cake|dessert|sweet|patisserie|ice cream/.test(c)) return { icon: "cake", grad: "linear-gradient(135deg, #9c4733 0%, #ee6c4d 55%, #ffc9a8 100%)", tint: "coral", menu: "Menu" };
  if (/restaurant|pizz|food|biryani|kitchen|dhaba|bar|grill|diner|eat|bistro|mess/.test(c)) return { icon: "food", grad: "linear-gradient(135deg, #9c4733 0%, #ee6c4d 50%, #f3a712 100%)", tint: "coral", menu: "Menu" };
  if (/shop|store|boutique|mart|cloth|fashion|gift|book/.test(c)) return { icon: "bag", grad: "linear-gradient(135deg, #37609a 0%, #3a86ff 55%, #9cc3ff 100%)", tint: "sky", menu: "Products" };
  return { icon: "store", grad: "var(--grad-hero)", tint: "", menu: "Products" };
}

export function priceLabel(n: number | null | undefined): string | null {
  return n == null ? null : `₹${n.toLocaleString("en-IN")}`;
}
