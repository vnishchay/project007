// Deploy with --no-verify-jwt; the same secret header used by `remind` authenticates cron.
// Push payloads deliberately omit customer messages, contact details and staff notes.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const env = (name: string) => (Deno.env.get(name) || '').trim();
interface Delivery { delivery_id: string; claim_attempt: number; case_id: string; place_id: string; place_name: string; reason: string; endpoint: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  const secret = env('REMIND_CRON_SECRET');
  if (req.method !== 'POST' || !secret || req.headers.get('x-cron-secret') !== secret) return new Response('Not allowed', { status: 403 });
  const pub = env('VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return Response.json({ error: 'Push delivery is not configured.' }, { status: 503 });
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:hello@example.com', pub, priv);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data, error } = await db.rpc('claim_recovery_alerts', { p_limit: 100 });
  if (error) return Response.json({ error: 'Could not claim alerts.' }, { status: 500 });
  const deliveries = (data || []) as Delivery[];
  let sent = 0, failed = 0;
  // Bound parallel work so a busy outlet does not exhaust the Edge Function's resources.
  for (let start = 0; start < deliveries.length; start += 10) {
    await Promise.all(deliveries.slice(start, start + 10).map(async (d) => {
      let success = false;
      let failure: string | null = null;
      let expired = false;
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify({
          title: `Customer help · ${d.place_name}`,
          body: d.reason === 'overdue' ? 'A help request is past its follow-up target.' : d.reason === 'reopened' ? 'A customer said the problem is not fixed. Please follow up.' : 'A customer has asked for help. Open the queue to respond.',
          url: `/owner/${d.place_id}/help`, tag: `help-${d.case_id}`, requireInteraction: true,
        }), { TTL: 300, urgency: 'high', timeout: 10000 });
        success = true; sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        expired = code === 404 || code === 410;
        failure = code ? `Push service HTTP ${code}` : 'Push service unavailable';
        failed++;
      }
      const result = await db.rpc('finish_recovery_alert', { p_delivery: d.delivery_id, p_attempt: d.claim_attempt, p_success: success, p_error: failure });
      // A failed acknowledgement retains its lease and will be retried. Delivery is at-least-once.
      if (result.error) console.error('Could not record push delivery result');
      if (expired) await db.from('push_subscriptions').delete().eq('endpoint', d.endpoint);
    }));
  }
  return Response.json({ sent, failed });
});
