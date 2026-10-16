import { useCallback, useEffect, useState } from "react";
import { supabase, errorText } from "./supabase";

export function useFollowing(me: string | undefined) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const reload = useCallback(async () => {
    if (!me) return;
    const { data } = await supabase.from("follows").select("followee_id").eq("follower_id", me);
    setIds(new Set((data || []).map((f) => f.followee_id as string)));
  }, [me]);
  useEffect(() => { reload(); }, [reload]);

  const toggle = useCallback(async (other: string): Promise<string | null> => {
    if (!me || other === me) return null;
    const on = ids.has(other);
    const { error } = on
      ? await supabase.from("follows").delete().eq("follower_id", me).eq("followee_id", other)
      : await supabase.from("follows").insert({ follower_id: me, followee_id: other, source: "in_app" });
    if (error) return errorText(error);
    setIds((s) => { const n = new Set(s); if (on) n.delete(other); else n.add(other); return n; });
    return null;
  }, [me, ids]);

  return { following: ids, toggleFollow: toggle, reload };
}
