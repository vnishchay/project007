import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { canGoBack, goBack } from "../lib/nav";
import { focusShop } from "../lib/focus";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { isUuid, type ReviewRow } from "../lib/types";
import { copyText, googleReviewUrl } from "../lib/util";
import { shareLink } from "../lib/invite";
import { deviceId } from "../lib/device";
import { generateStoryCard } from "../lib/story";
import { itemLabel } from "../lib/reviews";
import { Icon, Spinner, Stars, TopBar, useToast } from "../components/ui";
import { REVIEW_SELECT, REVIEW_FEED, reviewPhotoUrl } from "../components/ReviewCard";
import { Chip, EmptyArt, Glyph, Retry, SectionTitle, type GlyphName } from "../components/home/Kit";
import "../styles/home.css";

function mapsSearchUrl(q: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Copy with the old execCommand trick; works synchronously inside a click. */
function execCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

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
  const [copyFailed, setCopyFailed] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoSaved, setPhotoSaved] = useState(false);

  // Reputation Shield & Private Feedback state
  const [showPrivateForm, setShowPrivateForm] = useState(false);
  const [privateNote, setPrivateNote] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [sendingNote, setSendingNote] = useState(false);
  const [noteSent, setNoteSent] = useState(false);
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
        if (row.body) setPrivateNote(row.body);
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
      <Link to="/me" className="btn ghost block"><Icon name="star" size={18} />See your reviews</Link>
    </div>
  );
  if (r === undefined) return <div className="page"><Spinner /></div>;
  if (!r) return <div className="page"><EmptyArt icon="ghost" tone="sky" title="Review not found"><Link to="/" className="btn ghost small"><Icon name="home" size={16} />Home</Link></EmptyArt></div>;

  const gid = r.places?.google_place_id;
  const placeName = r.places?.name || "";
  const googleUrl = gid ? googleReviewUrl(gid) : mapsSearchUrl([placeName, r.places?.area, city].filter(Boolean).join(" "));
  // Just the words: Google has its own stars, and a short text pastes cleanly.
  const text = (r.body || "").trim() || itemLabel(r.items?.name);
  const stars = `${r.rating} star${r.rating === 1 ? "" : "s"}`;
  const steps: [GlyphName, string][] = gid
    ? [["copy", "We copy your review"], ["external", `Google opens ${placeName}`], ["star", `Tap ${stars}`], ["edit", "Long-press the box, Paste, Post"]]
    : [["copy", "We copy your review"], ["map", `Google Maps finds ${placeName}`], ["edit", "Pick it, tap Write a review"], ["star", `Tap ${stars}, long-press, Paste, Post`]];

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

  function openGoogle() {
    // Start the copy while this click still counts as a user gesture and the page still has
    // focus; opening the new tab first makes browsers refuse the clipboard write.
    let copied: Promise<boolean>;
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      copied = navigator.clipboard.writeText(text).then(() => true, () => false);
    } else {
      const ok = execCopy(text);
      copied = Promise.resolve(ok);
    }
    const w = window.open(googleUrl, "_blank");
    if (w) w.opener = null;
    setOpened(true);
    void (async () => {
      let ok = await copied;
      if (!ok) ok = await copyText(text).catch(() => false);
      setCopyFailed(!ok);
      toast(ok ? (gid ? `Copied. On Google tap ${stars}, then long-press and Paste.` : `Copied. Pick the place, tap Write a review, then ${stars} and Paste.`) : "Couldn't copy. Copy your review from below.");
      const { error } = await supabase.from("google_shares").insert({ review_id: r!.id, user_id: uid });
      if (error) console.warn(errorText(error));
      // Popup blocked: go there in this tab instead, but only once the text is on the clipboard.
      if (!w && ok) window.location.href = googleUrl;
    })();
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
        toast("Story card downloaded for Instagram / WhatsApp!");
      } else if (await copyText(`${msg}\n${url}`)) {
        toast("Copied, ready to paste");
      }
    } catch {
      /* dismissed */
    } finally {
      setSharingStory(false);
    }
  }

  async function sendPrivateFeedback() {
    if (!privateNote.trim()) { toast("Write a quick note for the owner first"); return; }
    setSendingNote(true);
    try {
      // Not linked to the review or the account, so the owner never learns who sent it.
      const { error } = await supabase.rpc("send_owner_note", {
        p_place: r!.place_id,
        p_body: privateNote.trim(),
        p_contact: contactInfo.trim() || null,
        p_device: deviceId(),
      });
      if (error) throw error;
      setNoteSent(true);
      setShowPrivateForm(false);
      toast("Your private note was sent to the owner.");
    } catch (e) {
      toast(errorText(e));
    } finally {
      setSendingNote(false);
    }
  }

  const who: { icon: GlyphName; text: string } = isGuest || !r.is_public
    ? { icon: "eyeOff", text: isGuest ? "Anonymous, no account needed" : "Posted anonymously" }
    : { icon: "eye", text: friends > 0 ? `With your name · ${friends} friend${friends === 1 ? "" : "s"} will see it` : "Posted with your name" };

  return (
    <div className="page" style={{ gap: 18 }}>
      <TopBar tone="hero" />
      <header className="hero compact" style={{ alignItems: "center", textAlign: "center" }}>
        <span className="success-burst"><Icon name="checkCircle" size={38} color="#fff" width={2.4} /></span>
        <h1>Saved</h1>
        <span className="pill white"><Glyph name={who.icon} size={13} />{who.text}</span>
      </header>

      {/* Review summary preview */}
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
        <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
          <button type="button" className="btn small green" onClick={share} disabled={sharingStory}>
            <Icon name="share" size={16} />{sharingStory ? "Preparing story…" : "Share Story Card"}
          </button>
        </div>
      </div>

      {/* Google is offered at every rating; the private note sits beside it, never instead of it. */}
        <section className="card" aria-labelledby="google-h">
          <SectionTitle icon="globe" tone="sky"><span id="google-h">Post it on Google too</span></SectionTitle>
          <ol className="step-list">
            {steps.map(([icon, s], i) => (
              <li key={s}>
                <span className={`icon-chip sm ${i === 0 || opened ? "" : "sky"}`} aria-hidden="true">{i === 0 || opened ? <Icon name="check" size={16} width={2.6} /> : <Glyph name={icon} size={16} />}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <div className="g-stars-hint" aria-label={`On Google, tap ${stars}`}>
            <span className="small strong">On Google, tap</span>
            <Stars value={r.rating} />
          </div>
          {photo && (
            <button type="button" className={`btn small ${photoSaved ? "quiet" : "ghost"}`} style={{ alignSelf: "flex-start" }} onClick={savePhoto}>
              <Icon name={photoSaved ? "check" : "image"} size={16} />{photoSaved ? "Photo saved" : "Save your photo first"}
            </button>
          )}
          <p className="tiny muted row" style={{ gap: 6, alignItems: "flex-start" }}><Icon name="info" size={14} />Google only lets you post yourself, so the last tap is yours.</p>
          {copyFailed && (
            <label className="stack tight">
              <span className="small strong row" style={{ gap: 6 }}><Icon name="copy" size={14} />Copy by hand</span>
              <textarea className="textarea" readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          {copyFailed && (
            <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="link-btn" style={{ alignSelf: "flex-start" }}><Icon name="external" size={16} />Open {gid ? "Google" : "Google Maps"}</a>
          )}

          {/* Optional VIP note to kitchen */}
          {!noteSent && (
            <div style={{ marginTop: 8, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
              {showPrivateForm ? (
                <div className="stack" style={{ gap: 8 }}>
                  <span className="small strong">Send a private note to the owner:</span>
                  <textarea
                    className="textarea"
                    placeholder="Tell the owner what went well or what could be better"
                    value={privateNote}
                    onChange={(e) => setPrivateNote(e.target.value)}
                    rows={2}
                  />
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn green small" disabled={sendingNote} onClick={sendPrivateFeedback}>
                      {sendingNote ? "Sending…" : "Send to the owner"}
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => setShowPrivateForm(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="link-btn small" onClick={() => setShowPrivateForm(true)}>
                  <Icon name="message" size={14} />Send a private note to the owner
                </button>
              )}
            </div>
          )}
          {noteSent && (
            <span className="tiny green strong row" style={{ gap: 4, marginTop: 4 }}>
              <Icon name="check" size={13} />Private note sent to the owner
            </span>
          )}
        </section>

      {/* Main bottom navigation */}
      <div className="stack" style={{ marginTop: "auto" }}>
        <button type="button" className="btn green block" onClick={openGoogle}>
          <Icon name="copy" size={18} />{gid ? "Copy and open Google" : "Copy and open Google Maps"}
        </button>
        {!focusShop() && canGoBack()
          ? <button type="button" className="btn block quiet" onClick={() => goBack(nav, `/p/${r.place_id}`)}><Icon name="back" size={18} />Back</button>
          : <Link to={`/p/${r.place_id}`} className="btn block quiet">{opened ? <><Icon name="back" size={18} />Back to the place</> : "Done"}</Link>}
      </div>

      {isGuest && (opened || noteSent) && (
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
