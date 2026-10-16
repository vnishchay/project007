import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, errorText } from "./supabase";

export type FollowSource = "contacts" | "in_app" | "suggested";

export function useFollowing(me: string | undefined) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const busyRef = useRef(new Set<string>());

  const reload = useCallback(async () => {
    if (!me) { setIds(new Set()); setLoaded(true); return; }
    const { data, error: e } = await supabase.from("follows").select("followee_id").eq("follower_id", me);
    if (e) { setError(errorText(e)); setLoaded(true); return; }
    setError(null);
    setIds(new Set((data || []).map((f) => f.followee_id as string)));
    setLoaded(true);
  }, [me]);
  useEffect(() => { reload(); }, [reload]);

  /** Follows or unfollows `other`. Returns an error message, or null on success. */
  const toggle = useCallback(async (other: string, source: FollowSource = "in_app"): Promise<string | null> => {
    if (!me || other === me) return null;
    if (busyRef.current.has(other)) return null; // ignore double taps while a request is in flight
    busyRef.current.add(other);
    setBusy(new Set(busyRef.current));
    const on = idsRef.current.has(other);
    const { error: e } = on
      ? await supabase.from("follows").delete().eq("follower_id", me).eq("followee_id", other)
      : await supabase.from("follows").insert({ follower_id: me, followee_id: other, source });
    busyRef.current.delete(other);
    setBusy(new Set(busyRef.current));
    // 23505: already following (e.g. from another tab) — treat as followed.
    if (e && !(e.code === "23505" && !on)) return errorText(e);
    setIds((s) => { const n = new Set(s); if (on) n.delete(other); else n.add(other); return n; });
    return null;
  }, [me]);

  return { following: ids, toggleFollow: toggle, reload, loaded, error, pending: busy };
}
