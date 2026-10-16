import type { ReviewRow } from "./types";

// Same formula as search_places() in the database:
// score = (sum w*r + k*prior) / (sum w + k), w = rel * ver * 0.5^(age/180)
export function trustScore(reviews: ReviewRow[], following: Set<string>, prior = 3.5, k = 3): number | null {
  if (!reviews.length) return null;
  let num = 0;
  let den = 0;
  for (const r of reviews) {
    const rel = following.has(r.user_id) ? 3 : 1;
    const ver = r.visit_id ? 1.5 : 1;
    const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86400000;
    const w = rel * ver * Math.pow(0.5, ageDays / 180);
    num += w * r.rating;
    den += w;
  }
  return Math.round(((num + k * prior) / (den + k)) * 10) / 10;
}
