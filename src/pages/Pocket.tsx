import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { KINDS, dateText, dealHeadline, dealLine, dealWhen, loadPocket, untilText, useNow, type Deal, type Offer, type Pocket, type Stamps } from "../lib/treats";
import { timeAgo } from "../lib/util";
import { Icon, Spinner, TopBar, useTabKeys } from "../components/ui";
import { Retry } from "../components/home/Kit";
import { CounterSheet } from "../components/treats/CounterSheet";
import { UnwrapSheet } from "../components/treats/UnwrapSheet";
import { StampSheet } from "../components/treats/TreatsRail";
import { ShopLogo } from "../components/treats/Tickets";
import "../styles/treats.css";

const TABS = ["use", "used"] as const;
type Tab = (typeof TABS)[number];
type Open = { kind: "offer"; o: Offer; counter?: boolean } | { kind: "deal"; d: Deal } | { kind: "stamps"; s: Stamps; counter?: boolean } | null;

const TONE_BG: Record<string, string> = {
  ink: "#1d1d1f", violet: "#5856d6", gold: "#a15c00", sky: "#0062cc", green: "#1f7a36", coral: "#c70d40",
  gift: "linear-gradient(135deg, #ff6a45, #d4290f 60%, #a81f08)",
};

/**
 * Your pocket: offers shops sent you (wrapped until opened), deals at places you visited or saved,
 * and your stamp cards, stacked like a wallet. Wallet passes open here (?open=offer:<id>).
 */
