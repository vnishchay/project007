/**
 * A random id for this phone or browser, used only so a guest gets one review per shop
 * per device. It isn't a fingerprint: nothing about the device is read, and the server
 * stores only a hash of it.
 */
const KEY = "tp-device";
// Where storage is blocked, the id lives for this page view only. Never one shared id: that would
// make every such visitor look like the same phone.
let session: string | null = null;

export function deviceId(): string {
  try {
    let id = localStorage.getItem(KEY) || readCookie();
    if (!id) id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    document.cookie = `${KEY}=${id}; max-age=${60 * 60 * 24 * 730}; path=/; samesite=lax; secure`;
    return id;
  } catch {
    session ||= readCookie() || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return session;
  }
}

function readCookie(): string | null {
  try { return document.cookie.split("; ").find((c) => c.startsWith(`${KEY}=`))?.slice(KEY.length + 1) || null; } catch { return null; }
}
