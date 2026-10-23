import { errorText } from "../../lib/supabase";

/** Writing updates lives in Messages.tsx, next to offers. */
export interface PlaceUpdate { id: string; body: string; link_url: string | null; created_at: string }

export function friendlyUpdateError(e: unknown): string {
  const t = errorText(e);
  if (/3 updates a day/i.test(t)) return "You've posted 3 updates today. Post again tomorrow.";
  if (/can't mention reviews/i.test(t)) return "News can't mention reviews, ratings, stars or feedback. Google removes reviews that were rewarded.";
  if (/place_updates_link_url_check|link_url/i.test(t)) return "The link needs to start with https://";
  return t;
}
