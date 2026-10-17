import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Every AI feature goes through the Supabase Edge Function "ai". The AI key lives only
 * there (a Supabase secret); the app sends the request with the user's session and gets text back.
 */
export async function callAi<T>(task: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ai", { body: { task, ...payload } });
  if (error) {
    let msg = "AI isn't available right now";
    if (error instanceof FunctionsHttpError) {
      const j = (await error.context.json().catch(() => ({}))) as { error?: string };
      if (j.error) msg = j.error;
    } else if (/fetch|network/i.test(error.message)) {
      msg = "You seem to be offline";
    }
    throw new Error(msg);
  }
  return data as T;
}

/** Owner helpers: write an update, write the About text, read the reviews for tips. */
export function assist<T = { text: string }>(task: "update" | "about" | "insights", placeId: string, notes?: string): Promise<T> {
  return callAi<T>(task, { placeId, notes });
}

export interface PlaceSummary { summary: string; highlights: string[] }

/** "What people say": read the stored one; ask the edge function only when it's missing or a day old. */
export async function placeSummary(placeId: string): Promise<PlaceSummary | null> {
  try {
    const { data } = await supabase.from("place_ai_summaries").select("summary, highlights, updated_at").eq("place_id", placeId).maybeSingle();
    const row = data as (PlaceSummary & { updated_at: string }) | null;
    const fresh = row && Date.now() - new Date(row.updated_at).getTime() < 86_400_000;
    const s = fresh ? row : await callAi<PlaceSummary>("summary", { placeId });
    return s?.summary ? { summary: s.summary, highlights: s.highlights || [] } : null;
  } catch {
    return null;
  }
}
