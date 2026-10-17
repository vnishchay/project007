// Vercel serverless function: reads photos of a shop's menu or price list and returns
// the products on it, for the owner to check before they're saved. Only the shop's
// owner (or an admin) can call it; the photos are sent to Claude and not kept.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const SYSTEM = `You read photos of menus, price lists and rate cards from local shops in India
(restaurants, cafes, bakeries, salons, stores) and list every product or service on them.
Copy names as printed, fixing only obvious OCR-style mistakes; keep the original language if it isn't English.
price_inr is the price in rupees as a whole number, or null if there's no clear price. If an item has several
sizes or prices, use the smallest and put the others in the description (e.g. "Half 180, Full 320").
section is the heading it appears under ("Starters", "Haircuts"), or "" if none. description is a short line
printed with the item, or "". Skip headings, taxes, phone numbers and offers that aren't products.
If the photos aren't a menu or price list, return an empty list.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "price_inr", "section", "description"],
        properties: {
          name: { type: "string" },
          price_inr: { type: ["integer", "null"] },
          section: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
};

type Img = { data: string; media_type: "image/jpeg" | "image/png" | "image/webp" };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Menu reading isn't set up yet. Add products one by one for now." });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !sbUrl || !sbKey) return res.status(401).json({ error: "Sign in first" });

  const b = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}) as { placeId?: string; images?: Img[] };
  const placeId = typeof b.placeId === "string" ? b.placeId : "";
  const images = (Array.isArray(b.images) ? b.images : [])
    .filter((i) => i && typeof i.data === "string" && ["image/jpeg", "image/png", "image/webp"].includes(i.media_type))
    .slice(0, 4);
  if (!placeId || !images.length) return res.status(400).json({ error: "Add a photo of your menu" });

  // Check as the caller: only the shop's owner or an admin may import.
  const sb = createClient(sbUrl, sbKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: allowed, error: permError } = await sb.rpc("can_manage_place", { p_place: placeId });
  if (permError || allowed !== true) return res.status(403).json({ error: "Only the shop owner can do this" });

  try {
    const client = new Anthropic();
    const params = {
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
          { type: "text", text: "List the products on this menu." },
        ],
      }],
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    const msg = await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0]) as Anthropic.Beta.BetaMessage;
    if (msg.stop_reason === "refusal") return res.status(422).json({ error: "Couldn't read this photo. Try a clearer one." });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const parsed = JSON.parse(text) as { items: { name: string; price_inr: number | null; section: string; description: string }[] };
    const items = parsed.items
      .map((i) => ({
        name: String(i.name || "").replace(/\s+/g, " ").trim().slice(0, 80),
        price_inr: Number.isFinite(i.price_inr) && (i.price_inr as number) >= 0 ? Math.round(i.price_inr as number) : null,
        section: String(i.section || "").trim().slice(0, 40),
        description: String(i.description || "").trim().slice(0, 160),
      }))
      .filter((i) => i.name)
      .slice(0, 300);
    return res.status(200).json({ items });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Busy right now. Try again in a minute." });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: "Menu reading isn't available right now." });
    return res.status(500).json({ error: "Couldn't read the menu. Try again or add products by hand." });
  }
}
