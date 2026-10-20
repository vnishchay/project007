// A short history for well-known places, from Wikipedia (CC BY-SA, credited) and Wikidata (CC0).
// Only used when OpenStreetMap links the place to its article or Wikidata item, so it's the right place.
import { http, clip } from "../lib/common.mjs";

async function wikidata(qid) {
  const res = await http(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`);
  return res.ok ? (await res.json()).entities?.[qid] || null : null;
}

/** { history, credit, since } for a place whose OSM tags name a Wikipedia article or Wikidata item, else null. */
export async function wikiFacts(tags) {
  let lang = null, title = null, since = null;
  const w = String(tags.wikipedia || "").match(/^([a-z-]{2,12}):(.+)$/);
  if (w) [, lang, title] = w;
  if (/^Q\d+$/.test(tags.wikidata || "")) {
    const ent = await wikidata(tags.wikidata).catch(() => null);
    since = ent?.claims?.P571?.[0]?.mainsnak?.datavalue?.value?.time?.match(/^\+(\d{4})/)?.[1] || null;
    if (!title) {
      const link = ent?.sitelinks?.enwiki || ent?.sitelinks?.hiwiki;
      if (link) { lang = link.site.replace(/wiki$/, ""); title = link.title; }
    }
  }
  if (!title) return since ? { since } : null;
  const res = await http(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  if (!res.ok) return since ? { since } : null;
  const page = await res.json();
  if (page.type === "disambiguation" || !page.extract) return since ? { since } : null;
  // Whole sentences, up to about 600 characters.
  const sentences = page.extract.match(/[^.!?।]+[.!?।]+/g) || [page.extract];
  let history = "";
  for (const s of sentences) { if ((history + s).length > 600) break; history += s; }
  return {
    since,
    history: clip(history || page.extract, 600),
    credit: `From Wikipedia, "${page.title}", CC BY-SA 4.0: ${page.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`}`,
  };
}
