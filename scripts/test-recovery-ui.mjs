// Browser workflow checks use a local Vite server and intercepted fixture APIs only.
// No requests are made to a live Supabase project and no production data is changed.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const origin = 'http://127.0.0.1:4179';
const api = 'https://recovery-test.supabase.co';
const shop = '20000000-0000-4000-8000-000000000001';
const owner = '10000000-0000-4000-8000-000000000001';
const customer = '10000000-0000-4000-8000-000000000002';
const screenshots = process.env.RECOVERY_SCREENSHOTS;
const now = new Date().toISOString();
const expires = new Date(Date.now() + 3600000).toISOString();
const place = { id: shop, name: 'Test Cafe', owner_id: owner, google_place_id: null, kind: 'food', category: 'Cafe', currency: 'INR', status: 'live', verification: 'verified', area: 'Test area', city: 'Test city', about: '', hours: {}, links: [], cover_path: null, logo_path: null };

test('Customer-to-owner help workflow on mobile and desktop', async (t) => {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4179', '--strictPort'], {
    env: { ...process.env, VITE_SUPABASE_URL: api, VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key', VITE_GOOGLE_MAPS_KEY: '', VITE_VAPID_PUBLIC_KEY: '' }, stdio: ['ignore','pipe','pipe'],
  });
  t.after(() => vite.kill());
  await Promise.race([new Promise((resolve, reject) => {
    vite.stdout.on('data', (data) => { if (data.toString().includes('4179')) resolve(); });
    vite.once('exit', (code) => reject(new Error(`Vite exited with ${code}`)));
  }), new Promise((_, reject) => setTimeout(() => reject(new Error('Vite did not start')),15000).unref())]);
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch(existsSync(edge) ? { executablePath: edge, headless: true } : { headless: true });
  t.after(() => browser.close());
  if (screenshots) mkdirSync(screenshots, { recursive: true });
  const cases = [];
  const writes = [];
  const errors = [];
  async function contextFor(id, mobile = true, guest = false) {
    const context = await browser.newContext({ viewport: mobile ? { width:390,height:844 } : { width:1365,height:900 }, serviceWorkers:'block' });
    const user = { id, email: guest ? undefined : `${id === owner ? 'owner' : 'customer'}@example.test`, is_anonymous:guest, aud:'authenticated', role:'authenticated', user_metadata:{}, app_metadata:{provider: guest ? 'anonymous' : 'email'}, created_at:now };
    const profile = { id, display_name:id === owner ? 'Test Owner' : guest ? '' : 'Test Customer', avatar_path:null, role:id===owner?'business':'user',created_at:now };
    const jwt = `${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.fixture`;
    await context.addInitScript(({user,jwt}) => localStorage.setItem('sb-recovery-test-auth-token',JSON.stringify({access_token:jwt,refresh_token:'fixture-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})), {user,jwt});
    await context.route('**/*',async (route) => {
      const req = route.request(); const url = new URL(req.url());
      if (url.origin===origin) return route.continue();
      if (url.origin!==api) return route.abort();
      const rpc = url.pathname.split('/rpc/')[1];
      const payload = req.postDataJSON() || {};
      if (req.method()==='POST') writes.push({rpc,payload});
      let value = [];
      if (url.pathname==='/auth/v1/user') value=user;
      else if (rpc==='my_profile') value=[profile];
      else if (rpc==='can_manage_place') value=id===owner;
      else if (rpc==='place_pin') value=[{has_pin:true,source:'manual',google_linked:false}];
      else if (rpc==='peek_qr') value=[{place_id:shop,place_name:place.name,area:place.area,table_label:'Table 2',status:'ok'}];
      else if (rpc==='place_service') value={calls:true};
      else if (rpc==='can_review') value=[{allowed:false,reason:'paused'}];
      else if (rpc==='begin_help_visit') value=[{visit_id:'40000000-0000-4000-8000-000000000001',expires_at:expires}];
      else if (rpc==='request_customer_help') {
        assert.equal(payload.p_allow_contact, true);
        cases.push({id:payload.p_request,place_id:shop,place_name:place.name,category:payload.p_category,status:'open',body:payload.p_body,contact:payload.p_contact,created_at:now,due_at:expires,assigned_to:'',resolution:'',internal_note:'',acknowledged_at:null,resolved_at:null,confirmation:'pending',confirmed_at:null,recovery_cost:0,purchase_amount:null,bill_reference:null,currency:'INR',version:1});
        value=payload.p_request;
      } else if (rpc==='my_help_requests') value=cases;
      else if (rpc==='shop_recovery_cases') value={open:cases.filter(c=>c.status!=='resolved').length,overdue:0,resolved_30d:cases.filter(c=>c.status==='resolved').length,confirmed_30d:cases.filter(c=>c.confirmation==='fixed').length,money:[],total:cases.filter(c=>payload.p_filter==='all'||(payload.p_filter==='resolved'?c.status==='resolved':c.status!=='resolved')).length,cases:cases.filter(c=>payload.p_filter==='all'||(payload.p_filter==='resolved'?c.status==='resolved':c.status!=='resolved'))};
      else if (rpc==='recovery_alert_state') value={enabled:false,worker_seen_at:null,failed:0,last_delivered_at:null};
      else if (rpc==='update_recovery_case') {
        const c=cases.find(c=>c.id===payload.p_case); assert.equal(payload.p_version,c.version);
        Object.assign(c,{status:payload.p_status,assigned_to:payload.p_assigned_to,resolution:payload.p_resolution,internal_note:payload.p_internal_note,recovery_cost:payload.p_recovery_cost,purchase_amount:payload.p_purchase_amount,bill_reference:payload.p_bill_reference,version:c.version+1}); value=null;
      } else if (rpc==='confirm_help_resolution') {
        const c=cases.find(c=>c.id===payload.p_case); assert.equal(payload.p_version,c.version);
        Object.assign(c,{status:payload.p_fixed?'resolved':'open',confirmation:payload.p_fixed?'fixed':'not_fixed',version:c.version+1}); value=null;
      } else if (rpc==='owner_today') value={today:now.slice(0,10),visitors_today:1,visitors_yesterday:0,scans_today:1,days:[],reviews_today:1,reviews_7d:1,reviews:1,avg_rating:4,need_reply:0,low_open:0,notes_unread:0,recovery_open:cases.filter(c=>c.status!=='resolved').length,recovery_overdue:0,recovery_confirmed_30d:cases.filter(c=>c.confirmation==='fixed').length,deals_live:0,deals_on_now:0,deal_uses_today:0,offers_7d:0,offers_seen_7d:0,offers_used_7d:0,qr_active:1,qr_limit:1,reviews_open:false,plan_status:'expired',plan_name:'Starter'};
      else if (rpc==='shop_treats') value={deals:[],offers:[],stamps:null};
      else if (url.pathname==='/rest/v1/places') value=url.searchParams.has('select') && req.headers()['accept']?.includes('object') ? place : [place];
      const headers={'content-type':'application/json','access-control-allow-origin':'*','content-range':'0-0/5'};
      if (req.method()==='HEAD') return route.fulfill({status:200,headers,body:''});
      return route.fulfill({status:200,headers,body:JSON.stringify(value)});
    });
    const page=await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', e=>errors.push(e.message));
    return {context,page};
  }
  const diner=await contextFor(customer,true,true);
  t.after(()=>diner.context.close());
  await t.test('customer requests help despite paused reviews, with explicit contact permission',async()=>{
    await diner.page.goto(`${origin}/q/table-code`);
    await diner.page.getByRole('button',{name:'Tell the shop now',exact:true}).click();
    assert.equal(await diner.page.locator('details.help-entry').getAttribute('open'),'','Table feedback should open the trackable help flow');
    await diner.page.getByLabel('What happened?').fill('My meal arrived cold. Could you replace it?');
    await diner.page.getByLabel('Phone or email for a reply (optional)').fill('customer@example.test');
    assert.equal(await diner.page.getByRole('button',{name:'Send help request',exact:true}).isEnabled(),false);
    await diner.page.getByLabel('I allow this shop').check();
    await diner.page.getByRole('button',{name:'Send help request',exact:true}).click();
    await diner.page.getByRole('heading',{name:'Your request is saved'}).waitFor();
    assert.equal(cases.length,1);
    assert.equal(writes.some(w=>w.rpc==='submit_review'),false);
    if(screenshots) await diner.page.screenshot({path:`${screenshots}/customer-receipt.png`,fullPage:true});
    await diner.page.getByRole('link',{name:'Track your request'}).click();
    await diner.page.getByText('My meal arrived cold. Could you replace it?',{exact:true}).waitFor();
    assert.ok(diner.page.url().includes(`/help/${shop}`),'Guest shop mode must permit the tracking route');
  });
  const manager=await contextFor(owner);
  t.after(()=>manager.context.close());
  await t.test('owner assigns, resolves and records the actual recovery cost',async()=>{
    await manager.page.goto(`${origin}/owner/${shop}/help`);
    await manager.page.getByRole('button',{name:'Handle request',exact:true}).click();
    await manager.page.getByLabel('Status',{exact:true}).selectOption('resolved');
    await manager.page.getByLabel('Person responsible').fill('Duty manager');
    await manager.page.getByLabel('What did you do?').fill('We replaced the meal and checked the temperature.');
    await manager.page.getByLabel('Internal follow-up note').fill('Check the evening kitchen handoff.');
    await manager.page.getByLabel('Recovery cost (INR)').fill('45');
    if(screenshots) await manager.page.screenshot({path:`${screenshots}/owner-mobile.png`,fullPage:true});
    assert.equal(await manager.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile queue must not overflow horizontally');
    await manager.page.getByRole('button',{name:'Save request',exact:true}).click();
    await manager.page.getByText('No open help requests.',{exact:false}).waitFor();
    assert.equal(cases[0].status,'resolved'); assert.equal(cases[0].recovery_cost,45);
  });
  await t.test('customer can reopen a failed resolution and confirm a later fix',async()=>{
    await diner.page.getByRole('button',{name:'Refresh',exact:true}).click();
    await diner.page.getByText('We replaced the meal and checked the temperature.',{exact:true}).waitFor();
    assert.equal(await diner.page.getByText('Check the evening kitchen handoff.',{exact:true}).count(),0);
    await diner.page.getByRole('button',{name:'No, I still need help',exact:true}).click();
    await diner.page.getByText('You said it was not fixed.',{exact:false}).waitFor();
    await manager.page.getByRole('button',{name:'Refresh',exact:true}).click();
    await manager.page.getByRole('button',{name:'Handle request',exact:true}).click();
    await manager.page.getByLabel('Status',{exact:true}).selectOption('resolved');
    await manager.page.getByLabel('What did you do?').fill('We made a fresh meal and checked with you at the table.');
    await manager.page.getByRole('button',{name:'Save request',exact:true}).click();
    await manager.page.getByText('No open help requests.',{exact:false}).waitFor();
    await diner.page.getByRole('button',{name:'Refresh',exact:true}).click();
    await diner.page.getByRole('button',{name:'Yes, it’s fixed',exact:true}).click();
    await diner.page.getByText('You confirmed it was fixed',{exact:true}).waitFor();
    assert.equal(cases[0].confirmation,'fixed');
  });
  await t.test('desktop outcome view and break-even estimate remain usable',async()=>{
    await manager.page.setViewportSize({width:1365,height:900});
    await manager.page.getByRole('button',{name:'Resolved',exact:true}).click();
    await manager.page.getByText('We made a fresh meal and checked with you at the table.',{exact:true}).waitFor();
    if(screenshots) await manager.page.screenshot({path:`${screenshots}/owner-desktop.png`,fullPage:true});
    await manager.page.goto(`${origin}/owner/${shop}/insights`);
    await manager.page.getByLabel('Monthly plan and messaging cost').fill('1000');
    await manager.page.getByLabel('Contribution per additional purchase').fill('100');
    await manager.page.getByLabel('Monthly recovery and reward costs').fill('200');
    await manager.page.getByText('12 additional purchases per month',{exact:true}).waitFor();
    assert.equal(await manager.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });
  assert.deepEqual(errors,[],'No uncaught browser errors');
});
