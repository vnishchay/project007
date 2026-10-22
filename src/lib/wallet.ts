import { supabase, errorText } from "./supabase";

export type PassKind = { kind: "shop"; qrId: string } | { kind: "invite" };

/** Which wallet this phone or computer uses: Apple on iPhone, iPad and Mac, Google everywhere else. */
export const homeWallet = (): "apple" | "google" => (/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? "apple" : "google");

let ready: Promise<{ apple: boolean; google: boolean }> | null = null;
/** Whether each wallet is set up on the server (asked once per page load). */
export function walletStatus() {
  ready ??= supabase.functions.invoke("wallet", { body: { kind: "status" } })
    .then(({ data, error }) => (error || !data ? { apple: false, google: false } : data as { apple: boolean; google: boolean }), () => ({ apple: false, google: false }));
  return ready;
}

/** Makes the pass and opens it: Apple's file (iPhone shows "Add") or Google's save page. Returns an error message or "". */
export async function addToWallet(p: PassKind): Promise<string> {
  const st = await walletStatus();
  const want = homeWallet();
  const which = st[want] ? want : st.apple ? "apple" : st.google ? "google" : null;
  if (!which) return "Wallet passes aren't set up yet.";
  const { data, error } = await supabase.functions.invoke("wallet", { body: p });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return (body as { error?: string } | null)?.error || errorText(error);
  }
  const url = (data as { apple: string | null; google: string | null })[which];
  if (!url) return "Wallet passes aren't set up yet.";
  window.location.href = url;
  return "";
}
