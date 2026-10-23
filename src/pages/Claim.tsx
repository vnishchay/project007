import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { isUuid } from "../lib/types";
import { getLocation, type Coords } from "../lib/util";
import { shrinkImage } from "../lib/media";
import { Icon, Spinner, TopBar } from "../components/ui";

type Step = 0 | 1 | 2 | 3;
const ROLES = ["Owner", "Partner", "Manager", "Family member"];

/** Claim a shop in a few slides, one question each: are you there, shop-front photo, who you are. */
export default function Claim() {
  const { placeId = "" } = useParams();
  const { session } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [here, setHere] = useState<Coords | null | undefined>(undefined);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [role, setRole] = useState("Owner");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    if (!isUuid(placeId)) { setName(""); return; }
    supabase.from("places").select("name").eq("id", placeId).maybeSingle().then(({ data }) => setName(data?.name ?? ""));
  }, [placeId]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const guest = !session || session.user.is_anonymous;
  if (name === null) return <div className="page"><Spinner /></div>;
  if (guest) return (
    <div className="page">
      <TopBar back="/business" title="Claim your shop" />
      <div className="card rv-gate center">
        <span className="icon-chip lg" style={{ margin: "0 auto" }}><Icon name="store" size={26} /></span>
        <h2>Sign in to claim {name || "this shop"}</h2>
        <p className="small muted">Claiming is free. You'll manage the page, products and review QRs.</p>
        <Link to={`/signin?next=${encodeURIComponent(`/claim/${placeId}`)}`} className="btn green block"><Icon name="login" size={18} />Sign in</Link>
      </div>
    </div>
  );

  async function locate() { setBusy(true); setHere(await getLocation()); setBusy(false); setStep(1); }

  async function send() {
    if (!photo) return;
    setBusy(true); setErr("");
    try {
      const path = `${session!.user.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("claim-photos").upload(path, await shrinkImage(photo, 1600), { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const r = await supabase.rpc("claim_place", { p_place: placeId, p_lat: here?.lat ?? null, p_lng: here?.lng ?? null, p_photo: path, p_role: role, p_phone: phone || null });
      if (r.error) throw r.error;
      setResult(String(r.data)); setStep(3);
    } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  }

  const slides = [
    <>
      <span className="icon-chip lg" style={{ margin: "0 auto" }}><Icon name="pin" size={26} /></span>
      <h2>Are you at {name || "the shop"} right now?</h2>
      <p className="small muted">We check once that you're near the shop. Only "near" or "far" is kept, never your location.</p>
      <button className="btn green block" disabled={busy} onClick={locate}><Icon name="navigate" size={18} />{busy ? "Checking…" : "Yes, check my location"}</button>
      <button className="btn ghost block" onClick={() => { setHere(null); setStep(1); }}>I'm not there now</button>
    </>,
    <>
      <span className="icon-chip lg sky" style={{ margin: "0 auto" }}><Icon name="camera" size={26} /></span>
      <h2>Take a photo of the shop front</h2>
      <p className="small muted">Show the name board if you can. Only our team sees it.</p>
      {preview && <img src={preview} alt="Shop front" className="cl-photo" />}
      <label className="btn green block">
        <Icon name="camera" size={18} />{photo ? "Retake photo" : "Open camera"}
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
          const f = e.target.files?.[0]; if (!f) return;
          setPhoto(f); setPreview(URL.createObjectURL(f));
        }} />
      </label>
      {photo && <button className="btn ghost block" onClick={() => setStep(2)}>Next<Icon name="chev" size={18} /></button>}
    </>,
    <>
      <span className="icon-chip lg violet" style={{ margin: "0 auto" }}><Icon name="user" size={26} /></span>
      <h2>Who are you at the shop?</h2>
      <div className="row wrap" style={{ gap: 8, justifyContent: "center" }}>
        {ROLES.map((r) => <button key={r} className={`chip ${role === r ? "on" : ""}`} onClick={() => setRole(r)}>{r}</button>)}
      </div>
      <div className="field"><label>Phone, so we can call if needed (optional)</label>
        <input className="input" inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} /></div>
      {err && <div className="notice err">{err}</div>}
      <button className="btn green block" disabled={busy} onClick={send}><Icon name="send" size={18} />{busy ? "Sending…" : "Send claim"}</button>
    </>,
    <>
      <span className="icon-chip lg" style={{ margin: "0 auto" }}><Icon name="check" size={26} /></span>
      <h2>{result === "owner" ? "You already own this shop" : "Claim sent"}</h2>
      <p className="small muted">{result === "access"
        ? "Someone already manages this shop. Our team will check and get back to you."
        : result === "owner" ? "Open Manage shop to set it up." : "We'll check the photo and switch on Manage shop for you, usually within a day."}</p>
      {result === "owner" && <Link to={`/manage/${placeId}`} className="btn green block"><Icon name="settings" size={18} />Manage shop</Link>}
      <Link to={`/p/${placeId}`} replace className="btn ghost block"><Icon name="eye" size={18} />Back to the shop</Link>
    </>,
  ];

  return (
    <div className="page">
      <TopBar back="/business" title="Claim your shop" sub={name || undefined} />
      {step < 3 && <div className="cl-dots" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map((i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>}
      <div className="card rv-gate center cl-slide" key={step}>{slides[step]}</div>
      {step > 0 && step < 3 && <button className="btn quiet" onClick={() => setStep((s) => (s - 1) as Step)}><Icon name="back" size={16} />Back</button>}
    </div>
  );
}
