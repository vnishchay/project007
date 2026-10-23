// Opening a shop's QR or review link puts this browser tab in "shop mode": the customer sees
// only that shop (no bottom bar, no back button, no other pages) so they stay with it.
// Kept per tab, so the full app still opens normally in a new tab.
const KEY = "tp-focus-shop";
const CODE = "tp-focus-code";

/** `code` is the landing that opened shop mode (/q/<token> or /r/<token>), so the shop page can lead back to it. */
export function setFocusShop(placeId: string, code?: string) {
  try {
    sessionStorage.setItem(KEY, placeId);
    if (code) sessionStorage.setItem(CODE, code); else sessionStorage.removeItem(CODE);
  } catch { /* storage blocked */ }
}
/** The table QR or review link this tab came in through, while in shop mode for `placeId`. */
export function focusCode(placeId: string): string | null {
  try { return sessionStorage.getItem(KEY) === placeId ? sessionStorage.getItem(CODE) : null; } catch { return null; }
}
export function focusShop(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function clearFocusShop() {
  try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(CODE); } catch { /* storage blocked */ }
}

/** Pages a customer in shop mode may open. */
export function allowedInFocus(path: string, shop: string): boolean {
  return path === `/p/${shop}` || path.startsWith(`/review/${shop}`) || path.startsWith("/saved/")
    || path === `/help/${shop}`
    || path.startsWith("/q/") || path.startsWith("/r/") || path === "/signin" || path === "/check"
    || ["/privacy", "/terms"].includes(path);
}
