// Supabase Edge Function "remind": sends review reminders (Web Push) for open visits.
// pg_cron calls it every 10 minutes (migration 47) with the x-cron-secret header; nobody else can.
// Only people who switched reminders on have a push address, so nobody else gets anything.
// A reminder never mentions offers or rewards: it only asks how the visit was.
//
// Secrets (Supabase > Edge Functions > Secrets), made by scripts/setup-reminders.ps1:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   the Web Push key pair (the public one is also VITE_VAPID_PUBLIC_KEY on Vercel)
//   VAPID_SUBJECT                         mailto: address push services can contact
//   REMIND_CRON_SECRET                    the same value as the Vault secret `remind_cron_secret`
// Deploy with --no-verify-jwt: pg_cron has no user session; the secret header guards it.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const env = (k: string) => (Deno.env.get(k) || "").trim();

interface Due { visit_id: string; place_id: string; place_name: string; expires_at: string; last_one: boolean; endpoint: string; p256dh: string; auth: string }

/** "about 3 hours" / "about 40 minutes": the server doesn't know the phone's time zone, so no clock times. */
function left(iso: string): string {
  const min = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  if (min < 90) return `about ${Math.max(5, Math.round(min / 5) * 5)} minutes`;
  const h = Math.round(min / 60);
  return `about ${h} hour${h === 1 ? "" : "s"}`;
}

Deno.serve(async (req) => {
  const secret = env("REMIND_CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("not allowed", { status: 403 });
  const pub = env("VAPID_PUBLIC_KEY"), priv = env("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return new Response(JSON.stringify({ sent: 0, note: "VAPID keys are not set" }), { status: 200 });
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:hello@example.com", pub, priv);

  const db = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("take_due_review_reminders", { p_limit: 300 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0, gone = 0, failed = 0;
  const dead: string[] = [];
  await Promise.all(((data as Due[]) || []).map(async (d) => {
    const payload = JSON.stringify({
      title: d.last_one ? `Last call: how was ${d.place_name}?` : `How was ${d.place_name}?`,
      body: d.last_one
        ? `Your review closes in ${left(d.expires_at)}. It takes a minute, and you can stay anonymous.`
        : `Your verified review is open for ${left(d.expires_at)}. Tell the next person what to get.`,
      url: `/review/${d.place_id}`,
      tag: `review-${d.visit_id}`,
    });
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: 3600, urgency: "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // The phone unsubscribed or the address expired: forget it.
      if (code === 404 || code === 410) { dead.push(d.endpoint); gone++; } else { failed++; console.warn("push failed", code, (e as Error).message); }
    }
  }));
  if (dead.length) await db.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(JSON.stringify({ sent, gone, failed }), { headers: { "Content-Type": "application/json" } });
});
