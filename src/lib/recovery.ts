export type HelpStatus = 'open' | 'in_progress' | 'resolved';
export const HELP_CATEGORIES = [
  { id: 'order', label: 'My order' }, { id: 'service', label: 'Service' },
  { id: 'quality', label: 'Quality' }, { id: 'other', label: 'Something else' },
] as const;
export const HELP_STATUS: Record<HelpStatus, string> = { open: 'Waiting for the shop', in_progress: 'Being handled', resolved: 'Shop marked resolved' };
export interface HelpRequest {
  id: string; place_id: string; place_name: string; category: string; status: HelpStatus;
  created_at: string; resolved_at: string | null; resolution: string;
  confirmation: 'pending' | 'fixed' | 'not_fixed'; version: number; body: string;
}
export interface RecoveryCase extends Omit<HelpRequest, 'place_id' | 'place_name'> {
  assigned_to: string; internal_note: string; due_at: string; acknowledged_at: string | null;
  confirmed_at: string | null; recovery_cost: number; purchase_amount: number | null;
  bill_reference: string | null; purchase_recorded_at: string | null; currency: string; contact: string | null;
}
export interface RecoveryQueueData {
  open: number; overdue: number; resolved_30d: number; confirmed_30d: number; total: number;
  money: { currency: string; cost: number; recorded_sales: number; purchases: number }[];
  cases: RecoveryCase[];
}
export const categoryLabel = (id: string) => HELP_CATEGORIES.find((x) => x.id === id)?.label || 'Something else';
export function recoveryError(error: unknown): string {
  const e = error as { code?: string; message?: string };
  if (e?.code === 'PGRST202' || e?.code === '42P01') return 'Help requests are not available yet. Please speak to the staff directly.';
  if (e?.code === '23505') return 'That bill reference is already recorded for another request. Check the reference before saving.';
  return e?.message || 'Could not connect. Please try again.';
}
