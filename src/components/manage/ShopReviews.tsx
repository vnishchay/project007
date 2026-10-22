import { useEffect, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import type { ReviewRow } from "../../lib/types";
import { timeAgo } from "../../lib/util";
import { itemLabel, olderThan, splitTags, tagLabels } from "../../lib/reviews";
import { OwnerReply, REVIEW_FEED, REVIEW_SELECT, roughDate } from "../ReviewCard";
import { Icon, Stars, useConfirm, useToast } from "../ui";

const PAGE = 10;
const MAX = 600;

/** Anonymous reviews show a rough date here too, as on the shop's page. */
const anonymous = (r: ReviewRow) => !r.user_id || !r.is_public;
const when = (r: ReviewRow) => (anonymous(r) ? roughDate(r.created_at) : timeAgo(r.created_at));

/**
 * The shop's newest reviews, each with a public reply from the owner. Read through review_feed like
 * every other screen, so the owner never sees who wrote an anonymous review.
 */
type Show = "reply" | "low" | "all";
const SHOWS: { id: Show; label: string; icon: "reply" | "thumbsDown" | "list" }[] = [
  { id: "reply", label: "Needs reply", icon: "reply" },
  { id: "low", label: "Low ratings", icon: "thumbsDown" },
  { id: "all", label: "All", icon: "list" },
];

export function ShopReviews({ placeId, shopName }: { placeId: string; shopName: string }) {
  const toast = useToast();
  const [show, setShow] = useState<Show>("reply");
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replying, setReplying] = useState<ReviewRow | null>(null);

  const page = (before?: ReviewRow) => {
    let q = supabase.from(REVIEW_FEED).select(REVIEW_SELECT).eq("place_id", placeId).eq("status", "published");
    if (before) q = q.or(olderThan(before));
    return q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE + 1);
  };

  useEffect(() => {
    let alive = true;
    setRows(null);
    page().then(({ data, error }) => {
      if (!alive) return;
      const all = error ? [] : ((data as unknown as ReviewRow[]) || []);
      setMore(all.length > PAGE);
      setRows(all.slice(0, PAGE));
    });
    return () => { alive = false; };
  }, [placeId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function showMore() {
    const last = rows?.[rows.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    const { data, error } = await page(last);
    setLoadingMore(false);
    if (error) { toast(errorText(error)); return; }
    const all = (data as unknown as ReviewRow[]) || [];
    setMore(all.length > PAGE);
    setRows((prev) => { const seen = new Set((prev || []).map((x) => x.id)); return [...(prev || []), ...all.slice(0, PAGE).filter((x) => !seen.has(x.id))]; });
  }

  if (rows === null) return <div className="skeleton" style={{ height: 120 }} />;
  if (rows.length === 0) return (
    <div className="mg-empty"><span className="icon-chip lg amber"><Icon name="star" size={24} /></span><h2>No reviews yet</h2>
      <p className="small muted" style={{ maxWidth: 270 }}>Customers review after scanning the QR on their table, or from a review link you send.</p></div>
  );
  const counts: Record<Show, number> = { reply: rows.filter((r) => !r.owner_reply).length, low: rows.filter((r) => r.rating <= 2).length, all: rows.length };
  const shown = rows.filter((r) => (show === "reply" ? !r.owner_reply : show === "low" ? r.rating <= 2 : true));

  return (
    <section className="mg-section" style={{ gap: 10 }} aria-label="Reviews">
      <div className="mg-section-head">
        <span className="icon-chip sm amber"><Icon name="message" size={16} /></span>
        <span className="grow">Reviews</span>
      </div>
      <p className="tiny muted" style={{ margin: "-4px 0 6px" }}>Reply to thank customers or put something right. Your reply shows under the review on your page.</p>
      <div className="chips scroll" role="group" aria-label="Show reviews">
        {SHOWS.map((x) => (
          <button key={x.id} type="button" className={`chip ${show === x.id ? "on" : ""}`} aria-pressed={show === x.id} onClick={() => setShow(x.id)}>
            <Icon name={x.icon} size={14} />{x.label} {counts[x.id]}{more && x.id !== "all" ? "+" : ""}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="small muted row" style={{ gap: 6 }}><Icon name="checkCircle" size={16} color="var(--good)" />{show === "reply" ? "You've replied to every review here." : "No low ratings here."}</p>}
      <div className="stack" style={{ gap: 8 }}>
        {shown.map((r) => {
          const { good, bad } = splitTags(tagLabels(r));
          const tags = [...good, ...bad].join(" · ");
          return (
            <div key={r.id} className="card mg-review">
              <div className="row" style={{ gap: 8 }}>
                <Stars value={r.rating} size={13} />
                <span className="small strong grow ellipsis">{itemLabel(r.items?.name)}</span>
                <span className="tiny muted" style={{ flex: "none" }}>{when(r)}</span>
              </div>
              <span className="tiny muted ellipsis">{anonymous(r) || !r.author_name ? "Anonymous" : r.author_name}{r.verified ? " · verified visit" : ""}</span>
              {r.body ? <p className="small mg-review-body">{r.body}</p> : tags ? <p className="small muted mg-review-body">{tags}</p> : null}
              {r.owner_reply && <OwnerReply text={r.owner_reply} at={r.owner_reply_at} shop={shopName} rough={anonymous(r)} />}
              <button type="button" className="btn ghost small" style={{ alignSelf: "flex-end" }} onClick={() => setReplying(r)}>
                <Icon name={r.owner_reply ? "edit" : "reply"} size={15} />{r.owner_reply ? "Edit reply" : "Reply"}
              </button>
            </div>
          );
        })}
      </div>
      {more && <button type="button" className="btn ghost small block" disabled={loadingMore} onClick={showMore}><Icon name="down" size={16} />{loadingMore ? "Loading…" : "Show older reviews"}</button>}
      {replying && (
        <ReplySheet review={replying} shopName={shopName} onClose={() => setReplying(null)}
          onSaved={(text, at) => {
            setRows((rs) => (rs || []).map((x) => (x.id === replying.id ? { ...x, owner_reply: text, owner_reply_at: at } : x)));
            setReplying(null);
          }} />
      )}
    </section>
  );
}

/** Write, change or delete the reply to one review. */
function ReplySheet({ review, shopName, onClose, onSaved }: {
  review: ReviewRow; shopName: string; onClose: () => void; onSaved: (text: string | null, at: string | null) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [text, setText] = useState(review.owner_reply || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  async function save(remove: boolean) {
    const body = remove ? "" : text.trim();
    if (!remove && !body) { setErr("Write your reply first"); return; }
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("reply_to_review", { p_review_id: review.id, p_text: body });
    setBusy(false);
    if (error) { setErr(error.code === "PGRST202" ? "Replies aren't available yet." : errorText(error)); return; }
    toast(remove ? "Reply deleted" : "Reply posted");
    onSaved(remove ? null : body, remove ? null : ((data as string | null) ?? new Date().toISOString()));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet mg-sheet" role="dialog" aria-modal="true" aria-label="Reply to a review" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <div className="mg-grabber" />
        <div className="mg-sheet-head">
          <span className="icon-chip sm sky"><Icon name="reply" size={16} /></span>
          <h2>{review.owner_reply ? "Edit your reply" : "Reply to review"}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="mg-review-quote">
          <span className="row" style={{ gap: 8 }}>
            <Stars value={review.rating} size={13} />
            <span className="small strong grow ellipsis">{itemLabel(review.items?.name)}</span>
            <span className="tiny muted" style={{ flex: "none" }}>{when(review)}</span>
          </span>
          {review.body && <p className="small">{review.body}</p>}
        </div>
        <div className="field">
          <label className="mg-label" htmlFor="owner-reply"><Icon name="message" size={15} />Your reply</label>
          <textarea id="owner-reply" className="textarea" style={{ minHeight: 110 }} maxLength={MAX} value={text} autoFocus
            onChange={(e) => setText(e.target.value)} placeholder="Thank them, or say what you'll do about it" />
          <span className="tiny muted" style={{ alignSelf: "flex-end" }}>{text.length}/{MAX}</span>
        </div>
        <p className="tiny muted row" style={{ gap: 6, margin: 0 }}><Icon name="globe" size={13} />Anyone can read it under the review, from {shopName}.</p>
        {err && <div className="notice err small" role="alert">{err}</div>}
        <div className="row">
          {review.owner_reply && (
            <button type="button" className="btn danger" aria-label="Delete reply" disabled={busy} style={{ width: 52, padding: 0 }}
              onClick={() => void confirm({ title: "Delete your reply?", body: "It disappears from under the review on your page.", ok: "Delete", danger: true }).then((ok) => { if (ok) void save(true); })}><Icon name="trash" size={19} /></button>
          )}
          <button className="btn green grow" disabled={busy}>{busy ? "Saving…" : <><Icon name="send" size={18} />{review.owner_reply ? "Save reply" : "Post reply"}</>}</button>
        </div>
      </form>
    </div>
  );
}
