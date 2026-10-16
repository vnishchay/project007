import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { ReviewRow } from "../lib/types";
import { timeAgo } from "../lib/util";
import { Avatar, Stars } from "./ui";

export function reviewPhotoUrl(path: string | null | undefined): string | null {
  return path ? supabase.storage.from("review-photos").getPublicUrl(path).data.publicUrl : null;
}

function VoiceNote({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("voice").createSignedUrl(path, 3600).then(({ data }) => setSrc(data?.signedUrl ?? null));
  }, [path]);
  return src ? <audio controls preload="none" src={src} style={{ width: "100%", height: 36 }} aria-label="Voice note" /> : null;
}

export function ReviewCard({ r, mine, friend, expert, showPlace = false, children }: { r: ReviewRow; mine?: boolean; friend?: boolean; expert?: string | null; showPlace?: boolean; children?: ReactNode }) {
  const name = mine ? "You" : r.profiles?.display_name || "Someone";
  const tags = (r.review_tags || []).map((t) => t.tags?.label).filter(Boolean) as string[];
  return (
    <div className="card">
      <div className="row">
        <Link to={`/u/${r.user_id}`}><Avatar id={r.user_id} name={r.profiles?.display_name} path={r.profiles?.avatar_path} /></Link>
        <div className="grow stack tight">
          <span className="row" style={{ gap: 6 }}>
            <Link to={`/u/${r.user_id}`} className="strong" style={{ color: "inherit" }}>{name}</Link>
            {friend && !mine && <span className="badge gray">You follow</span>}
            {expert && !mine && <span className="badge">{expert} expert</span>}
          </span>
          <span className="tiny muted">
            {r.visit_id ? <span className="green strong">✓ Verified visit · </span> : null}
            {timeAgo(r.created_at)}
          </span>
        </div>
        <Stars value={r.rating} />
      </div>
      <div className="small strong">
        {r.items?.name}
        {showPlace && r.places ? <> · <Link to={`/p/${r.place_id}`}>{r.places.name}</Link></> : null}
      </div>
      {r.body && <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--ink-2)" }}>{r.body}</p>}
      {r.photo_path && <img src={reviewPhotoUrl(r.photo_path)!} alt={`Photo of ${r.items?.name || "the order"}`} loading="lazy" style={{ width: "100%", maxHeight: 280, objectFit: "cover", borderRadius: 12 }} />}
      {r.voice_path && <VoiceNote path={r.voice_path} />}
      {tags.length > 0 && <div className="chips">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
      {children}
    </div>
  );
}

export const REVIEW_SELECT =
  "id, user_id, place_id, item_id, rating, body, ai_drafted, visit_id, photo_path, voice_path, status, created_at, items(name), places(name, google_place_id, area), profiles(display_name, avatar_path), review_tags(tags(label))";
