export function googleReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

export function googleMapsUrl(placeId: string, name: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`;
}

export function qrUrl(token: string): string {
  return `${window.location.origin}/q/${token}`;
}

export function placeUrl(id: string): string {
  return `${window.location.origin}/p/${id}`;
}

export function distanceText(m: number | null | undefined): string {
  if (m == null) return "";
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function priceText(level: number | null | undefined): string {
  return level ? "₹".repeat(level) : "";
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return d === 1 ? "yesterday" : `${d} days ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

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

const AVATAR_COLORS = ["#DCD3FF", "#FFE6B3", "#C9F2EE", "#FFD9CC", "#E8F3EC", "#E3E8FF"];
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
