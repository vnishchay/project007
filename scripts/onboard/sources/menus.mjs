// Turns menus found online (menu-page text, PDF menus, photos of menus) into items, using the app's own
// menu reader: the `menu` task of the Supabase Edge Function `ai` (DeepSeek, key kept as a Supabase secret).
// The script authenticates with ONBOARD_TOKEN, a secret set both in .env and on the function.
import { http, sleep } from "../lib/common.mjs";

/** Calls ai/menu for one place. text: menu text; images: [{ data: Buffer, type }] (at most 4). Returns items or []. */
export async function readMenu(env, placeId, { text, images = [] }) {
  const token = env.ONBOARD_TOKEN, url = env.SUPABASE_URL;
  if (!token || !url) return [];
  const body = {
    task: "menu", placeId,
    text: text ? String(text).slice(0, 24000) : undefined,
    images: images.slice(0, 4).filter((i) => i.data.length <= 1_100_000).map((i) => ({ data: i.data.toString("base64"), media_type: i.type })),
  };
  if (!body.text && !body.images.length) return [];
  const res = await http(`${url.replace(/\/$/, "")}/functions/v1/ai`, {
    method: "POST", timeout: 120000, retries: 1,
    headers: { "Content-Type": "application/json", "x-onboard-token": token, apikey: env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { console.warn(`    menu reader: ${j.error || res.status}`); if (res.status === 401 || res.status === 403) throw new Error("menu reader refused the ONBOARD_TOKEN"); return []; }
  await sleep(300);
  return (j.items || []).map((i) => ({ name: i.name, price: i.price_inr, section: i.section || null, description: i.description || null, diet: i.diet || [] }));
}

/** Asks ai/embed to make "Similar dishes" vectors for one place's products (free, built-in model). Returns how many. */
export async function embedItems(env, placeId) {
  const token = env.ONBOARD_TOKEN, url = env.SUPABASE_URL;
  if (!token || !url) return 0;
  let made = 0;
  for (let round = 0; round < 8; round++) {
    const res = await http(`${url.replace(/\/$/, "")}/functions/v1/ai`, {
      method: "POST", timeout: 120000, retries: 1,
      headers: { "Content-Type": "application/json", "x-onboard-token": token, apikey: env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "" },
      body: JSON.stringify({ task: "embed", placeId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { console.warn(`    similar dishes: ${j.error || res.status}`); return made; }
    made += j.made || 0;
    if (!j.left) return made;
  }
  return made;
}

/** Text of a PDF menu (pdfjs-dist, already an app dependency). */
export async function pdfText(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise;
  let out = "";
  for (let p = 1; p <= Math.min(doc.numPages, 12); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    out += tc.items.map((i) => i.str).join(" ") + "\n";
    if (out.length > 24000) break;
  }
  return out.trim();
}

/** Downloads an image or PDF the menu reader can use. */
export async function fetchMenuFile(url) {
  try {
    const res = await http(url, { timeout: 25000, retries: 1 });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 15_000_000) return null;
    if (type === "application/pdf" || /\.pdf($|\?)/i.test(url)) return { kind: "pdf", data };
    if (/^image\/(jpeg|png|webp)$/.test(type)) return { kind: "image", data, type };
    return null;
  } catch { return null; }
}
