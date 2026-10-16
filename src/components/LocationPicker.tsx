import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Where } from "../lib/location";
import { Icon } from "./ui";

interface Spot { city: string; areas: string[] }

export function LocationPicker({ current, onPick, onClose }: { current: Where; onPick: (w: Where) => void; onClose: () => void }) {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    supabase.from("places").select("city, area").eq("status", "live").limit(2000).then(({ data }) => {
      const byCity = new Map<string, Set<string>>();
      for (const r of (data as { city: string | null; area: string | null }[]) || []) {
        const city = (r.city || "").trim();
        if (!city) continue;
        if (!byCity.has(city)) byCity.set(city, new Set());
        if (r.area?.trim()) byCity.get(city)!.add(r.area.trim());
      }
      setSpots([...byCity.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([city, a]) => ({ city, areas: [...a].sort() })));
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
          <h2>Choose location</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="search">
          <Icon name="search" color="var(--muted)" />
          <input autoFocus aria-label="Search city or area" placeholder="Search a city or area" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="list sheet-list">
          <button className={`list-item pick ${isOn({ kind: "near" }) ? "on" : ""}`} onClick={() => pick({ kind: "near" })}>
            <Icon name="locate" color="var(--green)" /><span className="grow strong">Near me</span><span className="tiny muted">uses GPS</span>
          </button>
          <button className={`list-item pick ${isOn({ kind: "all" }) ? "on" : ""}`} onClick={() => pick({ kind: "all" })}>
            <Icon name="globe" color="var(--green)" /><span className="grow strong">Everywhere</span>
          </button>
          {spots === null ? <div className="skeleton" style={{ marginTop: 10 }} /> : shown.map((s) => (
            <div key={s.city} className="stack" style={{ gap: 0 }}>
              <button className={`list-item pick ${isOn({ kind: "city", city: s.city }) ? "on" : ""}`} onClick={() => pick({ kind: "city", city: s.city })}>
                <Icon name="pin" color="var(--green)" /><span className="grow strong">{s.city}</span><span className="tiny muted">All areas</span>
              </button>
              {s.areas.map((a) => (
                <button key={a} className={`list-item pick sub ${isOn({ kind: "area", city: s.city, area: a }) ? "on" : ""}`} onClick={() => pick({ kind: "area", city: s.city, area: a })}>
                  <span className="grow">{a}</span>
                </button>
              ))}
            </div>
          ))}
          {spots && t && !exact && (
            <button className="list-item pick" onClick={() => pick({ kind: "city", city: text.trim() })}>
              <Icon name="search" color="var(--green)" /><span className="grow">Search in “{text.trim()}”</span>
            </button>
          )}
          {spots && spots.length === 0 && !t && <p className="small muted" style={{ padding: "12px 0" }}>No places are listed yet.</p>}
        </div>
      </div>
    </div>
  );
}
