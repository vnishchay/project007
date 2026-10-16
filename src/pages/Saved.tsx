import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { ReviewRow } from "../lib/types";
import { copyText, googleReviewUrl, placeUrl } from "../lib/util";
import { Icon, Spinner, Stars, useToast } from "../components/ui";
import { REVIEW_SELECT } from "../components/ReviewCard";

export default function Saved() {
  const { reviewId = "" } = useParams();
  const { session } = useAuth();
  const toast = useToast();
  const [r, setR] = useState<ReviewRow | null | undefined>(undefined);
  const [followers, setFollowers] = useState(0);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    supabase.from("reviews").select(REVIEW_SELECT).eq("id", reviewId).maybeSingle().then(({ data }) => setR((data as unknown as ReviewRow) ?? null));
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", session!.user.id).then(({ count }) => setFollowers(count ?? 0));
  }, [reviewId, session]);

  if (r === undefined) return <div className="page"><Spinner /></div>;
  if (!r) return <div className="page"><div className="empty"><h2>Review not found</h2><Link to="/" className="btn ghost">Go home</Link></div></div>;

  const gid = r.places?.google_place_id;
  const text = r.body || `${r.items?.name}: ${r.rating}/5`;

  async function openGoogle() {
    if (!gid) return;
    // Open the tab first so the browser doesn't block it as a popup.
    const w = window.open(googleReviewUrl(gid), "_blank");
    if (w) w.opener = null;
    const ok = await copyText(text);
    toast(ok ? "Review copied. Paste it on Google and tap the stars." : "Couldn't copy; select the text and copy it.");
    setOpened(true);
    const { error } = await supabase.from("google_shares").insert({ review_id: r!.id, user_id: session!.user.id });
    if (error) console.warn(errorText(error));
    if (!w) window.location.href = googleReviewUrl(gid);
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
  }

  return (
    <div className="page">
      <div className="stack" style={{ gap: 8, marginTop: 16 }}>
        <span className="avatar lg" style={{ background: "var(--green-soft)" }}><Icon name="check" size={26} color="var(--green)" width={2.6} /></span>
        <h1>Saved</h1>
        <p className="muted">{followers > 0 ? `${followers} ${followers === 1 ? "person follows" : "people follow"} you and will see it.` : "Follow friends from your Circle so you see each other's picks."}</p>
      </div>

      <div className="card">
        <div className="row between"><span className="strong">{r.items?.name} · {r.places?.name}</span><Stars value={r.rating} /></div>
        {r.body && <p style={{ lineHeight: 1.5, color: "var(--ink-2)" }}>{r.body}</p>}
        <button className="link-btn" onClick={share}><Icon name="share" size={16} />Share with friends</button>
      </div>

      {gid ? (
        <div className="stack">
          <h2>Post it on Google too</h2>
          {["We copy your review", `Google opens on ${r.places?.name}`, "You paste, tap the stars and post"].map((s, i) => (
            <div key={s} className="row">
              <span className="avatar sm" style={{ width: 24, height: 24, background: i === 0 || opened ? "var(--green)" : "var(--surface)", color: i === 0 || opened ? "#fff" : "var(--muted)", border: 0 }}>{i + 1}</span>
              <span className="small">{s}</span>
            </div>
          ))}
          <p className="tiny muted">Google only lets you post reviews yourself, so the last tap is yours.</p>
        </div>
      ) : null}

      <div className="stack" style={{ marginTop: "auto" }}>
        {gid && <button className="btn block" onClick={openGoogle}><Icon name="copy" size={18} />Copy and open Google</button>}
        <Link to={`/p/${r.place_id}`} className={`btn block ${gid ? "quiet" : ""}`}>{gid ? "Not now" : "Back to the place"}</Link>
      </div>
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
