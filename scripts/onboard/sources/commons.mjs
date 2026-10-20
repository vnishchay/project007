// Freely licensed photos of a place from Wikimedia Commons, found through the place's OSM tags
// (wikimedia_commons, image, or wikidata's "image" property). Only public-domain, CC0, CC BY and
// CC BY-SA files are used, and each comes with the credit its licence requires. Never AI-made, never stock.
import { http, clip } from "../lib/common.mjs";

const COMMONS = "https://commons.wikimedia.org/w/api.php";
const FREE = /^(cc0|public domain|pd|cc by(-sa)? \d(\.\d)?( [a-z]+)?|cc by(-sa)?)$/i;

const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function fileFromWikidata(qid) {
  const res = await http(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`);
  if (!res.ok) return null;
  const ent = (await res.json()).entities?.[qid];
  const name = ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return name ? `File:${name}` : null;
}

/** The Commons file name a place's OSM tags point at, if any. */
export async function commonsFileFor(tags) {
  const direct = tags.wikimedia_commons || tags.image || "";
  const m = decodeURIComponent(direct).match(/(File:[^?#|]+\.(jpe?g|png|webp))/i);
  if (m) return m[1].replace(/_/g, " ");
  if (/^Q\d+$/.test(tags.wikidata || "")) return fileFromWikidata(tags.wikidata);
  return null;
}

/** { url (a ~1400px JPEG/PNG), credit, license, page } for a freely licensed Commons file, else null. */
export async function commonsImage(file) {
  const q = new URLSearchParams({ action: "query", format: "json", prop: "imageinfo", titles: file,
    iiprop: "url|mime|extmetadata", iiurlwidth: "1400" });
  const res = await http(`${COMMONS}?${q}`);
  if (!res.ok) return null;
  const page = Object.values((await res.json()).query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime)) return null;
  const meta = info.extmetadata || {};
  const license = stripHtml(meta.LicenseShortName?.value);
  if (!FREE.test(license) || meta.NonFree?.value) return null;
  const artist = clip(stripHtml(meta.Artist?.value) || "Unknown author", 60);
  return { url: info.thumburl || info.url, mime: info.mime, license, page: info.descriptionurl,
    credit: `Photo: ${artist}, ${license}, via Wikimedia Commons` };
}

/** Downloads the photo and stores it in the place-media bucket as <placeId>/commons-<n>.jpg. Returns the path. */
export async function storeCommonsImage(supabase, placeId, img) {
  const res = await http(img.url, { timeout: 30000 });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) return null; // bucket limit
  const ext = img.mime === "image/png" ? "png" : img.mime === "image/webp" ? "webp" : "jpg";
  const path = `${placeId}/commons-${Date.now().toString(36)}.${ext}`;
  const { error } = await supabase.storage.from("place-media").upload(path, buf, { contentType: img.mime, upsert: false });
  if (error) { console.warn(`    photo upload failed: ${error.message}`); return null; }
  return path;
}
