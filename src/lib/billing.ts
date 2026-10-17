import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface PlanRow {
  code: string; name: string; qr_limit: number;
  price_inr_year: number | null; price_inr_month: number | null;
  price_usd_year: number | null; price_usd_month: number | null;
  features: string[]; sort_order: number;
}
export interface MyPlan {
  plan: string; plan_name: string; status: "trial" | "active" | "past_due" | "cancelled" | "expired";
  period_end: string; trial_reviews_left: number; qr_limit: number; qr_used: number;
  reviews_open: boolean; cancel_at_period_end: boolean; billing_interval: "month" | "year" | null;
}

export async function loadPlans(): Promise<PlanRow[]> {
  const { data } = await supabase.from("plans").select("*").order("sort_order");
  return (data as PlanRow[] | null) ?? [];
}

async function billing<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("billing", { body });
  if (error) {
    let msg = "Payments aren't available right now";
    if (error instanceof FunctionsHttpError) {
      const j = (await error.context.json().catch(() => ({}))) as { error?: string };
      if (j.error) msg = j.error;
    } else if (/fetch|network/i.test(error.message)) msg = "You seem to be offline";
    throw new Error(msg);
  }
  return data as T;
}

type RazorpayResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
declare global {
  interface Window { Razorpay?: new (o: Record<string, unknown>) => { open(): void; on(ev: string, fn: (r: unknown) => void): void } }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => ok();
    s.onerror = () => fail(new Error("Couldn't open the payment window. Check your connection."));
    document.head.appendChild(s);
  });
}

type PayTarget = { placeId: string; plan: string; interval: "month" | "year" } | { requestId: string };

/** Opens Razorpay checkout. Resolves true once paid and verified, false if the person closed it. */
export async function pay(target: PayTarget, label: string): Promise<boolean> {
  await loadCheckout();
  const o = await billing<{ key_id: string; order_id: string; amount: number; currency: string; plan_name: string; email: string | null }>(
    "requestId" in target
      ? { action: "order", request_id: target.requestId }
      : { action: "order", place_id: target.placeId, plan: target.plan, interval: target.interval });
  const paid = await new Promise<RazorpayResult | null>((resolve, reject) => {
    const rz = new window.Razorpay!({
      key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency,
      name: "Trusted Picks", description: `${o.plan_name} plan, ${label}`,
      prefill: o.email ? { email: o.email } : undefined,
      theme: { color: "#c2492b" },
      handler: (r: RazorpayResult) => resolve(r),
      modal: { ondismiss: () => resolve(null) },
    });
    rz.on("payment.failed", () => reject(new Error("The payment didn't go through. No money was taken.")));
    rz.open();
  });
  if (!paid) return false;
  await billing({ action: "verify", order_id: paid.razorpay_order_id, payment_id: paid.razorpay_payment_id, signature: paid.razorpay_signature });
  return true;
}

export const payForPlan = (placeId: string, placeName: string, plan: string, interval: "month" | "year") =>
  pay({ placeId, plan, interval }, `1 ${interval}, ${placeName}`);
export const payForRequest = (requestId: string, shopName: string) => pay({ requestId }, shopName);
