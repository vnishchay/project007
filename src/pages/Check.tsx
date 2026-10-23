import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase, configured, errorText } from "../lib/supabase";
import { deviceId } from "../lib/device";
import { Icon, RvxBack } from "../components/ui";
import "../styles/review.css";

type Line = { ok: boolean; label: string; detail: string };

/** A self-check for reviewing without an account. Runs each step a guest goes through and shows the exact answer. */
export default function Check() {
  const [params] = useSearchParams();
  const token = params.get("t") || "";
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run() {
    setRunning(true); setCopied(false);
    const out: Line[] = [];
    const add = (ok: boolean, label: string, detail = "") => { out.push({ ok, label, detail }); setLines([...out]); };
    try {
      add(configured, "App is connected to Supabase", configured ? (import.meta.env.VITE_SUPABASE_URL as string).replace(/^https?:\/\//, "") : "VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is missing in this deployment");
      if (!configured) return;
      const had = (await supabase.auth.getSession()).data.session;
      if (had) add(true, "Already signed in on this browser", had.user.is_anonymous ? "as a guest" : "with an account. Open this page in a private window to test a guest");
      let session = had;
      if (!session) {
        const r = await supabase.auth.signInAnonymously();
        session = r.data.session;
        add(!r.error && Boolean(session), "Guest session starts", r.error ? `${r.error.message}${r.error.status ? ` (${r.error.status})` : ""}${/anonymous/i.test(r.error.message) ? ". Fix: Supabase dashboard > Authentication > Sign In / Providers > turn on \"Allow anonymous sign-ins\"" : ""}` : "ok");
        if (!session) return;
      }
      const prof = await supabase.rpc("my_profile");
      add(!prof.error, "Guest profile can be read", prof.error ? errorText(prof.error) : `${(prof.data as unknown[] | null)?.length ?? 0} row`);
      const claims = JSON.parse(atob(session.access_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")) || "{}") as { is_anonymous?: boolean; role?: string };
      add(claims.is_anonymous === true || !session.user.is_anonymous, "Guest flag is in the sign-in token", `is_anonymous=${String(claims.is_anonymous)}, role=${claims.role}`);
      if (!token) { add(true, "Table code not tested", "add ?t=YOUR_QR_TOKEN to the address to test a QR (the part after /q/)"); return; }
      const pk = await supabase.rpc("peek_qr", { p_token: token });
      const pl = (pk.data as { place_id: string; place_name: string }[] | null)?.[0];
      add(!pk.error && Boolean(pl), "QR code is found", pk.error ? errorText(pk.error) : pl ? pl.place_name : "no active code with that token");
      if (!pl) return;
      const sc = await supabase.rpc("scan_qr", { p_token: token });
      add(!sc.error, "Scan unlocks a verified visit", sc.error ? errorText(sc.error) : "ok");
      if (sc.error) return;
      const gate = await supabase.rpc("can_review", { p_place: pl.place_id, p_device: deviceId() });
      const g = (gate.data as { allowed: boolean; reason: string }[] | null)?.[0];
      add(!gate.error && g?.allowed === true, "Review is allowed", gate.error ? errorText(gate.error) : `${g?.reason}${g?.reason === "paused" ? ": this shop's plan is out of trial reviews or expired" : g?.reason === "guest_used" ? ": this phone already reviewed here" : ""}`);
    } catch (e) {
      add(false, "Something stopped the check", errorText(e));
    } finally {
      setRunning(false);
    }
  }

  const text = lines.map((l) => `${l.ok ? "OK  " : "FAIL"} ${l.label}${l.detail ? `: ${l.detail}` : ""}`).join("\n");
  return (
    <div className="rvx" data-stage="check">
      <div className="rvx-bar"><RvxBack /><span className="rvx-brand">Trusted Picks</span><span className="grow" /></div>
      <section className="rvx-sec">
        <h2>Review <i>check</i></h2>
        <p className="rvx-hint">Runs the same steps a guest goes through, and shows exactly which one fails.</p>
        <div className="rvx-cards">
          {lines.map((l) => (
            <div key={l.label} className="rvx-status" style={l.ok ? undefined : { background: "var(--danger-soft)", borderColor: "rgba(255,154,120,.35)" }}>
              <Icon name={l.ok ? "checkCircle" : "alert"} size={20} color={l.ok ? "#7fbf9e" : "#ff9a78"} />
              <span className="grow"><b>{l.label}</b>{l.detail && <small style={{ overflowWrap: "anywhere" }}>{l.detail}</small>}</span>
            </div>
          ))}
        </div>
        <button type="button" className="rvx-cta" disabled={running} onClick={run} style={{ position: "static" }}><span>{running ? "Checking…" : lines.length ? "Run again" : "Run the check"}</span><Icon name="chev" size={20} /></button>
        {lines.length > 0 && !running && (
          <button type="button" className="rvx-more" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}><Icon name="copy" size={16} />{copied ? "Copied" : "Copy the results"}</button>
        )}
      </section>
    </div>
  );
}
