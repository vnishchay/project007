import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { isUuid, type ReviewRow } from "../lib/types";
import { copyText, googleReviewUrl } from "../lib/util";
import { shareLink } from "../lib/invite";
import { isNegativeTag, tagLabels } from "../lib/reviews";
import { generateStoryCard } from "../lib/story";
import { ScratchCard } from "../components/ScratchCard";
import { Icon, Spinner, Stars, useToast } from "../components/ui";
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
  const text = (r.body || "").trim() || `${r.items?.name}`;
  const stars = `${r.rating} star${r.rating === 1 ? "" : "s"}`;
  const steps: [GlyphName, string][] = gid
    ? [["copy", "We copy your review"], ["external", `Google opens ${placeName}`], ["star", `Tap ${stars}`], ["edit", "Long-press the box, Paste, Post"]]
    : [["copy", "We copy your review"], ["map", `Google Maps finds ${placeName}`], ["edit", "Pick it, tap Write a review"], ["star", `Tap ${stars}, long-press, Paste, Post`]];

  const isNegative = r.rating <= 3 || tagLabels(r).some(isNegativeTag);

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
      const msg = `${r!.items?.name} at ${r!.places?.name}: ${"★".repeat(r!.rating)}\n${r!.body}`.trim();
      const file = await generateStoryCard({
        itemName: r!.items?.name || "",
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
        a.download = "verified-food-story.png";
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
    if (!privateNote.trim()) { toast("Please enter a note for management"); return; }
    setSendingNote(true);
    try {
      let { error } = await supabase.rpc("send_owner_note", {
        p_place: r!.place_id,
        p_body: privateNote.trim(),
        p_contact: contactInfo.trim() || null,
        p_review: r!.id,
        p_item: r!.item_id || null,
      });
      if (error && (error.code === "PGRST202" || error.code === "PGRST205")) {
        const res2 = await supabase.rpc("submit_private_feedback", {
          p_place_id: r!.place_id,
          p_review_id: r!.id,
          p_message: privateNote.trim(),
          p_contact: contactInfo.trim() || null,
          p_rating: r!.rating,
          p_item_name: r!.items?.name || null,
        });
        error = res2.error;
      }
      if (error && (error.code === "PGRST202" || error.code === "PGRST205")) {
        const fallbackBody = `[Private Management Note]: ${privateNote.trim()}${contactInfo.trim() ? ` (Contact: ${contactInfo.trim()})` : ""}`;
        const res3 = await supabase.rpc("submit_review", {
          p_place_id: r!.place_id,
          p_item_name: r!.items?.name || "Private Note",
          p_rating: r!.rating || 3,
          p_body: fallbackBody,
          p_is_public: false,
        });
        error = res3.error;
      }
      if (error) throw error;
      setNoteSent(true);
      setShowPrivateForm(false);
      toast("Your note was delivered directly to management.");
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
            <span className="strong" style={{ overflowWrap: "anywhere" }}>{r.items?.name}</span>
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

      {/* Instant Micro-Reward (Digital Scratch Card / Table Perk) */}
      <ScratchCard stars={r.rating} placeName={placeName} />

      {/* FTC-Compliant Reputation Shield (Dual Exit for negative feedback) */}
      {isNegative ? (
        <section className="card" style={{ border: "2px solid rgba(220, 38, 38, 0.2)", background: "var(--card)" }} aria-labelledby="shield-h">
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <span className="icon-chip coral"><Icon name="shield" size={22} /></span>
            <div className="grow stack tight">
              <h2 id="shield-h" style={{ fontSize: 17, margin: 0 }}>Experience wasn't 5-star?</h2>
              <span className="small muted">You have two options for your feedback:</span>
            </div>
          </div>

          <div className="stack" style={{ gap: 12, marginTop: 12 }}>
            {/* Option 1: Direct VIP Resolution Channel (Recommended) */}
            <div style={{ padding: 14, borderRadius: 16, border: "1.5px solid var(--green)", background: "rgba(30, 122, 70, 0.06)" }}>
              <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span className="badge green">Recommended</span>
                <strong style={{ fontSize: 15 }}>Send Private Note to Owner / Chef</strong>
              </div>
              <p className="small muted" style={{ margin: "4px 0 10px", lineHeight: 1.4 }}>
                Management reads every note directly to resolve issues (e.g. replacement voucher, refund, or fixing kitchen/service issues).
              </p>

              {noteSent ? (
                <div className="callout green" style={{ padding: "10px 14px" }}>
                  <Chip icon="check" tone="green" size="sm" />
                  <span className="small strong grow">Sent directly to management. Thank you for giving them a chance to make it right!</span>
                </div>
              ) : showPrivateForm ? (
                <div className="stack" style={{ gap: 8 }}>
                  <textarea
                    className="textarea"
                    placeholder="Tell the owner or chef what went wrong and how they can resolve it for you..."
                    value={privateNote}
                    onChange={(e) => setPrivateNote(e.target.value)}
                    rows={3}
                  />
                  <input
                    className="input"
                    placeholder="Your phone or email (optional, for voucher / follow-up)"
                    value={contactInfo}
                    onChange={(e) => setContactInfo(e.target.value)}
                  />
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn green small" disabled={sendingNote} onClick={sendPrivateFeedback}>
                      {sendingNote ? "Sending…" : "Send Note to Owner / Chef"}
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => setShowPrivateForm(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn green small" onClick={() => setShowPrivateForm(true)}>
                  <Icon name="message" size={16} />Message Management Privately
                </button>
              )}
            </div>

            {/* Option 2: Public Google Review (Always available for FTC compliance) */}
            <div style={{ padding: 14, borderRadius: 16, border: "1.5px solid var(--line)", background: "var(--surface)" }}>
              <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span className="icon-chip sm sky"><Icon name="globe" size={16} /></span>
                <strong style={{ fontSize: 15 }}>Post Publicly to Google</strong>
              </div>
              <p className="small muted" style={{ margin: "4px 0 10px", lineHeight: 1.4 }}>
                Share your review publicly on Google Maps (1-tap copy & redirect).
              </p>
              <button type="button" className="btn ghost small" onClick={openGoogle}>
                <Icon name="copy" size={16} />{gid ? "Copy & open Google" : "Copy & open Google Maps"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        /* Standard flow for 4-star and 5-star positive reviews */
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
                  <span className="small strong">Send a compliment or private note to the chef:</span>
                  <textarea
                    className="textarea"
                    placeholder="e.g. Loved the special sauce! Thank you chef."
                    value={privateNote}
                    onChange={(e) => setPrivateNote(e.target.value)}
                    rows={2}
                  />
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn green small" disabled={sendingNote} onClick={sendPrivateFeedback}>
                      {sendingNote ? "Sending…" : "Send to Chef"}
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => setShowPrivateForm(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="link-btn small" onClick={() => setShowPrivateForm(true)}>
                  <Icon name="message" size={14} />Want to send a private compliment to the team?
                </button>
              )}
            </div>
          )}
          {noteSent && (
            <span className="tiny green strong row" style={{ gap: 4, marginTop: 4 }}>
              <Icon name="check" size={13} />Private note delivered to management
            </span>
          )}
        </section>
      )}

      {/* Main bottom navigation */}
      <div className="stack" style={{ marginTop: "auto" }}>
        {!isNegative && (
          <button type="button" className="btn green block" onClick={openGoogle}>
            <Icon name="copy" size={18} />{gid ? "Copy and open Google" : "Copy and open Google Maps"}
          </button>
        )}
        <Link to={`/p/${r.place_id}`} className="btn block quiet">{opened ? <><Icon name="back" size={18} />Back to the place</> : "Done"}</Link>
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
