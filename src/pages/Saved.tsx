import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { ReviewRow } from "../lib/types";
import { copyText, googleReviewUrl } from "../lib/util";
import { shareLink } from "../lib/invite";
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

  useEffect(() => {
    let alive = true;
    setLoadErr("");
    supabase.from(REVIEW_FEED).select(REVIEW_SELECT).eq("id", reviewId).maybeSingle().then(({ data, error }) => {
      if (!alive) return;
      if (error && !/invalid input syntax for type uuid/i.test(error.message)) { setLoadErr(errorText(error)); return; }
      const row = (data as unknown as ReviewRow) ?? null;
      setR(row);
      if (row && !row.places?.google_place_id) {
        supabase.from("places").select("city").eq("id", row.place_id).maybeSingle().then(({ data: p }) => { if (alive) setCity((p as { city?: string } | null)?.city ?? null); });
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
    const url = await shareLink(`/p/${r!.place_id}`, "review");
    const msg = `${r!.items?.name} at ${r!.places?.name}: ${"★".repeat(r!.rating)}\n${r!.body}`.trim();
    if (navigator.share) {
      try {
        const file = await storyCard(r!);
        if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: msg, url });
        else await navigator.share({ text: msg, url });
      } catch { /* dismissed */ }
    } else if (await copyText(`${msg}\n${url}`)) toast("Copied, ready to paste");
    else toast("Couldn't copy the link");
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
        <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={share}><Icon name="share" size={16} />Share with friends</button>
      </div>

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
      </section>

      <div className="stack" style={{ marginTop: "auto" }}>
        <button type="button" className="btn green block" onClick={openGoogle}><Icon name="copy" size={18} />{gid ? "Copy and open Google" : "Copy and open Google Maps"}</button>
        <Link to={`/p/${r.place_id}`} className="btn block quiet">{opened ? <><Icon name="back" size={18} />Back to the place</> : "Not now"}</Link>
      </div>

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

// A simple 1080x1350 image of the review for Instagram or WhatsApp status.
async function storyCard(r: ReviewRow): Promise<File | null> {
  try {
    await document.fonts?.ready;
    const c = document.createElement("canvas");
    c.width = 1080; c.height = 1350;
    const g = c.getContext("2d")!;
    g.fillStyle = "#F5F6F4"; g.fillRect(0, 0, 1080, 1350);
    g.fillStyle = "#FFFFFF"; roundRect(g, 80, 160, 920, 1030, 56); g.fill();
    g.fillStyle = "#c2391c"; g.font = "700 40px Inter, -apple-system, system-ui, sans-serif"; g.fillText("Trusted Picks", 150, 270);
    g.fillStyle = "#1c1c1e"; g.font = "800 72px Inter, -apple-system, system-ui, sans-serif";
    wrap(g, r.items?.name || "", 150, 400, 780, 84, 2);
    g.fillStyle = "#636366"; g.font = "600 40px Inter, -apple-system, system-ui, sans-serif"; g.fillText(r.places?.name || "", 150, 560);
    g.fillStyle = "#E0A100"; g.font = "64px sans-serif"; g.fillText("★".repeat(r.rating) + "☆".repeat(5 - r.rating), 150, 670);
    g.fillStyle = "#3a3a3c"; g.font = "500 40px Inter, -apple-system, system-ui, sans-serif";
    wrap(g, r.body ? `“${r.body}”` : "", 150, 780, 780, 58, 6);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    return blob ? new File([blob], "trusted-pick.png", { type: "image/png" }) : null;
  } catch {
    return null;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, lines: number) {
  const words = text.split(/\s+/);
  let line = "";
  let n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) {
      if (++n >= lines) { g.fillText(line + "…", x, y); return; }
      g.fillText(line, x, y); y += lh; line = w;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
}
