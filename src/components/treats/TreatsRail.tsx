import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { dateText, dealHeadline, dealLine, dealWhen, KINDS, loadTreats, useNow, type Deal, type Offer, type Stamps, type Treats } from "../../lib/treats";
import { WalletButton } from "../WalletButton";
import { Icon } from "../ui";
import { CounterSheet } from "./CounterSheet";
import { UnwrapSheet } from "./UnwrapSheet";
import { DealTicket, OfferTicket, StampCard, StampRow } from "./Tickets";
import "../../styles/treats.css";

type Open = { kind: "offer"; o: Offer; counter?: boolean } | { kind: "deal"; d: Deal } | { kind: "stamps"; counter?: boolean } | null;

/**
 * "3 treats here": the shop's deals for everyone, your own offers (wrapped until you open them) and
 * the stamp card, right under the shop's name. Quietly absent when the shop has none.
 * `onCollect` (scan page only) records today's visit so the stamp counts without reviewing.
 */
export function TreatsRail({ placeId, placeName, currency, onCollect, bleed = false }: {
  placeId: string; placeName: string; currency?: string | null; onCollect?: () => Promise<boolean>;
  /** On a page with 20px side padding: run the rail edge to edge. */
  bleed?: boolean;
}) {
  const { session } = useAuth();
  const [t, setT] = useState<Treats | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [collecting, setCollecting] = useState(false);
  const now = useNow(1000);
  const reload = useCallback(() => loadTreats(placeId).then(setT), [placeId]);
  const uid = session?.user.id;
  useEffect(() => { let alive = true; loadTreats(placeId).then((x) => alive && setT(x)); return () => { alive = false; }; }, [placeId, uid]);

  if (!t) return null;
  const offers = t.offers.filter((o) => !o.used_at);
  const deals = t.deals;
  const s = t.stamps;
  const count = offers.length + deals.filter((d) => !d.used_at).length;
  if (!offers.length && !deals.length && !s) return null;

  async function collect() {
    if (!onCollect) return;
    setCollecting(true);
    if (await onCollect()) await reload();
    setCollecting(false);
  }
  const close = () => setOpen(null);
  const patchOffer = (id: string, p: Partial<Offer>) => setT((x) => x && { ...x, offers: x.offers.map((o) => (o.id === id ? { ...o, ...p } : o)) });

  return (
    <section className={`tr-sec ${bleed ? "bleed" : ""}`} aria-label="Offers here">
      {(offers.length > 0 || deals.length > 0) && (
        <>
          <div className="tr-head">
            <span className="tr-badge" aria-hidden="true"><Icon name="ticket" size={18} /></span>
            <h2>{count > 0 ? `${count} ${count === 1 ? "treat" : "treats"} here` : "Deals here"}</h2>
            {session && <Link to="/pocket">Your pocket</Link>}
          </div>
          <div className="tr-rail">
            {offers.map((o) => <OfferTicket key={o.id} offer={o} onOpen={() => setOpen({ kind: "offer", o })} />)}
            {deals.map((d) => <DealTicket key={d.id} deal={d} currency={currency} now={now} onOpen={() => setOpen({ kind: "deal", d })} />)}
          </div>
        </>
      )}
      {s && <StampRow s={s} onOpen={() => setOpen({ kind: "stamps" })} />}
      {s && onCollect && !s.today && (
        <button type="button" className="btn block ghost tr-collect" disabled={collecting} onClick={() => void collect()}>
          <Icon name="checkCircle" size={18} />{collecting ? "Adding…" : "Collect today's stamp"}
        </button>
      )}

      {open?.kind === "offer" && !open.counter && (
        <UnwrapSheet offer={open.o} shop={placeName} onClose={close}
          onOpened={() => patchOffer(open.o.id, { seen: true })}
          onUse={() => setOpen({ kind: "offer", o: { ...open.o, seen: true }, counter: true })} />
      )}
      {open?.kind === "offer" && open.counter && (
        <CounterSheet shop={placeName} big={open.o.body} tone="gift" usable={session ? { kind: "offer", id: open.o.id } : null}
          usedAt={open.o.used_at} pass={{ kind: "offer", id: open.o.id }} onClose={close}
          onUsed={(at) => patchOffer(open.o.id, { used_at: at })} />
      )}
      {open?.kind === "deal" && (
        <CounterSheet shop={placeName} big={dealHeadline(open.d, currency)} line={dealLine(open.d)} tone={(KINDS[open.d.kind] ?? KINDS.other).tone}
          note={[open.d.on_now ? null : `On ${dealWhen(open.d)}`, open.d.terms, open.d.valid_until ? `Till ${dateText(open.d.valid_until)}` : null].filter(Boolean).join(" · ")}
          usable={session && open.d.on_now ? { kind: "deal", id: open.d.id } : null} usedAt={open.d.used_at}
          pass={{ kind: "deal", id: open.d.id }} onClose={close}
          onUsed={(at) => setT((x) => x && { ...x, deals: x.deals.map((d) => (d.id === open.d.id ? { ...d, used_at: at } : d)) })} />
      )}
      {open?.kind === "stamps" && s && !open.counter && <StampSheet s={{ ...s, place_name: placeName }} onClose={close} onUse={() => setOpen({ kind: "stamps", counter: true })} />}
      {open?.kind === "stamps" && s && open.counter && (
        <CounterSheet shop={placeName} big={s.reward} line="Stamp card reward" tone="gold" usable={session ? { kind: "stamps", placeId } : null}
          onClose={() => { close(); void reload(); }} />
      )}
    </section>
  );
}

/** The stamp card, with how it works, the reward when it's ready, and Wallet. */
export function StampSheet({ s, onClose, onUse }: { s: Stamps; onClose: () => void; onUse: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const ready = s.stamps >= s.goal;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet stack" style={{ gap: 14 }} role="dialog" aria-modal="true" aria-label="Stamp card" onClick={(e) => e.stopPropagation()}>
        <StampCard s={s} />
        {ready && <button type="button" className="btn block" onClick={onUse}><Icon name="gift" size={18} />Use my reward</button>}
        <div className="stack small" style={{ gap: 8 }}>
          <span className="row" style={{ gap: 10, alignItems: "flex-start" }}><Icon name="qr" size={18} color="var(--accent)" /><span><b>Stamps add themselves.</b> Scan a table code on a visit and you get one. No paper card to lose.</span></span>
          <span className="row" style={{ gap: 10, alignItems: "flex-start" }}><Icon name="clock" size={18} color="var(--accent)" /><span><b>One a day</b>, only for visits at the shop.</span></span>
          <span className="row" style={{ gap: 10, alignItems: "flex-start" }}><Icon name="shield" size={18} color="var(--accent)" /><span><b>For visiting, never for reviewing.</b> Stamps don't care whether or what you rate.</span></span>
        </div>
        <WalletButton pass={{ kind: "stamps", placeId: s.place_id }} label="Add stamp card to Wallet" />
        <button type="button" className="btn block ghost" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}
