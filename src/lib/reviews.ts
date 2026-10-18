import type { ReviewRow } from "./types";

/** Review tags that say what could be better; every other tag says what was good. */
export const NEGATIVE_TAGS = new Set([
  "Too pricey", "Slow service", "Crowded",
  "Small portion", "Not fresh", "Served cold", "Too oily", "Rude staff", "Not clean", "Long wait",
  "Poor quality", "Damaged item", "Pushy selling", "Late", "Overcharged", "Rushed", "Old equipment",
  "Poor food", "Poor service", "Noisy", "Unhelpful staff",
]);

export const isNegativeTag = (label: string) => NEGATIVE_TAGS.has(label);

/** The hidden item a review of the whole visit is filed under, so it works like any other review (migration 36). */
export const VISIT_ITEM = "Overall visit";
export const isVisitItem = (name?: string | null) => name === VISIT_ITEM;
/** What to call an item in the app: the whole-visit review reads "Whole visit". */
export const itemLabel = (name?: string | null) => (isVisitItem(name) ? "Whole visit" : name || "");

export function tagLabels(r: ReviewRow): string[] {
  return (r.review_tags || []).map((t) => t.tags?.label).filter(Boolean) as string[];
}

export function splitTags(labels: string[]): { good: string[]; bad: string[] } {
  return { good: labels.filter((l) => !isNegativeTag(l)), bad: labels.filter(isNegativeTag) };
}

export interface ReviewSummary {
  count: number;
  average: number;
  /** index 0 = 1 star ... index 4 = 5 stars */
  stars: number[];
  liked: [string, number][];
  better: [string, number][];
}

export function summarize(reviews: ReviewRow[]): ReviewSummary {
  const stars = [0, 0, 0, 0, 0];
  const counts = new Map<string, number>();
  let sum = 0;
  for (const r of reviews) {
    sum += r.rating;
    stars[Math.min(5, Math.max(1, r.rating)) - 1]++;
    for (const l of tagLabels(r)) counts.set(l, (counts.get(l) || 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  return {
    count: reviews.length,
    average: reviews.length ? sum / reviews.length : 0,
    stars,
    liked: ranked.filter(([l]) => !isNegativeTag(l)).slice(0, 5),
    better: ranked.filter(([l]) => isNegativeTag(l)).slice(0, 3),
  };
}

export type ReviewSort = "useful" | "newest" | "high" | "low";

/** "Most useful": friends first, then reviews with words and photos, then verified, then newest. */
export function sortReviews(list: ReviewRow[], how: ReviewSort, isFriend: (r: ReviewRow) => boolean): ReviewRow[] {
  const time = (r: ReviewRow) => new Date(r.created_at).getTime();
  const useful = (r: ReviewRow) =>
    (isFriend(r) ? 8 : 0) + ((r.body || "").trim().length > 20 ? 3 : 0) + (r.photo_path ? 2 : 0) + (r.verified ? 1 : 0);
  return [...list].sort((a, b) =>
    how === "newest" ? time(b) - time(a)
    : how === "high" ? b.rating - a.rating || time(b) - time(a)
    : how === "low" ? a.rating - b.rating || time(b) - time(a)
    : useful(b) - useful(a) || time(b) - time(a));
}

/** Keyset paging filter for "older than this review", with the id breaking ties between equal times. */
export function olderThan(r: { created_at: string; id: string }): string {
  return `created_at.lt."${r.created_at}",and(created_at.eq."${r.created_at}",id.lt.${r.id})`;
}
