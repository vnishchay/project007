// Runs the migration in a real, isolated PostgreSQL engine. No production credentials or data.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = read('20261023000054_customer_recovery.sql');
const notes = read('20261018000033_owner_notes_gating.sql');
const sendNote = notes.match(/create or replace function public\.send_owner_note\([\s\S]*?end \$\$;/i)?.[0];
assert.ok(sendNote, 'Test must use the production note authorization function');
const ids = {
  owner: '10000000-0000-4000-8000-000000000001', customer: '10000000-0000-4000-8000-000000000002',
  other: '10000000-0000-4000-8000-000000000003', admin: '10000000-0000-4000-8000-000000000004',
  shop: '20000000-0000-4000-8000-000000000001', otherShop: '20000000-0000-4000-8000-000000000002',
  request: '30000000-0000-4000-8000-000000000001', second: '30000000-0000-4000-8000-000000000002',
};

test('Customer recovery authorization, lifecycle and reporting', async (t) => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table profiles(id uuid primary key, role text default 'user');
    create table places(id uuid primary key, owner_id uuid, name text, currency text default 'INR', status text default 'live', time_zone text default 'Asia/Kolkata');
    create table items(id uuid primary key, place_id uuid, name text);
    create table visits(id uuid primary key default gen_random_uuid(), user_id uuid, place_id uuid, source text default 'qr', scanned_at timestamptz default now(), expires_at timestamptz, near boolean);
    create table owner_notes(id uuid primary key default gen_random_uuid(), place_id uuid references places(id), item_id uuid, body text, contact text, visit_id uuid, device_hash text, created_at timestamptz default now(), read_at timestamptz);
    alter table owner_notes enable row level security;
    revoke all on owner_notes from public, anon, authenticated;
    create table review_links(id uuid primary key default gen_random_uuid(), token text unique, place_id uuid, used_at timestamptz, visit_id uuid, expires_at timestamptz);
    create function is_place_owner(p_place uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from places where id = p_place and owner_id = auth.uid()) $$;
    create function is_admin() returns boolean language sql stable security definer as $$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin') $$;
    create function can_manage_place(p_place uuid) returns boolean language sql stable security definer as $$ select is_admin() or is_place_owner(p_place) $$;
    create function setting_int(p_key text, p_default integer) returns integer language sql stable as $$ select p_default $$;
    create function scan_qr(p_token text) returns table(visit_id uuid, expires_at timestamptz) language plpgsql security definer as $$ begin raise exception 'Test uses the real link path, not a table scan'; end $$;
    insert into profiles(id,role) values ('${ids.owner}','business'),('${ids.customer}','user'),('${ids.other}','user'),('${ids.admin}','admin');
    insert into places(id,owner_id,name) values ('${ids.shop}','${ids.owner}','Test Cafe'),('${ids.otherShop}','${ids.other}','Other Cafe');
    insert into visits(user_id,place_id,expires_at) values ('${ids.customer}','${ids.shop}',now()+interval '1 hour');
  `);
  await db.exec(sendNote);
  // Additional minimal tables used by owner_today; the real function is compiled and executed below.
  await db.exec(`
    create table reviews(id uuid, place_id uuid, rating integer, owner_reply text, created_at timestamptz, status text);
    create table stamp_cards(place_id uuid, active boolean, goal integer, reward text);
    create table shop_deals(id uuid, place_id uuid, active boolean, valid_until date);
    create table deal_uses(deal_id uuid, local_day date);
    create table stamp_rewards(place_id uuid, used_at timestamptz);
    create table visitor_offers(place_id uuid, created_at timestamptz, seen_at timestamptz, used_at timestamptz);
    create table place_updates(place_id uuid, created_at timestamptz);
    create table qr_codes(place_id uuid, active boolean);
    create table plans(code text, name text);
    create table subscriptions(place_id uuid, plan text, status text, period_end timestamptz, trial_reviews_left integer);
    create function place_qr_limit(p_place uuid) returns integer language sql as $$ select 1 $$;
    create function reviews_open(p_place uuid) returns boolean language sql as $$ select false $$;
    create function deal_on_at(d shop_deals,t timestamp) returns boolean language sql as $$ select false $$;
  `);
  await db.exec(migration);
  await db.exec(migration); // Safe to rerun on an existing database.
  async function as(user, sql, params = [], role = 'authenticated') {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
    await db.exec(`set role ${role}`);
    return db.query(sql, params);
  }
  const request = (user = ids.customer, id = ids.request, contact = null, consent = false) => as(user,
    'select request_customer_help($1,$2,$3,$4,$5,$6,$7) as id', [ids.shop, id, 'My meal arrived cold.', 'quality', contact, consent, 'test-device']);
  const queue = async (user = ids.owner, filter = 'active', offset = 0) => (await as(user,
    'select shop_recovery_cases($1,$2,$3) as q', [ids.shop, filter, offset])).rows[0].q;
  const mine = async (user = ids.customer) => (await as(user, 'select my_help_requests() as q')).rows[0].q;
  const update = (user, version, status, resolution = '', amount = null, bill = null, cost = 25) => as(user,
    'select update_recovery_case($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [ids.request, version, status, 'Duty manager', resolution, 'Internal: check the kitchen handoff.', cost, amount, bill]);

  await t.test('rejects signed-out access, missing visits and owner submissions', async () => {
    await assert.rejects(request(null), /Open the shop QR/);
    await assert.rejects(request(ids.other), /Scan the table code/);
    await assert.rejects(request(ids.owner), /own shop/);
    await assert.rejects(as(null, 'select shop_recovery_cases($1)', [ids.shop], 'anon'), /permission denied/);
  });
  await t.test('requires explicit contact consent', async () => {
    await assert.rejects(request(ids.customer, ids.request, 'test@example.com', false), /Allow the shop/);
  });
  await t.test('saves a visit-only request even when reviews are paused; retry is idempotent', async () => {
    assert.equal((await request()).rows[0].id, ids.request);
    assert.equal((await request()).rows[0].id, ids.request);
    assert.equal((await queue()).total, 1);
    await assert.rejects(request(ids.other), /reference is already in use/);
  });
  await t.test('isolates owner/customer views and denies direct table access', async () => {
    await assert.rejects(queue(ids.other), /Only this shop owner/);
    assert.deepEqual(await mine(ids.other), []);
    const c = (await queue()).cases[0];
    assert.equal(c.body, 'My meal arrived cold.');
    for (const key of ['requester_id', 'note_id', 'visit_id', 'device_hash']) assert.equal(key in c, false);
    await assert.rejects(as(ids.owner, 'select * from recovery_cases'), /permission denied/);
    await assert.rejects(as(ids.customer, 'select * from owner_notes'), /permission denied/);
  });
  await t.test('rejects unauthorized edits and invalid resolution/money', async () => {
    await assert.rejects(update(ids.other, 1, 'resolved', 'Done'), /Only this shop owner/);
    await assert.rejects(update(ids.owner, 1, 'resolved'), /Explain what was done/);
    await assert.rejects(update(ids.owner, 1, 'in_progress', '', null, null, -1), /valid recovery cost/);
    await assert.rejects(update(ids.owner, 1, 'in_progress', '', 100, null), /amount and a bill reference/);
    await assert.rejects(update(ids.owner, 1, 'in_progress', '', null, null, 'NaN'), /valid recovery cost/);
  });
  await t.test('acknowledges a request without leaking an internal note or response draft', async () => {
    await update(ids.owner, 1, 'in_progress', 'Draft response');
    const c = (await queue()).cases[0];
    assert.ok(c.acknowledged_at);
    const customer = (await mine())[0];
    assert.equal(customer.resolution, '');
    for (const key of ['assigned_to', 'internal_note', 'contact', 'recovery_cost', 'purchase_amount']) assert.equal(key in customer, false);
    await assert.rejects(update(ids.owner, 1, 'resolved', 'Old edit'), /request changed/);
  });
  await t.test('customer can reject the proposed fix and reopen the case', async () => {
    await update(ids.owner, 2, 'resolved', 'We replaced the meal.');
    assert.equal((await queue()).open, 0);
    assert.equal((await queue()).confirmed_30d, 0);
    await assert.rejects(as(ids.other, 'select confirm_help_resolution($1,3,true)', [ids.request]), /not your help request/);
    await as(ids.customer, 'select confirm_help_resolution($1,3,false)', [ids.request]);
    const c = (await queue()).cases[0];
    assert.equal(c.status, 'open'); assert.equal(c.confirmation, 'not_fixed'); assert.equal(c.resolved_at, null);
    assert.ok(Date.parse(c.due_at) > Date.now());
  });
  await t.test('only the customer can confirm a fix; confirmed responses cannot silently change', async () => {
    await update(ids.owner, 4, 'resolved', 'We provided a replacement and followed up.', 250, '2026-10-24/BILL-42');
    await assert.rejects(as(ids.owner, 'select confirm_help_resolution($1,5,true)', [ids.request]), /not your help request/);
    await as(ids.customer, 'select confirm_help_resolution($1,5,true)', [ids.request]);
    const q = await queue(ids.owner, 'resolved');
    assert.equal(q.confirmed_30d, 1); assert.equal(q.resolved_30d, 1);
    assert.equal(Number(q.money[0].cost), 25); assert.equal(Number(q.money[0].recorded_sales), 250);
    await assert.rejects(update(ids.owner, 6, 'resolved', 'Changed without asking'), /Reopen the request/);
    await assert.rejects(as(ids.customer, 'select confirm_help_resolution($1,6,false)', [ids.request]), /no resolution waiting/);
  });
  await t.test('legacy notes are readable without a plan and recovery cases are not duplicated there', async () => {
    await as(ids.customer, 'select send_owner_note($1,$2,null,null,$3)', [ids.shop, 'A separate legacy note', 'test-device']);
    const notes = (await as(ids.owner, 'select * from my_owner_notes($1)', [ids.shop])).rows;
    assert.equal(notes.length, 1); assert.equal(notes[0].locked, false); assert.equal(notes[0].body, 'A separate legacy note');
    await as(ids.owner, 'select mark_note_read($1)', [notes[0].id]);
  });
  await t.test('note abuse limits still apply to help requests', async () => {
    await request(ids.customer, ids.second);
    await assert.rejects(request(ids.customer, '30000000-0000-4000-8000-000000000003'), /few notes already/);
  });
  await t.test('a bill cannot be counted twice, including different letter casing', async () => {
    await assert.rejects(as(ids.owner, 'select update_recovery_case($1,1,$2,$3,$4,$5,0,250,$6)', [ids.second, 'resolved', 'Manager', 'Done', '', '2026-10-24/bill-42']), /duplicate key/);
  });
  await t.test('help links work with expired review plans, are single-user and enforce expiry', async () => {
    await db.exec('reset role');
    await db.query("insert into review_links(token,place_id,expires_at) values ('help-link',$1,now()+interval '1 hour'),('expired-link',$1,now()-interval '1 hour')", [ids.shop]);
    const opened = await as(ids.customer, "select * from begin_help_visit('help-link',true)");
    assert.ok(opened.rows[0].visit_id);
    assert.equal((await as(ids.customer, "select * from begin_help_visit('help-link',true)")).rows[0].visit_id, opened.rows[0].visit_id);
    await assert.rejects(as(ids.other, "select * from begin_help_visit('help-link',true)"), /already used/);
    await assert.rejects(as(ids.customer, "select * from begin_help_visit('expired-link',true)"), /expired/);
  });
  await t.test('queue summaries cover all pages; overdue counts and owner home agree', async () => {
    await db.exec('reset role');
    await db.query(`insert into owner_notes(id,place_id,body) select gen_random_uuid(),$1,'Seed for pagination' from generate_series(1,26)`, [ids.shop]);
    await db.query(`insert into recovery_cases(id,note_id,place_id,requester_id,category,currency,due_at)
      select gen_random_uuid(),n.id,$1,$2,'other','INR',now()-interval '1 hour' from owner_notes n where n.body='Seed for pagination'`, [ids.shop, ids.customer]);
    const q = await queue();
    assert.equal(q.open, 27); assert.equal(q.total, 27); assert.equal(q.overdue, 26); assert.equal(q.cases.length, 25);
    assert.equal((await queue(ids.owner, 'active', 25)).cases.length, 2);
    const home = (await as(ids.owner, 'select owner_today($1) as q', [ids.shop])).rows[0].q;
    assert.equal(home.recovery_open, q.open); assert.equal(home.recovery_overdue, q.overdue); assert.equal(home.recovery_confirmed_30d, 1);
    assert.equal(home.notes_unread, 0);
    await assert.rejects(as(ids.other, 'select owner_today($1)', [ids.shop]), /only the shop owner/);
  });
  await db.exec('reset role');
  await db.exec('create table push_subscriptions(endpoint text primary key,user_id uuid,p256dh text,auth text)');
  const alertMigration = read('20261024000055_recovery_alerts.sql');
  await db.exec(alertMigration);
  await db.exec(alertMigration);
  await t.test('alerts require opt-in, a subscription, and authorized access', async () => {
    await assert.rejects(as(ids.other, 'select set_recovery_alerts($1,true)', [ids.shop]), /Only this shop owner/);
    await assert.rejects(as(ids.owner, 'select set_recovery_alerts($1,true)', [ids.shop]), /Enable notifications/);
    await assert.rejects(as(ids.owner, 'select * from claim_recovery_alerts()'), /permission denied/);
    await db.exec('reset role');
    await db.query("insert into push_subscriptions values('https://push.test/device',$1,'public-key','auth-key')", [ids.owner]);
    assert.equal((await as(null, 'select * from claim_recovery_alerts()', [], 'service_role')).rows.length, 0);
    await as(ids.owner, 'select set_recovery_alerts($1,true)', [ids.shop]);
  });
  let claimed;
  await t.test('alerts are leased once and contain no customer text or contact', async () => {
    claimed = (await as(null, 'select * from claim_recovery_alerts()', [], 'service_role')).rows;
    assert.equal(claimed.length, 27);
    for (const key of ['body','contact','requester_id','internal_note']) assert.equal(key in claimed[0],false);
    assert.equal((await as(null, 'select * from claim_recovery_alerts()', [], 'service_role')).rows.length,0);
  });
  await t.test('delivery failures are retained for retry; stale acknowledgements cannot overwrite a newer claim', async () => {
    const d = claimed[0];
    await as(null, 'select finish_recovery_alert($1,$2,false,$3)', [d.delivery_id,d.claim_attempt,'HTTP 503'], 'service_role');
    await db.exec('reset role');
    const failed = (await db.query('select * from recovery_alert_delivery where id=$1',[d.delivery_id])).rows[0];
    assert.equal(failed.delivered_at,null); assert.equal(failed.last_error,'HTTP 503');
    assert.ok(Date.parse(failed.next_attempt_at)>Date.now());
    await db.query("update recovery_alert_delivery set next_attempt_at=now()-interval '1 second' where id=$1",[d.delivery_id]);
    const retry = (await as(null,'select * from claim_recovery_alerts()',[],'service_role')).rows;
    assert.equal(retry.length,1); assert.equal(retry[0].claim_attempt,2);
    await as(null,'select finish_recovery_alert($1,1,true)',[d.delivery_id],'service_role');
    await db.exec('reset role');
    assert.equal((await db.query('select delivered_at from recovery_alert_delivery where id=$1',[d.delivery_id])).rows[0].delivered_at,null);
    await as(null,'select finish_recovery_alert($1,2,true)',[d.delivery_id],'service_role');
    const state = (await as(ids.owner,'select recovery_alert_state($1) as q',[ids.shop])).rows[0].q;
    assert.equal(state.enabled,true); assert.ok(state.worker_seen_at); assert.ok(state.last_delivered_at);
  });
  await t.test('turning alerts off prevents dispatch even for expired leases', async () => {
    await as(ids.owner,'select set_recovery_alerts($1,false)',[ids.shop]);
    await db.exec('reset role');
    await db.exec("update recovery_alert_delivery set leased_until=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' where delivered_at is null");
    assert.equal((await as(null,'select * from claim_recovery_alerts()',[],'service_role')).rows.length,0);
  });
  await db.close();
});
