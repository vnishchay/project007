import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase, errorText } from "../lib/supabase";
import { timeAgo } from "../lib/util";
import { Icon, useConfirm, useToast } from "./ui";

export interface MyOffer { id: string; body: string; link_url: string | null; created_at: string; seen: boolean; used_at: string | null }
interface Update { id: string; body: string; link_url: string | null; created_at: string }

const MONTH = 30 * 86_400_000;
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

/**
 * On the scan page: this shop's offers for you (show one at the counter, then mark it used) and its
 * latest news. Quietly absent when there's nothing. Offers never depend on reviewing.
 */
export function ForYouHere({ placeId, placeName, signedIn, newsOnly = false }: { placeId: string; placeName: string; signedIn: boolean; newsOnly?: boolean }) {
  const [offers, setOffers] = useState<MyOffer[]>([]);
  const [news, setNews] = useState<Update[]>([]);
  const [open, setOpen] = useState<MyOffer | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.from("place_updates").select("id, body, link_url, created_at").eq("place_id", placeId)
      .order("created_at", { ascending: false }).limit(2)
      .then(({ data, error }) => alive && !error && setNews(((data as Update[]) || []).filter((u) => Date.now() - new Date(u.created_at).getTime() < MONTH)), () => {});
    // newsOnly: offers show as tickets above (TreatsRail), wrapped until opened.
    if (signedIn && !newsOnly) {
      supabase.rpc("my_offers_here", { p_place: placeId }).then(({ data, error }) => {
        if (!alive || error) return;
        const list = (data as MyOffer[]) || [];
        setOffers(list);
        const fresh = list.filter((o) => !o.seen).map((o) => o.id);
        if (fresh.length) supabase.rpc("mark_offers_seen", { p_ids: fresh }).then(() => {}, () => {});
      }, () => {});
    }
    return () => { alive = false; };
  }, [placeId, signedIn, newsOnly]);

  if (!offers.length && !news.length) return null;
  return (
    <section className="rvx-sec" aria-label="For you here">
      <div className="rvx-row"><h3>{offers.some((o) => !o.used_at) ? "For you here" : "From the shop"}</h3></div>
      <div className="rvx-scroll">
        {offers.map((o) => (
          <button key={o.id} type="button" className={`rvx-coupon ${o.used_at ? "used" : ""}`} onClick={() => setOpen(o)} aria-label={`Offer: ${o.body}. ${o.used_at ? "Used" : "Show at the counter"}`}>
            <span className="k"><Icon name="gift" size={14} />{o.used_at ? "Used" : "Your offer"}</span>
            <span className="b">{o.body}</span>
            <span className="f">{o.used_at ? `Used ${timeAgo(o.used_at)}` : <><Icon name="ticket" size={14} />Show at counter</>}</span>
          </button>
        ))}
        {news.map((u) => (
          <div key={u.id} className="rvx-coupon news">
            <span className="k"><Icon name="message" size={14} />News · {timeAgo(u.created_at)}</span>
            <span className="b">{u.body}</span>
            {u.link_url && <a className="f" href={u.link_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} />Open link</a>}
          </div>
        ))}
      </div>
      {open && <CouponSheet offer={open} placeName={placeName} onClose={() => setOpen(null)}
        onUsed={(at) => { setOffers((xs) => xs.map((x) => (x.id === open.id ? { ...x, used_at: at } : x))); setOpen((o) => (o ? { ...o, used_at: at } : o)); }} />}
    </section>
  );
}

/** The offer, big enough to show staff, with a live clock so a screenshot can't pass for it. */
export function CouponSheet({ offer, placeName, onClose, onUsed }: { offer: MyOffer; placeName: string; onClose: () => void; onUsed: (at: string) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function use() {
    const ok = await confirm({ title: "Mark this offer as used?", body: "Do this at the counter, with the staff. It can't be used again.", ok: "Mark as used" });
    if (!ok) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("use_offer", { p_id: offer.id });
    setBusy(false);
    if (error) { toast(errorText(error)); return; }
    onUsed(String(data || new Date().toISOString()));
  }

  const used = offer.used_at ? new Date(offer.used_at) : null;
  // In a portal: the scan page's sections animate in, and a transformed parent would trap a fixed sheet.
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet coupon-sheet" role="dialog" aria-modal="true" aria-labelledby="cp-t" onClick={(e) => e.stopPropagation()}>
        <div className="cp-card">
          <span className="cp-shop">{placeName}</span>
          <h2 id="cp-t">{offer.body}</h2>
          <span className="cp-meta">Sent to you {timeAgo(offer.created_at)}</span>
          {used
            ? <span className="cp-state used"><Icon name="check" size={16} />Used {used.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
            : <span className="cp-state live" aria-live="off"><i aria-hidden="true" />{clock(now)}</span>}
        </div>
        {!used && <p className="small muted" style={{ margin: 0 }}>Show this screen to the staff. The moving clock shows it's live.</p>}
        {offer.link_url && <a className="btn block ghost" href={offer.link_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={18} />Offer details</a>}
        {!used && <button type="button" className="btn block green" disabled={busy} onClick={() => void use()}><Icon name="check" size={18} />{busy ? "Saving…" : "Mark as used"}</button>}
        <button type="button" className="btn block ghost" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}
