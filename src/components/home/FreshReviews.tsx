import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { ReviewRow } from "../../lib/types";
import { ReviewCard, REVIEW_FEED, REVIEW_SELECT } from "../ReviewCard";
import { SectionTitle } from "./Kit";

/** The newest written reviews from the places on this page, so the home page leads with what people said. */
export function FreshReviews({ placeIds }: { placeIds: string[] }) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const key = placeIds.join(",");
  useEffect(() => {
    if (!placeIds.length) { setRows([]); return; }
    let alive = true;
    supabase.from(REVIEW_FEED).select(REVIEW_SELECT).in("place_id", placeIds.slice(0, 40)).eq("status", "published")
      .neq("body", "").order("created_at", { ascending: false }).limit(5)
      .then(({ data, error }) => { if (alive && !error) setRows((data as unknown as ReviewRow[]) || []); }, () => {});
    return () => { alive = false; };
    // placeIds is summarised by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!rows.length) return null;
  return (
    <section className="stack" style={{ gap: 10 }} aria-label="Fresh reviews">
      <SectionTitle icon="star" tone="amber">Fresh reviews</SectionTitle>
      <div className="stack" style={{ gap: 12 }}>
        {rows.map((r) => <ReviewCard key={r.id} r={r} showPlace />)}
      </div>
    </section>
  );
}
