import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import type { Place } from "../../lib/types";
import { Icon, useToast } from "../ui";
import { CoordsField } from "../CoordsField";
import { parseCoords } from "../../lib/util";
import { HoursEditor, readHours, writeHours, type DayHours } from "./HoursEditor";

/** About, hours, category, area and price level: what owners may change themselves. */
export function ShopDetails({ place, isAdmin, onSaved }: { place: Place; isAdmin: boolean; onSaved: (p: Partial<Place>) => void }) {
  const toast = useToast();
  const [about, setAbout] = useState(place.about || "");
  const [category, setCategory] = useState(place.category);
  const [area, setArea] = useState(place.area || "");
  const [price, setPrice] = useState<number | null>(place.price_level);
  const [days, setDays] = useState<DayHours[]>(() => readHours(place.hours));
  const [hoursSet, setHoursSet] = useState(Boolean(place.hours));
  const [coords, setCoords] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!category.trim()) { toast("Add a category"); return; }
    const c = coords.trim() ? parseCoords(coords) : null;
    if (coords.trim() && !c) { toast("Check the map location"); return; }
    setBusy(true);
    const change: Partial<Place> = {
      about: about.trim() || null, category: category.trim(), area: area.trim() || null, price_level: price,
      ...(hoursSet ? { hours: writeHours(days) } : place.hours ? { hours: null } : {}),
    };
    const { error } = await supabase.from("places").update(change).eq("id", place.id);
    setBusy(false);
    if (error) { toast(errorText(error)); return; }
    if (c) {
      const r = await supabase.rpc("set_place_location", { p_place: place.id, p_lat: c.lat, p_lng: c.lng });
      if (r.error) { toast(errorText(r.error)); return; }
      setCoords("");
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
        </div>
      </div>

      <div className="mg-section">
        <div className="mg-section-head"><span className="icon-chip sm sky"><Icon name="map" size={16} /></span>Map pin</div>
        <p className="tiny muted">Leave empty to keep the current pin. Stand in your shop and tap "Use my current location".</p>
        <CoordsField value={coords} onChange={setCoords} />
      </div>

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
