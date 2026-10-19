import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { lovedPct, openNow, titleCase, topDishes, unslug, type TopDish } from "../lib/dishes";
import { copyText } from "../lib/util";
import { Icon, Spinner, TopBar, useToast } from "../components/ui";
import { EmptyArt, Retry } from "../components/home/Kit";
import { OpenPill } from "../components/home/DishCard";
import { ItemThumb } from "../components/place/ItemThumb";
import "../styles/home.css";

/** /best/<city>/<dish>: every place in a city ranked for one dish by the people who ate it there. */
export default function BestDish() {
  const { city: citySlug = "", dish: dishSlug = "" } = useParams();
  const dish = unslug(dishSlug);
  const toast = useToast();
  const [rows, setRows] = useState<TopDish[] | null>(null);
  const [err, setErr] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const city = rows?.[0]?.city || titleCase(unslug(citySlug));
  const title = `Best ${titleCase(dish)} in ${city}`;

  useEffect(() => {
    let alive = true;
    setRows(null); setErr("");
    topDishes({ query: dish, city: unslug(citySlug), limit: 50 }).then((r) => {
      if (!alive) return;
      if (r.error) setErr(r.error);
      setRows(r.rows);
    });
    return () => { alive = false; };
  }, [dish, citySlug, attempt]);

  useEffect(() => {
    const before = document.title;
    document.title = `${title} · Trusted Picks`;
    return () => { document.title = before; };
  }, [title]);

  async function share() {
    const url = window.location.href;
    const top = rows?.[0];
    const text = top ? `${title}: ${top.place_name} leads, ${lovedPct(top)}% of ${top.review_count} people loved it.` : title;
    if (navigator.share) { try { await navigator.share({ title, text, url }); } catch { /* dismissed */ } return; }
    toast(await copyText(`${text}\n${url}`) ? "Link copied" : "Couldn't copy the link");
  }

  const shown = (rows || []).filter((d) => !openOnly || openNow(d.hours) !== false);
  return (
    <div className="page" style={{ gap: 16 }}>
      <TopBar title={title} right={<button type="button" className="icon-btn" aria-label="Share this list" onClick={share}><Icon name="share" /></button>} />
      <header className="stack tight">
        <h1 style={{ fontSize: 26 }}>{title}</h1>
        <span className="small muted row" style={{ gap: 6 }}><Icon name="verified" size={15} />Ranked by people who tried it there</span>
      </header>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className={`chip ${openOnly ? "on" : ""}`} aria-pressed={openOnly} onClick={() => setOpenOnly((v) => !v)}><Icon name="clock" size={14} />Open now</button>
      </div>
      {err ? <Retry msg={`Couldn't load this list: ${err}`} onRetry={() => setAttempt((n) => n + 1)} /> :
        rows === null ? <Spinner /> :
        shown.length === 0 ? (
          <div className="card">
            <EmptyArt icon="search" tone="sky" title={rows.length ? "Nothing open right now" : `No ratings for ${dish} in ${city} yet`}>
              <Link to={`/?q=${encodeURIComponent(dish)}`} className="btn small ghost"><Icon name="search" size={16} />Search {dish}</Link>
            </EmptyArt>
          </div>
        ) : (
          <ol className="stack" style={{ gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
            {shown.map((d, i) => (
              <li key={d.item_id}>
                <Link to={`/p/${d.place_id}`} className="place-card">
                  <span className="thumb"><ItemThumb path={d.image_path} size={88} /><span className="rank-badge" aria-label={`Number ${i + 1}`}>{i + 1}</span></span>
                  <span className="body">
                    <span className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                      <span className="name grow ellipsis">{d.place_name}</span>
                      <span className="rating-pill"><Icon name="star" size={12} fill="#fff" />{Number(d.avg_rating).toFixed(1)}</span>
                    </span>
                    <span className="meta">
                      <span className="ellipsis">{d.item_name}</span>
                      {d.area && <span><Icon name="pin" size={12} />{d.area}</span>}
                      {d.price_inr != null && <span>₹{d.price_inr}</span>}
                    </span>
                    <span className="badges">
                      <span className="pill loved"><Icon name="heart" size={12} fill="currentColor" /><span>{lovedPct(d)}% of {d.review_count} loved it</span></span>
                      {d.friend_loved > 0 && <span className="pill friends"><Icon name="people" size={12} />{d.friend_loved} friend{d.friend_loved > 1 ? "s" : ""}</span>}
                      <OpenPill hours={d.hours} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      <p className="tiny muted center">Only people who scanned the table QR or had a shop's review link can rate.</p>
    </div>
  );
}
