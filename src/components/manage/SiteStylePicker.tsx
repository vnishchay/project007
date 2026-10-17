import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import type { Place } from "../../lib/types";
import { SITE_STYLES, siteStyleFor, type SiteStyle } from "../../lib/siteStyles";
import { placeMediaUrl } from "../../lib/media";
import { Icon, useToast } from "../ui";

/** Owners pick how their website looks, and write the one line shown at the top. */
export function SiteStylePicker({ place, onSaved }: { place: Place; onSaved: (p: Partial<Place>) => void }) {
  const toast = useToast();
  const current = siteStyleFor(place);
  const [style, setStyle] = useState<SiteStyle>(current);
  const [tagline, setTagline] = useState(place.tagline || "");
  const [busy, setBusy] = useState(false);
  const cover = placeMediaUrl(place.cover_path);
  const dirty = style !== current || (tagline.trim() || null) !== (place.tagline || null);

  async function save() {
    setBusy(true);
    const change = { site_style: style, tagline: tagline.trim() || null };
    const { error } = await supabase.from("places").update(change).eq("id", place.id);
    setBusy(false);
    if (error) { toast(/site_style|tagline/.test(error.message) ? "Run the latest database update first (update_existing_database.sql)." : errorText(error)); return; }
    onSaved(change);
    toast("Your website is updated");
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="mg-section">
        <div className="mg-section-head"><span className="icon-chip sm"><Icon name="globe" size={16} /></span>Your website</div>
        <p className="small muted" style={{ margin: 0 }}>Customers who scan your QR or open your link see this page as your own website. Pick the look that fits your place.</p>
        <div className="ss-grid" role="radiogroup" aria-label="Website style">
          {SITE_STYLES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={style === s.id} className={`ss-card ${style === s.id ? "on" : ""}`} onClick={() => setStyle(s.id)}>
              <span className={`ss-preview ss-${s.id}`} style={{ background: s.swatch[0], color: s.swatch[1] }}>
                {cover && (s.id === "glass" || s.id === "editorial") && <img src={cover} alt="" />}
                <span className="ss-title">{place.name}</span>
                <span className="ss-dot" style={{ background: s.swatch[2] }} />
                <span className="ss-bar" style={{ background: s.swatch[1] }} />
                <span className="ss-bar short" style={{ background: s.swatch[1] }} />
              </span>
              <span className="ss-name">{s.name}{style === s.id && <Icon name="checkCircle" size={16} color="var(--green)" />}</span>
              <span className="ss-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
        <Link to={`/p/${place.id}?style=${style}`} target="_blank" className="btn ghost small" style={{ alignSelf: "flex-start" }}><Icon name="eye" size={16} />Preview {SITE_STYLES.find((s) => s.id === style)?.name}</Link>
      </div>

      <div className="mg-section">
        <div className="mg-section-head"><span className="icon-chip sm amber"><Icon name="message" size={16} /></span>Your line</div>
        <input className="input" value={tagline} maxLength={120} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Wood-fired Neapolitan pizza since 2012" aria-label="Your line" />
        <span className="tiny muted">Shown at the top of your website and beside what customers say.</span>
      </div>

      <button type="button" className="btn green block" disabled={busy || !dirty} onClick={save}><Icon name="check" size={18} />{busy ? "Saving…" : "Save website"}</button>
    </div>
  );
}
