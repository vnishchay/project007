import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { canGoBack, goBack } from "../lib/nav";
import { focusShop } from "../lib/focus";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { isUuid, type ReviewRow } from "../lib/types";
import { copyText, googleReviewUrl } from "../lib/util";
import { GoogleHandoff, PrivateNote, mapsSearchUrl } from "../components/GoogleHandoff";
import { shareLink } from "../lib/invite";
import { generateStoryCard } from "../lib/story";
import { itemLabel } from "../lib/reviews";
import { Icon, Spinner, Stars, TopBar, useToast } from "../components/ui";
import { OwnerReply, REVIEW_SELECT, REVIEW_FEED, reviewPhotoUrl } from "../components/ReviewCard";
import { Chip, EmptyArt, Glyph, Retry, type GlyphName } from "../components/home/Kit";
import "../styles/home.css";

export default function Saved() {
  const nav = useNavigate();
  const { reviewId = "" } = useParams();
  const { session, isGuest } = useAuth();
  const uid = session?.user.id;
  const toast = useToast();
  const [r, setR] = useState<ReviewRow | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState("");
  const [reload, setReload] = useState(0);
  const [city, setCity] = useState<string | null>(null);
  const [friends, setFriends] = useState(0);
  const [opened, setOpened] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoSaved, setPhotoSaved] = useState(false);

  const [showNote, setShowNote] = useState(false);
  // The burst is for the moment of posting only; opened later from Profile, this page is just "Post on Google".
  const justPosted = Boolean((useLocation().state as { justPosted?: boolean } | null)?.justPosted);
  const [sharingStory, setSharingStory] = useState(false);

  useEffect(() => {
    if (!isUuid(reviewId)) { setR(null); return; }
    let alive = true;
    setLoadErr("");
    supabase.from(REVIEW_FEED).select(REVIEW_SELECT).eq("id", reviewId).maybeSingle().then(({ data, error }) => {
      if (!alive) return;
      if (error && !/invalid input syntax for type uuid/i.test(error.message)) { setLoadErr(errorText(error)); return; }
      const row = (data as unknown as ReviewRow) ?? null;
      setR(row);
      if (row) {
        if (!row.places?.google_place_id) {
          supabase.from("places").select("city").eq("id", row.place_id).maybeSingle().then(({ data: p }) => { if (alive) setCity((p as { city?: string } | null)?.city ?? null); });
        }
      }
    }, (e: unknown) => { if (alive) setLoadErr(errorText(e)); });
    return () => { alive = false; };
  }, [reviewId, reload]);

  // Fetch the review photo up front so saving it later happens straight from the tap.
  useEffect(() => {
    const url = reviewPhotoUrl(r?.photo_path);
    if (!url) { setPhoto(null); return; }
    let alive = true;
    fetch(url).then((res) => (res.ok ? res.blob() : null)).then((b) => {
      if (alive && b) setPhoto(new File([b], "trusted-picks-photo.jpg", { type: b.type || "image/jpeg" }));
    }, () => {});
    return () => { alive = false; };
  }, [r?.photo_path]);

  useEffect(() => {
    if (!uid || isGuest) return;
    supabase.rpc("my_friends").then(({ data, error }) => { if (!error) setFriends(((data as unknown[]) || []).length); });
  }, [uid, isGuest]);

  if (loadErr) return (
    <div className="page">
      <Retry msg={`Your review may be saved, but it couldn't be loaded: ${loadErr}`} onRetry={() => setReload((n) => n + 1)} />
      <Link to="/picks" className="btn ghost block"><Icon name="star" size={18} />See your reviews</Link>
    </div>
  );
  if (r === undefined) return <div className="page"><Spinner /></div>;
  if (!r) return <div className="page"><TopBar back="/picks" /><EmptyArt icon="ghost" tone="sky" title="Review not found"><Link to="/" className="btn ghost small"><Icon name="home" size={16} />Home</Link></EmptyArt></div>;

  const gid = r.places?.google_place_id;
  const placeName = r.places?.name || "";
  const googleUrl = gid ? googleReviewUrl(gid) : mapsSearchUrl([placeName, r.places?.area, city].filter(Boolean).join(" "));
  // Just the words: Google has its own stars, and a short text pastes cleanly.
  const text = (r.body || "").trim() || itemLabel(r.items?.name);
  async function savePhoto() {
    if (!photo) return;
    try {
      if (navigator.canShare?.({ files: [photo] })) {
        await navigator.share({ files: [photo] });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(photo);
        a.download = photo.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      setPhotoSaved(true);
      toast("Photo ready. Add it on Google with the camera icon.");
    } catch { /* dismissed */ }
  }

  async function share() {
    setSharingStory(true);
    try {
      const url = await shareLink(`/p/${r!.place_id}`, "review");
      const msg = `${itemLabel(r!.items?.name)} at ${r!.places?.name}: ${"★".repeat(r!.rating)}\n${r!.body}`.trim();
      const file = await generateStoryCard({
        itemName: itemLabel(r!.items?.name),
        placeName: r!.places?.name || "",
        rating: r!.rating,
        body: r!.body,
        photoBlob: photo,
      });
      if (navigator.share) {
        if (file && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text: msg, url });
        } else {
          await navigator.share({ text: msg, url });
        }
      } else if (file) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = "verified-story.png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast("Story card saved. Share it from your photos.");
      } else if (await copyText(`${msg}\n${url}`)) {
        toast("Copied, ready to paste");
      }
    } catch {
      /* dismissed */
    } finally {
      setSharingStory(false);
    }
  }

  const who: { icon: GlyphName; text: string } = isGuest || !r.is_public
    ? { icon: "eyeOff", text: isGuest ? "Anonymous, no account needed" : "Posted anonymously" }
    : { icon: "eye", text: friends > 0 ? `With your name · ${friends} friend${friends === 1 ? "" : "s"} will see it` : "Posted with your name" };

  return (
    <div className="page" style={{ gap: 18 }}>
      <TopBar tone="hero" />
      <header className="hero compact" style={{ alignItems: "center", textAlign: "center" }}>
        {justPosted && <span className="success-burst"><Icon name="checkCircle" size={38} color="#fff" width={2.4} /></span>}
        <h1>Post on Google</h1>
        <span className="pill white"><Glyph name={who.icon} size={13} />{who.text}</span>
      </header>

      {/* The review being posted */}
      <div className="card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <Chip icon={r.verified ? "verified" : "star"} tone={r.verified ? "sky" : "amber"} />
          <div className="grow stack tight" style={{ minWidth: 0 }}>
            <span className="strong" style={{ overflowWrap: "anywhere" }}>{itemLabel(r.items?.name)}</span>
            <span className="small muted row" style={{ gap: 4 }}><Icon name="store" size={13} />{placeName}</span>
          </div>
          <Stars value={r.rating} />
        </div>
        {r.body && <p style={{ lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.body}</p>}
        {r.owner_reply && <OwnerReply text={r.owner_reply} at={r.owner_reply_at} shop={placeName} />}
      </div>

      {/* The same Google card as right after reviewing. */}
      <GoogleHandoff text={text} stars={r.rating} url={googleUrl} onMaps={!gid} placeName={placeName} reviewId={r.id} opened={opened} onOpened={() => setOpened(true)}
        extra={photo ? (
          <button type="button" className={`btn small ${photoSaved ? "quiet" : "ghost"}`} style={{ alignSelf: "flex-start" }} onClick={savePhoto}>
            <Icon name={photoSaved ? "check" : "image"} size={16} />{photoSaved ? "Photo saved" : "Save your photo first"}
          </button>
        ) : null} />

      <div className="gh-row">
        <button type="button" onClick={share} disabled={sharingStory}><Icon name="share" size={20} />{sharingStory ? "Making card…" : "Share"}</button>
        <button type="button" aria-expanded={showNote} onClick={() => setShowNote((v) => !v)}><Icon name="message" size={20} />Note to owner</button>
        {!focusShop() && canGoBack()
          ? <button type="button" onClick={() => goBack(nav, `/p/${r.place_id}`)}><Icon name="back" size={20} />Back</button>
          : <Link to={`/p/${r.place_id}`}><Icon name="store" size={20} />Shop page</Link>}
      </div>
      {showNote && <div className="gh-panel"><PrivateNote placeId={r.place_id} /></div>}

      {isGuest && opened && (
        <Link to={`/signin?next=${encodeURIComponent(`/p/${r.place_id}`)}`} className="callout violet">
          <Chip icon="lock" tone="violet" />
          <span className="grow stack tight">
            <span className="strong">Keep your reviews? (optional)</span>
            <span className="tiny">Sign in to keep them on any device. Nothing changes if you don't.</span>
          </span>
          <Icon name="login" size={18} />
        </Link>
      )}
    </div>
  );
}
