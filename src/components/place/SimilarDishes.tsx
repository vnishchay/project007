import { useEffect, useState } from "react";
import { similarDishes, type TopDish } from "../../lib/dishes";
import { DishCard } from "../home/DishCard";
import { SectionTitle } from "../home/Kit";

/** "Similar dishes nearby": the same kind of thing at other shops, best loved first. Hidden when there's nothing. */
export function SimilarDishes({ itemId, name }: { itemId: string; name: string }) {
  const [rows, setRows] = useState<TopDish[]>([]);
  useEffect(() => {
    let alive = true;
    setRows([]);
    similarDishes(itemId).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [itemId]);
  if (!rows.length) return null;
  return (
    <section className="stack" style={{ gap: 10 }} aria-label={`Like ${name}, elsewhere`}>
      <SectionTitle icon="compass" tone="violet">Like {name}, elsewhere</SectionTitle>
      <div className="hscroll">
        {rows.map((d) => <DishCard key={d.item_id} d={d} />)}
      </div>
    </section>
  );
}
