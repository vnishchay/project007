import { InviteCard } from "../components/home/InviteCard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { isVisitItem, itemLabel, olderThan } from "../lib/reviews";
import { ItemThumb } from "../components/place/ItemThumb";
import { InstallNudge } from "../components/Install";
import { useAuth } from "../lib/auth";
import type { ReviewRow } from "../lib/types";
import { placeMediaUrl, shrinkImage } from "../lib/media";
import { copyText } from "../lib/util";
import { triggerConfetti } from "../lib/confetti";
import { Avatar, Icon, Spinner, StarInput, TopBar, useToast } from "../components/ui";
import { ReviewCard, REVIEW_SELECT, REVIEW_FEED } from "../components/ReviewCard";
import { Chip, Cover, EmptyArt, Glyph, MenuRow, Retry, SectionTitle, lookFor } from "../components/home/Kit";
import "../styles/home.css";

interface SavedRow { place_id: string; places: { name: string; area: string | null; category: string } | null }
interface Draft { id: string; rating: number; body: string }
interface MyPlace { id: string; name: string; area: string | null; city: string; status: string; cover_path: string | null; logo_path: string | null }

interface OpenVisit { place_id: string; expires_at: string; places: { name: string; area: string | null; category: string } | null }

export default function Me() {
  const { session, profile, refreshProfile, signOut, isAdmin, isGuest } = useAuth();
  const me = session!.user.id;
  const email = session!.user.email;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile?.display_name || "");
  const [city, setCity] = useState(profile?.city || "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reviews, setReviews] = useState<ReviewRow[] | null>(null);
  const [reviewsErr, setReviewsErr] = useState<string | null>(null);
  const PAGE = 30;
  const [moreReviews, setMoreReviews] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saved, setSaved] = useState<SavedRow[] | null>(null);
  const [savedErr, setSavedErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"reviews" | "saved">("reviews");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [shops, setShops] = useState<MyPlace[]>([]);

  useEffect(() => { setName(profile?.display_name || ""); setCity(profile?.city || ""); }, [profile]);

  const loadReviews = useCallback(() => {
    setReviewsErr(null);
    supabase.rpc("my_reviews", { p_limit: PAGE + 1 }).select(REVIEW_SELECT)
      .then(({ data, error }) => {
        if (error) { setReviewsErr(errorText(error)); return; }
        const all = (data as unknown as ReviewRow[]) || [];
        setMoreReviews(all.length > PAGE);
        setReviews(all.slice(0, PAGE));
      });
  }, [me]);
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
  const [openVisits, setOpenVisits] = useState<OpenVisit[]>([]);
  useEffect(() => {
    supabase.from("visits").select("place_id, expires_at, places(name, area, category)").eq("user_id", me)
      .gt("expires_at", new Date().toISOString()).order("scanned_at", { ascending: false }).limit(10)
      .then(({ data }) => {
        const seen = new Set<string>();
        setOpenVisits(((data as unknown as OpenVisit[]) || []).filter((v) => v.places && !seen.has(v.place_id) && seen.add(v.place_id)));
      });
  }, [me]);

  // Friends and your shops. Both quietly stay empty on a database without them.
  useEffect(() => {
    if (isGuest) return;
    supabase.rpc("my_friends").then(({ data, error }) => { if (!error) setFriendCount(((data as unknown[]) || []).length); });
    supabase.rpc("my_places").then(({ data, error }) => { if (!error) setShops((data as MyPlace[]) || []); });
  }, [me, isGuest]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast("Add your name"); return; }
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ display_name: name.trim(), city: city.trim() || null }).eq("id", me);
    setBusy(false);
    if (error) toast(errorText(error)); else { await refreshProfile(); setEditing(false); toast("Profile saved"); }
  }

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith("image/")) { toast("Pick an image file"); return; }
    if (file.size > 15 * 1024 * 1024) { toast("Pick a photo under 15 MB"); return; }
    setUploading(true);
    try {
      // Re-encoded so the photo's location and camera details never leave the phone.
      const blob = await shrinkImage(file, 512, 0.85).catch(() => null);
      if (!blob) { toast("Couldn't read that photo. Try a JPEG or PNG."); return; }
      const path = `${me}/avatar-${Date.now()}.jpg`;
      const up = await supabase.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (up.error) { toast(errorText(up.error)); return; }
      const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", me);
      if (error) toast(errorText(error)); else { await refreshProfile(); toast("Photo updated"); }
    } finally {
      setUploading(false);
    }
  }

  async function setVisibility(id: string, isPublic: boolean) {
    const { data, error } = await supabase.from("reviews").update({ is_public: isPublic }).eq("id", id).select("id");
    if (error) { toast(errorText(error)); return; }
    if (!data?.length) { toast("Couldn't change this review"); return; }
    setReviews((rs) => (rs || []).map((x) => (x.id === id ? { ...x, is_public: isPublic } : x)));
    toast(isPublic ? "Your name now shows on this review" : "This review is now anonymous");
  }

  async function remove(id: string) {
    if (!confirm("Delete this review?")) return;
    const { data, error } = await supabase.from("reviews").delete().eq("id", id).select("id");
    if (error) toast(errorText(error));
    else if (!data?.length) toast(isGuest ? "Sign in to delete reviews" : "Couldn't delete this review");
    else { setReviews((rs) => (rs || []).filter((r) => r.id !== id)); if (draft?.id === id) setDraft(null); toast("Review deleted"); }
  }

  async function saveReview(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (draft.rating < 1 || draft.rating > 5) { toast("Pick 1 to 5 stars"); return; }
    setSavingReview(true);
    const body = draft.body.trim();
    const { data, error } = await supabase.from("reviews").update({ rating: draft.rating, body }).eq("id", draft.id).select("id");
    setSavingReview(false);
    if (error) { toast(errorText(error)); return; }
    if (!data?.length) { toast("Couldn't save this review"); return; }
    setReviews((rs) => (rs || []).map((r) => (r.id === draft.id ? { ...r, rating: draft.rating, body } : r)));
    setDraft(null);
    toast("Review updated");
  }

  async function doSignOut() {
    setSigningOut(true);
    try { await signOut(); } catch (e) { toast(errorText(e)); setSigningOut(false); }
  }

  const verified = (reviews || []).filter((r) => r.verified).length;
  const named = (reviews || []).filter((r) => r.is_public).length;

  return (
    <div className="page" style={{ gap: 18 }}>
      <TopBar title="Your profile" tone={isGuest ? "sunset" : "hero"} />
      {isGuest ? (
        <header className="hero sunset">
          <div className="row" style={{ gap: 12 }}>
            <span className="success-burst"><Glyph name="ghost" size={34} color="#fff" /></span>
            <div className="grow stack tight">
              <h1 style={{ fontSize: 24 }}>Guest</h1>
              <span className="hero-sub"><Icon name="eyeOff" size={16} />Your reviews are anonymous</span>
            </div>
          </div>
          <div className="stat-tiles">
            <div className="stat-tile"><span className="n"><Icon name="star" size={16} />{reviews?.length ?? "–"}</span><span className="l">reviews</span></div>
            <div className="stat-tile"><span className="n"><Icon name="verified" size={16} />{reviews ? verified : "–"}</span><span className="l">verified</span></div>
            <div className="stat-tile"><span className="n"><Icon name="lock" size={16} /></span><span className="l">this device</span></div>
          </div>
          <Link to="/signin" className="btn white block" style={{ color: "#9c4733" }}><Icon name="login" size={18} />Keep my picks diary (optional)</Link>
        </header>
      ) : (
        <>
          <header className="hero">
            <div className="row" style={{ gap: 14 }}>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-label={uploading ? "Uploading photo" : "Change photo"}
                style={{ position: "relative", border: 0, padding: 0, background: "none", borderRadius: "50%", cursor: uploading ? "wait" : "pointer", flex: "none" }}
              >
                <span style={{ opacity: uploading ? 0.5 : 1, display: "block" }}>
                  <Avatar id={me} name={profile?.display_name} path={profile?.avatar_path} size="lg" />
                </span>
                <span aria-hidden="true" style={{ position: "absolute", right: -4, bottom: -4, width: 24, height: 24, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: "var(--green-dark)" }}>
                  <Icon name="camera" size={13} width={2.4} />
                </span>
              </button>
              <input
                ref={fileRef} type="file" accept="image/*" hidden tabIndex={-1}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadAvatar(f); }}
              />
              <div className="grow stack tight" style={{ minWidth: 0 }}>
                <span className="strong ellipsis" style={{ fontSize: 20 }}>{profile?.display_name || "Add your name"}</span>
                <span className="hero-sub ellipsis" title={email || undefined}>
                  <Glyph name={email ? "mail" : "user"} size={14} />
                  <span className="ellipsis">{email || session!.user.phone || "Signed in"}</span>
                </span>
                {profile?.city && <span className="hero-sub"><Icon name="pin" size={14} />{profile.city}</span>}
                {uploading && <span className="hero-sub" role="status">Uploading photo…</span>}
              </div>
              <button type="button" className="glass-btn round" aria-label="Edit profile" aria-expanded={editing} title="Edit profile" onClick={() => setEditing((v) => !v)}>
                <Icon name={editing ? "close" : "edit"} size={18} />
              </button>
            </div>
            <div className="stat-tiles">
              <div className="stat-tile"><span className="n"><Icon name="star" size={16} />{reviews?.length ?? "–"}</span><span className="l">reviews</span></div>
              <div className="stat-tile"><span className="n"><Icon name="verified" size={16} />{reviews ? verified : "–"}</span><span className="l">verified</span></div>
              <div className="stat-tile"><span className="n"><Icon name="people" size={16} />{friendCount ?? "–"}</span><span className="l">{friendCount === 1 ? "friend" : "friends"}</span></div>
            </div>
          </header>

          {editing && (
            <form className="card" onSubmit={saveProfile}>
              <SectionTitle icon="edit" tone="sky">Your profile</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                <div className="field"><label htmlFor="n">Name</label><input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" /></div>
                <div className="field"><label htmlFor="c">City</label><input id="c" className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Pune" maxLength={60} autoComplete="address-level2" /></div>
              </div>
              <button className="btn green block" disabled={busy}><Icon name="check" size={18} />{busy ? "Saving…" : "Save"}</button>
            </form>
          )}

          <FoodPassport reviews={reviews || []} city={profile?.city} userId={me} />

          <InviteCard />

          <div className="menu">
            {shops.map((s) => (
              <Link key={s.id} to={`/manage/${s.id}`} className="menu-row">
                <span className="thumb" style={{ width: 40, height: 40, borderRadius: 12 }}><Cover url={placeMediaUrl(s.logo_path) || placeMediaUrl(s.cover_path)} category={s.name} size={20} /></span>
                <span className="grow stack tight" style={{ minWidth: 0 }}>
                  <span className="t ellipsis">{s.name}</span>
                  <span className="s ellipsis row" style={{ gap: 4 }}><Icon name="store" size={12} />Your shop{s.area ? ` · ${s.area}` : ""}{s.status !== "live" ? ` · ${s.status}` : ""}</span>
                </span>
                <Icon name="settings" size={18} color="var(--muted)" />
              </Link>
            ))}
            <MenuRow to="/business" icon={shops.length ? "plus" : "store"} tone="amber" title={shops.length ? "Add another business" : "List your business"} />
            {isAdmin && <MenuRow to="/admin" icon="shield" tone="sky" title="Admin" />}
          </div>

          <div className="callout green">
            <Chip icon={named ? "eye" : "eyeOff"} size="sm" />
            <span className="small grow">{named ? `${named} review${named === 1 ? " shows" : "s show"} your name. The rest are anonymous.` : "All your reviews are anonymous. You can show your name on any of them."}</span>
          </div>
        </>
      )}

      {reviews && <FoodDiary reviews={reviews} />}

      <InstallNudge look="row" title="Add to home screen" sub="Open Trusted Picks like an app" />

      {openVisits.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <SectionTitle icon="star" tone="amber">Ready to rate</SectionTitle>
          <div className="menu">
            {openVisits.map((v) => (
              <Link key={v.place_id} to={`/review/${v.place_id}`} className="menu-row">
                <Chip icon={lookFor(v.places!.category).icon} tone={lookFor(v.places!.category).tone} />
                <span className="grow stack tight" style={{ minWidth: 0 }}>
                  <span className="t ellipsis">{v.places!.name}</span>
                  <span className="s ellipsis">{[v.places!.area, "you scanned here"].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="pill verified"><Icon name="star" size={13} />Rate now</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="tabs" role="tablist" aria-label="Your activity">
        <button type="button" role="tab" aria-selected={tab === "reviews"} className={tab === "reviews" ? "on" : ""} onClick={() => setTab("reviews")}>
          <span className="row" style={{ gap: 6, justifyContent: "center" }}><Icon name="star" size={16} />Reviews{reviews ? ` ${reviews.length}${moreReviews ? "+" : ""}` : ""}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>
          <span className="row" style={{ gap: 6, justifyContent: "center" }}><Icon name="bookmark" size={16} />Saved{saved ? ` ${saved.length}` : ""}</span>
        </button>
      </div>

      {tab === "reviews" ? (
        reviewsErr ? <Retry msg={`Couldn't load your reviews: ${reviewsErr}`} onRetry={loadReviews} /> :
        reviews === null ? <Spinner /> :
        reviews.length === 0 ? (
          <div className="card">
            <EmptyArt icon="star" tone="amber" title="No reviews yet">
              <span className="small muted">At a shop, point your phone camera at the QR on your table to review.</span>
            </EmptyArt>
          </div>
        ) : (
          <div className="stack">
            {reviews.map((r) => {
              const editingThis = draft?.id === r.id;
              const what = itemLabel(r.items?.name) || "this item";
              return (
                <ReviewCard key={r.id} r={editingThis ? { ...r, rating: draft.rating, body: "" } : r} mine showPlace>
                  {editingThis ? (
                    <form className="stack" onSubmit={saveReview}>
                      <StarInput value={draft.rating} onChange={(v) => setDraft({ ...draft, rating: v })} />
                      <div className="field">
                        <label htmlFor={`body-${r.id}`}>Your review</label>
                        <textarea id={`body-${r.id}`} className="textarea" value={draft.body} maxLength={2000}
                          onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                        <span className="tiny muted" style={{ alignSelf: "flex-end" }}>{draft.body.length}/2000</span>
                      </div>
                      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                        <button type="button" className="icon-act" onClick={() => setDraft(null)} disabled={savingReview} aria-label="Cancel" title="Cancel"><Icon name="close" size={18} /></button>
                        <button className="btn small green" disabled={savingReview}><Icon name="check" size={16} />{savingReview ? "Saving…" : "Save"}</button>
                      </div>
                    </form>
                  ) : (
                    <div className="row" style={{ gap: 8 }}>
                      {r.status === "hidden" ? <span className="badge red" style={{ marginRight: "auto" }}><Icon name="eyeOff" size={12} />Hidden</span> : <span className="grow" />}
                      {r.status === "published" && (
                        <Link to={`/saved/${r.id}`} className="icon-act sky" aria-label={`Post review of ${what} on Google`} title="Post on Google"><Icon name="external" size={18} /></Link>
                      )}
                      {!isGuest && (
                        <button type="button" className={`icon-act ${r.is_public ? "green" : ""}`} onClick={() => setVisibility(r.id, !r.is_public)}
                          aria-label={r.is_public ? `Make review of ${what} anonymous` : `Show your name on review of ${what}`}
                          title={r.is_public ? "Name shown. Tap to hide" : "Anonymous. Tap to show name"}>
                          <Icon name={r.is_public ? "eye" : "eyeOff"} size={18} />
                        </button>
                      )}
                      <button type="button" className="icon-act" onClick={() => setDraft({ id: r.id, rating: r.rating, body: r.body || "" })}
                        aria-label={`Edit review of ${what}`} title="Edit"><Icon name="edit" size={18} /></button>
                      {isGuest ? <Link to="/signin" className="tiny muted">Sign in to delete</Link> : (
                        <button type="button" className="icon-act danger" onClick={() => remove(r.id)}
                          aria-label={`Delete review of ${what}`} title="Delete"><Icon name="trash" size={18} /></button>
                      )}
                    </div>
                  )}
                </ReviewCard>
              );
            })}
            {moreReviews && <button type="button" className="btn ghost block" disabled={loadingMore} onClick={showMoreReviews}><Icon name="down" size={18} />{loadingMore ? "Loading…" : "Show older reviews"}</button>}
          </div>
        )
      ) : (
        savedErr ? <Retry msg={`Couldn't load saved places: ${savedErr}`} onRetry={loadSaved} /> :
        saved === null ? <Spinner /> :
        saved.length === 0 ? (
          <div className="card">
            <EmptyArt icon="bookmark" tone="sky" title="Nothing saved">
              <Link to="/" className="btn small ghost"><Icon name="search" size={16} />Discover places</Link>
            </EmptyArt>
          </div>
        ) : (
          <div className="menu">{saved.map((s) => {
            const look = lookFor(s.places?.category);
            return <MenuRow key={s.place_id} to={`/p/${s.place_id}`} icon={look.icon} tone={look.tone} title={s.places?.name || "Place no longer listed"} sub={[s.places?.category, s.places?.area].filter(Boolean).join(" · ")} />;
          })}</div>
        )
      )}

      {!isGuest && (
        <div className="menu">
          <MenuRow icon="logout" tone="coral" title={signingOut ? "Signing out…" : "Sign out"} onClick={doSignOut} right={<span />} />
        </div>
      )}
    </div>
  );
}

function FoodPassport({ reviews, city, userId }: { reviews: ReviewRow[]; city?: string | null; userId?: string }) {
  const toast = useToast();
  const [expertBadges, setExpertBadges] = useState<string[]>([]);
  const verifiedCount = reviews.filter((r) => r.verified).length;
  const placeCount = new Set(reviews.map((r) => r.place_id)).size;
  const mustTryCount = reviews.filter((r) => r.rating === 5).length;

  useEffect(() => {
    if (!userId) return;
    supabase
      .from("user_topic_stats")
      .select("review_count, is_expert, topics(name)")
      .eq("user_id", userId)
      .eq("is_expert", true)
      .then(({ data, error }) => {
        if (!error && data) {
          const list = (data as unknown as { topics: { name: string } | null }[])
            .map((t) => t.topics?.name || "")
            .filter(Boolean);
          setExpertBadges(list);
        }
      });
  }, [userId]);

  const areas = Array.from(
    new Set(reviews.map((r) => r.places?.area).filter(Boolean))
  ).slice(0, 4) as string[];

  async function sharePassport() {
    const text = `My Picks Journal on Trusted Picks: ${reviews.length} things reviewed across ${placeCount} local spots.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "My Picks Journal", text, url: window.location.href });
      } catch {
        /* dismissed */
      }
    } else {
      await copyText(`${text}\n${window.location.href}`);
      toast("Profile summary link copied");
    }
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row between" style={{ alignItems: "center" }}>
        <div className="stack tight">
          <span className="strong" style={{ fontSize: 17 }}>Picks Journal</span>
          <span className="tiny muted">{city ? `${city} Chapter` : "Verified Activity"}</span>
        </div>
        <span className="badge green">
          <Icon name="verified" size={13} />
          <span>{verifiedCount} Verified</span>
        </span>
      </div>

      <div className="stats" style={{ margin: "4px 0", borderTop: "0.5px solid var(--line-soft)", borderBottom: "0.5px solid var(--line-soft)" }}>
        <div className="stack tight center">
          <span className="n">{reviews.length}</span>
          <span className="l">Things Rated</span>
        </div>
        <div className="stack tight center">
          <span className="n">{placeCount}</span>
          <span className="l">Spots Visited</span>
        </div>
        <div className="stack tight center">
          <span className="n">{mustTryCount}</span>
          <span className="l">Must-Tries</span>
        </div>
      </div>

      {expertBadges.length > 0 && (
        <div className="stack tight" style={{ marginTop: 2 }}>
          <span className="tiny muted strong row" style={{ gap: 4, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10 }}>
            <Icon name="award" size={11} color="var(--amber)" /> Community Badges
          </span>
          <div className="chips" style={{ gap: 6 }}>
            {expertBadges.map((b) => (
              <span key={b} className="badge amber" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 12 }}>
                <Icon name="trophy" size={12} />
                <span>{b} Expert</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {areas.length > 0 && (
        <div className="chips" style={{ marginTop: expertBadges.length > 0 ? 4 : 0 }}>
          {areas.map((a) => (
            <span key={a} className="chip">
              <Icon name="pin" size={12} />
              <span>{a}</span>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn ghost small block"
        style={{ marginTop: 2 }}
        onClick={sharePassport}
      >
        <Icon name="share" size={15} />
        <span>Share Picks Summary</span>
      </button>
    </div>
  );
}

type DiaryShelf = "loved" | "liked" | "skip";
const SHELVES: { id: DiaryShelf; label: string; icon: "heart" | "thumbs" | "thumbsDown"; fits: (r: number) => boolean }[] = [
  { id: "loved", label: "Loved", icon: "heart", fits: (r) => r >= 5 },
  { id: "liked", label: "Liked", icon: "thumbs", fits: (r) => r === 4 },
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
  if (!things.length) return null;
  const counts = Object.fromEntries(SHELVES.map((x) => [x.id, things.filter((r) => x.fits(r.rating)).length])) as Record<DiaryShelf, number>;
  const current = counts[shelf] ? shelf : SHELVES.find((x) => counts[x.id])?.id ?? "loved";
  const shown = things.filter((r) => SHELVES.find((x) => x.id === current)!.fits(r.rating));
  return (
    <section className="stack" style={{ gap: 10 }} aria-label="Your picks diary">
      <SectionTitle icon="heart" tone="coral" right={<span className="count-pill"><Icon name="star" size={13} />{things.length}</span>}>Your picks diary</SectionTitle>
      <div className="chips scroll" role="tablist" aria-label="Diary shelves">
        {SHELVES.filter((x) => counts[x.id]).map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={current === x.id} className={`chip ${current === x.id ? "on" : ""}`} onClick={() => setShelf(x.id)}>
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
