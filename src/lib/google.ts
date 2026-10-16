// Live Google rating via Places API (New). Google's terms don't allow storing
// this, so it's fetched each time and shown with Google attribution.
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;

export interface GoogleRating { rating: number; count: number; mapsUri: string | null }

export async function fetchGoogleRating(placeId: string): Promise<GoogleRating | null> {
  if (!KEY || !placeId) return null;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": "rating,userRatingCount,googleMapsUri" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { rating?: number; userRatingCount?: number; googleMapsUri?: string };
    if (j.rating == null) return null;
    return { rating: j.rating, count: j.userRatingCount ?? 0, mapsUri: j.googleMapsUri ?? null };
  } catch {
    return null;
  }
}
