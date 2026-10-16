import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configured = Boolean(url && key);

// Supabase sends sign-in failures back as ?error=…&error_description=… or #error=….
// Read them before the client starts, and take them out of the address bar.
function readUrlAuthError(): string | null {
  if (typeof window === "undefined") return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const desc = hash.get("error_description") || query.get("error_description");
  const code = hash.get("error") || query.get("error");
  if (!desc && !code) return null;
  for (const k of ["error", "error_code", "error_description"]) query.delete(k);
  const qs = query.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : ""));
  return (desc || code || "").replace(/\+/g, " ");
}
export const urlAuthError = readUrlAuthError();

export const supabase = createClient(url || "http://localhost", key || "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Columns of profiles the public may read (phone_hash is never readable).
export const PROFILE_COLS = "id, display_name, avatar_path, city, role, created_at";

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

export function errorText(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message;
  return m || "Something went wrong";
}
