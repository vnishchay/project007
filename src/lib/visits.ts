import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** A shop you scanned at and can still review. `reviewed`: you already posted something since the scan. */
export interface OpenVisit { place_id: string; place_name: string; area: string | null; category: string; expires_at: string; reviewed: boolean }

/** Your open visits, soonest to close first. Empty without a session. */
export function useOpenVisits(userId: string | undefined): OpenVisit[] {
  const [rows, setRows] = useState<OpenVisit[]>([]);
  useEffect(() => {
    setRows([]);
    if (!userId) return;
    let alive = true;
    supabase.rpc("my_open_visits").then(({ data, error }) => {
      if (!alive || error) return;
      setRows(((data as OpenVisit[]) || []).sort((a, b) => a.expires_at.localeCompare(b.expires_at)));
    }, () => {});
    return () => { alive = false; };
  }, [userId]);
  return rows;
}

/** "45 min left" for a visit that is still open, so people know how long they have to rate. */
export function timeLeft(iso: string): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ${mins % 60 ? `${mins % 60} min ` : ""}left` : `Until ${new Date(iso).toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

/**
 * How sure we are that your open visit here happened at the shop. "verified": the location check passed, an NFC tap,
 * or the shop's own review link. "far": the phone was away from the shop. "unchecked": no location was shared.
 * Far and unchecked visits can still review, but count for less, so they aren't called verified.
 */
export type VisitProof = "verified" | "far" | "unchecked";
export function useVisitProof(placeId: string | undefined, userId: string | undefined, refresh: unknown = null): VisitProof | null {
  const [proof, setProof] = useState<VisitProof | null>(null);
  useEffect(() => {
    setProof(null);
    if (!placeId || !userId) return;
    let alive = true;
    supabase.from("visits").select("near, tapped, source").eq("user_id", userId).eq("place_id", placeId)
      .gt("expires_at", new Date().toISOString()).order("scanned_at", { ascending: false }).limit(1)
      .then(({ data, error }) => {
        const v = (data as { near: boolean | null; tapped: boolean | null; source: string | null }[] | null)?.[0];
        if (!alive || error || !v) return;
        setProof(v.near || v.tapped || v.source === "link" ? "verified" : v.near === false ? "far" : "unchecked");
      }, () => {});
    return () => { alive = false; };
  }, [placeId, userId, refresh]);
  return proof;
}
