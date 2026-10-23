import { placeMediaUrl } from "../../lib/media";
import { initials } from "../../lib/util";
import { KINDS, dateText, dealHeadline, dealLine, dealWhen, untilText, type Deal, type Offer, type Stamps } from "../../lib/treats";
import { Icon } from "../ui";

/** A shop deal as a ticket: the big words, what it's on, and when (or how long it has left). */
export function DealTicket({ deal, currency, now, onOpen }: { deal: Deal; currency?: string | null; now: number; onOpen: () => void }) {
  const k = KINDS[deal.kind] ?? KINDS.other;
  const big = dealHeadline(deal, currency);
  const used = Boolean(deal.used_at);
  const foot = used ? <><Icon name="check" size={14} />{deal.per_person === "once" ? "Used" : "Used today"}</>
    : deal.on_now && deal.ends_ts ? <>Ends in <b>{untilText(deal.ends_ts, now)}</b></>
    : deal.on_now ? <><Icon name="check" size={14} />On today{deal.valid_until ? ` · till ${dateText(deal.valid_until)}` : ""}</>
    : <><Icon name="clock" size={14} />{dealWhen(deal)}</>;
  return (
    <button type="button" className={`tkt tone-${k.tone} ${used ? "used" : deal.on_now ? "" : "later"}`} onClick={onOpen}
      aria-label={`${big} ${dealLine(deal)}. ${deal.on_now ? "On now" : dealWhen(deal)}${used ? ". Used" : ""}`}>
      {deal.on_now && !used && <span className="tkt-glint" aria-hidden="true" />}
      <span className="tkt-top">
        <span className="tkt-k"><Icon name={k.icon} size={12} />{deal.kind === "happy_hour" ? dealWhen(deal) : deal.on_now ? "On now" : k.label}</span>
        <span className={`tkt-big ${big.length > 9 ? "long" : ""}`}>{big}</span>
        {dealLine(deal) && <span className="tkt-line">{dealLine(deal)}</span>}
      </span>
      <span className="tkt-foot">{foot}</span>
    </button>
  );
}

/** A personal offer: wrapped until opened, then a coupon. */
export function OfferTicket({ offer, onOpen }: { offer: Offer; onOpen: () => void }) {
  if (!offer.seen) {
    return (
      <button type="button" className="tkt gift tone-gift" onClick={onOpen} aria-label="A surprise from the shop, just for you. Tap to unwrap">
        <span className="tkt-glint" aria-hidden="true" />
        <span className="tkt-k">Just for you</span>
        <svg className="wob" aria-hidden="true" width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M19 12v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8" />
          <path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
        </svg>
        <span className="tkt-line">A surprise from the shop. Tap to open</span>
      </button>
    );
  }
  const used = Boolean(offer.used_at);
  return (
    <button type="button" className={`tkt tone-gift ${used ? "used" : ""}`} onClick={onOpen} aria-label={`Your offer: ${offer.body}${used ? ". Used" : ""}`}>
      <span className="tkt-top">
        <span className="tkt-k"><Icon name="gift" size={12} />Just for you</span>
        <span className="tkt-line" style={{ fontSize: 18, fontWeight: 800, WebkitLineClamp: 3 }}>{offer.body}</span>
      </span>
      <span className="tkt-foot">{used ? <><Icon name="check" size={14} />Used</> : <><Icon name="ticket" size={14} />Till {dateText(offer.valid_till)}</>}</span>
    </button>
  );
}

/** The stamp card in one line: dots, then "2 more visits and …" or "Your reward is ready". */
export function StampRow({ s, onOpen }: { s: Stamps; onOpen: () => void }) {
  const ready = s.stamps >= s.goal;
  const left = Math.max(0, s.goal - s.stamps);
  const dots = Array.from({ length: s.goal }, (_, i) => i);
  return (
    <button type="button" className={`tr-stamprow ${ready ? "ready" : ""}`} onClick={onOpen}
      aria-label={ready ? `Stamp card full. ${s.reward} is ready. Open` : `Stamp card: ${s.stamps} of ${s.goal}. ${left} more visits for ${s.reward}`}>
      <span className="tr-dots" aria-hidden="true">
        {dots.map((i) => i === s.goal - 1 && !ready
          ? <span key={i} className="tr-dot goal"><Icon name="gift" size={11} /></span>
          : <span key={i} className={`tr-dot ${i < s.stamps ? "on" : ""}`} />)}
      </span>
      <span className="tr-stamptext">
        <b>{ready ? "Your reward is ready" : `${left} more ${left === 1 ? "visit" : "visits"}`}</b>
        <span>{ready ? `${s.reward}. Show it at the counter` : `and you get ${s.reward}`}</span>
      </span>
      <Icon name="chev" size={18} />
    </button>
  );
}

/** The full stamp card: a stamp for each visit day, the reward in the last spot. */
export function StampCard({ s, logo }: { s: Stamps; logo?: string | null }) {
  const shown = Math.min(s.stamps, s.goal);
  const url = placeMediaUrl(logo ?? s.logo_path, 120);
  // Newest visit days first from the server; the card fills oldest first.
  const days = [...s.days].slice(0, shown).reverse();
  const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <div className="stc">
      <div className="stc-head">
        <span className="lg">{url ? <img src={url} alt="" /> : initials(s.place_name || "Shop")}</span>
        <b className="grow">{s.place_name || "Stamp card"}</b>
        <span className="small" style={{ opacity: 0.75 }}>{shown} of {s.goal}</span>
      </div>
      <div className="stc-grid" role="img" aria-label={`${shown} of ${s.goal} stamps`}>
        {Array.from({ length: s.goal }, (_, i) => {
          if (i < shown) return <span key={i} className={`stc-s on ${s.today && i === shown - 1 ? "new" : ""}`}><Icon name="check" size={20} width={3} />{days[i] ? short(days[i]!) : ""}</span>;
          if (i === s.goal - 1) return <span key={i} className="stc-s goal"><Icon name="gift" size={20} /><span>{s.reward.length > 14 ? "Reward" : s.reward}</span></span>;
          return <span key={i} className="stc-s off">{i + 1}</span>;
        })}
      </div>
      <div className="stc-bar" aria-hidden="true"><i style={{ width: `${(shown / s.goal) * 100}%` }} /></div>
      <span>{s.stamps >= s.goal ? <><b>Full!</b> {s.reward} is yours. Show it at the counter.</> : <><b>{s.goal - s.stamps} more {s.goal - s.stamps === 1 ? "visit" : "visits"}</b> and you get {s.reward}.</>}</span>
    </div>
  );
}

/** A small round logo, or the shop's initials. */
export function ShopLogo({ path, name }: { path?: string | null; name: string }) {
  const url = placeMediaUrl(path, 120);
  return <span className="pk-logo">{url ? <img src={url} alt="" /> : initials(name)}</span>;
}
