import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, errorText } from "./supabase";
import { fetchGoogleLocation, googleConfigured } from "./google";

/** Where a shop's map pin stands, as the owner sees it. */
export interface PinInfo {
  has_pin: boolean;
  source: "google" | "manual" | null;
  updated_at: string | null;
  lat: number | null;
  lng: number | null;
  google_linked: boolean;
}

/** Google lets us keep a pin for 30 days; refresh a little earlier. */
export const PIN_REFRESH_DAYS = 25;

export async function loadPin(placeId: string): Promise<PinInfo | null> {
  const r = await supabase.rpc("place_pin", { p_place: placeId });
  if (r.error) return null; // a database without map-pin tracking yet
  return ((r.data as PinInfo[]) || [])[0] ?? null;
}

/**
 * A shop linked to Google uses Google's own pin and nothing else: read it from Google
 * and save it with its source, so owners can't drift from it.
 */
export async function syncPinFromGoogle(placeId: string, googlePlaceId: string): Promise<{ ok: true; lat: number; lng: number } | { ok: false; error: string }> {
  if (!googleConfigured) return { ok: false, error: "Google isn't connected on this site" };
  const loc = await fetchGoogleLocation(googlePlaceId);
  if (!loc) return { ok: false, error: "Couldn't read the location from Google. Try again in a moment." };
  const r = await supabase.rpc("set_place_location", { p_place: placeId, p_lat: loc.lat, p_lng: loc.lng, p_source: "google" });
  if (r.error) return { ok: false, error: errorText(r.error) };
  return { ok: true, lat: loc.lat, lng: loc.lng };
}

const stale = (iso: string | null) => !iso || Date.now() - new Date(iso).getTime() > PIN_REFRESH_DAYS * 86400000;

/**
 * The pin for a shop being managed. For a Google-linked shop it fills in or refreshes the pin by itself
 * when it's missing, came from somewhere else, or is older than the refresh window.
 */
export function usePin(placeId: string, googlePlaceId: string | null | undefined) {
  const [pin, setPin] = useState<PinInfo | null | undefined>(undefined);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const tried = useRef("");

  const reload = useCallback(async () => { setPin(await loadPin(placeId)); }, [placeId]);

  const refresh = useCallback(async () => {
    if (!googlePlaceId) return false;
    setSyncing(true); setError("");
    const r = await syncPinFromGoogle(placeId, googlePlaceId);
    if (!r.ok) setError(r.error);
    await reload();
    setSyncing(false);
    return r.ok;
  }, [placeId, googlePlaceId, reload]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!pin || !googlePlaceId || !googleConfigured) return;
    const key = `${placeId}:${googlePlaceId}`;
    if (tried.current === key) return;
    if (!pin.has_pin || pin.source !== "google" || stale(pin.updated_at)) { tried.current = key; refresh(); }
  }, [pin, placeId, googlePlaceId, refresh]);

  return { pin, syncing, error, refresh, reload };
}
