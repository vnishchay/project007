import { useId, useState } from "react";
import { getLocation, parseCoords } from "../lib/util";
import { Icon } from "./ui";

/** Map location for a place: type "lat, lng", paste a Google Maps link, or use this device's GPS. */
export function CoordsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const c = value.trim() ? parseCoords(value) : null;

  async function here() {
    setBusy(true); setMsg("");
    const g = await getLocation();
    setBusy(false);
    if (g) onChange(`${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}`);
    else setMsg("Couldn't read this device's location. Allow location access, or paste it from Google Maps.");
  }

  return (
    <div className="field">
      <label htmlFor={id}>Map location</label>
      <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="18.5362, 73.8940 or a Google Maps link"
        onBlur={() => { if (c) onChange(`${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`); }} />
      <div className="row wrap" style={{ gap: 14 }}>
        <button type="button" className="link-btn tiny" disabled={busy} onClick={here}><Icon name="locate" size={14} />{busy ? "Locating…" : "Use my current location"}</button>
        {c && <a className="tiny" href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`} target="_blank" rel="noreferrer">Check on map</a>}
      </div>
      {value.trim() && !c && <span className="tiny" style={{ color: "var(--danger)" }}>That doesn't look like a location. Use “lat, lng” or a Google Maps link.</span>}
      {msg && <span className="tiny" style={{ color: "var(--danger)" }}>{msg}</span>}
    </div>
  );
}
