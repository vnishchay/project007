export function googleReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

export function googleMapsUrl(placeId?: string | null, name: string = "", location?: string): string {
  const query = [name, location].filter(Boolean).join(" ");
  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || name)}&query_place_id=${encodeURIComponent(placeId)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || name)}`;
}

export function zomatoSearchUrl(name: string, city: string = "varanasi"): string {
  const c = city.trim().toLowerCase() || "varanasi";
  return `https://www.zomato.com/${encodeURIComponent(c)}/restaurants?q=${encodeURIComponent(name)}`;
}

export function swiggySearchUrl(name: string, city: string = "varanasi"): string {
  const c = city.trim().toLowerCase() || "varanasi";
  return `https://www.swiggy.com/city/${encodeURIComponent(c)}/search?query=${encodeURIComponent(name)}`;
}

export function qrUrl(token: string): string {
  return `${window.location.origin}/q/${token}`;
}

export function placeUrl(id: string): string {
  return `${window.location.origin}/p/${id}`;
}

/** Miles where people use them (US, UK, Liberia, Myanmar), else kilometres. From the phone's region. */
export const usesMiles = (): boolean => {
  try { return /-(US|GB|LR|MM)\b/i.test(new Intl.Locale(navigator.language).maximize().toString()); } catch { return false; }
};
const MILE = 1609.344;

export function distanceText(m: number | null | undefined): string {
  if (m == null) return "";
  if (usesMiles()) return m < 400 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${(m / MILE).toFixed(1)} mi`;
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Choices for how far "Near you" reaches, in metres, with their labels. */
export function radiusChoices(): { m: number; label: string }[] {
  return usesMiles()
    ? [1, 3, 5, 10, 25].map((n) => ({ m: Math.round(n * MILE), label: `${n} mi` }))
    : [2, 5, 10, 25, 50].map((n) => ({ m: n * 1000, label: `${n} km` }));
}
export const defaultRadius = () => (usesMiles() ? Math.round(3 * MILE) : 5000);

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return d === 1 ? "yesterday" : `${d} days ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Plan prices and payments (billing is in rupees). Shop prices use formatPrice() in money.ts. */
export function rupees(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export interface Coords { lat: number; lng: number }

export function getLocation(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    // The browser's own timeout only starts after the permission prompt is answered,
    // so give up on our own if the prompt is ignored.
    const giveUp = setTimeout(() => resolve(null), 10000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(giveUp); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { clearTimeout(giveUp); resolve(null); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

export function initials(name: string | null | undefined): string {
  const n = (name || "").trim();
  if (!n) return "?";
  return n.split(/\s+/).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

const AVATAR_COLORS = ["#DCD3FF", "#FFE6B3", "#C9F2EE", "#FFD9CC", "#f6e6df", "#E3E8FF"];
export function avatarColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** Reads "18.53, 73.89" or a Google Maps link (…/@18.53,73.89,17z or …!3d18.53!4d73.89). */
export function parseCoords(text: string): Coords | null {
  const t = text.trim();
  const m = t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || t.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Today's hours from entries like {"Mon–Sat": "7 am–9 pm", "Sun": "Closed"}. */
export function todaysHours(hours: Record<string, string> | null | undefined, now = new Date()): string | null {
  if (!hours) return null;
  const today = now.getDay();
  for (const [key, val] of Object.entries(hours)) {
    for (const part of key.split(/[,&]/)) {
      const m = part.trim().match(/^([A-Za-z]{3})[a-z]*\s*(?:[–—-]\s*([A-Za-z]{3})[a-z]*)?$/);
      if (!m) {
        if (/daily|every ?day|all days/i.test(part)) return val;
        continue;
      }
      const a = DAYS.findIndex((d) => d.toLowerCase() === m[1]!.toLowerCase());
      const b = m[2] ? DAYS.findIndex((d) => d.toLowerCase() === m[2]!.toLowerCase()) : a;
      if (a < 0 || b < 0) continue;
      const inRange = a <= b ? today >= a && today <= b : today >= a || today <= b;
      if (inRange) return val;
    }
  }
  return null;
}

export const QR_STYLES = {
  paper: { label: "Clean white", dark: "#1d1b22", light: "#FFFFFF" },
  neon: { label: "Neon", dark: "#C6FF3D", light: "#07080D" },
  aurora: { label: "Aurora", dark: "#9B7BFF", light: "#07080D" },
  matrix: { label: "Matrix", dark: "#3DDC84", light: "#07080D" },
} as const;

/**
 * Pulls a Google Place ID out of a Place ID or a Google Maps link that carries one
 * (…place_id:ChIJ…, …query_place_id=ChIJ…). Short maps.app.goo.gl links don't carry it: returns null.
 */
export function extractPlaceId(text: string | null | undefined): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  const inUrl = t.match(/(?:place_id[:=]|query_place_id=|placeid=)([A-Za-z0-9_-]{16,})/);
  if (inUrl) return inUrl[1]!;
  if (/^[A-Za-z0-9_-]{16,}$/.test(t)) return t;
  return null;
}
