// Supabase Edge Function "wallet": Apple Wallet and Google Wallet passes.
//   shop    the owner's table QR as a pass, to show customers at the counter (owner or admin only)
//   invite  your friend-invite QR as a pass, so a friend can scan it from your phone (full accounts only)
//   offer   an offer a shop sent you (yours only), with its end date
//   deal    a shop's deal (anyone), with its end date if it has one
//   stamps  your stamp card at a shop, as it stands when you add it (add it again to refresh)
// Passes carry no location and no update web service: nothing tells us when or where a pass is used.
// Offer, deal and stamp passes only open the live offer in the app; the pass itself can't be used at
// the counter, and nothing on them is ever a reward for a review.
//
// POST JSON {kind: "shop", qrId} | {kind: "invite"} | {kind: "offer", id} | {kind: "deal", id} | {kind: "stamps", placeId}
//   ->  {apple: url | null, google: url | null}
//   apple:  a link back to this function (GET ?t=...) that returns the signed .pkpass, valid 10 minutes
//   google: a pay.google.com "Save to Google Wallet" link (signed JWT, generic pass)
// Deploy with --no-verify-jwt: the GET link is opened by the phone's browser, without a session.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   SITE_URL                    the app's address, e.g. https://trustedpicks.app (QR links point here)
//   Apple:  APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_PASS_CERT (PEM), APPLE_PASS_KEY (PEM),
//           APPLE_PASS_KEY_PASSPHRASE (if the key has one), APPLE_WWDR_CERT (PEM, Apple WWDR G4)
//   Google: GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_JSON (the service account's JSON key)
// Either wallet works on its own; the app hides the button of one that isn't set up.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Buffer } from "node:buffer";
import { PKPass } from "npm:passkit-generator@3.7.0";
import { ICONS } from "./icons.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
const env = (k: string) => (Deno.env.get(k) || "").replace(/\\n/g, "\n").trim();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRAND = { hex: "#d4290f", rgb: "rgb(212, 41, 15)", label: "rgb(255, 214, 204)" };
const LINK_MINUTES = 10;

class Fail extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/** What goes on a pass. Built only after the caller was checked, then carried in the signed Apple link. */
interface Card {
  kind: "shop" | "invite" | "offer" | "deal" | "stamps";
  serial: string;   // stable per shop code / per person, so adding it again replaces the old one
  title: string;    // the big line: shop name, or "Name's picks"
  sub: string;      // table label, or "Scan to become friends"
  url: string;      // what the QR opens
  back: string;     // the explanation on the back / details
  exp: number;
  head?: string;    // the label over the big line (offers, deals, stamps)
  until?: string;   // when it stops working (ISO), shown on the pass and used as its expiry
}

const LABEL: Record<Card["kind"], string> = {
  shop: "Rate what you had", invite: "Trusted Picks", offer: "Just for you", deal: "Deal", stamps: "Stamp card",
};
const DEAL_WORDS: Record<string, string> = { free: "FREE", bogo: "2 for 1", happy_hour: "Happy hour" };
const OFFER_BACK = "Open it in Trusted Picks and show the live screen at the counter. The staff press and hold to use it there. This pass on its own can't be used, has no location and sends nothing back.";

