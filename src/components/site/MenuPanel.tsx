import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../ui";
import { ItemThumb } from "../place/ItemThumb";
import { priceLabel, type ShopItem } from "../place/shop";

interface Stat { sum: number; count: number }

/** The full menu or catalogue, shown in a sheet from the website. */
export function MenuPanel({ items, stats, icon, canRate, rateUrl, focus, onReviews }: {
  items: ShopItem[]; stats: Map<string, Stat>; icon: IconName; canRate: boolean; rateUrl: string;
  focus?: string | null; onReviews: (itemId: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) box.current?.querySelector(`[data-item="${focus}"]`)?.scrollIntoView({ block: "center" });
  }, [focus]);
  if (!items.length) return <div className="empty"><Icon name="list" size={28} /><p className="small">Nothing added here yet</p></div>;
  return (
    <div className="mp" ref={box}>
      {items.map((p) => {
        const s = stats.get(p.id);
        return (
          <div key={p.id} data-item={p.id} className={`mp-row ${focus === p.id ? "focus" : ""}`}>
            <ItemThumb path={p.image_path} icon={icon} size={76} className="mp-img" alt={p.name} />
            <div className="mp-body">
              <div className="mp-top">
                <b>{p.name}</b>
                {priceLabel(p.price_inr) && <span className="mp-price">{priceLabel(p.price_inr)}</span>}
              </div>
              {p.description && <p>{p.description}</p>}
              <div className="mp-foot">
                {s ? <button type="button" className="mp-rating" onClick={() => onReviews(p.id)}><Icon name="star" size={13} fill="currentColor" />{(s.sum / s.count).toFixed(1)}<span>{s.count} review{s.count === 1 ? "" : "s"}</span></button>
                  : <span className="tiny muted">No reviews yet</span>}
                {canRate && <Link to={`${rateUrl}?item=${p.id}`} className="mp-rate"><Icon name="star" size={13} />Rate</Link>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
