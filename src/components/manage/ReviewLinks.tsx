import { useEffect, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { copyText } from "../../lib/util";
import { Icon, useToast } from "../ui";

interface Counts { made_today: number; left_today: number; used_30d: number; made_30d: number }

/**
 * One-time review links for customers who didn't sit at a table (delivery, appointment, takeaway).
 * Each link works once, for one person, for a few days. The shop never sees which review came from it.
 */
export function ReviewLinks({ placeId, placeName, live }: { placeId: string; placeName: string; live: boolean }) {
  const toast = useToast();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => supabase.rpc("review_link_counts", { p_place: placeId }).then(({ data, error }) => {
    if (!error) setCounts(((data as Counts[]) || [])[0] ?? null);
  });
  useEffect(() => { load(); }, [placeId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function make() {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("create_review_link", { p_place: placeId });
    setBusy(false);
    if (error) { setErr(/could not find the function/i.test(error.message) ? "Review links need the latest database update." : errorText(error)); return; }
    const row = ((data as { token: string; expires_at: string }[]) || [])[0];
    if (!row) return;
    setLink({ url: `${window.location.origin}/r/${row.token}`, expires: row.expires_at });
    load();
  }

  const message = link ? `Thanks for choosing ${placeName}! Tell us how it was (takes a minute, no account needed): ${link.url}` : "";
  const until = link ? new Date(link.expires).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";

  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="row">
        <span className="icon-chip sky"><Icon name="link" size={18} /></span>
        <span className="grow stack tight">
          <span className="strong">Review link for one customer</span>
          <span className="tiny muted">For delivery, takeaway or appointments. Works once, for one person.</span>
        </span>
        {counts && <span className="pill">{counts.left_today} left today</span>}
      </div>

      {link ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="rl-link"><Icon name="link" size={14} /><span className="ellipsis grow">{link.url}</span></div>
          <div className="row">
            <a className="btn green grow" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"><Icon name="send" size={18} />WhatsApp</a>
            <button type="button" className="btn ghost" aria-label="Copy link" onClick={async () => toast((await copyText(message)) ? "Copied, ready to paste" : "Couldn't copy")}><Icon name="copy" size={18} /></button>
          </div>
          <span className="tiny muted row" style={{ gap: 4 }}><Icon name="clock" size={12} />Works until {until}. Make a new one for the next customer.</span>
          <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }} disabled={busy || !live || counts?.left_today === 0} onClick={make}><Icon name="plus" size={16} />New link</button>
        </div>
      ) : (
        <button type="button" className="btn ghost block" disabled={busy || !live || counts?.left_today === 0} onClick={make}>
          <Icon name="plus" size={18} />{busy ? "Making…" : "Make a review link"}
        </button>
      )}
      {!live && <span className="tiny muted">Review links work once your shop is live.</span>}
      {err && <div className="notice err">{err}</div>}
      {counts && counts.made_30d > 0 && <span className="tiny muted">{counts.used_30d} of {counts.made_30d} links opened in the last 30 days</span>}
      <p className="tiny muted row" style={{ gap: 6, alignItems: "flex-start" }}><Icon name="shield" size={14} />Send links only to real customers. Link reviews show as verified but count a little less than table scans, and we watch for unusual patterns.</p>
    </section>
  );
}
