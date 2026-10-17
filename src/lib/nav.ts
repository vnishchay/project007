import type { NavigateFunction } from "react-router-dom";

/** True when there is an earlier screen of this app to go back to (not just an earlier site). */
export function canGoBack(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === "number" && idx > 0;
}

/** One step back inside the app; with nothing behind, go to `fallback` instead of leaving the app. */
export function goBack(nav: NavigateFunction, fallback = "/") {
  if (canGoBack()) nav(-1); else nav(fallback, { replace: true });
}
