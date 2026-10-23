import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

/**
 * Owner mode: shop owners get their own app at /owner, with its own look and navigation.
 * An owner lands there after signing in and whenever they open the app at "/", until they pick
 * "Diner app" (then "/" is Discover again, until they open the owner app). Diners never see it.
 */
export type AppMode = "owner" | "diner";
const MODE_KEY = "tp-app-mode";
const SHOPS_KEY = "tp-owner-shops";
const LAST_KEY = "tp-owner-last";

export interface OwnerShop { id: string; name: string; area: string | null; city: string; status: string; cover_path: string | null; logo_path: string | null; verification?: string; verification_note?: string | null }

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export const appMode = (): AppMode | null => (get(MODE_KEY) as AppMode | null);
export const setAppMode = (m: AppMode) => put(MODE_KEY, m);
export const lastShop = () => get(LAST_KEY);
export const setLastShop = (id: string) => put(LAST_KEY, id);

/** How many shops this account owned last time we looked, so "/" can send an owner on without a wait. */
export function knownShopCount(uid: string): number | null {
  const raw = get(SHOPS_KEY);
  if (!raw) return null;
  const [who, n] = raw.split(":");
  return who === uid ? Number(n) : null;
}

let inflight: { uid: string; p: Promise<OwnerShop[]> } | null = null;
export function loadMyShops(uid: string): Promise<OwnerShop[]> {
  if (inflight?.uid === uid) return inflight.p;
  const p = (async () => {
    const { data, error } = await supabase.rpc("my_places");
    const rows = error ? [] : ((data as OwnerShop[]) || []);
    if (!error) put(SHOPS_KEY, `${uid}:${rows.length}`);
    return rows;
  })();
  inflight = { uid, p };
  p.finally(() => setTimeout(() => { if (inflight?.p === p) inflight = null; }, 5000));
  return p;
}

/** The signed-in account's shops (undefined while loading; [] for guests and diners). */
export function useMyShops(): OwnerShop[] | undefined {
  const { session, isGuest, loading } = useAuth();
  const uid = session && !isGuest ? session.user.id : null;
  const [shops, setShops] = useState<OwnerShop[] | undefined>(undefined);
  useEffect(() => {
    if (loading) return;
    if (!uid) { setShops([]); return; }
    let alive = true;
    loadMyShops(uid).then((s) => { if (alive) setShops(s); });
    return () => { alive = false; };
  }, [uid, loading]);
  return shops;
}

/** Should "/" open the owner app for this account? null = still finding out. */
export function useOwnerLanding(): boolean | null {
  const { session, isGuest, loading } = useAuth();
  const uid = session && !isGuest ? session.user.id : null;
  const mode = appMode();
  const [owns, setOwns] = useState<{ uid: string; owns: boolean } | null>(null);
  useEffect(() => {
    if (loading || !uid || mode === "diner") return;
    let alive = true;
    loadMyShops(uid).then((s) => { if (alive) setOwns({ uid, owns: s.length > 0 }); });
    return () => { alive = false; };
  }, [uid, loading, mode]);
  if (loading) return null;
  if (!uid || mode === "diner") return false;
  if (owns?.uid === uid) return owns.owns;
  const known = knownShopCount(uid);
  return known == null ? null : known > 0;
}
