import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import { googleConfigured, type GoogleMatch } from "../../lib/google";
import type { Place } from "../../lib/types";
import { Icon, useToast } from "../ui";
import { GoogleFind, GoogleMark, GooglePreview } from "./Google";

/** Live Google preview when linked; otherwise a one-time "connect" flow for the owner. */
export function GoogleConnect({ place, isAdmin, onSaved }: { place: Place; isAdmin: boolean; onSaved: (p: Partial<Place>) => void }) {
  const toast = useToast();
  const [pick, setPick] = useState<GoogleMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!googleConfigured) return isAdmin
    ? <div className="notice warn row tiny" style={{ gap: 8 }}><Icon name="info" size={15} />Google previews are off: VITE_GOOGLE_MAPS_KEY isn't set.</div>
    : null;

  if (place.google_place_id) return (
    <div className="mg-section">
      <div className="mg-section-head">
        <span className="icon-chip sm sky"><Icon name="globe" size={16} /></span>
        <span className="grow">Google profile</span>
        <span className="badge"><Icon name="check" size={11} />Connected</span>
      </div>
      <GooglePreview id={place.google_place_id} />
      {isAdmin
        ? <Link to={`/admin/place/${place.id}`} className="link-btn tiny"><Icon name="settings" size={14} />Change in admin</Link>
        : <span className="tiny muted">Wrong business? Message us and we'll fix it.</span>}
    </div>
  );

  async function connect() {
    if (!pick) return;
    setBusy(true); setErr("");
    const { error } = await supabase.from("places").update({ google_place_id: pick.id }).eq("id", place.id);
    setBusy(false);
    if (error) { setErr(errorText(error)); return; }
    onSaved({ google_place_id: pick.id });
    setPick(null);
    toast("Google profile connected");
  }

  return (
    <div className="mg-section gc-connect">
      <div className="mg-section-head">
        <span className="icon-chip sm sky"><Icon name="globe" size={16} /></span>
        <span className="grow">Connect your <GoogleMark /> profile</span>
      </div>
      <div className="stack tight small">
        <span className="row" style={{ gap: 6 }}><Icon name="star" size={14} color="var(--star)" />Your Google rating and photos, live on your page</span>
        <span className="row" style={{ gap: 6 }}><Icon name="send" size={14} color="var(--green)" />Happy customers pass reviews on to Google</span>
      </div>
      {pick ? (
        <div className="stack" style={{ gap: 10 }}>
          <GooglePreview id={pick.id} note="Is this your shop?" />
          {err && <div className="notice err small">{err}</div>}
          <div className="row">
            <button type="button" className="btn small green grow" disabled={busy} onClick={connect}><Icon name="link" size={16} />{busy ? "Connecting…" : "Yes, connect"}</button>
            <button type="button" className="btn small ghost" onClick={() => { setPick(null); setErr(""); }}>Pick another</button>
          </div>
          {!isAdmin && <span className="tiny muted">You can connect once. To change it later, message us.</span>}
        </div>
      ) : <GoogleFind onPick={setPick} />}
    </div>
  );
}
