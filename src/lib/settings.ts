import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface AppSettings {
  listing_price_inr: number;
  qr_price_inr: number;
  visit_window_hours: number;
  upi_id: string;
  payee_name: string;
  support_phone: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  listing_price_inr: 199, qr_price_inr: 399, visit_window_hours: 6, upi_id: "", payee_name: "Trusted Picks", support_phone: "",
};

export function useSettings(): [AppSettings, () => void] {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [n, setN] = useState(0);
  useEffect(() => {
    supabase.from("app_settings").select("key, value").then(({ data }) => {
      const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
      for (const row of (data || []) as { key: string; value: unknown }[]) out[row.key] = row.value;
      setS(out as unknown as AppSettings);
    });
  }, [n]);
  return [s, () => setN((x) => x + 1)];
}

export function upiLink(s: AppSettings, amount: number, note: string): string | null {
  if (!s.upi_id) return null;
  const p = new URLSearchParams({ pa: s.upi_id, pn: s.payee_name || "Trusted Picks", am: String(amount), cu: "INR", tn: note });
  return `upi://pay?${p.toString()}`;
}
