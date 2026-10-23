import { supabase } from "./supabase";

/** The Web Push public key (from scripts/setup-reminders.ps1). Without it, reminders are simply not offered. */
const VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || "";

export type PushState = "on" | "off" | "denied" | "unsupported" | "install" | "unset";

const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Where this phone stands: reminders on, possible, blocked, or needing the app on the home screen first (iPhone). */
export async function pushState(): Promise<PushState> {
  if (!VAPID) return "unset";
  if (isIos() && !standalone()) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Asks for permission (only ever on a tap) and saves this phone's push address. */
export async function turnOnReminders(): Promise<PushState> {
  const now = await pushState();
  if (now === "on" || now === "unset" || now === "unsupported" || now === "install" || now === "denied") {
    if (now === "on") await save();
    return now;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  return (await save()) ? "on" : "off";
}

async function save(): Promise<boolean> {
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) });
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) return false;
  const { error } = await supabase.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  return !error;
}

export async function turnOffReminders(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await supabase.rpc("delete_push_subscription", { p_endpoint: sub?.endpoint ?? null });
  await sub?.unsubscribe().catch(() => false);
}
