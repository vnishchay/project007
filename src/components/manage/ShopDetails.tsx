import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import type { Place } from "../../lib/types";
import { Icon, useToast } from "../ui";
import { CoordsField } from "../CoordsField";
import { parseCoords } from "../../lib/util";
import { KINDS, MODES, modeOf, type Kind } from "../../lib/modes";
import { HoursEditor, readHours, writeHours, type DayHours } from "./HoursEditor";
import { assist } from "../../lib/assist";
import { googleConfigured } from "../../lib/google";
import type { PinInfo } from "../../lib/pin";
import { timeAgo } from "../../lib/util";

/** About, hours, category, area and price level: what owners may change themselves. */
export interface PinState { pin: PinInfo | null | undefined; syncing: boolean; error: string; refresh: () => Promise<boolean>; reload: () => Promise<void> }

export function ShopDetails({ place, isAdmin, onSaved, pinState }: { place: Place; isAdmin: boolean; onSaved: (p: Partial<Place>) => void; pinState: PinState }) {
  const toast = useToast();
  const [about, setAbout] = useState(place.about || "");
  const [writing, setWriting] = useState(false);
  const [aiErr, setAiErr] = useState("");
  async function writeAbout() {
    setWriting(true); setAiErr("");
    try { setAbout((await assist("about", place.id, about)).text); } catch (e) { setAiErr(e instanceof Error ? e.message : String(e)); }
    setWriting(false);
  }
  const [category, setCategory] = useState(place.category);
  const [kind, setKind] = useState<Kind>(() => modeOf(place.kind, place.category).kind);
  const [area, setArea] = useState(place.area || "");
  const [price, setPrice] = useState<number | null>(place.price_level);
  const [days, setDays] = useState<DayHours[]>(() => readHours(place.hours));
  const [hoursSet, setHoursSet] = useState(Boolean(place.hours));
  const [coords, setCoords] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!category.trim()) { toast("Add a category"); return; }
    const googlePin = Boolean(place.google_place_id) && googleConfigured;
    const c = !googlePin && coords.trim() ? parseCoords(coords) : null;
    if (!googlePin && coords.trim() && !c) { toast("Check the map location"); return; }
    setBusy(true);
    const change: Partial<Place> = {
      about: about.trim() || null, category: category.trim(), ...(kind !== place.kind ? { kind } : {}), area: area.trim() || null, price_level: price,
      ...(hoursSet ? { hours: writeHours(days) } : place.hours ? { hours: null } : {}),
    };
    const { error } = await supabase.from("places").update(change).eq("id", place.id);
    setBusy(false);
    if (error) { toast(errorText(error)); return; }
    if (c) {
      const r = await supabase.rpc("set_place_location", { p_place: place.id, p_lat: c.lat, p_lng: c.lng });
      if (r.error) { toast(errorText(r.error)); return; }
      setCoords("");
      pinState.reload();
    }
    onSaved(change);
    toast("Saved");
  }

  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={save}>
      <div className="mg-section">
        <div className="mg-section-head"><span className="icon-chip sm"><Icon name="store" size={16} /></span>Shop</div>
        <div className="mg-readonly">
          <Icon name="lock" size={16} color="var(--muted)" />
          <span className="grow"><span className="strong">{place.name}</span><span className="muted"> · {place.city}</span></span>
          {isAdmin
            ? <Link to={`/admin/place/${place.id}`} className="link-btn tiny"><Icon name="settings" size={14} />Admin</Link>
            : <span className="tiny muted">Ask us to change</span>}
        </div>
        <div className="field">
          <span className="mg-label"><Icon name="grid" size={15} />Business type</span>
          <div className="mg-kinds" role="radiogroup" aria-label="Business type">
            {KINDS.map((k) => {
              const m = MODES[k];
              return (
                <button type="button" key={k} role="radio" aria-checked={kind === k} className={`mg-kind ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
                  <span className={`icon-chip sm ${m.tint === "green" ? "" : m.tint}`}><Icon name={m.icon} size={16} /></span>
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
          <span className="tiny muted">Sets the words on your page, like “{MODES[kind].catalog}”.</span>
        </div>
        <div className="grid2">
          <div className="field"><label className="mg-label" htmlFor="sc"><Icon name="tag" size={15} />Category</label><input id="sc" className="input" required value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Salon" /></div>
          <div className="field"><label className="mg-label" htmlFor="sa"><Icon name="pin" size={15} />Area</label><input id="sa" className="input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Baner" /></div>
        </div>
        <div className="field">
          <span className="mg-label"><Icon name="wallet" size={15} />Price level</span>
          <div className="mg-seg" role="radiogroup" aria-label="Price level">
            <button type="button" role="radio" aria-checked={price == null} className={price == null ? "on" : ""} onClick={() => setPrice(null)} aria-label="Not set"><Icon name="close" size={15} /></button>
            {[1, 2, 3, 4].map((n) => (
              <button type="button" key={n} role="radio" aria-checked={price === n} className={price === n ? "on" : ""} onClick={() => setPrice(n)}>{"₹".repeat(n)}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="mg-label" htmlFor="ab"><Icon name="message" size={15} />About</label>
          <textarea id="ab" className="textarea" style={{ minHeight: 84 }} maxLength={500} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="What you're known for, in a line or two" />
          <button type="button" className="link-btn small" style={{ alignSelf: "flex-start" }} disabled={writing} onClick={writeAbout}><Icon name="spark" size={15} />{writing ? "Writing…" : about.trim() ? "Polish with AI" : "Write it for me"}</button>
          {aiErr && <span className="tiny" style={{ color: "var(--danger)" }}>{aiErr}</span>}
        </div>
      </div>

      <MapPin place={place} pinState={pinState} coords={coords} setCoords={setCoords} />

      <div className="mg-section">
        <div className="mg-section-head">
          <span className="icon-chip sm amber"><Icon name="clock" size={16} /></span>
          <span className="grow">Hours</span>
          <button type="button" role="switch" aria-checked={hoursSet} aria-label="Show opening hours" className={`mg-switch ${hoursSet ? "on" : ""}`} onClick={() => setHoursSet(!hoursSet)} />
        </div>
        {hoursSet ? <HoursEditor days={days} onChange={setDays} /> : <p className="small muted">Off: no hours on your page.</p>}
      </div>

      <div className="mg-savebar">
        <button className="btn green block" disabled={busy}><Icon name="check" size={19} />{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** The shop's pin: Google's own when the shop is linked to Google, otherwise typed in or taken from this phone. */
function MapPin({ place, pinState, coords, setCoords }: { place: Place; pinState: PinState; coords: string; setCoords: (v: string) => void }) {
  const { pin, syncing, error, refresh } = pinState;
  const fromGoogle = Boolean(place.google_place_id) && googleConfigured;
  return (
    <div className="mg-section">
      <div className="mg-section-head"><span className="icon-chip sm sky"><Icon name="map" size={16} /></span><span className="grow">Map pin</span>
        {pin?.has_pin ? <span className="badge"><Icon name="check" size={11} />Set</span> : pin ? <span className="badge warn">Missing</span> : null}
      </div>
      {pin && !pin.has_pin && <div className="notice warn small">Without a pin, people nearby can't find you under “Near you”.</div>}
      {fromGoogle ? (
        <>
          <p className="small muted">Your pin is taken from your Google profile, so it always matches Google Maps. If it's wrong, fix it on Google.</p>
          <div className="row wrap" style={{ gap: 12 }}>
            {pin?.has_pin && pin.source === "google" && pin.lat != null && pin.lng != null && (
              <span className="small row" style={{ gap: 6 }}><Icon name="globe" size={15} />From Google{pin.updated_at ? `, ${timeAgo(pin.updated_at)}` : ""}</span>
            )}
            {pin?.lat != null && pin.lng != null && <a className="small" href={mapsLink(pin.lat, pin.lng)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="map" size={14} />Check on map</a>}
          </div>
          {error && <div className="notice err small">{error}</div>}
          <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={syncing} onClick={() => { refresh(); }}><Icon name="locate" size={16} />{syncing ? "Reading Google…" : "Refresh from Google"}</button>
        </>
      ) : (
        <>
          <p className="tiny muted">{pin?.has_pin ? "Leave empty to keep the current pin. " : ""}Stand in your shop and tap "Use my current location", or paste a Google Maps link.{place.google_place_id ? "" : " Connect your Google profile and we'll use Google's pin instead."}</p>
          {pin?.has_pin && pin.lat != null && pin.lng != null && (
            <a className="small" href={mapsLink(pin.lat, pin.lng)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start" }}><Icon name="map" size={14} />Current pin on the map</a>
          )}
          <CoordsField value={coords} onChange={setCoords} />
        </>
      )}
    </div>
  );
}
