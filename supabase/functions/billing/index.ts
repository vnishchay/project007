// Supabase Edge Function "billing": shop owners pay for a plan with Razorpay (India).
// Secrets (Supabase > Edge Functions > Secrets): RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET.
// The key secret never leaves this function. Payments are one-off (a month or a year),
// so nothing renews by itself and there's nothing to cancel.
//
// POST JSON:
//   {action: "order", place_id, plan, interval: "month"|"year"}  -> Razorpay order for a shop's plan
//   {action: "verify", order_id, payment_id, signature}           -> checks the signature, starts the plan
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const keyId = Deno.env.get("RAZORPAY_KEY_ID"), keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret || !SB_SERVICE) return json(503, { error: "Payments aren't set up yet" });

  const auth = req.headers.get("Authorization") || "";
  const user = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await user.auth.getUser();
  if (!who?.user || who.user.is_anonymous) return json(401, { error: "Sign in to pay" });
  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); }

  if (body.action === "order") {
    const placeId = String(body.place_id || ""), plan = String(body.plan || ""), interval: "month" | "year" = body.interval === "month" ? "month" : "year";
    if (!UUID.test(placeId)) return json(400, { error: "Pick a shop" });
    // my_plan only returns a row to the shop's owner (or an admin).
    const mine = await user.rpc("my_plan", { p_place: placeId });
    if (mine.error || !mine.data?.length) return json(403, { error: "Only the shop owner can pay for a plan" });
    const { data: shop } = await admin.from("places").select("status, verification").eq("id", placeId).maybeSingle();
    if (!shop || shop.status !== "live" || shop.verification === "rejected") return json(400, { error: "This shop isn't listed right now, so it can't take a plan" });
    const { data: p } = await admin.from("plans").select("code, name, price_inr_year, price_inr_month").eq("code", plan).maybeSingle();
    const rupees = (interval === "year" ? p?.price_inr_year : p?.price_inr_month) || 0;
    if (!p || rupees <= 0) return json(400, { error: "Pick a plan" });
    const planName = p.name;
    const amount = rupees * 100;
    const rp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${keyId}:${keySecret}`) },
      body: JSON.stringify({ amount, currency: "INR", receipt: `tp-${placeId.slice(0, 8)}-${Date.now()}`, notes: { place_id: placeId, plan, interval } }),
    });
    const order = await rp.json().catch(() => null);
    if (!rp.ok || !order?.id) { console.error("razorpay order", rp.status, order?.error?.description); return json(502, { error: "Couldn't start the payment. Try again." }); }
    const ins = await admin.from("billing_orders").insert({
      place_id: placeId, plan, billing_interval: interval, currency: "INR", amount_minor: amount,
      provider_order_id: order.id, created_by: who.user.id,
    });
    if (ins.error) { console.error(ins.error); return json(500, { error: "Couldn't start the payment" }); }
    return json(200, { key_id: keyId, order_id: order.id, amount, currency: "INR", plan_name: planName, email: who.user.email ?? null });
  }

  if (body.action === "verify") {
    const orderId = String(body.order_id || ""), paymentId = String(body.payment_id || ""), sig = String(body.signature || "");
    if (!orderId || !paymentId || !sig) return json(400, { error: "Bad request" });
    if (!sameText(await hmacHex(keySecret, `${orderId}|${paymentId}`), sig)) return json(400, { error: "Payment couldn't be verified" });
    const { data: o } = await admin.from("billing_orders").select("place_id, created_by").eq("provider_order_id", orderId).maybeSingle();
    if (!o || o.created_by !== who.user.id) return json(404, { error: "Order not found" });
    // The checkout signature only says Razorpay started the payment: confirm it was captured, for this order and amount.
    const pr = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: "Basic " + btoa(`${keyId}:${keySecret}`) } });
    const pay = await pr.json().catch(() => null) as { status?: string; order_id?: string; amount?: number } | null;
    if (!pr.ok || !pay || pay.order_id !== orderId) return json(502, { error: "Couldn't confirm the payment with Razorpay yet" });
    if (pay.status !== "captured") return json(409, { error: "Razorpay hasn't confirmed this payment yet. Your plan starts as soon as it does." });
    const r = await admin.rpc("billing_mark_paid", { p_order: orderId, p_payment: paymentId, p_amount: pay.amount ?? null });
    if (r.error || !r.data) return json(500, { error: "Payment received but the plan didn't start. We'll fix it soon." });
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action" });
});
