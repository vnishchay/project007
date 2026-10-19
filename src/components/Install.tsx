import { useState, type ReactNode } from "react";
import { promptInstall, shouldSuggest, snoozeInstall, useInstall, type InstallWay } from "../lib/install";
import { useToast, Icon } from "./ui";
import { copyText } from "../lib/util";

/** Step by step, for browsers that can't open an install popup for us. */
const STEPS: Record<Exclude<InstallWay, "prompt" | null>, { title: string; steps: ReactNode[] }> = {
  ios: { title: "Add to your Home Screen", steps: [
    <>Tap <b>Share</b> <Icon name="share" size={15} /> at the bottom of Safari</>,
    <>Scroll down and tap <b>Add to Home Screen</b> <Icon name="plus" size={15} /></>,
    <>Tap <b>Add</b>. Trusted Picks opens from your home screen like an app.</>,
  ] },
  "ios-other": { title: "Add to your Home Screen", steps: [
    <>Tap <b>Share</b> <Icon name="share" size={15} /> (in the menu or next to the address bar)</>,
    <>Tap <b>Add to Home Screen</b> <Icon name="plus" size={15} /></>,
    <>Not there? Open this page in <b>Safari</b> and do the same.</>,
  ] },
  "android-menu": { title: "Install the app", steps: [
    <>Tap the browser menu <b>⋮</b> (top right, or bottom in Samsung Internet)</>,
    <>Tap <b>Install app</b> or <b>Add to Home screen</b></>,
    <>Tap <b>Install</b>. Trusted Picks opens from your home screen like an app.</>,
  ] },
  inapp: { title: "Open in your browser first", steps: [
    <>This app's built-in browser can't install apps</>,
    <>Tap <b>⋯</b> and choose <b>Open in browser</b> (or Open in Safari / Chrome)</>,
    <>Then add Trusted Picks to your home screen from there</>,
  ] },
};

function InstallSheet({ way, onClose }: { way: Exclude<InstallWay, "prompt" | null>; onClose: () => void }) {
  const toast = useToast();
  const s = STEPS[way];
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={s.title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: 12 }}>
          <img src="/icon-192.png" alt="" width={48} height={48} style={{ borderRadius: 12 }} />
          <div className="grow stack tight"><span className="strong" style={{ fontSize: 18 }}>{s.title}</span><span className="tiny muted">Free, no app store, takes a few seconds</span></div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <ol className="install-steps">{s.steps.map((x, i) => <li key={i}><span className="n">{i + 1}</span><span className="grow">{x}</span></li>)}</ol>
        {way === "inapp" && <button type="button" className="btn ghost block" onClick={async () => toast((await copyText(window.location.href)) ? "Link copied. Paste it in your browser." : "Couldn't copy")}><Icon name="copy" size={18} />Copy link</button>}
        <button type="button" className="btn green block" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

/** Opens the install popup or the right steps. Returns the click handler and the sheet to render. */
export function useInstallAction() {
  const { way } = useInstall();
  const [steps, setSteps] = useState(false);
  const run = async () => { if (way === "prompt") await promptInstall(); else if (way) setSteps(true); };
  const sheet = steps && way && way !== "prompt" ? <InstallSheet way={way} onClose={() => setSteps(false)} /> : null;
  return { way, run, sheet };
}

/**
 * An install suggestion. `look`: "rvx" on the review screens, "callout" on home, "row" in Me (always shown until installed).
 * `returning` waits for someone's second visit.
 */
export function InstallNudge({ look, title, sub, returning = false }: { look: "rvx" | "callout" | "row"; title: string; sub: string; returning?: boolean }) {
  const { way, run, sheet } = useInstallAction();
  const [hidden, setHidden] = useState(false);
  if (!way || hidden || (look !== "row" && !shouldSuggest({ returning }))) return sheet;
  const notNow = look !== "row" && (
    <button type="button" className="link-btn tiny" aria-label="Not now" onClick={(e) => { e.stopPropagation(); snoozeInstall(); setHidden(true); }}><Icon name="close" size={16} /></button>
  );
  const body = (
    <>
      <img src="/icon-192.png" alt="" width={36} height={36} style={{ borderRadius: 9, flex: "none" }} />
      <span className="grow stack tight" style={{ minWidth: 0 }}><b className={look === "row" ? "t" : undefined}>{title}</b><small className={look === "row" ? "s" : "tiny"}>{sub}</small></span>
    </>
  );
  return (
    <>
      {look === "rvx" ? (
        <div className="rvx-nudge" role="group" aria-label={title}>
          <button type="button" className="install-hit" onClick={run}>{body}<Icon name="download" size={18} /></button>{notNow}
        </div>
      ) : look === "callout" ? (
        <div className="callout green" role="group" aria-label={title}>
          <button type="button" className="install-hit" onClick={run}>{body}<span className="btn small green">{way === "prompt" ? "Install" : "How"}</span></button>{notNow}
        </div>
      ) : (
        <div className="menu"><button type="button" className="menu-row" onClick={run}>{body}<Icon name="download" size={18} color="var(--muted)" /></button></div>
      )}
      {sheet}
    </>
  );
}
