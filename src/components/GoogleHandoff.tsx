import { useState } from "react";
import { supabase, errorText } from "../lib/supabase";
import { copyText } from "../lib/util";
import { CustomerHelp } from "./CustomerHelp";
import { Icon, useToast } from "./ui";
import "../styles/handoff.css";

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

/** Copy on the tap itself: browsers refuse a clipboard write once a new tab has taken focus. */
export function copyOnTap(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true, () => (execCopy(text) ? true : copyText(text).catch(() => false)));
  }
  return execCopy(text) ? Promise.resolve(true) : copyText(text).catch(() => false);
}

export const mapsSearchUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/**
 * The one "post it on Google" card, used right after reviewing and on the Post on Google page.
 * Google has no way to post for someone, so we copy the words and open the right page; the last tap is theirs.
 */
export function GoogleHandoff({ text, stars, url, onMaps, placeName, reviewId, opened, onOpened, extra }: {
  text: string;
  stars: number;
  url: string;
  /** No Google place id: Maps search opens instead of the review box. */
  onMaps: boolean;
  placeName: string;
  /** Counted once in google_shares so the owner sees how many reviews went on to Google. */
  reviewId?: string | null;
  opened: boolean;
  onOpened: () => void;
  extra?: React.ReactNode;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState<boolean | null>(null);
  const s = Math.max(1, Math.min(5, Math.round(stars)));
  const starWord = `${s} star${s === 1 ? "" : "s"}`;
  const steps = onMaps
    ? ["We copy your review and open Google Maps", `Pick ${placeName}, then tap Write a review`, `Tap ${starWord}`, "Tap the box, then the paste suggestion, then Post"]
    : ["We copy your review and open Google", `Tap ${starWord}`, "Tap the box, then the paste suggestion above your keyboard", "Tap Post"];

  function open() {
    const copying = copyOnTap(text);
    let win: Window | null = null;
    try { win = window.open(url, "_blank"); } catch { win = null; }
    if (win) win.opener = null;
    if (reviewId && !opened) {
      void supabase.auth.getSession().then(({ data }) => supabase.from("google_shares").insert({ review_id: reviewId, user_id: data.session?.user.id }))
        .then(({ error }) => { if (error) console.warn(errorText(error)); }, () => {});
    }
    onOpened();
    void copying.then((ok) => {
      setCopied(ok);
      if (!ok) toast("Couldn't copy. Copy your review from the box below.");
      // Popup blocked: go there in this tab instead, but only once the text is on the clipboard.
      if (!win && ok) window.location.href = url;
    });
  }

  return (
    <section className="gh" aria-labelledby="gh-h">
      <div className="gh-head">
        <span className="gh-ico" aria-hidden="true"><Icon name="globe" size={22} /></span>
        <div className="gh-t">
          <h2 id="gh-h">Post it on Google</h2>
          <small>{opened ? "Google opened in a new tab. Finish there." : "Optional. Helps the shop the most."}</small>
        </div>
      </div>
      <ol className="gh-steps">
        {steps.map((t, i) => <li key={t}><b className={opened && i === 0 ? "done" : ""}>{opened && i === 0 ? <Icon name="check" size={13} width={3} /> : i + 1}</b><span>{t}</span></li>)}
      </ol>
      <div className="gh-stars" aria-label={`On Google, tap ${starWord}`}><span>On Google, tap</span><span className="gh-s" aria-hidden="true">{"★".repeat(s)}<i>{"★".repeat(5 - s)}</i></span></div>
      {extra}
      <button type="button" className="gh-cta" onClick={open}>
        <Icon name={opened ? "refresh" : "copy"} size={18} />{opened ? `Copy and open ${onMaps ? "Google Maps" : "Google"} again` : `Copy and open ${onMaps ? "Google Maps" : "Google"}`}
      </button>
      {copied === false && (
        <label className="gh-manual">
          <span><Icon name="copy" size={14} />Copy by hand</span>
          <textarea className="textarea" readOnly value={text} rows={4} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
      <p className="gh-fine"><Icon name="info" size={14} />Google only lets you post it yourself, so the last tap is yours.</p>
    </section>
  );
}

/**
 * A private note to the owner. It starts empty on purpose: copying the review into it would let
 * the owner match an anonymous review to whoever sent the note.
 */
export function PrivateNote({ placeId, onSent }: { placeId: string; onSent?: () => void }) {
  return <CustomerHelp key={placeId} placeId={placeId} onSent={onSent} />;
}