export default function PocketPage() {
  const [p, setP] = useState<Pocket | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("use");
  const [open, setOpen] = useState<Open>(null);
  const [params, setParams] = useSearchParams();
  const now = useNow(1000);
  const tabKeys = useTabKeys(TABS, tab, setTab);
  const load = useCallback(() => loadPocket().then(setP), []);
  useEffect(() => { void load(); }, [load]);

  // A Wallet pass or a link opens one treat straight away.
  const want = params.get("open");
  useEffect(() => {
    if (!p || !want) return;
    const [kind, id] = want.split(":");
    const o = kind === "offer" ? p.offers.find((x) => x.id === id) : undefined;
    const d = kind === "deal" ? p.deals.find((x) => x.id === id) : undefined;
    const s = kind === "stamps" ? p.stamps.find((x) => x.place_id === id) : undefined;
    if (o) setOpen({ kind: "offer", o });
    else if (d) setOpen({ kind: "deal", d });
    else if (s) setOpen({ kind: "stamps", s });
    setParams({}, { replace: true });
  }, [p, want, setParams]);

  if (p === undefined) return <div className="page"><TopBar title="Your pocket" tone="hero" /><Spinner /></div>;
  if (p === null) return <div className="page"><TopBar title="Your pocket" tone="hero" /><Retry msg="Couldn't open your pocket." onRetry={() => { setP(undefined); void load(); }} /></div>;

  const deals = [...p.deals].filter((d) => !(d.used_at && d.per_person === "once"));
  const ready = p.stamps.filter((s) => s.stamps >= s.goal);
  const filling = p.stamps.filter((s) => s.stamps < s.goal);
  const endingSoon = deals.filter((d) => d.on_now && d.ends_ts && new Date(d.ends_ts).getTime() - now < 3 * 3600_000).length;
  const total = p.offers.length + deals.filter((d) => !d.used_at).length + ready.length;
  const close = () => setOpen(null);
  const empty = !p.offers.length && !deals.length && !p.stamps.length;

  return (
    <div className="page pk-page" style={{ gap: 18 }}>
      <TopBar title="Your pocket" sub={total ? `${total} to use${endingSoon ? ` · ${endingSoon} ending soon` : ""}` : undefined} tone="hero" />

      <div className="tabs" role="tablist" aria-label="Pocket" onKeyDown={tabKeys}>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" tabIndex={tab === t ? 0 : -1} aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "use" ? "To use" : `Used${p.used.length ? ` · ${p.used.length}` : ""}`}
          </button>
        ))}
      </div>

      {tab === "use" && (empty ? (
        <div className="pk-empty">
          <Icon name="ticket" size={40} color="var(--accent)" />
          <b style={{ color: "var(--ink)" }}>Nothing in your pocket yet</b>
          <span className="small">Deals from shops you visit or save, offers they send you and your stamp cards all land here.</span>
          <Link to="/" className="btn">Find places</Link>
        </div>
      ) : (
        <>
          <div className="pk-stack">
            {p.offers.map((o) => (
              <button key={o.id} type="button" className="pk-card" style={{ background: TONE_BG.gift }} onClick={() => setOpen({ kind: "offer", o })}
                aria-label={o.seen ? `${o.place_name}: ${o.body}` : `A surprise from ${o.place_name}. Tap to unwrap`}>
                <span className="row1"><ShopLogo path={o.logo_path} name={o.place_name || ""} /><b>{o.place_name}</b><span className="pill">{o.seen ? "Just for you" : "New"}</span></span>
                {o.seen
                  ? <><span className="big" style={{ fontSize: 24 }}>{o.body}</span><span className="sub">Till {dateText(o.valid_till)}</span></>
                  : <span className="row" style={{ gap: 10 }}><Icon name="gift" size={34} /><span className="big" style={{ fontSize: 22 }}>Tap to unwrap</span></span>}
              </button>
            ))}
            {ready.map((s) => (
              <button key={s.place_id} type="button" className="pk-card" style={{ background: "linear-gradient(120deg, #a15c00, #d4290f)" }} onClick={() => setOpen({ kind: "stamps", s })}>
                <span className="row1"><ShopLogo path={s.logo_path} name={s.place_name || ""} /><b>{s.place_name}</b><span className="pill">Card full</span></span>
                <span className="big" style={{ fontSize: 24 }}>{s.reward}</span><span className="sub">Your stamp card reward is ready</span>
              </button>
            ))}
            {deals.map((d) => {
              const k = KINDS[d.kind] ?? KINDS.other;
              const pill = d.used_at ? "Used today" : d.on_now && d.ends_ts ? `Ends in ${untilText(d.ends_ts, now)}` : d.on_now ? "On now" : dealWhen(d);
              return (
                <button key={d.id} type="button" className="pk-card" style={{ background: TONE_BG[k.tone], opacity: d.used_at ? 0.7 : 1 }} onClick={() => setOpen({ kind: "deal", d })}>
                  <span className="row1"><ShopLogo path={d.logo_path} name={d.place_name || ""} /><b>{d.place_name}</b><span className="pill">{pill}</span></span>
                  <span className="big">{dealHeadline(d)}</span>
                  <span className="sub">{[dealLine(d), d.valid_until ? `till ${dateText(d.valid_until)}` : null].filter(Boolean).join(" · ")}</span>
                </button>
              );
            })}
            {filling.map((s) => (
              <button key={s.place_id} type="button" className="pk-card" style={{ background: "#1d1d1f" }} onClick={() => setOpen({ kind: "stamps", s })}>
                <span className="row1"><ShopLogo path={s.logo_path} name={s.place_name || ""} /><b>{s.place_name}</b><span className="pill">{s.stamps} of {s.goal}</span></span>
                <span className="tr-dots" aria-hidden="true" style={{ maxWidth: "none" }}>
                  {Array.from({ length: s.goal }, (_, i) => <span key={i} className={`tr-dot ${i < s.stamps ? "on" : ""}`} style={i < s.stamps ? undefined : { borderColor: "rgba(255,255,255,.35)" }} />)}
                </span>
                <span className="sub">{s.goal - s.stamps} more {s.goal - s.stamps === 1 ? "visit" : "visits"} for {s.reward}</span>
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ textAlign: "center", margin: 0 }}>Tap a card to show it at the counter or add it to Apple or Google Wallet.</p>
        </>
      ))}

      {tab === "used" && (p.used.length ? (
        <div className="stack" style={{ gap: 0 }}>
          {p.used.map((u, i) => (
            <Link key={i} to={`/p/${u.place_id}`} className="pk-used" style={{ color: "inherit" }}>
              <span className="pk-logo" style={{ background: "var(--fill)", color: "var(--muted)" }}><Icon name={u.kind === "stamps" ? "award" : u.kind === "offer" ? "gift" : "ticket"} size={15} /></span>
              <span className="grow stack tight" style={{ minWidth: 0 }}>
                <span className="strong small ellipsis">{u.kind === "deal" && u.deal_kind ? `${dealHeadline({ kind: u.deal_kind, amount: u.amount ?? null, title: u.title })} ${u.deal_kind === "other" ? "" : u.title}` : u.title}</span>
                <span className="tiny muted ellipsis">{u.place_name} · {timeAgo(u.used_at)}</span>
              </span>
              <Icon name="check" size={16} color="var(--good)" />
            </Link>
          ))}
        </div>
      ) : <div className="pk-empty"><span className="small">Offers and deals you use show here.</span></div>)}

      {open?.kind === "offer" && !open.counter && (
        <UnwrapSheet offer={open.o} shop={open.o.place_name || ""} onClose={close}
          onOpened={() => setP((x) => x && { ...x, offers: x.offers.map((o) => (o.id === open.o.id ? { ...o, seen: true } : o)) })}
          onUse={() => setOpen({ kind: "offer", o: { ...open.o, seen: true }, counter: true })} />
      )}
      {open?.kind === "offer" && open.counter && (
        <CounterSheet shop={open.o.place_name || ""} big={open.o.body} usable={{ kind: "offer", id: open.o.id }} pass={{ kind: "offer", id: open.o.id }}
          onClose={() => { close(); void load(); }} />
      )}
      {open?.kind === "deal" && (
        <CounterSheet shop={open.d.place_name || ""} big={dealHeadline(open.d)} line={dealLine(open.d)} tone={(KINDS[open.d.kind] ?? KINDS.other).tone}
          note={[open.d.on_now ? null : `On ${dealWhen(open.d)}`, open.d.terms].filter(Boolean).join(" · ")}
          usable={open.d.on_now ? { kind: "deal", id: open.d.id } : null} usedAt={open.d.used_at} pass={{ kind: "deal", id: open.d.id }}
          onClose={() => { close(); void load(); }} />
      )}
      {open?.kind === "stamps" && !open.counter && <StampSheet s={open.s} onClose={close} onUse={() => setOpen({ kind: "stamps", s: open.s, counter: true })} />}
      {open?.kind === "stamps" && open.counter && (
        <CounterSheet shop={open.s.place_name || ""} big={open.s.reward} line="Stamp card reward" tone="gold" usable={{ kind: "stamps", placeId: open.s.place_id }}
          onClose={() => { close(); void load(); }} />
      )}
    </div>
  );
}
