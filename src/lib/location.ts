import { useCallback, useEffect, useState } from "react";
import { getLocation, type Coords } from "./util";

// Where Discover searches. Remembered on this device.
export type Where =
  | { kind: "near" }
  | { kind: "all" }
  | { kind: "city"; city: string }
  | { kind: "area"; city: string; area: string };

const KEY = "tp-where";

function load(): Where | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && ["near", "all", "city", "area"].includes(v.kind)) return v as Where;
  } catch { /* storage unavailable */ }
  return null;
}

const LAST_CITY = "tp-last-city";
/** The city of the last places found near this phone, used while GPS is slow or off. */
export function lastCity(): string | null {
  try { return localStorage.getItem(LAST_CITY) || null; } catch { return null; }
}
export function rememberCity(city: string | null | undefined) {
  if (!city) return;
  try { localStorage.setItem(LAST_CITY, city); } catch { /* storage blocked */ }
}

export function whereLabel(w: Where): string {
  if (w.kind === "near") return "Near you";
  if (w.kind === "all") return "Everywhere";
  if (w.kind === "city") return w.city;
  return `${w.area}, ${w.city}`;
}

/** The chosen search area, plus GPS coordinates when it is "near". */
export function useWhere(fallbackCity: string | null | undefined) {
  const [where, setWhereState] = useState<Where>(() => load() ?? { kind: "near" });
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<"idle" | "locating" | "denied">("idle");
  // GPS can take a while indoors; after 3 seconds the page says what it is showing instead and offers a retry.
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (where.kind !== "near") return;
    let alive = true;
    setStatus("locating");
    setSlow(false);
    const t = window.setTimeout(() => { if (alive) setSlow(true); }, 3000);
    getLocation().then((c) => {
      if (!alive) return;
      window.clearTimeout(t);
      setCoords(c);
      setSlow(false);
      setStatus(c ? "idle" : "denied");
    });
    return () => { alive = false; window.clearTimeout(t); };
  }, [where]);

  const setWhere = useCallback((w: Where) => {
    try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* ignore */ }
    setWhereState(w);
  }, []);

  // Until GPS answers (or if it is off), show the profile city, else the last city seen here, else everywhere.
  const city = fallbackCity || lastCity();
  const effective: Where =
    where.kind === "near" && !coords
      ? city ? { kind: "city", city } : { kind: "all" }
      : where;

  return { where, effective, coords: where.kind === "near" ? coords : null, locating: where.kind === "near" && status === "locating", slow: where.kind === "near" && status === "locating" && slow, denied: where.kind === "near" && status === "denied", setWhere };
}
