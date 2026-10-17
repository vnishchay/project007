import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface AppSettings {
  visit_window_hours: number;
  support_phone: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  visit_window_hours: 6, support_phone: "",
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
