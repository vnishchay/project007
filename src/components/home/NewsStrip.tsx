import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { placeMediaUrl } from "../../lib/media";
import { initials, timeAgo } from "../../lib/util";
import { Icon } from "../ui";
import { SectionTitle } from "./Kit";

interface ShopUpdate { id: string; place_id: string; place_name: string; logo_path: string | null; body: string; link_url: string | null; created_at: string }

function Logo({ path, name }: { path: string | null; name: string }) {
  const url = placeMediaUrl(path);
  const [broken, setBroken] = useState(false);
  return <span className="news-logo">{url && !broken ? <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name)}</span>;
}

/** Notes from shops you saved or reviewed. Quietly absent when there are none. */
export function NewsStrip({ userId }: { userId: string }) {
  const [rows, setRows] = useState<ShopUpdate[]>([]);
  useEffect(() => {
    let alive = true;
    supabase.rpc("my_shop_updates", { p_limit: 10 })
      .then(({ data, error }) => alive && !error && setRows((data as ShopUpdate[]) || []), () => {});
    return () => { alive = false; };
  }, [userId]);

  if (!rows.length) return null;
  return (
    <section className="stack" style={{ gap: 10 }} aria-label="News from your places">
      <SectionTitle icon="megaphone" tone="amber">News from your places</SectionTitle>
      <div className="hscroll">
        {rows.map((u) => (
          <Link key={u.id} to={`/p/${u.place_id}`} className="news-card">
            <span className="news-head">
              <Logo path={u.logo_path} name={u.place_name} />
              <span className="grow stack tight" style={{ minWidth: 0 }}>
                <span className="strong small ellipsis">{u.place_name}</span>
                <span className="tiny muted">{timeAgo(u.created_at)}</span>
              </span>
              {u.link_url && <Icon name="link" size={15} color="var(--muted)" />}
            </span>
            <span className="news-body">{u.body}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
