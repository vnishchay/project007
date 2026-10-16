// Vercel serverless function: drafts a short review from what the user picked.
// Only signed-in users can call it (their Supabase token is checked), and only
// the item, rating, tags and notes are sent to Claude.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const SYSTEM = `You write short, honest customer reviews for a local-recommendations app in India.
Write in the first person as the customer, in plain everyday English, 2 to 3 sentences, under 60 words.
Use only what the customer told you: the item, the star rating, the tags and their notes. Never invent details,
prices, staff names or dishes they didn't mention. Match the tone to the stars: 1-2 stars is a fair complaint,
3 is mixed, 4-5 is warm. No hashtags, no emojis, no quotation marks. Reply with the review text only.`;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI drafts aren't set up yet. Write it yourself for now." });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !sbUrl || !sbKey) return res.status(401).json({ error: "Sign in to use AI drafts" });
  const { data: user, error: authError } = await createClient(sbUrl, sbKey).auth.getUser(token);
  if (authError || !user.user) return res.status(401).json({ error: "Sign in to use AI drafts" });

  const b = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}) as Record<string, unknown>;
  const item = clean(b.item, 80);
  const rating = Math.max(1, Math.min(5, Math.round(Number(b.rating) || 0)));
  if (!item || !Number(b.rating)) return res.status(400).json({ error: "Pick what you had and give it stars first." });
  const tags = Array.isArray(b.tags) ? b.tags.map((t) => clean(t, 30)).filter(Boolean).slice(0, 8) : [];
  const facts = [
    `Place: ${clean(b.place, 80) || "a local place"}${b.category ? ` (${clean(b.category, 40)})` : ""}`,
    `Item: ${item}`,
    `Stars: ${rating} of 5`,
    tags.length ? `Tags: ${tags.join(", ")}` : "",
    clean(b.notes, 1200) ? `Customer's own words (may be rough speech-to-text): ${clean(b.notes, 1200)}` : "",
  ].filter(Boolean).join("\n");

  try {
    const client = new Anthropic();
    const params = {
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: `Write the review.\n\n${facts}` }],
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    const msg = await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0]) as Anthropic.Beta.BetaMessage;
    if (msg.stop_reason === "refusal") return res.status(422).json({ error: "Couldn't draft this one. Write it in your own words." });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    if (!text) return res.status(502).json({ error: "The AI draft came back empty. Try again." });
    return res.status(200).json({ text });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Too many drafts right now. Try again in a minute." });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: "The AI draft isn't available right now." });
    return res.status(500).json({ error: "Something went wrong drafting your review." });
  }
}
