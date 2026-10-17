import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { timeAgo } from "../../lib/util";
import { Glyph } from "../home/Kit";
import { LinkIcon, guessLinkKind, linkLabel } from "../LinkIcon";

interface Update { id: string; body: string; link_url: string | null; created_at: string }

/** The latest notes the shop posted for all its customers. Hidden when there are none. */
export function ShopUpdates({ placeId }: { placeId: string }) {
  const [rows, setRows] = useState<Update[]>([]);
  useEffect(() => {
    let alive = true;
    setRows([]);
    supabase.from("place_updates").select("id, body, link_url, created_at").eq("place_id", placeId)
      .order("created_at", { ascending: false }).limit(3)
      .then(({ data, error }) => alive && !error && setRows((data as Update[]) || []), () => {});
    return () => { alive = false; };
  }, [placeId]);

  if (!rows.length) return null;
  return (
    <section className="pl-news" aria-label="From the shop">
      <div className="pl-news-head">
        <span className="pl-news-icon"><Glyph name="megaphone" size={18} /></span>
        <span className="grow">From the shop</span>
      </div>
      {rows.map((u) => {
        const kind = u.link_url ? guessLinkKind(u.link_url) : "";
        return (
          <article key={u.id} className="pl-news-item">
            <p>{u.body}</p>
            <div className="pl-news-foot">
              <span className="tiny muted">{timeAgo(u.created_at)}</span>
              {u.link_url && (
                <a className="pl-news-link" href={u.link_url} target="_blank" rel="noopener noreferrer">
                  <LinkIcon kind={kind} size={20} />{kind === "website" || kind === "other" ? "Open link" : linkLabel({ kind })}
                </a>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
