// Supabase Edge Function "billing-webhook": Razorpay tells us about payments here, so a plan
// still starts if the owner closed the page mid-payment. Deploy with JWT verification off.
// Secret: RAZORPAY_WEBHOOK_SECRET (the one typed in Razorpay > Webhooks). Events: payment.captured, order.paid.
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false } });

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return new Response("not set up", { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") || "";
  const want = await hmacHex(secret, raw);
  let diff = want.length ^ sig.length;
  for (let i = 0; i < Math.min(want.length, sig.length); i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return new Response("bad signature", { status: 401 });

  let ev: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } } };
  try { ev = JSON.parse(raw); } catch { return new Response("bad body", { status: 400 }); }
  const eventId = req.headers.get("x-razorpay-event-id");
  if (eventId) {
    const seen = await admin.from("billing_events").insert({ id: eventId, kind: ev.event || "unknown" });
    if (seen.error?.code === "23505") return new Response("ok"); // already handled
  }
  const pay = ev.payload?.payment?.entity;
  if ((ev.event === "payment.captured" || ev.event === "order.paid") && pay?.order_id && pay.id) {
    const r = await admin.rpc("billing_mark_paid", { p_order: pay.order_id, p_payment: pay.id, p_amount: pay.amount ?? null });
    if (r.error) {
      console.error(r.error);
      if (eventId) await admin.from("billing_events").delete().eq("id", eventId); // let Razorpay retry
      return new Response("retry", { status: 500 });
    }
  }
  return new Response("ok");
});
