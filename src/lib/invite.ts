import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Friends are made through shared links. Every link someone shares (an invite, a review,
 * a place) carries ?ref=<their invite code>. Whoever opens it and then uses the app
 * (as a guest or signed in) becomes their friend.
 */
const KEY = "tp-ref";
export type Via = "invite" | "review" | "place" | "qr";

interface Pending { code: string; via: Via }

function read(): Pending | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export function clearPendingRef() { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } }
export function pendingRef(): Pending | null { return read(); }

// Runs once at startup, before the router reads the address.
(function captureRef() {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  const code = (q.get("ref") || "").trim().toLowerCase();
  if (!code) return;
  const via = (["invite", "review", "place", "qr"].includes(q.get("via") || "") ? q.get("via") : "invite") as Via;
  try { localStorage.setItem(KEY, JSON.stringify({ code: code.slice(0, 32), via })); } catch { /* storage blocked */ }
  q.delete("ref"); q.delete("via");
  const qs = q.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
})();

let cached: { uid: string; code: string } | null = null;

/** Your invite code, created the first time it's needed. Null if signed out. */
export async function myInviteCode(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return null;
  if (cached?.uid === uid) return cached.code;
  const r = await supabase.rpc("my_invite_code");
  if (r.error || !r.data) return null;
  cached = { uid, code: r.data as string };
  return cached.code;
}

/** A link to a path in the app that makes whoever opens it your friend. */
export async function shareLink(path: string, via: Via): Promise<string> {
  const url = new URL(path, window.location.origin);
  const code = await myInviteCode();
  if (code) { url.searchParams.set("ref", code); url.searchParams.set("via", via); }
  return url.toString();
}

export function useInviteLink(path = "/", via: Via = "invite"): string | null {
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => { let alive = true; shareLink(path, via).then((l) => alive && setLink(l)); return () => { alive = false; }; }, [path, via]);
  return link;
}

/** Share with the system sheet, or copy. Resolves "shared", "copied" or "dismissed". */
export async function shareOrCopy(data: { title?: string; text?: string; url: string; files?: File[] }): Promise<"shared" | "copied" | "dismissed"> {
  if (navigator.share) {
    try {
      if (data.files?.length && navigator.canShare?.({ files: data.files })) await navigator.share(data);
      else await navigator.share({ title: data.title, text: data.text, url: data.url });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "dismissed";
    }
  }
  try { await navigator.clipboard.writeText(data.text ? `${data.text} ${data.url}` : data.url); return "copied"; } catch { return "dismissed"; }
}

export interface AcceptedFriend { friend_id: string; display_name: string | null; avatar_path: string | null; is_new: boolean }

/**
 * Accept a pending invite for the current session. A guest accepts it too, but the invite is kept
 * until a full account accepts it, so signing in later still makes the real account friends.
 */
export async function acceptPendingInvite(isGuest = false): Promise<AcceptedFriend | null> {
  const p = read();
  if (!p) return null;
  const r = await supabase.rpc("accept_invite", { p_code: p.code, p_via: p.via });
  // Database not updated yet, or the network failed: keep the invite for later.
  if (r.error?.code === "PGRST202" || (r.error && !r.error.code)) return null;
  if (!isGuest || r.error) clearPendingRef();
  if (r.error) return null;
  return ((r.data as AcceptedFriend[] | null) || [])[0] ?? null;
}
