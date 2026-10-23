import { supabase } from "./supabase";

/** A call from a table (migration 52): the staff, the bill, or "tell the shop now". */
export type CallKind = "waiter" | "bill" | "help";
export interface TableCall {
  id: string; kind: CallKind; message: string | null; table_label: string | null;
  created_at: string; pinged_at: string; seen_at: string | null; done_at: string | null;
}
export interface LiveBoard {
  calls: boolean; alerts: boolean; open: TableCall[]; done: TableCall[];
  today: { count: number; answer_s: number | null };
}

export const CALLS: Record<CallKind, { label: string; owner: string; icon: "service" | "receipt" | "message"; tone: string }> = {
  waiter: { label: "Call staff", owner: "Calling the staff", icon: "service", tone: "sky" },
  bill: { label: "Get the bill", owner: "Bill please", icon: "receipt", tone: "green" },
  help: { label: "Tell the shop now", owner: "Needs you now", icon: "message", tone: "coral" },
};

/** "just now", "3 min", "1 h 5 min" since a time. */
export function waited(iso: string, now = Date.now()): string {
  const m = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export async function placeService(placeId: string): Promise<{ calls: boolean }> {
  const { data, error } = await supabase.rpc("place_service", { p_place: placeId });
  if (error || !data) return { calls: false };
  return data as { calls: boolean };
}

export async function myCalls(placeId: string): Promise<TableCall[]> {
  const { data, error } = await supabase.rpc("my_table_requests", { p_place: placeId });
  return error ? [] : ((data as TableCall[]) || []);
}

export async function sendCall(placeId: string, kind: CallKind, message?: string): Promise<TableCall> {
  const { data, error } = await supabase.rpc("table_request", { p_place: placeId, p_kind: kind, p_message: message ?? null });
  if (error) throw error;
  return data as TableCall;
}

export async function cancelCall(id: string): Promise<void> {
  await supabase.rpc("cancel_table_request", { p_id: id });
}

export async function loadBoard(placeId: string): Promise<LiveBoard | null> {
  const { data, error } = await supabase.rpc("shop_live_requests", { p_place: placeId });
  return error || !data ? null : (data as LiveBoard);
}

export async function answerCall(id: string, action: "seen" | "done"): Promise<void> {
  const { error } = await supabase.rpc("shop_answer_request", { p_id: id, p_action: action });
  if (error) throw error;
}
