import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Where } from "../lib/location";
import { Icon } from "./ui";
import { Chip } from "./home/Kit";

interface Spot { city: string; areas: string[] }

interface Props {
  current: Where; onPick: (w: Where) => void; onClose: () => void;
  /** "Near me" distance choices, and whether the phone refused location. */
  radius?: number; choices?: { m: number; label: string }[]; onRadius?: (m: number) => void; denied?: boolean;
}

export function LocationPicker({ current, onPick, onClose, radius, choices, onRadius, denied }: Props) {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    // One grouped query (city, area, shops) instead of reading every shop; older databases fall back to a capped read.
    const build = (rows: { city: string | null; area: string | null }[]) => {
      const byCity = new Map<string, Set<string>>();
      for (const r of rows) {
        const city = (r.city || "").trim();
        if (!city) continue;
        if (!byCity.has(city)) byCity.set(city, new Set());
        if (r.area?.trim()) byCity.get(city)!.add(r.area.trim());
      }
      setSpots([...byCity.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([city, a]) => ({ city, areas: [...a].sort() })));
    };
    supabase.rpc("place_areas").then(async (r) => {
      if (!r.error) { build((r.data as { city: string | null; area: string | null }[]) || []); return; }
      const old = await supabase.from("places").select("city, area").eq("status", "live").limit(2000);
      build((old.data as { city: string | null; area: string | null }[]) || []);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const t = text.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!spots) return [];
    if (!t) return spots;
    return spots
      .map((s) => s.city.toLowerCase().includes(t) ? s : { ...s, areas: s.areas.filter((a) => a.toLowerCase().includes(t)) })
      .filter((s) => s.city.toLowerCase().includes(t) || s.areas.length);
  }, [spots, t]);
  const exact = spots?.some((s) => s.city.toLowerCase() === t || s.areas.some((a) => a.toLowerCase() === t));

  const isOn = (w: Where) => JSON.stringify(w) === JSON.stringify(current);
  const pick = (w: Where) => { onPick(w); onClose(); };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Choose location" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <span className="section-title"><Chip icon="mapPinned" tone="sky" size="sm" />Choose location</span>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="search">
          <Icon name="search" color="var(--muted)" />
          <input autoFocus aria-label="Search city or area" placeholder="Search a city or area" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="list sheet-list">
          <button className={`list-item pick ${isOn({ kind: "near" }) ? "on" : ""}`} onClick={() => pick({ kind: "near" })}>
            <Chip icon="locate" size="sm" />
            <span className="grow stack" style={{ gap: 0 }}><span className="strong">Near me</span>{denied && <span className="tiny muted">Location is off. Allow it in your browser to use this.</span>}</span>
            <Icon name="navigate" size={14} color="var(--muted)" />
          </button>
          {choices && onRadius && !t && (
            <div className="chips scroll" role="group" aria-label="How far" style={{ margin: 0, padding: "4px 0 10px 52px", flex: "none" }}>
              {choices.map((c) => {
                const on = current.kind === "near" && radius === c.m;
                return <button key={c.m} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => { onRadius(c.m); pick({ kind: "near" }); }}>{c.label}</button>;
              })}
            </div>
          )}
          <button className={`list-item pick ${isOn({ kind: "all" }) ? "on" : ""}`} onClick={() => pick({ kind: "all" })}>
            <Chip icon="globe" tone="sky" size="sm" /><span className="grow strong">Everywhere</span>
          </button>
          {spots === null ? <div className="skeleton" style={{ marginTop: 10 }} /> : shown.map((s) => (
            <div key={s.city} className="stack" style={{ gap: 0 }}>
              <button className={`list-item pick ${isOn({ kind: "city", city: s.city }) ? "on" : ""}`} onClick={() => pick({ kind: "city", city: s.city })}>
                <Chip icon="pin" tone="coral" size="sm" /><span className="grow strong">{s.city}</span><span className="tiny muted">All areas</span>
              </button>
              {s.areas.map((a) => (
                <button key={a} className={`list-item pick sub ${isOn({ kind: "area", city: s.city, area: a }) ? "on" : ""}`} onClick={() => pick({ kind: "area", city: s.city, area: a })}>
                  <Icon name="pin" size={14} color="var(--muted)" /><span className="grow">{a}</span>
                </button>
              ))}
            </div>
          ))}
          {spots && t && !exact && (
            <button className="list-item pick" onClick={() => pick({ kind: "city", city: text.trim() })}>
              <Chip icon="search" tone="violet" size="sm" /><span className="grow">Search in “{text.trim()}”</span>
            </button>
          )}
          {spots && spots.length === 0 && !t && <p className="small muted" style={{ padding: "12px 0" }}>No places are listed yet.</p>}
        </div>
      </div>
    </div>
  );
}