const appleReady = () => ["APPLE_PASS_TYPE_ID", "APPLE_TEAM_ID", "APPLE_PASS_CERT", "APPLE_PASS_KEY", "APPLE_WWDR_CERT"].every((k) => env(k));
const googleReady = () => Boolean(env("GOOGLE_WALLET_ISSUER_ID") && env("GOOGLE_WALLET_SA_JSON"));

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? unescape(encodeURIComponent(b)) : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`wallet:${SB_SERVICE}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg))));
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Checks who's asking and what they may put on a pass. */
async function cardFor(req: Request, b: Record<string, unknown>): Promise<Card> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (token.split(".").length !== 3) throw new Fail(401, "Sign in first");
  const user = createClient(SB_URL, SB_ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: u } = await user.auth.getUser(token);
  if (!u.user) throw new Fail(401, "Sign in first");
  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const exp = Date.now() + LINK_MINUTES * 60_000;

  if (b.kind === "shop") {
    const qrId = String(b.qrId || "");
    if (!UUID.test(qrId)) throw new Fail(400, "Pick a table code");
    const { data: q } = await admin.from("qr_codes").select("id, token, table_label, active, place_id, places(name, area)").eq("id", qrId).maybeSingle();
    const qr = q as { token: string; table_label: string | null; active: boolean; place_id: string; places: { name: string; area: string | null } | null } | null;
    if (!qr?.active || !qr.places) throw new Fail(404, "That table code isn't active");
    const { data: ok } = await user.rpc("can_manage_place", { p_place: qr.place_id });
    if (ok !== true) throw new Fail(403, "Only the shop owner can do this");
    return {
      kind: "shop", serial: `shop-${qrId}`, exp,
      title: qr.places.name, sub: [qr.table_label, qr.places.area].filter(Boolean).join(" · ") || "Review code",
      url: `${SITE_URL}/q/${qr.token}`,
      back: "Customers scan this to see what people love here and rate what they had, the same as the printed table card. Reviews are never paid for or rewarded.",
    };
  }
  if (b.kind === "invite") {
    if (u.user.is_anonymous) throw new Fail(403, "Sign in to get your invite card");
    const { data: code } = await user.rpc("my_invite_code");
    if (!code) throw new Fail(503, "Couldn't make your invite code. Try again.");
    const { data: p } = await admin.from("profiles").select("display_name").eq("id", u.user.id).maybeSingle();
    const name = String((p as { display_name?: string } | null)?.display_name || "").trim().split(/\s+/)[0];
    return {
      kind: "invite", serial: `invite-${u.user.id}`, exp,
      title: name ? `${name}'s picks` : "My picks", sub: "Scan to become friends",
      url: `${SITE_URL}/?ref=${encodeURIComponent(String(code))}&via=qr`,
      back: "Show this to a friend. When they scan it and join, you see each other's named reviews. Only people you show it to can add you. This card has no location and sends nothing back.",
    };
  }
  if (b.kind === "offer") {
    const id = String(b.id || "");
    if (!UUID.test(id)) throw new Fail(400, "Pick an offer");
    const { data: o } = await admin.from("visitor_offers").select("id, body, created_at, used_at, user_id, places(name)").eq("id", id).maybeSingle();
    const off = o as { body: string; created_at: string; used_at: string | null; user_id: string; places: { name: string } | null } | null;
    if (!off || off.user_id !== u.user.id || !off.places) throw new Fail(404, "That offer isn't yours");
    if (off.used_at) throw new Fail(410, "That offer was already used");
    return {
      kind: "offer", serial: `offer-${id}`, exp, head: "Just for you",
      title: off.body.length > 60 ? `${off.body.slice(0, 57)}…` : off.body, sub: off.places.name,
      until: new Date(new Date(off.created_at).getTime() + 30 * 86_400_000).toISOString(),
      url: `${SITE_URL}/pocket?open=offer:${id}`, back: `${off.body}\n\n${OFFER_BACK}`,
    };
  }
  if (b.kind === "deal") {
    const id = String(b.id || "");
    if (!UUID.test(id)) throw new Fail(400, "Pick a deal");
    const { data: d } = await admin.from("shop_deals").select("id, place_id, kind, amount, title, terms, valid_until, active, places(name, currency, status)").eq("id", id).maybeSingle();
    const deal = d as { place_id: string; kind: string; amount: number | null; title: string; terms: string | null; valid_until: string | null; active: boolean;
      places: { name: string; currency: string | null; status: string } | null } | null;
    if (!deal?.active || deal.places?.status !== "live") throw new Fail(404, "That deal isn't on any more");
    const big = deal.kind === "percent" ? `${Math.round(Number(deal.amount))}% OFF`
      : deal.kind === "flat" ? `${deal.places.currency || "INR"} ${Number(deal.amount)} OFF` : DEAL_WORDS[deal.kind] ?? deal.title;
    return {
      kind: "deal", serial: `deal-${id}-${u.user.id}`, exp, head: deal.places.name,
      title: deal.kind === "other" ? deal.title : `${big} ${deal.title}`.slice(0, 80), sub: deal.places.name,
      until: deal.valid_until ? `${deal.valid_until}T23:59:00+05:30` : undefined,
      url: `${SITE_URL}/p/${deal.place_id}`, back: [deal.terms, OFFER_BACK].filter(Boolean).join("\n\n"),
    };
  }
  if (b.kind === "stamps") {
    const placeId = String(b.placeId || "");
    if (!UUID.test(placeId)) throw new Fail(400, "Pick a shop");
    const { data: t } = await user.rpc("place_treats", { p_place: placeId });
    const st = (t as { stamps?: { goal: number; reward: string; stamps: number } | null } | null)?.stamps;
    if (!st) throw new Fail(404, "This shop has no stamp card");
    const { data: pl } = await admin.from("places").select("name").eq("id", placeId).maybeSingle();
    const name = String((pl as { name?: string } | null)?.name || "Stamp card");
    return {
      kind: "stamps", serial: `stamps-${placeId}-${u.user.id}`, exp, head: "Stamp card",
      title: name, sub: st.stamps >= st.goal ? `Full! ${st.reward} is ready` : `${Math.min(st.stamps, st.goal)} of ${st.goal} · then ${st.reward}`,
      url: `${SITE_URL}/pocket?open=stamps:${placeId}`,
      back: "A stamp for each day you scan a table code at this shop. Stamps count visits only, never reviews. This shows your card as it was when you added it: add it again from the app to refresh it, or open the app for the live card.",
    };
  }
  throw new Fail(400, "Unknown pass");
}

async function appleLink(card: Card): Promise<string> {
  const body = b64url(JSON.stringify(card));
  return `${SB_URL}/functions/v1/wallet?t=${body}.${await hmac(body)}`;
}

