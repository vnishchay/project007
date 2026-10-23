/**
 * Where a business owner came from, for the launch funnel.
 * Outreach links carry ?src=wa-varanasi (or utm_source=...). The first one seen is kept for 30 days
 * in this browser and added to the note on a new listing, so the admin Verify tab shows which channel worked.
 */
const KEY = "tp-src";
const DAYS = 30;

export function rememberSource(search = window.location.search) {
  const p = new URLSearchParams(search);
  const raw = p.get("src") || p.get("utm_source");
  if (!raw) return;
  const src = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  if (!src) return;
  try {
    if (getSource()) return;
    localStorage.setItem(KEY, JSON.stringify({ src, at: Date.now() }));
  } catch { /* private mode: no tracking, nothing breaks */ }
}

export function getSource(): string {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null") as { src: string; at: number } | null;
    if (!v || Date.now() - v.at > DAYS * 864e5) return "";
    return v.src;
  } catch { return ""; }
}
