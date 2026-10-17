import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { ReviewRow } from "../lib/types";
import { timeAgo } from "../lib/util";
import { Avatar, Icon, Stars, useToast, type IconName } from "./ui";
import { ItemThumb } from "./place/ItemThumb";
import "../styles/place.css";

export function reviewPhotoUrl(path: string | null | undefined): string | null {
  return path ? supabase.storage.from("review-photos").getPublicUrl(path).data.publicUrl : null;
}

export function VoiceNote({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("voice").createSignedUrl(path, 3600).then(({ data }) => setSrc(data?.signedUrl ?? null));
  }, [path]);
  return src ? (
    <div className="rc-voice">
      <span className="icon-chip sm sky"><Icon name="mic" size={16} /></span>
      <audio controls preload="none" src={src} aria-label="Voice note" />
    </div>
  ) : null;
}

// Anonymous reviews show only a rough date, so a time can't point to a person.
function roughDate(iso: string): string {
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days < 7) return "this week";
  if (days < 31) return "this month";
  return new Date(iso).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function ReviewPhoto({ path, alt }: { path: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return <img className="rc-photo" src={reviewPhotoUrl(path)!} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}

export function ReviewCard({ r, mine, friend, expert, showPlace = false, itemImage, itemIcon = "food", children }: {
  r: ReviewRow; mine?: boolean; friend?: boolean; expert?: string | null; showPlace?: boolean;
  /** the product's shop photo (place-media path), shown in the item chip */
  itemImage?: string | null; itemIcon?: IconName; children?: ReactNode;
}) {
  const anon = !r.user_id;
  const name = mine ? "You" : anon ? "Anonymous" : r.author_name || "Someone";
  const tags = (r.review_tags || []).map((t) => t.tags?.label).filter(Boolean) as string[];
  const who = anon || !r.author_name
    ? <span className="avatar rc-anon" aria-hidden="true"><Icon name="user" size={20} /></span>
    : <Link to={`/u/${r.user_id}`} aria-label={`${name}'s profile`}><Avatar id={r.user_id!} name={r.author_name} path={r.author_avatar} /></Link>;
  return (
    <article className="rc">
      <div className="rc-head">
        {who}
        <div className="grow stack" style={{ gap: 3 }}>
          <span className="row wrap" style={{ gap: 6 }}>
            {anon ? <span className="strong">{name}</span> : <Link to={`/u/${r.user_id}`} className="strong" style={{ color: "inherit" }}>{name}</Link>}
            {mine && <span className={`badge ${r.is_public ? "" : "gray"}`}><Icon name={r.is_public ? "eye" : "eyeOff"} size={12} />{r.is_public ? "Named" : "Anonymous"}</span>}
            {friend && !mine && <span className="badge"><Icon name="people" size={12} />Friend</span>}
            {expert && !mine && <span className="badge warn"><Icon name="award" size={12} />{expert}</span>}
          </span>
          <span className="row" style={{ gap: 8 }}>
            <Stars value={r.rating} size={15} />
            <span className="tiny muted">{anon && !mine ? roughDate(r.created_at) : timeAgo(r.created_at)}</span>
          </span>
        </div>
        {r.verified && <span className="rc-verified" title={r.source === "link" ? "From the shop's review link" : "Scanned at the shop"} aria-label="Verified visit"><Icon name="verified" size={20} /></span>}
      </div>
      {(r.items?.name || (showPlace && r.places)) && (
        <div className="rc-item">
          {r.items?.name && <span className="rc-chip"><ItemThumb path={itemImage} icon={itemIcon} size={26} />{r.items.name}</span>}
          {showPlace && r.places ? <Link to={`/p/${r.place_id}`} className="rc-chip place"><Icon name="store" size={14} />{r.places.name}</Link> : null}
        </div>
      )}
      {r.body && <p className="rc-body">{r.body}</p>}
      {r.photo_path && <ReviewPhoto path={r.photo_path} alt={`Photo of ${r.items?.name || "the order"}`} />}
      {r.voice_path && <VoiceNote path={r.voice_path} />}
      {tags.length > 0 && <div className="rc-tags">{tags.map((t) => <span key={t} className="rc-tag">{t}</span>)}</div>}
      <div className="rc-foot">
        {r.source && <span className="tiny muted row" style={{ gap: 4 }}><Icon name={r.source === "link" ? "link" : "qr"} size={12} />{r.source === "link" ? "From the shop's review link" : "Scanned at the shop"}</span>}
        <span className="grow" />
        {!mine && <ReportButton reviewId={r.id} />}
      </div>
      {children}
    </article>
  );
}

const REASONS: [string, string][] = [["fake", "Looks fake"], ["offensive", "Rude or offensive"], ["wrong_place", "Wrong shop"], ["personal_info", "Shares personal details"], ["other", "Something else"]];

/** Anyone can flag a review for the Trusted Picks team. Who reported stays private. */
function ReportButton({ reviewId }: { reviewId: string }) {
  const { session } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <span className="tiny muted row" style={{ gap: 4 }}><Icon name="check" size={12} />Reported</span>;
  async function send(reason: string) {
    if (!session) { toast("Sign in or scan a shop QR to report"); return; }
    const { error } = await supabase.rpc("report_review", { p_review: reviewId, p_reason: reason });
    setOpen(false);
    if (error) toast(errorText(error)); else { setDone(true); toast("Thanks. We'll take a look."); }
  }
  return (
    <span className="rc-report">
      <button type="button" className="icon-btn sm" aria-label="Report this review" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="flag" size={15} /></button>
      {open && (
        <span className="rc-report-menu" role="menu">
          {REASONS.map(([k, label]) => <button key={k} type="button" role="menuitem" onClick={() => send(k)}>{label}</button>)}
        </span>
      )}
    </span>
  );
}

// Reviews are read through the review_feed view, which hides who wrote anonymous ones.
export const REVIEW_FEED = "review_feed";
export const REVIEW_SELECT =
  "id, user_id, place_id, item_id, rating, body, ai_drafted, verified, is_public, photo_path, voice_path, status, created_at, author_name, author_avatar, source, items(name), places(name, google_place_id, area), review_tags(tags(label))";
