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
