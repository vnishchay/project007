import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import type { Place } from "../../lib/types";
import { Icon, TopBar, useToast } from "../ui";

interface PlaceCheck { status: Place["status"]; verification: string; note: string | null; next_recheck_at: string | null }

/** A removed or rejected shop: the team's note, and a way to ask for another check once it's fixed. */
export function RecheckBanner({ placeId }: { placeId: string }) {
  const toast = useToast();
  const [check, setCheck] = useState<PlaceCheck | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    let alive = true;
    supabase.rpc("my_place_check", { p_place: placeId }).then(({ data, error }) => {
      if (alive && !error) setCheck(((data as PlaceCheck[]) || [])[0] ?? null);
    });
    return () => { alive = false; };
  }, [placeId, n]);

  async function ask() {
    setBusy(true);
    const { error } = await supabase.rpc("request_recheck", { p_place: placeId, p_note: msg.trim() || null });
    setBusy(false);
    if (error) toast(errorText(error)); else { toast("Sent. The team will check your shop again"); setMsg(""); setN((x) => x + 1); }
  }

  if (!check) return null;
  if (check.verification === "pending") return (
    <div className="callout sky">
      <span className="icon-chip sm sky"><Icon name="clock" size={16} /></span>
      <span className="grow small"><b>Being checked again.</b> Your shop stays off the app until the team approves it.</span>
    </div>
  );
  const waitUntil = check.next_recheck_at && new Date(check.next_recheck_at).getTime() > Date.now() ? new Date(check.next_recheck_at) : null;
  return (
    <div className="callout coral" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <span className="row" style={{ gap: 10 }}>
        <span className="icon-chip sm coral"><Icon name="alert" size={16} /></span>
        <span className="grow small"><b>Your shop is off the app.</b> People can't find it or review it until the team checks it again.</span>
      </span>
      {check.note && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><b>From the team:</b> {check.note}</p>}
      {waitUntil ? (
        <span className="tiny">You can ask again after {waitUntil.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.</span>
      ) : (
        <>
          <input className="input" placeholder="What did you change? (optional)" value={msg} maxLength={1000} onChange={(e) => setMsg(e.target.value)} />
          <button type="button" className="btn small green" disabled={busy} onClick={ask}><Icon name="refresh" size={16} />{busy ? "Sending…" : "I've fixed it, check again"}</button>
        </>
      )}
    </div>
  );
}

export function Locked() {
  return (
    <div className="page">
      <TopBar title="Owner app" back="/business" />
      <div className="mg-lock">
        <div className="mg-lock-art"><Icon name="lock" size={38} /></div>
        <h2 style={{ fontSize: 20 }}>Only the shop owner can edit this</h2>
        <p className="small muted" style={{ maxWidth: 270 }}>Own a shop? List it and you can add products, photos and hours.</p>
        <div className="row wrap" style={{ justifyContent: "center" }}>
          <Link to="/business" className="btn green small"><Icon name="store" size={17} />List your business</Link>
          <Link to="/" className="btn ghost small"><Icon name="home" size={17} />Home</Link>
        </div>
      </div>
    </div>
  );
}
