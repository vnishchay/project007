import { useEffect, useRef } from "react";
import { Icon, type IconName } from "./ui";
import { ItemThumb } from "./place/ItemThumb";
import type { ShopItem } from "./place/shop";
import { formatPrice } from "../lib/money";
import "../styles/place.css";

/** One-tap product tiles: shop photos first, then other items, then "something else". */
export function ProductPicker({ items, selected, other, onPick, onOther, icon = "food", labelledBy, currency }: {
  items: ShopItem[];
  selected: string | null;
  other: boolean;
  onPick: (item: ShopItem) => void;
  onOther: () => void;
  icon?: IconName;
  labelledBy?: string;
  /** the shop's currency, for prices */
  currency?: string | null;
}) {
  const row = useRef<HTMLDivElement>(null);
  // Bring a preselected product into view.
  useEffect(() => {
    if (!selected) return;
    const el = row.current?.querySelector<HTMLElement>(`[data-id="${selected}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [selected]);

  return (
    <div className="pp-row hscroll" ref={row} role="group" aria-labelledby={labelledBy}>
      {items.map((i) => {
        const on = !other && selected === i.id;
        return (
          <button key={i.id} data-id={i.id} type="button" className={`pp-tile ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onPick(i)}>
            <span className="pp-img">
              <ItemThumb path={i.image_path} icon={icon} />
              {on && <span className="pp-check"><Icon name="check" size={14} color="#fff" width={3} /></span>}
            </span>
            <span className="pp-name">{i.name}</span>
            {i.price_inr != null && <span className="pp-price">{formatPrice(i.price_inr, currency)}</span>}
          </button>
        );
      })}
      <button type="button" className={`pp-tile ${other ? "on" : ""}`} aria-pressed={other} onClick={onOther}>
        <span className="pp-img pp-other"><Icon name="plus" size={26} /></span>
        <span className="pp-name">Something else</span>
      </button>
    </div>
  );
}