/** The signed .pkpass for a card. */
function applePass(card: Card): Uint8Array {
  const files: Record<string, Buffer> = {};
  for (const [name, data] of Object.entries(ICONS)) files[name] = Buffer.from(data, "base64");
  const pass = new PKPass(files, {
    wwdr: env("APPLE_WWDR_CERT"), signerCert: env("APPLE_PASS_CERT"), signerKey: env("APPLE_PASS_KEY"),
    signerKeyPassphrase: env("APPLE_PASS_KEY_PASSPHRASE") || undefined,
  }, {
    formatVersion: 1, passTypeIdentifier: env("APPLE_PASS_TYPE_ID"), teamIdentifier: env("APPLE_TEAM_ID"),
    organizationName: "Trusted Picks",
    description: card.kind === "shop" ? `${card.title} review code` : card.kind === "invite" ? "Trusted Picks invite" : `${LABEL[card.kind]}: ${card.sub}`,
    serialNumber: card.serial, logoText: "Trusted Picks",
    backgroundColor: BRAND.rgb, foregroundColor: "rgb(255, 255, 255)", labelColor: BRAND.label,
    sharingProhibited: card.kind === "invite" || card.kind === "offer" || card.kind === "stamps",
  });
  if (card.until) pass.setExpirationDate(new Date(card.until));
  pass.type = card.kind === "offer" || card.kind === "deal" ? "coupon" : card.kind === "stamps" ? "storeCard" : "generic";
  pass.primaryFields.push({ key: "title", label: card.head ?? LABEL[card.kind], value: card.title });
  pass.secondaryFields.push({ key: "sub", label: card.kind === "shop" ? "Table" : card.kind === "stamps" ? "Your card" : card.kind === "invite" ? "" : "At", value: card.sub });
  if (card.until) pass.auxiliaryFields.push({ key: "until", label: "Valid till", value: card.until, dateStyle: "PKDateStyleMedium" });
  pass.backFields.push({ key: "how", label: "How it works", value: card.back }, { key: "link", label: "Link", value: card.url });
  pass.setBarcodes({ format: "PKBarcodeFormatQR", message: card.url, messageEncoding: "iso-8859-1", altText: "Scan with your camera" });
  return new Uint8Array(pass.getAsBuffer());
}

/** A "Save to Google Wallet" link: a JWT signed with the service account, holding a generic pass. */
async function googleLink(card: Card): Promise<string> {
  const issuer = env("GOOGLE_WALLET_ISSUER_ID");
  // Read as-is: the JSON key escapes its newlines itself.
  const sa = JSON.parse((Deno.env.get("GOOGLE_WALLET_SA_JSON") || "").trim()) as { client_email: string; private_key: string };
  const t = (value: string) => ({ defaultValue: { language: "en", value } });
  const payload = {
    iss: sa.client_email, aud: "google", typ: "savetowallet", iat: Math.floor(Date.now() / 1000),
    origins: SITE_URL ? [SITE_URL] : [],
    payload: {
      genericClasses: [{ id: `${issuer}.trusted_picks` }],
      genericObjects: [{
        id: `${issuer}.${card.serial.replace(/[^\w.-]/g, "_")}`, classId: `${issuer}.trusted_picks`, state: "ACTIVE",
        cardTitle: t(card.head ?? "Trusted Picks"), header: t(card.title), subheader: t(card.sub),
        ...(card.until ? { validTimeInterval: { end: { date: card.until } } } : {}),
        hexBackgroundColor: BRAND.hex,
        logo: { sourceUri: { uri: `${SITE_URL}/icon-192.png` }, contentDescription: t("Trusted Picks") },
        barcode: { type: "QR_CODE", value: card.url, alternateText: "Scan with your camera" },
        textModulesData: [{ id: "how", header: "How it works", body: card.back }],
      }],
    },
  };
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)));
  return `https://pay.google.com/gp/v/save/${head}.${body}.${b64url(sig)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!SB_SERVICE) throw new Fail(503, "Wallet passes aren't set up yet");
    if (req.method === "GET") {
      // The Apple link: check the signature and the time, then hand over the pass.
      const [body, sig] = (new URL(req.url).searchParams.get("t") || "").split(".");
      if (!body || !sig || !same(sig, await hmac(body))) throw new Fail(403, "This link isn't valid. Make a new one in the app.");
      const card = JSON.parse(fromB64url(body)) as Card;
      if (!(card.exp > Date.now())) throw new Fail(410, "This link has expired. Make a new one in the app.");
      if (!appleReady()) throw new Fail(503, "Apple Wallet isn't set up yet");
      return new Response(applePass(card), { headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename="${card.kind === "shop" ? "shop-code" : card.kind}.pkpass"`,
        "Cache-Control": "no-store",
      } });
    }
    if (req.method !== "POST") throw new Fail(405, "Use POST");
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (b.kind === "status") return json(200, { apple: appleReady() && Boolean(SITE_URL), google: googleReady() && Boolean(SITE_URL) });
    if (!SITE_URL || (!appleReady() && !googleReady())) throw new Fail(503, "Wallet passes aren't set up yet");
    const card = await cardFor(req, b);
    return json(200, {
      apple: appleReady() ? await appleLink(card) : null,
      google: googleReady() ? await googleLink(card) : null,
    });
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: "Couldn't make the pass. Try again." });
  }
});
