import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { placeMediaUrl } from "../../lib/media";
import { initials, timeAgo } from "../../lib/util";
import { Icon, useToast } from "../ui";
import { SectionTitle } from "./Kit";
import { UnwrapSheet } from "../treats/UnwrapSheet";
import { CounterSheet } from "../treats/CounterSheet";
import "../../styles/treats.css";

interface Offer { id: string; place_id: string; place_name: string; logo_path: string | null; body: string; link_url: string | null; created_at: string; seen: boolean }
interface ShopUpdate { id: string; place_id: string; place_name: string; logo_path: string | null; body: string; link_url: string | null; created_at: string }

const asOffer = (o: Offer) => ({ ...o, valid_till: new Date(new Date(o.created_at).getTime() + 30 * 86_400_000).toISOString(), used_at: null });

function Logo({ path, name }: { path: string | null; name: string }) {
  const url = placeMediaUrl(path);
  const [broken, setBroken] = useState(false);
  return <span className="news-logo">{url && !broken ? <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name)}</span>;
}

/** Offers sent to you by shops you scanned at, then notes from shops you saved or reviewed. Quietly absent when there are none. */
export function NewsStrip({ userId }: { userId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<ShopUpdate[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  useEffect(() => {
    let alive = true;
    supabase.rpc("my_shop_updates", { p_limit: 10 })
      .then(({ data, error }) => alive && !error && setRows((data as ShopUpdate[]) || []), () => {});
    supabase.rpc("my_offers", { p_limit: 10 }).then(({ data, error }) => {
      if (!alive || error) return;
      // Not marked seen here: an offer stays wrapped until it's opened.
      setOffers((data as Offer[]) || []);
    }, () => {});
    return () => { alive = false; };
  }, [userId]);

  async function stop(o: Offer) {
    const { error } = await supabase.rpc("set_shop_privacy", { p_place: o.place_id, p_no_offers: true });
    if (error) { toast("Couldn't change that. Try again."); return; }
    setOffers((xs) => xs.filter((x) => x.place_id !== o.place_id));
    toast(`No more offers from ${o.place_name}`);
  }

  const [showing, setShowing] = useState<Offer | null>(null);
  const [counter, setCounter] = useState(false);
  if (!rows.length && !offers.length) return null;
  return (
    <section className="stack" style={{ gap: 10 }} aria-label="News from your places">
      <SectionTitle icon="megaphone" tone="amber">News from your places</SectionTitle>
      <div className="hscroll">
        {offers.map((o) => (
          <div key={o.id} className="news-card offer">
            <Link to={`/p/${o.place_id}`} className="news-head" style={{ color: "inherit" }}>
              <Logo path={o.logo_path} name={o.place_name} />
              <span className="grow stack tight" style={{ minWidth: 0 }}>
                <span className="strong small ellipsis">{o.place_name}</span>
                <span className="tiny muted ellipsis"><Icon name="gift" size={12} /> For you · {timeAgo(o.created_at)}</span>
              </span>
              {!o.seen && <span className="badge">New</span>}
            </Link>
            <span className="news-body">{o.body}</span>
            <span className="row" style={{ gap: 8, marginTop: "auto" }}>
              <button type="button" className="link-btn small" onClick={() => setShowing(o)}><Icon name={o.seen ? "ticket" : "gift"} size={14} />{o.seen ? "Show at counter" : "Unwrap"}</button>
              <span className="grow" />
              <button type="button" className="link-btn small" style={{ color: "var(--muted)" }} onClick={() => stop(o)}><Icon name="bell" size={14} />Stop offers</button>
            </span>
          </div>
        ))}
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
      {showing && !counter && <UnwrapSheet offer={asOffer(showing)} shop={showing.place_name} onClose={() => setShowing(null)}
        onOpened={() => setOffers((xs) => xs.map((x) => (x.id === showing.id ? { ...x, seen: true } : x)))} onUse={() => setCounter(true)} />}
      {showing && counter && <CounterSheet shop={showing.place_name} big={showing.body} usable={{ kind: "offer", id: showing.id }} pass={{ kind: "offer", id: showing.id }}
        onClose={() => { setShowing(null); setCounter(false); }}
        onUsed={() => setOffers((xs) => xs.filter((x) => x.id !== showing.id))} />}
    </section>
  );
}
