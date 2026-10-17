// Opening a shop's QR or review link puts this browser tab in "shop mode": the customer sees
// only that shop (no bottom bar, no back button, no other pages) so they stay with it.
// Kept per tab, so the full app still opens normally in a new tab.
const KEY = "tp-focus-shop";

export function setFocusShop(placeId: string) {
  try { sessionStorage.setItem(KEY, placeId); } catch { /* storage blocked */ }
}
export function focusShop(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

/** Pages a customer in shop mode may open. */
export function allowedInFocus(path: string, shop: string): boolean {
  return path === `/p/${shop}` || path.startsWith(`/review/${shop}`) || path.startsWith("/saved/")
    || path.startsWith("/q/") || path.startsWith("/r/") || path === "/signin"
    || ["/privacy", "/terms"].includes(path);
}
