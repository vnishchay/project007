import { useEffect, useState } from "react";
import { pushState, turnOffReminders, turnOnReminders, type PushState } from "../lib/push";
import { Chip } from "./home/Kit";
import { useToast } from "./ui";

/** What a diner is told after choosing "Rate later", for each state of this phone. */
export function laterNote(state: PushState, until: string | null): string {
  const waits = `It waits on your home page under Ready to rate${until ? ` until ${until}` : ""}.`;
  if (state === "on") return `We'll remind you in about an hour and a half. ${waits}`;
  if (state === "install") return `${waits} To get a reminder on iPhone, add Trusted Picks to your home screen first.`;
  if (state === "denied") return `Notifications are blocked for this site, so no reminder. ${waits}`;
  return waits;
}

/** Profile switch: review reminders on this phone. Hidden until reminders are set up for the app. */
export function ReminderRow() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; pushState().then((s) => alive && setState(s), () => alive && setState("unsupported")); return () => { alive = false; }; }, []);
  if (!state || state === "unset" || state === "unsupported") return null;

  async function flip(on: boolean) {
    setBusy(true);
    try {
      if (on) {
        const s = await turnOnReminders();
        setState(s);
        if (s === "denied") toast("Notifications are blocked. Allow them for this site in your browser settings.");
      } else { await turnOffReminders(); setState("off"); }
    } catch { toast("Couldn't change that. Try again."); }
    setBusy(false);
  }

  const sub = state === "install" ? "On iPhone, add Trusted Picks to your home screen first"
    : state === "denied" ? "Blocked in your browser's settings for this site"
    : "A nudge to review after you scan at a shop, while your review is still open";
  return (
    <div className="menu">
      <label className="menu-row" style={{ cursor: state === "install" || state === "denied" ? "default" : "pointer" }}>
        <Chip icon="bell" tone="amber" />
        <span className="grow stack tight" style={{ minWidth: 0 }}>
          <span className="t">Review reminders</span>
          <span className="s">{sub}</span>
        </span>
        <span className="switch-row"><input type="checkbox" role="switch" aria-label="Review reminders" checked={state === "on"} disabled={busy || state === "install" || state === "denied"} onChange={(e) => void flip(e.target.checked)} /></span>
      </label>
    </div>
  );
}
