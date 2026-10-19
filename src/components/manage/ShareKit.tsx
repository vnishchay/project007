import { copyText, placeUrl } from "../../lib/util";
import { Icon, useToast } from "../ui";

/**
 * The shop's own page is its best advert: what customers loved, updated as they rate.
 * Ready-made lines for the places people already look before they visit.
 */
export function ShareKit({ placeId, placeName, live }: { placeId: string; placeName: string; live: boolean }) {
  const toast = useToast();
  const url = placeUrl(placeId);
  const spots: { icon: "camera" | "globe" | "send"; where: string; how: string; text: string }[] = [
    { icon: "camera", where: "Instagram bio", how: "Paste it as your bio link.", text: url },
    { icon: "globe", where: "Google Business Profile", how: "Add it as your Website link.", text: url },
    { icon: "send", where: "WhatsApp status or groups", how: "Share it with regulars.", text: `Wondering what to get at ${placeName}? See what our customers loved most: ${url}` },
  ];
  const copy = async (t: string) => toast((await copyText(t)) ? "Copied, ready to paste" : "Couldn't copy");
  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="row">
        <span className="icon-chip coral"><Icon name="heart" size={18} /></span>
        <span className="grow stack tight">
          <span className="strong">Show people what's loved here</span>
          <span className="tiny muted">Your page lists what customers loved most and updates as they rate.</span>
        </span>
      </div>
      <div className="rl-link"><Icon name="link" size={14} /><span className="ellipsis grow">{url}</span></div>
      <div className="row">
        <a className="btn green grow" href={`https://wa.me/?text=${encodeURIComponent(spots[2]!.text)}`} target="_blank" rel="noopener noreferrer"><Icon name="send" size={18} />WhatsApp</a>
        <button type="button" className="btn ghost" aria-label="Copy link" onClick={() => copy(url)}><Icon name="copy" size={18} /></button>
      </div>
      <div className="menu">
        {spots.map((s) => (
          <button key={s.where} type="button" className="menu-row" onClick={() => copy(s.text)} aria-label={`Copy for ${s.where}`}>
            <span className="icon-chip sm"><Icon name={s.icon} size={16} /></span>
            <span className="grow stack tight" style={{ minWidth: 0 }}>
              <span className="t">{s.where}</span>
              <span className="s">{s.how}</span>
            </span>
            <Icon name="copy" size={16} color="var(--muted)" />
          </button>
        ))}
      </div>
      {!live && <span className="tiny muted">Your page shows to customers once your shop is live.</span>}
    </section>
  );
}
