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

  useEffect(() => {
    if (where.kind !== "near") return;
    let alive = true;
    setStatus("locating");
    getLocation().then((c) => {
      if (!alive) return;
      setCoords(c);
      setStatus(c ? "idle" : "denied");
    });
    return () => { alive = false; };
  }, [where]);

  const setWhere = useCallback((w: Where) => {
    try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* ignore */ }
    setWhereState(w);
  }, []);

  // Until GPS answers (or if it is off), show the profile city, else everywhere.
  const effective: Where =
    where.kind === "near" && !coords
      ? fallbackCity ? { kind: "city", city: fallbackCity } : { kind: "all" }
      : where;

  return { where, effective, coords: where.kind === "near" ? coords : null, locating: where.kind === "near" && status === "locating", denied: where.kind === "near" && status === "denied", setWhere };
}
