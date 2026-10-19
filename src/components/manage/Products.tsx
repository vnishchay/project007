import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { isStockPhoto, uploadPlaceMedia } from "../../lib/media";
import { addPhotos } from "../../lib/assist";
import { guessLinkKind } from "../LinkIcon";
import type { PlaceLink } from "../place/ShopLinks";
import { MediaImg } from "./MediaImg";
import type { Item, Topic } from "../../lib/types";
import { formatPrice } from "../../lib/money";
import type { Mode } from "../../lib/modes";
import { Icon, useToast } from "../ui";
import { ProductSheet, friendlyItemError } from "./ProductSheet";
import { MenuImport } from "../MenuImport";
import { isVisitItem } from "../../lib/reviews";

interface Stat { item_id: string; avg_rating: number; review_count: number }

const byOrder = (a: Item, b: Item) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);

const ITEM_COLS = "id, place_id, topic_id, name, image_path, description, price_inr, sort_order, is_listed, is_hidden";

/** The shop's products: photo, price, type; reorder, hide, edit. */
export function Products({ placeId, isAdmin, mode, links = [], currency, onCount }: { placeId: string; isAdmin: boolean; mode: Mode; links?: PlaceLink[]; currency?: string | null; onCount?: (n: number) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [topics, setTopics] = useState<Topic[]>([]);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Item | null | "new">(null);
  const [n, setN] = useState(0);
  const [importing, setImporting] = useState<null | "photo" | "text">(null);
  const [picBusy, setPicBusy] = useState(false);
  const onlineMenu = links.some((l) => ["zomato", "swiggy"].includes(l.kind || guessLinkKind(l.url)));

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("items").select(`${ITEM_COLS}, section`).eq("place_id", placeId)
        .then((r) => (r.error?.code === "42703" ? supabase.from("items").select(ITEM_COLS).eq("place_id", placeId) : r)),
      supabase.from("item_stats").select("item_id, avg_rating, review_count").eq("place_id", placeId),
      supabase.from("topics").select("id, name").order("name"),
    ]).then(([i, s, t]) => {
      if (!alive) return;
      setErr(i.error ? errorText(i.error) : "");
      // The hidden item that holds whole-visit reviews is not a product.
      setItems(((i.data as Item[]) || []).filter((x) => !isVisitItem(x.name)).sort(byOrder));
      setStats(Object.fromEntries(((s.data as Stat[]) || []).map((x) => [x.item_id, x])));
      setTopics((t.data as Topic[]) || []);
    });
    return () => { alive = false; };
  }, [placeId, n]);

  const listed = useMemo(() => (items || []).filter((i) => i.is_listed).sort(byOrder), [items]);
  const fromCustomers = useMemo(() => (items || []).filter((i) => !i.is_listed), [items]);
  useEffect(() => { if (items) onCount?.(listed.filter((i) => !i.is_hidden).length); }, [items, listed, onCount]);

  const topicName = (id: number | null) => topics.find((t) => t.id === id)?.name;
  const nextSort = listed.reduce((m, i) => Math.max(m, i.sort_order), 0) + 1;
  const defaultTopic = useMemo(() => {
    const c: Record<number, number> = {};
    for (const i of items || []) if (i.topic_id != null) c[i.topic_id] = (c[i.topic_id] || 0) + 1;
    const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return best ? Number(best[0]) : null;
  }, [items]);

  const patch = (it: Item) => setItems((xs) => (xs || []).map((x) => (x.id === it.id ? it : x)));

  async function update(it: Item, change: Partial<Item>, ok?: string) {
    patch({ ...it, ...change });
    const { error } = await supabase.from("items").update(change).eq("id", it.id);
    if (error) { patch(it); toast(friendlyItemError(error)); return false; }
    if (ok) toast(ok);
    return true;
  }

  async function move(idx: number, dir: -1 | 1) {
    const order = [...listed];
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j]!, order[idx]!];
    const changed = order.map((it, k) => ({ it, sort_order: k + 1 })).filter((x) => x.it.sort_order !== x.sort_order);
    setItems((xs) => (xs || []).map((x) => { const c = changed.find((y) => y.it.id === x.id); return c ? { ...x, sort_order: c.sort_order } : x; }));
    const res = await Promise.all(changed.map((c) => supabase.from("items").update({ sort_order: c.sort_order }).eq("id", c.it.id)));
    const bad = res.find((r) => r.error);
    if (bad) { toast(errorText(bad.error)); setN((x) => x + 1); }
  }

  async function findPictures() {
    setPicBusy(true);
    try {
      let got = 0;
      for (let round = 0; round < 3; round++) {
        const r = await addPhotos(placeId);
        got += r.assigned;
        if (!r.assigned || !r.remaining) break;
      }
      toast(got ? `Added ${got} ${got === 1 ? "picture" : "pictures"}` : "No new pictures found");
      setN((x) => x + 1);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setPicBusy(false);
    }
  }

  if (items === null) return <div className="stack"><div className="skeleton" style={{ height: 84 }} /><div className="skeleton" style={{ height: 84 }} /></div>;

  const withPhoto = listed.filter((i) => i.image_path).length;
  const noPhoto = listed.filter((i) => !i.image_path && !i.is_hidden).length;
  const anyStock = (items || []).some((i) => isStockPhoto(i.image_path));
  const reviewTotal = Object.values(stats).reduce((s, x) => s + x.review_count, 0);
  const sheetItem = editing === "new" ? null : editing;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {err && <div className="notice err row"><span className="grow">{err}</span><button className="link-btn" onClick={() => setN((x) => x + 1)}><Icon name="refresh" size={15} />Retry</button></div>}

      {listed.length > 0 && (
        <div className="mg-stats">
          <div className="mg-stat"><span className="icon-chip sm"><Icon name="box" size={16} /></span><span><div className="n">{listed.length}</div><div className="l">{mode.itemPlural}</div></span></div>
          <div className="mg-stat"><span className="icon-chip sm amber"><Icon name="camera" size={16} /></span><span><div className="n">{withPhoto}</div><div className="l">photos</div></span></div>
          <div className="mg-stat"><span className="icon-chip sm violet"><Icon name="star" size={16} /></span><span><div className="n">{reviewTotal}</div><div className="l">reviews</div></span></div>
        </div>
      )}

      {noPhoto > 0 && (
        <div className="mg-pics-banner">
          <span className="icon-chip sm"><Icon name="spark" size={16} /></span>
          <span className="grow stack tight"><span className="strong small">{noPhoto} {noPhoto === 1 ? mode.item : mode.itemPlural} without a picture</span><span className="tiny muted">We'll add nice ones. Swap in your own any time.</span></span>
          <button className="btn small green" disabled={picBusy} onClick={findPictures}>{picBusy ? "Finding…" : "Add pictures"}</button>
        </div>
      )}

      {listed.length === 0 ? (
        <div className="mg-empty">
          <div className="mg-empty-art" aria-hidden="true">
            <span className="icon-chip lg amber a"><Icon name="camera" size={24} /></span>
            <span className="icon-chip lg b" style={{ width: 60, height: 60 }}><Icon name="box" size={28} /></span>
            <span className="icon-chip lg violet c"><Icon name="star" size={24} /></span>
          </div>
          <h2>Add your first {mode.item}</h2>
          <p className="small muted" style={{ maxWidth: 260 }}>Photo, name, price. Customers who scan your table QR pick it when they review.</p>
          <button className="mg-snap" onClick={() => setImporting("photo")}>
            <span className="icon-chip coral"><Icon name="camera" size={20} /></span>
            <span className="grow stack tight"><span>Snap your {mode.catalog.toLowerCase()}</span><span className="tiny muted" style={{ fontWeight: 600 }}>We read it into {mode.itemPlural} for you</span></span>
            <Icon name="chev" size={18} />
          </button>
          {onlineMenu && <button className="btn ghost small" onClick={() => setImporting("text")}><Icon name="external" size={17} />Bring it from Zomato / Swiggy</button>}
          <button className="btn ghost small" onClick={() => setEditing("new")}><Icon name="plus" size={17} />Add one by hand</button>
        </div>
      ) : (
        <>
          <div className="mg-add-row">
            <button className="mg-add" onClick={() => setEditing("new")}>
              <span className="icon-chip"><Icon name="plus" size={22} /></span>
              <span className="grow">Add {mode.item}</span>
            </button>
            <button className="mg-add-menu" onClick={() => setImporting(onlineMenu ? "text" : "photo")}>
              <span className="icon-chip coral sm"><Icon name="camera" size={17} /></span>{onlineMenu ? "Import menu" : mode.kind === "food" ? "From a menu photo" : "From a price list photo"}
            </button>
          </div>
          <div className="mg-list">
            {listed.map((it, idx) => (
              <ProductRow key={it.id} it={it} currency={currency} stat={stats[it.id]} topic={topicName(it.topic_id)} onEdit={() => setEditing(it)}>
                <button className={`mg-act ${it.is_hidden ? "" : "on"}`} aria-label={it.is_hidden ? `Show ${it.name}` : `Hide ${it.name}`} aria-pressed={!it.is_hidden}
                  onClick={() => update(it, { is_hidden: !it.is_hidden }, it.is_hidden ? "Visible to customers" : "Hidden from customers")}>
                  <Icon name={it.is_hidden ? "eyeOff" : "eye"} size={17} />
                </button>
                <button className="mg-act" aria-label={`Edit ${it.name}`} onClick={() => setEditing(it)}><Icon name="edit" size={16} /></button>
                <span className="mg-updown">
                  <button className="mg-act" aria-label={`Move ${it.name} up`} disabled={idx === 0} onClick={() => move(idx, -1)}><Icon name="up" size={14} /></button>
                  <button className="mg-act" aria-label={`Move ${it.name} down`} disabled={idx === listed.length - 1} onClick={() => move(idx, 1)}><Icon name="arrowDown" size={14} /></button>
                </span>
              </ProductRow>
            ))}
          </div>
        </>
      )}

      {fromCustomers.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="mg-group-title"><span className="icon-chip sm sky"><Icon name="people" size={16} /></span><span className="grow">Added by customers</span><span className="badge gray">{fromCustomers.length}</span></div>
          <div className="mg-hint"><Icon name="info" size={15} />Add a photo to put it on your {mode.catalog.toLowerCase()}</div>
          <div className="mg-list">
            {fromCustomers.map((it) => (
              <ProductRow key={it.id} it={it} currency={currency} stat={stats[it.id]} topic={topicName(it.topic_id)} onEdit={() => setEditing(it)}>
                <CustomerPhoto it={it} placeId={placeId} nextSort={nextSort} onDone={patch} />
                <button className={`mg-act ${it.is_hidden ? "" : "on"}`} aria-label={it.is_hidden ? `Show ${it.name}` : `Hide ${it.name}`} aria-pressed={!it.is_hidden}
                  onClick={() => update(it, { is_hidden: !it.is_hidden }, it.is_hidden ? "Visible to customers" : "Hidden from customers")}>
                  <Icon name={it.is_hidden ? "eyeOff" : "eye"} size={17} />
                </button>
              </ProductRow>
            ))}
          </div>
        </div>
      )}

      {importing !== null && (
        <MenuImport placeId={placeId} mode={mode} links={links} currency={currency} start={importing} nextSort={(items || []).reduce((m, i) => Math.max(m, i.sort_order), 0) + 1}
          onClose={() => setImporting(null)} onSaved={() => { setImporting(null); setN((x) => x + 1); }} />
      )}

      {anyStock && <p className="mg-credit">Stock pictures from <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a></p>}

      {editing !== null && (
        <ProductSheet
          placeId={placeId} item={sheetItem} topics={topics} mode={mode} currency={currency} reviews={sheetItem ? stats[sheetItem.id]?.review_count ?? 0 : 0}
          nextSort={nextSort} defaultTopic={defaultTopic} canRename={isAdmin}
          taken={(items || []).filter((x) => x.id !== sheetItem?.id).map((x) => x.name)}
          onClose={() => setEditing(null)}
          onSaved={(it, isNew) => { setItems((xs) => isNew ? [...(xs || []), it] : (xs || []).map((x) => (x.id === it.id ? it : x))); setEditing(null); }}
          onDeleted={(id) => { setItems((xs) => (xs || []).filter((x) => x.id !== id)); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ProductRow({ it, currency, stat, topic, onEdit, children }: { it: Item; currency?: string | null; stat?: Stat; topic?: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className={`mg-product ${it.is_hidden ? "off" : ""}`}>
      <span className="thumb mg-thumb-empty"><MediaImg path={it.image_path} fallback={<Icon name="image" size={22} />} /></span>
      <button className="info" onClick={onEdit} aria-label={`Edit ${it.name}`}>
        <span className="name">{it.name}</span>
        <span className="mg-meta">
          {it.price_inr != null && <span className="mg-price">{formatPrice(it.price_inr, currency)}</span>}
          {it.section && <span className="badge gray">{it.section}</span>}
          {topic && <span>{topic}</span>}
          {isStockPhoto(it.image_path) && <span className="badge gray"><Icon name="image" size={11} />Stock</span>}
          {it.is_hidden && <span className="badge gray"><Icon name="eyeOff" size={11} />Hidden</span>}
        </span>
        {stat && stat.review_count > 0 && (
          <span className="mg-meta"><span className="rating-pill" style={{ padding: "2px 7px", fontSize: 11 }}><Icon name="star" size={10} fill="#fff" />{Number(stat.avg_rating).toFixed(1)}</span>{stat.review_count}</span>
        )}
      </button>
      <span className="mg-acts">{children}</span>
    </div>
  );
}

function CustomerPhoto({ it, placeId, nextSort, onDone }: { it: Item; placeId: string; nextSort: number; onDone: (it: Item) => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const image_path = await uploadPlaceMedia(placeId, f, 1200);
      const { data, error } = await supabase.from("items").update({ image_path, is_listed: true, is_hidden: false, sort_order: nextSort }).eq("id", it.id).select("*").single();
      if (error) throw error;
      onDone(data as Item);
      toast("Added");
    } catch (e) {
      toast(`Photo not saved: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="mg-add-photo" disabled={busy} onClick={() => ref.current?.click()} aria-label={`Add photo of ${it.name}`}>
        <Icon name="camera" size={16} />{busy ? "…" : "Photo"}
      </button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
    </>
  );
}
