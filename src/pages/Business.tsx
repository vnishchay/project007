import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/settings";
import { STATUS_WORDS, initials } from "../lib/util";
import { Icon, TopBar, type IconName } from "../components/ui";
import { MediaImg } from "../components/manage/MediaImg";
import { loadPlans, type PlanRow } from "../lib/billing";
import "../styles/manage.css";

interface Found { id: string; name: string; area: string | null; city: string }

const GAINS: [IconName, string, string, string][] = [
  ["food", "", "Help people choose", "Show your menu, item prices and what reviewers liked. Customers can shortlist what they want to try."],
  ["people", "violet", "Recommendations with context", "Friends' named recommendations add a familiar perspective when those reviews are available."],
  ["star", "amber", "Honest feedback, item by item", "Learn which dishes or services customers liked. Every rating gets the same optional route to Google."],
  ["message", "", "Follow through on problems", "Assign help requests, record the action and let the customer confirm the fix or ask for more help."],
  ["bell", "violet", "Table calls", "Call staff, ask for the bill, all from the table QR, with a live board for you."],
  ["gift", "amber", "Give them a reason to return", "Run deals, visit-based stamp cards and personal in-app offers. Rewards never depend on leaving a review."],
];

const PROMISES: [IconName, string][] = [
  ["shield", "Reviews require a QR or shop-link visit. Verification labels show the available visit evidence."],
  ["refresh", "Nothing renews on its own. Pay for a month or a year, that's it."],
  ["lock", "We never text or spam your customers."],
  ["store", "Your page stays up even if your plan ends."],
];

const FAQ: [string, string][] = [
  ["Is it really free to start?", "Yes. Listing is free and you get 1 review QR free for 30 days or 25 reviews, whichever comes first."],
  ["My shop is already on Trusted Picks. How?", "We list popular local places from public maps so diners can find them. Claim it for free to edit details, add your menu and get review QRs."],
  ["Do I need an app or a tablet?", "No. Print the QR, put it on the table or counter. Diners scan with their phone camera. You manage everything from your phone."],
  ["Does it post to Google for me?", "No, Google doesn't allow that. Diners can copy their own review to Google in one tap if they want."],
  ["How do I pay?", "UPI, cards or netbanking through Razorpay. You get a receipt by email."],
];

interface MyPlace { id: string; name: string; area: string | null; city: string; status: string; listed_until: string | null; cover_path: string | null; logo_path: string | null; verification?: string; verification_note?: string | null }

