import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "./supabase";

// Daily totals for the team (how many opened a shop page today), never tied to a person:
// the database keeps only a count per day and metric. Each page counts once per tab session.
export type Stat = "view_home" | "view_place" | "view_best" | "view_qr" | "view_business" | "view_pricing"
  | "review_started" | "install_prompt" | "installed" | "share";

const seen = new Set<string>();

/** Adds one to today's total for `metric`, at most once per tab session for the same `once` key. */
export function bumpStat(metric: Stat, once: string = metric) {
  const key = `tp-stat:${once}`;
  let first = !seen.has(key);
  try { first = !sessionStorage.getItem(key); sessionStorage.setItem(key, "1"); } catch { /* storage blocked: memory only */ }
  seen.add(key);
  if (first) void supabase.rpc("bump_stat", { p_metric: metric }).then(() => {}, () => {});
}

const VIEWS: [RegExp, Stat][] = [
  [/^\/$/, "view_home"], [/^\/p\//, "view_place"], [/^\/best\//, "view_best"],
  [/^\/(q|r)\//, "view_qr"], [/^\/business$/, "view_business"], [/^\/pricing$/, "view_pricing"],
];

/** Counts page views by kind (a shop page, a dish page...). Mounted once inside the router. */
export function ViewStats() {
  const { pathname } = useLocation();
  useEffect(() => {
    const hit = VIEWS.find(([re]) => re.test(pathname));
    if (hit) bumpStat(hit[1], `${hit[1]}:${pathname}`);
  }, [pathname]);
  return null;
}
