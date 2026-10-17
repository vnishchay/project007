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
  const text = (desc || code || "").replace(/\+/g, " ");
  try { return decodeURIComponent(text); } catch { return text; }
}
export const urlAuthError = readUrlAuthError();

// While a newer app version runs against a database that hasn't had its latest update yet,
// a read that names a brand-new column fails. For these optional columns, retry once without them
// so the screen still loads (the extra detail just doesn't show).
const OPTIONAL_COLS = ["source"];
async function tolerantFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 400 || (init?.method && init.method !== "GET")) return res;
  const body = await res.clone().json().catch(() => null) as { code?: string; message?: string } | null;
  const col = body?.code === "42703" && OPTIONAL_COLS.find((c) => body.message?.includes(`.${c} does not exist`));
  if (!col) return res;
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const sel = u.searchParams.get("select");
  if (!sel) return res;
  u.searchParams.set("select", sel.split(",").filter((c) => c !== col).join(","));
  return fetch(u.toString(), init);
}

export const supabase = createClient(url || "http://localhost", key || "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: tolerantFetch },
});

// Columns of other people's profiles anyone may read. Phone fingerprint and home city
// are private; your own full profile comes from the my_profile() function.
export const PROFILE_COLS = "id, display_name, avatar_path, role, created_at";

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

export function errorText(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message;
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : "Something went wrong";
}

/**
 * search_places, falling back to older signatures (no p_kind, no p_area / p_place) when
 * the database hasn't had the newer migrations yet, so Discover keeps working.
 */
export async function searchPlaces(params: Record<string, unknown>) {
  let res = await supabase.rpc("search_places", params);
  // Before migration 0013 there's no business-type filter: search without it.
  if (res.error?.code === "PGRST202" && "p_kind" in params) {
    const { p_kind: _kind, ...rest } = params;
    params = rest;
    res = await supabase.rpc("search_places", params);
  }
  if (res.error?.code === "PGRST202" && ("p_area" in params || "p_place" in params)) {
    const { p_area, p_place, ...old } = params;
    const retry = await supabase.rpc("search_places", p_place || p_area ? { ...old, p_limit: 50 } : old);
    if (retry.error || !retry.data) return retry;
    let rows = retry.data as { place_id: string; area: string | null }[];
    if (p_area) rows = rows.filter((r) => (r.area || "").toLowerCase() === String(p_area).toLowerCase());
    if (p_place) rows = rows.filter((r) => r.place_id === p_place);
    return { ...retry, data: rows };
  }
  return res;
}
