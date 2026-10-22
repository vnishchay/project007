import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { isNegativeTag, isVisitItem, itemLabel } from "../lib/reviews";
import { ItemThumb } from "../components/place/ItemThumb";
import { useAuth } from "../lib/auth";
import type { ReviewRow, Tag } from "../lib/types";
import { Icon, Spinner, TopBar, useConfirm, useTabKeys, useToast } from "../components/ui";
import { ReviewCard, REVIEW_SELECT } from "../components/ReviewCard";
import { FacePicker } from "../components/FacePicker";
import { Chip, EmptyArt, MenuRow, Retry, SectionTitle, lookFor } from "../components/home/Kit";
import "../styles/home.css";

interface SavedRow { place_id: string; places: { name: string; area: string | null; category: string } | null }
interface Draft { id: string; rating: number; body: string; tags: number[] }
interface OpenVisit { place_id: string; expires_at: string; places: { name: string; area: string | null; category: string } | null }

const TABS = ["reviews", "saved"] as const;
type Tab = (typeof TABS)[number];

/** "45 min left" for a visit that is still open, so people know how long they have to rate. */
function timeLeft(iso: string): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ${mins % 60 ? `${mins % 60} min ` : ""}left` : `Until ${new Date(iso).toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

/** Your picks: what you can rate now, your diary, your reviews and saved places. Profile and settings live on /me. */
export default function Picks() {
  const { session, isGuest } = useAuth();
  const me = session!.user.id;
  const toast = useToast();
  const confirm = useConfirm();
  const [reviews, setReviews] = useState<ReviewRow[] | null>(null);
  const [reviewsErr, setReviewsErr] = useState<string | null>(null);
  const PAGE = 30;
  const [moreReviews, setMoreReviews] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saved, setSaved] = useState<SavedRow[] | null>(null);
  const [savedErr, setSavedErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("reviews");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [savingReview, setSavingReview] = useState(false);
  const [openVisits, setOpenVisits] = useState<OpenVisit[]>([]);
  const tabKeys = useTabKeys(TABS, tab, setTab);

  const loadReviews = useCallback(() => {
    setReviewsErr(null);
    supabase.rpc("my_reviews", { p_limit: PAGE + 1 }).select(REVIEW_SELECT)
      .then(({ data, error }) => {
        if (error) { setReviewsErr(errorText(error)); return; }
        const all = (data as unknown as ReviewRow[]) || [];
        setMoreReviews(all.length > PAGE);
        setReviews(all.slice(0, PAGE));
      });
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  async function showMoreReviews() {
    const last = reviews?.[reviews.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    const { data, error } = await supabase.rpc("my_reviews", { p_before_created: last.created_at, p_before_id: last.id, p_limit: PAGE + 1 }).select(REVIEW_SELECT);
    setLoadingMore(false);
    if (error) { toast(errorText(error)); return; }
    const all = (data as unknown as ReviewRow[]) || [];
    setMoreReviews(all.length > PAGE);
    setReviews((rs) => { const seen = new Set((rs || []).map((x) => x.id)); return [...(rs || []), ...all.slice(0, PAGE).filter((x) => !seen.has(x.id))]; });
  }
  const loadSaved = useCallback(() => {
    setSavedErr(null);
    supabase.from("saved_places").select("place_id, places(name, area, category)").eq("user_id", me).order("created_at", { ascending: false }).limit(300)
      .then(({ data, error }) => { if (error) setSavedErr(errorText(error)); else setSaved((data as unknown as SavedRow[]) || []); });
  }, [me]);
  useEffect(() => { loadReviews(); loadSaved(); }, [loadReviews, loadSaved]);

  // Shops you scanned into recently and can still review (the visit is open).
  useEffect(() => {
    supabase.from("visits").select("place_id, expires_at, places(name, area, category)").eq("user_id", me)
      .gt("expires_at", new Date().toISOString()).order("scanned_at", { ascending: false }).limit(10)
      .then(({ data }) => {
        const seen = new Set<string>();
        setOpenVisits(((data as unknown as OpenVisit[]) || []).filter((v) => v.places && !seen.has(v.place_id) && seen.add(v.place_id)));
      });
  }, [me]);

  async function setVisibility(id: string, isPublic: boolean) {
    const { data, error } = await supabase.from("reviews").update({ is_public: isPublic }).eq("id", id).select("id");
    if (error) { toast(errorText(error)); return; }
    if (!data?.length) { toast("Couldn't change this review"); return; }
    setReviews((rs) => (rs || []).map((x) => (x.id === id ? { ...x, is_public: isPublic } : x)));
    toast(isPublic ? "Your name now shows on this review" : "This review is now anonymous");
  }

  async function remove(r: ReviewRow) {
    const ok = await confirm({ title: "Delete this review?", body: `Your review of ${itemLabel(r.items?.name) || "this"} at ${r.places?.name || "this place"} will be gone for good.`, ok: "Delete", danger: true });
    if (!ok) return;
    const { data, error } = await supabase.from("reviews").delete().eq("id", r.id).select("id");
    if (error) toast(errorText(error));
    else if (!data?.length) toast(isGuest ? "Sign in to delete reviews" : "Couldn't delete this review");
    else { setReviews((rs) => (rs || []).filter((x) => x.id !== r.id)); if (draft?.id === r.id) setDraft(null); toast("Review deleted"); }
  }

  async function startEdit(r: ReviewRow) {
    let list = allTags;
    if (!list.length) {
      const { data } = await supabase.from("tags").select("id, label").order("id");
      list = (data as Tag[]) || [];
      setAllTags(list);
    }
    const labels = new Set((r.review_tags || []).map((t) => t.tags?.label).filter(Boolean));
    setDraft({ id: r.id, rating: r.rating, body: r.body || "", tags: list.filter((t) => labels.has(t.label)).map((t) => t.id) });
  }

  async function saveReview(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const before = reviews?.find((r) => r.id === draft.id);
    setSavingReview(true);
    const body = draft.body.trim();
    const { data, error } = await supabase.from("reviews").update({ rating: draft.rating, body }).eq("id", draft.id).select("id");
    if (error || !data?.length) { setSavingReview(false); toast(error ? errorText(error) : "Couldn't save this review"); return; }
    // Tags: add the new ones, drop the ones taken off. Both are allowed on your own review only.
    const had = new Set((before?.review_tags || []).map((t) => t.tags?.label));
    const hadIds = allTags.filter((t) => had.has(t.label)).map((t) => t.id);
    const add = draft.tags.filter((id) => !hadIds.includes(id));
    const drop = hadIds.filter((id) => !draft.tags.includes(id));
    const errs: string[] = [];
    if (add.length) { const r = await supabase.from("review_tags").insert(add.map((tag_id) => ({ review_id: draft.id, tag_id }))); if (r.error) errs.push(errorText(r.error)); }
    if (drop.length) { const r = await supabase.from("review_tags").delete().eq("review_id", draft.id).in("tag_id", drop); if (r.error) errs.push(errorText(r.error)); }
    setSavingReview(false);
    const labels = allTags.filter((t) => draft.tags.includes(t.id)).map((t) => ({ tags: { label: t.label } }));
    setReviews((rs) => (rs || []).map((r) => (r.id === draft.id ? { ...r, rating: draft.rating, body, review_tags: errs.length ? r.review_tags : labels } : r)));
    setDraft(null);
    toast(errs.length ? "Review saved, but the tags didn't change. Try again." : "Review updated");
  }

  const toggleTag = (id: number) => setDraft((d) => d && ({ ...d, tags: d.tags.includes(id) ? d.tags.filter((x) => x !== id) : [...d.tags, id] }));

  return (
    <div className="page" style={{ gap: 18 }}>
      <TopBar title="Your picks" tone="hero" />

      {/* What you can still rate comes first: it runs out. */}
      {openVisits.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <SectionTitle icon="star" tone="amber">Ready to rate</SectionTitle>
          <div className="menu">
            {openVisits.map((v) => (
              <Link key={v.place_id} to={`/review/${v.place_id}`} className="menu-row">
                <Chip icon={lookFor(v.places!.category).icon} tone={lookFor(v.places!.category).tone} />
                <span className="grow stack tight" style={{ minWidth: 0 }}>
                  <span className="t ellipsis">{v.places!.name}</span>
                  <span className="s ellipsis row" style={{ gap: 4 }}><Icon name="clock" size={12} />{timeLeft(v.expires_at)}{v.places!.area ? ` · ${v.places!.area}` : ""}</span>
                </span>
                <span className="pill verified"><Icon name="star" size={13} />Rate now</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {reviews && <FoodDiary reviews={reviews} />}

      <div className="tabs" role="tablist" aria-label="Your activity" onKeyDown={tabKeys}>
        <button type="button" role="tab" id="t-reviews" aria-controls="p-reviews" tabIndex={tab === "reviews" ? 0 : -1} aria-selected={tab === "reviews"} className={tab === "reviews" ? "on" : ""} onClick={() => setTab("reviews")}>
          <span className="row" style={{ gap: 6, justifyContent: "center" }}><Icon name="star" size={16} />Reviews{reviews ? ` ${reviews.length}${moreReviews ? "+" : ""}` : ""}</span>
        </button>
        <button type="button" role="tab" id="t-saved" aria-controls="p-saved" tabIndex={tab === "saved" ? 0 : -1} aria-selected={tab === "saved"} className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>
          <span className="row" style={{ gap: 6, justifyContent: "center" }}><Icon name="bookmark" size={16} />Saved{saved ? ` ${saved.length}` : ""}</span>
        </button>
      </div>

      {tab === "reviews" ? (
        <div role="tabpanel" id="p-reviews" aria-labelledby="t-reviews" className="stack">
          {reviewsErr ? <Retry msg={`Couldn't load your reviews: ${reviewsErr}`} onRetry={loadReviews} /> :
            reviews === null ? <Spinner /> :
            reviews.length === 0 ? (
              <div className="card">
                <EmptyArt icon="star" tone="amber" title="No reviews yet">
                  <span className="small muted">At a shop, point your phone camera at the QR on your table to review.</span>
                </EmptyArt>
              </div>
            ) : <>
              {reviews.map((r) => {
                const editingThis = draft?.id === r.id;
                const what = itemLabel(r.items?.name) || "this item";
                return (
                  <ReviewCard key={r.id} r={editingThis ? { ...r, rating: draft.rating, body: "", review_tags: [] } : r} mine showPlace>
                    {editingThis ? (
                      <form className="stack" onSubmit={saveReview}>
                        <FacePicker value={draft.rating} onChange={(v) => setDraft({ ...draft, rating: v })} />
                        {allTags.length > 0 && (
                          <div className="stack tight">
                            <span className="small strong">Tags</span>
                            <div className="chips" role="group" aria-label="Tags">
                              {allTags.filter((t) => draft.rating >= 5 ? !isNegativeTag(t.label) : true).slice(0, 40).map((t) => {
                                const on = draft.tags.includes(t.id);
                                return <button key={t.id} type="button" aria-pressed={on} className={`chip ${on ? "on" : ""}`} onClick={() => toggleTag(t.id)}>{on && <Icon name="check" size={13} />}{t.label}</button>;
                              })}
                            </div>
                          </div>
                        )}
                        <div className="field">
                          <label htmlFor={`body-${r.id}`}>Your review</label>
                          <textarea id={`body-${r.id}`} className="textarea" value={draft.body} maxLength={2000}
                            onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                          <span className="tiny muted" style={{ alignSelf: "flex-end" }}>{draft.body.length}/2000</span>
                        </div>
                        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                          <button type="button" className="btn small ghost" onClick={() => setDraft(null)} disabled={savingReview}><Icon name="close" size={16} />Cancel</button>
                          <button className="btn small green" disabled={savingReview}><Icon name="check" size={16} />{savingReview ? "Saving…" : "Save"}</button>
                        </div>
                      </form>
                    ) : (
                      <div className="row wrap review-acts" style={{ gap: 8 }}>
                        {r.status === "hidden" ? <span className="badge red" style={{ marginRight: "auto" }}><Icon name="eyeOff" size={12} />Hidden</span> : <span className="grow" />}
                        {r.status === "published" && (
                          <Link to={`/saved/${r.id}`} className="act-btn sky" aria-label={`Post review of ${what} on Google`}><Icon name="external" size={16} />Google</Link>
                        )}
                        {!isGuest && (
                          <button type="button" className={`act-btn ${r.is_public ? "green" : ""}`} onClick={() => setVisibility(r.id, !r.is_public)}
                            aria-label={r.is_public ? `Make review of ${what} anonymous` : `Show your name on review of ${what}`}>
                            <Icon name={r.is_public ? "eye" : "eyeOff"} size={16} />{r.is_public ? "Named" : "Anonymous"}
                          </button>
                        )}
                        <button type="button" className="act-btn" onClick={() => void startEdit(r)} aria-label={`Edit review of ${what}`}><Icon name="edit" size={16} />Edit</button>
                        {isGuest ? <Link to="/signin" className="tiny muted">Sign in to delete</Link> : (
                          <button type="button" className="act-btn danger" onClick={() => void remove(r)} aria-label={`Delete review of ${what}`}><Icon name="trash" size={16} />Delete</button>
                        )}
                      </div>
                    )}
                  </ReviewCard>
                );
              })}
              {moreReviews && <button type="button" className="btn ghost block" disabled={loadingMore} onClick={showMoreReviews}><Icon name="down" size={18} />{loadingMore ? "Loading…" : "Show older reviews"}</button>}
            </>}
        </div>
      ) : (
        <div role="tabpanel" id="p-saved" aria-labelledby="t-saved">
          {savedErr ? <Retry msg={`Couldn't load saved places: ${savedErr}`} onRetry={loadSaved} /> :
            saved === null ? <Spinner /> :
            saved.length === 0 ? (
              <div className="card">
                <EmptyArt icon="bookmark" tone="sky" title="Nothing saved">
                  <span className="small muted">Tap the bookmark on any shop page to keep it here.</span>
                  <Link to="/" className="btn small ghost"><Icon name="search" size={16} />Discover places</Link>
                </EmptyArt>
              </div>
            ) : (
              <div className="menu">{saved.map((s) => {
                const look = lookFor(s.places?.category);
                return <MenuRow key={s.place_id} to={`/p/${s.place_id}`} icon={look.icon} tone={look.tone} title={s.places?.name || "Place no longer listed"} sub={[s.places?.category, s.places?.area].filter(Boolean).join(" · ")} />;
              })}</div>
            )}
        </div>
      )}
    </div>
  );
}

type DiaryShelf = "loved" | "liked" | "ok" | "skip";
const SHELVES: { id: DiaryShelf; label: string; icon: "heart" | "thumbs" | "minus" | "thumbsDown"; fits: (r: number) => boolean }[] = [
  { id: "loved", label: "Loved", icon: "heart", fits: (r) => r >= 5 },
  { id: "liked", label: "Liked", icon: "thumbs", fits: (r) => r === 4 },
  { id: "ok", label: "It was OK", icon: "minus", fits: (r) => r === 3 },
  { id: "skip", label: "Skip next time", icon: "thumbsDown", fits: (r) => r <= 2 },
];

/** Everything you rated, sorted onto shelves, so "what did I love at that place?" has an answer. */
function FoodDiary({ reviews }: { reviews: ReviewRow[] }) {
  const things = reviews.filter((r) => !isVisitItem(r.items?.name) && r.status === "published");
  const [shelf, setShelf] = useState<DiaryShelf>("loved");
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const ids = [...new Set(things.map((r) => r.item_id))].slice(0, 200);
  const idKey = ids.join(",");
  useEffect(() => {
    if (!ids.length) return;
    let alive = true;
    supabase.from("items").select("id, image_path").in("id", ids).then(({ data }) => {
      if (alive && data) setPhotos(Object.fromEntries((data as { id: string; image_path: string | null }[]).map((i) => [i.id, i.image_path])));
    });
    return () => { alive = false; };
  }, [idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = Object.fromEntries(SHELVES.map((x) => [x.id, things.filter((r) => x.fits(r.rating)).length])) as Record<DiaryShelf, number>;
  const present = SHELVES.filter((x) => counts[x.id]);
  const current = counts[shelf] ? shelf : present[0]?.id ?? "loved";
  const keys = useTabKeys(present.map((x) => x.id), current, setShelf);
  if (!things.length) return null;
  const shown = things.filter((r) => SHELVES.find((x) => x.id === current)!.fits(r.rating));
  return (
    <section className="stack" style={{ gap: 10 }} aria-label="Your picks diary">
      <SectionTitle icon="heart" tone="coral" right={<span className="count-pill"><Icon name="star" size={13} />{things.length}</span>}>Your picks diary</SectionTitle>
      <div className="chips scroll" role="tablist" aria-label="Diary shelves" onKeyDown={keys}>
        {present.map((x) => (
          <button key={x.id} type="button" role="tab" tabIndex={current === x.id ? 0 : -1} aria-selected={current === x.id} className={`chip ${current === x.id ? "on" : ""}`} onClick={() => setShelf(x.id)}>
            <Icon name={x.icon} size={14} />{x.label} {counts[x.id]}
          </button>
        ))}
      </div>
      <div className="hscroll">
        {shown.map((r) => (
          <Link key={r.id} to={`/p/${r.place_id}`} className="pick-card dish-card diary-card">
            <span className="thumb"><ItemThumb path={photos[r.item_id]} /></span>
            <span className="pc-body">
              <span className="strong ellipsis">{itemLabel(r.items?.name)}</span>
              <span className="tiny muted ellipsis">{[r.places?.name, r.places?.area].filter(Boolean).join(" · ")}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
