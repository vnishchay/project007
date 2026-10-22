import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { ReviewRow } from "../lib/types";
import { timeAgo } from "../lib/util";
import { demoArtUrl, isDemoArt } from "../lib/demoArt";
import { isVisitItem, itemLabel, ratingWord, splitTags, tagLabels } from "../lib/reviews";
import { Avatar, Icon, Stars, useToast, type IconName } from "./ui";
import { ItemThumb } from "./place/ItemThumb";
import "../styles/place.css";

export function reviewPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (isDemoArt(path)) return demoArtUrl(path, 800);
  return supabase.storage.from("review-photos").getPublicUrl(path).data.publicUrl;
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
export function roughDate(iso: string): string {
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days < 7) return "this week";
  if (days < 31) return "this month";
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function ReviewPhoto({ path, alt }: { path: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return <img className="rc-photo" src={reviewPhotoUrl(path)!} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}

export function ReviewCard({ r, mine, friend, expert, showPlace = false, itemImage, itemIcon = "food", reveal = false, children }: {
  r: ReviewRow; mine?: boolean;
  /** admin moderation only: show who wrote an anonymous review */
  reveal?: boolean; friend?: boolean; expert?: string | null; showPlace?: boolean;
  /** the product's shop photo (place-media path), shown in the item chip */
  itemImage?: string | null; itemIcon?: IconName; children?: ReactNode;
}) {
  // Anonymous unless the author chose to show their name (admins see who it was only in moderation).
  const anon = !r.user_id || (!r.is_public && !mine && !reveal);
  const name = mine ? "You" : anon ? "Anonymous" : r.author_name || "Someone";
  const { good, bad } = splitTags(tagLabels(r));
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
          <span className="tiny muted">{anon && !mine ? roughDate(r.created_at) : timeAgo(r.created_at)}</span>
        </div>
        {r.verified && <span className="rc-verified" title={r.source === "link" ? "From the shop's review link" : "Scanned at the shop"} aria-label="Verified visit"><Icon name="verified" size={20} /></span>}
      </div>
      <div className="rc-rating">
        <Stars value={r.rating} size={16} />
        <span className="rc-word">{ratingWord(r.rating)}</span>
        {r.items?.name && (isVisitItem(r.items.name)
          ? <span className="rc-chip"><Icon name="store" size={14} />{itemLabel(r.items.name)}</span>
          : <span className="rc-chip"><ItemThumb path={itemImage} icon={itemIcon} size={26} />{r.items.name}</span>)}
        {showPlace && r.places ? <Link to={`/p/${r.place_id}`} className="rc-chip place"><Icon name="store" size={14} />{r.places.name}</Link> : null}
      </div>
      {good.length > 0 && <div className="rc-tags" aria-label="Liked"><Icon name="thumbs" size={14} color="var(--accent)" />{good.map((t) => <span key={t} className="rc-tag">{t}</span>)}</div>}
      {bad.length > 0 && <div className="rc-tags" aria-label="Could be better"><Icon name="thumbsDown" size={14} color="var(--coral)" />{bad.map((t) => <span key={t} className="rc-tag bad">{t}</span>)}</div>}
      {r.body && <p className="rc-body">{r.body}</p>}
      {r.photo_path && <ReviewPhoto path={r.photo_path} alt={`Photo of ${isVisitItem(r.items?.name) ? "the visit" : r.items?.name || "the visit"}`} />}
      {r.voice_path && <VoiceNote path={r.voice_path} />}
      {r.owner_reply && <OwnerReply text={r.owner_reply} at={r.owner_reply_at} shop={r.places?.name} rough={anon && !mine} />}
      <div className="rc-foot">
        {r.source && <span className="tiny muted row" style={{ gap: 4 }}><Icon name={r.source === "link" ? "link" : "qr"} size={12} />{r.source === "link" ? "From the shop's review link" : "Scanned at the shop"}</span>}
        <span className="grow" />
        {!mine && <ReportButton reviewId={r.id} />}
      </div>
      {children}
    </article>
  );
}

/**
 * The shop owner's public answer, as a quiet indented card under the review. Dated the way the review
 * is (`rough` for someone else's anonymous review), so the reply's date can't pin down when it was written.
 */
export function OwnerReply({ text, at, shop, rough = false }: { text: string; at?: string | null; shop?: string | null; rough?: boolean }) {
  const when = at ? (rough ? roughDate(at) : timeAgo(at)) : "";
  return (
    <div className="rc-reply" role="group" aria-label="Reply from the owner">
      <div className="rc-reply-head">
        <span className="rc-reply-ico" aria-hidden="true"><Icon name="store" size={14} /></span>
        <span className="grow stack" style={{ gap: 1, minWidth: 0 }}>
          <span className="small strong">Reply from the owner</span>
          {(shop || when) && <span className="tiny muted ellipsis">{[shop, when].filter(Boolean).join(" · ")}</span>}
        </span>
      </div>
      <p className="rc-reply-body">{text}</p>
    </div>
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
    if (!session) { toast("Sign in to report a review", { label: "Sign in", to: `/signin?next=${encodeURIComponent(window.location.pathname)}` }); return; }
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
  "id, user_id, place_id, item_id, rating, body, ai_drafted, verified, is_public, photo_path, voice_path, status, created_at, author_name, author_avatar, source, owner_reply, owner_reply_at, items(name), places(name, google_place_id, area), review_tags(tags(label))";
