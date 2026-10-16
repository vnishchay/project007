import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { upiLink, useSettings } from "../lib/settings";
import type { ListingRequest, QrStyle } from "../lib/types";
import { copyText, extractPlaceId, QR_STYLES, rupees, timeAgo } from "../lib/util";
import type { AppSettings } from "../lib/settings";
import { Icon, QrImage, TopBar, useToast } from "../components/ui";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Waiting for payment", cls: "warn" },
  paid: { label: "Paid, being reviewed", cls: "gray" },
  approved: { label: "Live", cls: "" },
  declined: { label: "Declined", cls: "red" },
};

export default function Business() {
  const { session } = useAuth();
  const toast = useToast();
  const [settings] = useSettings();
  const [mine, setMine] = useState<ListingRequest[]>([]);
  const [form, setForm] = useState({ business_name: "", category: "", area: "", city: "", phone: "", google_place_id: "", note: "" });
  const [wantsQr, setWantsQr] = useState(true);
  const [style, setStyle] = useState<QrStyle>("paper");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => {
    if (!session) return;
    supabase.from("listing_requests").select("*").eq("requester_id", session.user.id).order("created_at", { ascending: false })
      .then(({ data }) => setMine((data as ListingRequest[]) || []));
  };
  useEffect(load, [session]);

  const total = settings.listing_price_inr + (wantsQr ? settings.qr_price_inr : 0);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) { setErr("Enter a full phone number so we can reach you."); return; }
    setBusy(true); setErr("");
    // A Maps link without a Place ID goes in the note for the team to look up.
    const raw = form.google_place_id.trim();
    const placeId = extractPlaceId(raw);
    const note = [form.note.trim(), raw && !placeId ? `Google Maps link: ${raw}` : ""].filter(Boolean).join("\n");
    const { error } = await supabase.from("listing_requests").insert({
      requester_id: session!.user.id,
      business_name: form.business_name.trim(), category: form.category.trim(), area: form.area.trim() || null,
      city: form.city.trim(), phone: form.phone.trim(), google_place_id: placeId,
      note: note || null, wants_qr: wantsQr, qr_style: wantsQr ? style : null,
    });
    setBusy(false);
    if (error) { setErr(errorText(error)); return; }
    toast("Request sent");
    setForm({ business_name: "", category: "", area: "", city: "", phone: "", google_place_id: "", note: "" });
    load();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="page">
      <TopBar title="List your business" />
      <div className="stack" style={{ gap: 6 }}>
        <h1>Get your best dishes found</h1>
        <p className="muted">Customers rate the exact things they had, friends see it, and you get honest feedback item by item.</p>
      </div>

      <div className="grid2">
        <div className="card soft" style={{ gap: 4 }}>
          <span className="tiny strong muted">Listing</span>
          <span style={{ fontWeight: 800, fontSize: 24 }}>{rupees(settings.listing_price_inr)}<span className="small muted"> / year</span></span>
          <span className="tiny muted">Place page, reviews, ranking in search</span>
        </div>
        <div className="card soft" style={{ gap: 4 }}>
          <span className="tiny strong muted">Table QR</span>
          <span style={{ fontWeight: 800, fontSize: 24 }}>{rupees(settings.qr_price_inr)}<span className="small muted"> once</span></span>
          <span className="tiny muted">Printable codes for every table, verified reviews</span>
        </div>
      </div>

      {mine.length > 0 && (
        <div className="stack">
          <h2>Your requests</h2>
          {mine.map((r) => <RequestCard key={r.id} r={r} settings={settings} onCopied={() => toast("UPI ID copied")} />)}
        </div>
      )}

      {!session ? (
        <div className="card">
          <p>Sign in first so we can keep you updated on your listing.</p>
          <Link to="/signin?next=/business" className="btn block">Sign in to continue</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <h2>{mine.length ? "List another business" : "Tell us about your business"}</h2>
          <div className="field"><label htmlFor="bn">Business name</label><input id="bn" className="input" required value={form.business_name} onChange={set("business_name")} placeholder="Forno Napoli" /></div>
          <div className="grid2">
            <div className="field"><label htmlFor="cat">Category</label><input id="cat" className="input" required value={form.category} onChange={set("category")} placeholder="Pizzeria" /></div>
            <div className="field"><label htmlFor="ph">Phone</label><input id="ph" className="input" required type="tel" value={form.phone} onChange={set("phone")} placeholder="98xxxxxxxx" /></div>
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="ar">Area</label><input id="ar" className="input" value={form.area} onChange={set("area")} placeholder="Koregaon Park" /></div>
            <div className="field"><label htmlFor="ct">City</label><input id="ct" className="input" required value={form.city} onChange={set("city")} placeholder="Pune" /></div>
          </div>
          <div className="field">
            <label htmlFor="gp">Google Maps link or Place ID (optional)</label>
            <input id="gp" className="input" value={form.google_place_id} onChange={set("google_place_id")} placeholder="Paste your Google Maps link" />
            <span className="tiny muted">Lets customers post their review on Google in one tap. If your link has no Place ID, we look it up for you.</span>
          </div>
          <div className="field"><label htmlFor="nt">Anything else (optional)</label><textarea id="nt" className="textarea" style={{ minHeight: 70 }} value={form.note} onChange={set("note")} placeholder="Number of tables, best time to call…" /></div>

          <label className="card row" style={{ cursor: "pointer", flexDirection: "row" }}>
            <input type="checkbox" checked={wantsQr} onChange={(e) => setWantsQr(e.target.checked)} style={{ width: 20, height: 20, accentColor: "var(--green)" }} />
            <span className="grow"><b>Add table QR codes</b><br /><span className="small muted">{rupees(settings.qr_price_inr)} one time</span></span>
          </label>
          {wantsQr && (
            <div className="stack">
              <span className="small strong">QR style</span>
              <div className="grid2" role="radiogroup" aria-label="QR style">
                {(Object.keys(QR_STYLES) as QrStyle[]).map((k) => {
                  const st = QR_STYLES[k];
                  return (
                    <button type="button" key={k} role="radio" aria-checked={style === k} onClick={() => setStyle(k)} className="card"
                      style={{ alignItems: "center", cursor: "pointer", background: st.light, color: st.light === "#FFFFFF" ? "var(--ink)" : "#fff", borderColor: style === k ? "var(--green)" : "var(--line)", borderWidth: style === k ? 2 : 1, padding: 12 }}>
                      <QrImage text={`${window.location.origin}/q/preview`} size={72} dark={st.dark} light={st.light} />
                      <span className="small strong">{st.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {err && <div className="notice err">{err}</div>}
          <button className="btn block" disabled={busy}>{busy ? "Sending…" : `Request listing · ${rupees(total)}`}</button>
          <p className="tiny muted center">You pay after sending the request. We list you once payment is confirmed.</p>
        </form>
      )}
    </div>
  );
}

function RequestCard({ r, settings, onCopied }: { r: ListingRequest; settings: AppSettings; onCopied: () => void }) {
  const st = STATUS[r.status]!;
  const ref = `TP-${r.id.slice(0, 8).toUpperCase()}`;
  const upi = upiLink(settings, r.amount_inr, `${ref} ${r.business_name}`.slice(0, 50));
  return (
    <div className="card">
      <div className="row between"><span className="strong">{r.business_name}</span><span className={`badge ${st.cls}`}>{st.label}</span></div>
      <span className="small muted">{[r.category, r.area, r.city].filter(Boolean).join(" · ")} · {rupees(r.amount_inr)} · sent {timeAgo(r.created_at)}</span>
      {r.status === "pending" && (
        upi ? (
          <div className="stack">
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              <QrImage text={upi} size={110} />
              <div className="stack tight small">
                <span>Pay <b>{rupees(r.amount_inr)}</b> by UPI to <b>{settings.upi_id}</b></span>
                <span className="muted">Reference <b>{ref}</b>. We confirm and list you after payment arrives.</span>
              </div>
            </div>
            <div className="row">
              <a className="btn small green" href={upi}>Pay with UPI app</a>
              <button type="button" className="btn small ghost" onClick={async () => { if (await copyText(settings.upi_id)) onCopied(); }}><Icon name="copy" size={16} />Copy UPI ID</button>
            </div>
          </div>
        ) : <p className="small muted">We'll call you on {r.phone} to collect payment. Reference <b>{ref}</b>.</p>
      )}
      {r.status === "approved" && r.place_id && <Link to={`/p/${r.place_id}`} className="link-btn">See your live page</Link>}
      {settings.support_phone && r.status !== "approved" && <a className="small" href={`https://wa.me/${settings.support_phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi, about my listing ${ref}`)}`} target="_blank" rel="noreferrer">Message us on WhatsApp</a>}
    </div>
  );
}
