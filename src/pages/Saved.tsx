import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { ReviewRow } from "../lib/types";
import { copyText, googleReviewUrl, placeUrl } from "../lib/util";
import { Icon, Spinner, Stars, useToast } from "../components/ui";
import { REVIEW_SELECT, REVIEW_FEED } from "../components/ReviewCard";

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
  const [followers, setFollowers] = useState(0);
  const [opened, setOpened] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

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

  useEffect(() => {
    if (!uid) return;
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", uid).then(({ count }) => setFollowers(count ?? 0));
  }, [uid]);

  if (loadErr) return (
    <div className="page">
      <div className="notice err" role="alert" style={{ marginTop: 16 }}>
        <div className="stack" style={{ gap: 8 }}>
          <span>Your review may be saved, but it couldn't be loaded: {loadErr}</span>
          <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => setReload((n) => n + 1)}>Retry</button>
        </div>
      </div>
      <Link to="/me" className="btn ghost block">See your reviews</Link>
    </div>
  );
  if (r === undefined) return <div className="page"><Spinner /></div>;
  if (!r) return <div className="page"><div className="empty"><h2>Review not found</h2><Link to="/" className="btn ghost">Go home</Link></div></div>;

  const gid = r.places?.google_place_id;
  const placeName = r.places?.name || "";
  const googleUrl = gid ? googleReviewUrl(gid) : mapsSearchUrl([placeName, r.places?.area, city].filter(Boolean).join(" "));
  const text = r.body || `${r.items?.name}: ${r.rating}/5`;
  const steps = gid
    ? ["We copy your review", `Google opens on ${placeName}`, "You paste, tap the stars and post"]
    : ["We copy your review", `Google Maps searches for ${placeName}`, "Pick the place, then tap Write a review and paste"];

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
      toast(ok ? (gid ? "Review copied. Paste it on Google and tap the stars." : "Review copied. Pick the place on Google, then tap Write a review.") : "Couldn't copy. Copy your review from below.");
      const { error } = await supabase.from("google_shares").insert({ review_id: r!.id, user_id: uid });
      if (error) console.warn(errorText(error));
      // Popup blocked: go there in this tab instead, but only once the text is on the clipboard.
      if (!w && ok) window.location.href = googleUrl;
    })();
  }

  async function share() {
    const url = placeUrl(r!.place_id);
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

  return (
    <div className="page">
      <div className="stack" style={{ gap: 8, marginTop: 16 }}>
        <span className="avatar lg" style={{ background: "var(--green-soft)" }}><Icon name="check" size={26} color="var(--green)" width={2.6} /></span>
        <h1>Saved</h1>
        <p className="muted">{isGuest ? "Posted anonymously, no account needed. Your rating counts, but no one can see it was you." : !r.is_public ? "Posted anonymously. Your rating counts, but no one can see it was you." : followers > 0 ? `Posted with your name. ${followers} ${followers === 1 ? "person follows" : "people follow"} you and will see it.` : "Posted with your name. You can make it anonymous from your profile."}</p>
      </div>

      <div className="card">
        <div className="row between" style={{ alignItems: "flex-start" }}><span className="strong grow" style={{ overflowWrap: "anywhere" }}>{r.items?.name} · {placeName}</span><Stars value={r.rating} /></div>
        {r.body && <p style={{ lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.body}</p>}
        <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }} onClick={share}><Icon name="share" size={16} />Share with friends</button>
      </div>

      <div className="stack">
        <h2>Post it on Google too</h2>
        <ol className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {steps.map((s, i) => (
            <li key={s} className="row">
              <span className="avatar sm" aria-hidden="true" style={{ width: 24, height: 24, background: i === 0 || opened ? "var(--green)" : "var(--surface)", color: i === 0 || opened ? "#fff" : "var(--muted)", border: 0 }}>{i + 1}</span>
              <span className="small">{s}</span>
            </li>
          ))}
        </ol>
        <p className="tiny muted">{gid ? "Google only lets you post reviews yourself, so the last tap is yours." : "Pick the place, then tap Write a review. Google only lets you post reviews yourself."}</p>
        {copyFailed && (
          <label className="stack tight">
            <span className="small strong">Your review, to copy by hand</span>
            <textarea className="textarea" readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
          </label>
        )}
        {copyFailed && (
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="link-btn" style={{ alignSelf: "flex-start" }}><Icon name="external" size={16} />Open {gid ? "Google" : "Google Maps"}</a>
        )}
      </div>

      <div className="stack" style={{ marginTop: "auto" }}>
        <button type="button" className="btn block" onClick={openGoogle}><Icon name="copy" size={18} />{gid ? "Copy and open Google" : "Copy and open Google Maps"}</button>
        <Link to={`/p/${r.place_id}`} className="btn block quiet">{opened ? "Back to the place" : "Not now"}</Link>
      </div>

      {isGuest && opened && (
        <div className="card soft">
          <span className="strong">Want to keep your reviews? (optional)</span>
          <span className="small muted">You're reviewing as a guest. Sign in to keep your reviews on any device and see what friends loved. Nothing changes if you don't.</span>
          <Link to={`/signin?next=${encodeURIComponent(`/p/${r.place_id}`)}`} className="btn small ghost" style={{ alignSelf: "flex-start" }}>Sign in</Link>
        </div>
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
    g.fillStyle = "#1E7A46"; g.font = "700 40px Manrope, sans-serif"; g.fillText("Trusted Picks", 150, 270);
    g.fillStyle = "#111311"; g.font = "800 72px Manrope, sans-serif";
    wrap(g, r.items?.name || "", 150, 400, 780, 84, 2);
    g.fillStyle = "#5F665F"; g.font = "600 40px Manrope, sans-serif"; g.fillText(r.places?.name || "", 150, 560);
    g.fillStyle = "#E0A100"; g.font = "64px sans-serif"; g.fillText("★".repeat(r.rating) + "☆".repeat(5 - r.rating), 150, 670);
    g.fillStyle = "#3A403A"; g.font = "500 40px Manrope, sans-serif";
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