export default function Business() {
  const { session } = useAuth();
  const [shops, setShops] = useState<MyPlace[]>([]);

  const load = () => {
    if (!session) return;
    supabase.rpc("my_places").then(({ data, error }) => { if (!error) setShops((data as MyPlace[]) || []); });
  };
  useEffect(load, [session]);

  const [plans, setPlans] = useState<PlanRow[]>([]);
  useEffect(() => { loadPlans().then(setPlans); }, []);

  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  useEffect(() => {
    const term = q.trim().replace(/[%_,()]/g, " ");
    let alive = true;
    setFound(null); setSearchError(false);
    if (term.length < 3) { setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      supabase.from("places").select("id, name, area, city").ilike("name", `%${term}%`).order("name").limit(6)
        .then(({ data, error }) => { if (alive) { setSearching(false); setSearchError(Boolean(error)); setFound(error ? null : (data as Found[]) || []); } }, () => { if (alive) { setSearching(false); setSearchError(true); } });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const startUrl = session ? "/business/setup" : "/signin?next=/business/setup";

  const support = String(useSettings()[0].support_phone || "").replace(/\D/g, "");
  return (
    <div className="page">
      <TopBar title="For businesses" />

      <div className="biz-hero">
        <div className="biz-hero-art" aria-hidden="true">
          <span><Icon name="store" size={22} color="#fff" /></span><span><Icon name="star" size={22} color="#fff" fill="#fff" /></span>
          <span><Icon name="qr" size={22} color="#fff" /></span><span><Icon name="people" size={22} color="#fff" /></span>
        </div>
        <span className="biz-hero-pills"><span><Icon name="food" size={13} />Discovery & feedback</span><span><Icon name="gift" size={13} />Service & loyalty</span></span>
        <h1>Make every visit worth coming back for</h1>
        <p>Help people choose your best, look after them during their visit, and give them a reason to return. One connected experience for your customers and your team.</p>
        <Link to={startUrl} className="btn small"><Icon name="plus" size={17} />Set up my shop</Link>
      </div>

      {shops.length > 0 && (
        <div className="stack">
          <div className="section-title"><span className="icon-chip sm"><Icon name="store" size={16} /></span>Your shops</div>
          {shops.map((s) => {
            return (
              <Link key={s.id} to={`/owner/${s.id}`} className="biz-shop">
                <span className="thumb"><MediaImg path={s.logo_path || s.cover_path} fallback={initials(s.name)} /></span>
                <span className="grow stack tight">
                  <span className="strong ellipsis">{s.name}</span>
                  <span className="mg-meta">{[s.area, s.city].filter(Boolean).join(" · ")}<span className={`badge ${s.status === "live" ? "" : s.status === "lapsed" ? "warn" : "red"}`}>{STATUS_WORDS[s.status] || s.status}</span>
                    {s.verification === "pending" && <span className="badge gray">We're checking your details</span>}</span>
                  {s.verification === "rejected" && <span className="tiny" style={{ color: "var(--danger)" }}>Not approved{s.verification_note ? `: ${s.verification_note}` : ""}</span>}
                </span>
                <span className="icon-chip sm"><Icon name="edit" size={15} /></span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="biz-steps">
        {([
          ["food", "", "Choose with confidence", "A useful menu, item recommendations and a personal shortlist"],
          ["message", "amber", "Enjoy the visit", "Table service and trackable help, without requiring a public review"],
          ["gift", "violet", "Keep the relationship going", "Honest feedback, visit-based rewards and relevant offers"],
        ] as [IconName, string, string, string][]).map(([icon, cls, t, s], i) => (
          <div key={t} className="biz-step">
            <span className="num">{i + 1}</span>
            <span className={`icon-chip lg ${cls}`}><Icon name={icon} size={22} /></span>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
              <span className="t">{t}</span>
              <span className="s">{s}</span>
            </div>
          </div>
        ))}
      </div>

      <section className="card stack" style={{ gap: 12 }} aria-label="How the service works">
        <h2>Start with one outlet. See the whole journey.</h2>
        <p className="small">Add your menu, put your QR where customers can use it, and choose who checks table calls and help requests. Customers can browse before they sign in; their reviews and rewards remain separate.</p>
        <p className="small muted">Your owner app brings together recorded scans, item feedback, customer help and offer redemptions. Review the results and costs before deciding what to expand. Customer help and private notes stay accessible on every plan.</p>
        <Link to="/demo" className="btn ghost"><Icon name="eye" size={17} />Explore a sample shop</Link>
      </section>
      <div className="card stack biz-find">
        <div className="section-title"><span className="icon-chip sm"><Icon name="search" size={16} /></span>Already on Trusted Picks?</div>
        <p className="small muted">Many local places are listed already. Find yours and claim it for free.</p>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Your shop's name" aria-label="Find your shop" />
        {searching && <p className="small muted" role="status">Finding matching shops…</p>}
        {searchError && <p className="notice warn" role="alert">We could not search right now. Try editing the name, or come back shortly before creating another listing.</p>}
        {found && (found.length ? found.map((f) => (
          <Link key={f.id} to={`/claim/${f.id}`} className="biz-found">
            <span className="grow stack tight"><span className="strong ellipsis">{f.name}</span><span className="tiny muted">{[f.area, f.city].filter(Boolean).join(" · ")}</span></span>
            <span className="badge">Claim</span>
          </Link>
        )) : <p className="small muted">Not found. <Link to={startUrl}>List it in 2 minutes</Link>.</p>)}
      </div>

      <div className="section-title"><span className="icon-chip sm"><Icon name="spark" size={16} /></span>What you get</div>
      <div className="biz-gains">
        {GAINS.map(([icon, cls, t, s]) => (
          <div key={t} className="biz-gain">
            <span className={`icon-chip ${cls}`}><Icon name={icon} size={20} /></span>
            <span className="t">{t}</span>
            <span className="s">{s}</span>
          </div>
        ))}
      </div>
      <Link to="/demo" className="btn block ghost"><Icon name="eye" size={18} />See a sample shop</Link>

      {plans.length > 0 && (<>
        <div className="section-title"><span className="icon-chip sm"><Icon name="rupee" size={16} /></span>Simple prices</div>
        <div className="biz-prices">
          {plans.map((p) => (
            <div key={p.code} className="biz-price">
              <span className="strong">{p.name}</span>
              <span><span className="amt">{p.price_inr_month ? `₹${p.price_inr_month.toLocaleString("en-IN")}` : "Free"}</span>{p.price_inr_month ? <span className="per"> /month</span> : null}</span>
              {p.price_inr_year ? <span className="tiny muted">or ₹{p.price_inr_year.toLocaleString("en-IN")} a year</span> : null}
              <ul>{[`${p.qr_limit} review QR${p.qr_limit === 1 ? "" : "s"}`, ...p.features.filter((f) => !/review qr/i.test(f))].slice(0, 4).map((f) => <li key={f}><Icon name="check" size={13} />{f}</li>)}</ul>
            </div>
          ))}
        </div>
      </>)}

      <div className="card stack biz-promises">
        {PROMISES.map(([icon, t]) => <div key={t} className="row"><span className="icon-chip sm"><Icon name={icon} size={15} /></span><span className="small">{t}</span></div>)}
      </div>

      <div className="section-title"><span className="icon-chip sm"><Icon name="info" size={16} /></span>Questions</div>
      <div className="stack biz-faq">
        {FAQ.map(([qq, a]) => <details key={qq} className="card"><summary className="strong">{qq}</summary><p className="small muted">{a}</p></details>)}
      </div>

      <Link to={startUrl} className="btn block green"><Icon name="plus" size={18} />List my shop free</Link>

      {support && (
        <a className="btn block ghost" href={`https://wa.me/${support}`} target="_blank" rel="noopener noreferrer"><Icon name="message" size={18} />Questions? WhatsApp us</a>
      )}

      <nav className="biz-footer-nav">
        <Link to="/pricing">Pricing</Link><Link to="/terms">Terms</Link><Link to="/refunds">Refunds</Link><Link to="/privacy">Privacy</Link><Link to="/contact">Contact</Link>
      </nav>
    </div>
  );
}
