import { useEffect, useState } from "react";
import { bumpStat } from "./stats";

// Installing the app to the home screen (PWA).
// Android/desktop Chrome and Edge give us an install prompt we can open from our own button.
// iPhone and iPad never do: people add it from Safari's Share menu, so we show those steps.
// In-app browsers (Instagram, Facebook...) can't install at all: we say how to open the real browser.

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
const SNOOZE = "tp-install-snooze";
const DONE = "tp-installed";
const SEEN = "tp-sessions";

function store(k: string, v?: string): string | null {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* storage blocked */ }
  return null;
}

if (typeof window !== "undefined") {
  deferred = (window as Window & { __installPrompt?: InstallPrompt }).__installPrompt ?? null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallPrompt; notify(); });
  window.addEventListener("appinstalled", () => { deferred = null; store(DONE, "1"); bumpStat("installed"); notify(); });
  // Count visits (one per tab session), so we only ask people who came back.
  try {
    if (!sessionStorage.getItem(SEEN)) { sessionStorage.setItem(SEEN, "1"); store(SEEN, String(Number(store(SEEN) || 0) + 1)); }
  } catch { /* storage blocked */ }
}

/** The service worker makes the app installable and quick to reopen. Production only. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}

export type InstallWay = "prompt" | "ios" | "ios-other" | "inapp" | "android-menu" | null;

export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
    || document.referrer.startsWith("android-app://");
}

/** How this browser can install the app, or null when it can't (or it's already installed). */
export function installWay(): InstallWay {
  if (typeof navigator === "undefined" || isInstalled()) return null;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (/FBAN|FBAV|Instagram|Line\/|Snapchat|LinkedInApp|Twitter/i.test(ua)) return "inapp";
  if (deferred) return "prompt";
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios";
  if (/Android/.test(ua)) return "android-menu"; // Chrome before its prompt is ready, Samsung Internet, Firefox
  return null; // desktop browsers without a prompt: nothing to offer
}

/** Opens the browser's own install popup (Android/desktop). True when the person installed it. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const p = deferred;
  deferred = null;
  await p.prompt();
  const { outcome } = await p.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  if (outcome === "accepted") store(DONE, "1"); else snoozeInstall(7);
  notify();
  return outcome === "accepted";
}

/** "Not now": don't ask again for a while. */
export function snoozeInstall(days = 21) { store(SNOOZE, String(Date.now() + days * 86400000)); notify(); }

/** Whether to show an install suggestion now. `returning` asks only people on their second visit or later. */
export function shouldSuggest({ returning = false } = {}): boolean {
  if (!installWay() || store(DONE)) return false;
  if (Number(store(SNOOZE) || 0) > Date.now()) return false;
  return !returning || Number(store(SEEN) || 0) >= 2;
}

/** Re-renders when the install state changes (prompt arrived, installed, snoozed). */
export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return { way: installWay(), installed: isInstalled() };
}
