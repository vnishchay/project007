import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { loadPlans, type PlanRow } from "../lib/billing";
import { Icon, TopBar, type IconName } from "../components/ui";

// Pages Razorpay asks for before going live: pricing, terms, refunds, privacy, contact.
const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || "";
const BUSINESS = (import.meta.env.VITE_LEGAL_NAME as string | undefined) || "Trusted Picks";
const UPDATED = "17 October 2026";

function Doc({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <div className="page">
      <TopBar title={title} />
      <article className="card legal stack" style={{ gap: 12 }}>
        <span className="icon-chip lg"><Icon name={icon} size={26} /></span>
        {children}
        <p className="tiny muted">Last updated {UPDATED}.</p>
        <nav className="row wrap tiny" style={{ gap: 12 }}>
          <Link to="/pricing">Pricing</Link><Link to="/terms">Terms</Link><Link to="/refunds">Refunds</Link>
          <Link to="/privacy">Privacy</Link><Link to="/contact">Contact</Link>
        </nav>
      </article>
    </div>
  );
}
const Mail = () => CONTACT ? <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : <Link to="/contact">our contact page</Link>;

export function Pricing() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  useEffect(() => { loadPlans().then(setPlans); }, []);
  return (
    <Doc title="Pricing" icon="rupee">
      <h2>Free to list. Pay only for review QRs.</h2>
      <p>Every business gets a free page and a free trial: 1 review QR for 30 days or 25 reviews, whichever comes first.
        After that, pick a plan. If a plan ends, your page and QRs keep working; only new reviews pause until you renew.</p>
      <div className="legal-table-wrap">
        <table className="legal-table">
          <thead><tr><th>Plan</th><th>Review QRs</th><th>Yearly</th><th>Monthly</th></tr></thead>
          <tbody>{plans.map((p) => (
            <tr key={p.code}><td><b>{p.name}</b></td><td>{p.qr_limit}</td>
              <td>{p.price_inr_year ? `₹${p.price_inr_year.toLocaleString("en-IN")}` : "Free"}</td>
              <td>{p.price_inr_month ? `₹${p.price_inr_month.toLocaleString("en-IN")}` : "Free"}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className="small muted">Prices include all fees charged by us. Each payment covers one month or one year. Nothing renews automatically, so there's nothing to cancel.</p>
      <Link to="/business" className="btn green block" style={{ marginTop: 8 }}><Icon name="store" size={18} />List your business</Link>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Terms" icon="list">
      <h2>Terms of use</h2>
      <p>Trusted Picks is run by {BUSINESS}. By using it you agree to these terms.</p>
      <h3>Reviews</h3>
      <p>Reviews must be your own honest experience. Businesses may not pay, reward or pressure anyone for a review, write reviews of their own business, or ask only happy customers to review. We may remove reviews or accounts that break these rules.</p>
      <h3>Business plans</h3>
      <p>Plans are paid in advance for one month or one year and give the number of review QRs shown on the <Link to="/pricing">pricing page</Link>. Plans do not renew automatically. If a plan ends, new reviews pause; the business page stays up.</p>
      <h3>Google</h3>
      <p>Trusted Picks is not part of Google. We never post to Google for you; you choose whether to copy your review there yourself.</p>
      <h3>Business details</h3>
      <p>Some business details (names, opening hours, contact links) come from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> under the Open Database License, some from Google Maps, and some shop photos from Wikimedia Commons or Google Maps, credited on the shop page. Owners can claim their shop and correct anything.</p>
      <h3>Liability</h3>
      <p>The service is provided as is. Our total liability for any claim is limited to what you paid us in the last 12 months.</p>
      <p>Questions: <Mail />.</p>
    </Doc>
  );
}

export function Refunds() {
  return (
    <Doc title="Refunds" icon="wallet">
      <h2>Cancellation and refunds</h2>
      <p>Plans are one-off payments, so there's no subscription to cancel.</p>
      <p>If you're not happy, ask for a full refund within 7 days of paying and we'll send it back to the original payment method. After 7 days we refund the unused whole months of a yearly plan on request.</p>
      <p>Refunds reach your account within 5 to 7 working days after we approve them. Write to <Mail /> with your shop name and the payment date.</p>
    </Doc>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy" icon="lock">
      <h2>Privacy</h2>
      <p>We collect as little as we can and never sell data.</p>
      <ul>
        <li>Reviews are anonymous unless you choose to show your name. Anonymous reviews show only a rough date.</li>
        <li>Nobody, including shop owners and friends, can see which review is yours unless you posted it with your name.</li>
        <li>When you scan a shop's QR code, that shop sees your profile name and photo (or "Guest"), when you visited and which table. It never sees your email, phone or location, and it can't link you to a review. The shop can send you offers in the app. You can hide from a shop, or stop its offers, with one tap on its scan page or any of its offers.</li>
        <li>Other people and other shops never see where you've been.</li>
        <li>When you scan a QR we may check if you're near the shop. We keep only "near" or "far", never your location.</li>
        <li>No ad trackers. Signing in is optional.</li>
        <li>Payments are handled by Razorpay. We never see or store card or UPI details.</li>
        <li>You can delete your reviews and account at any time.</li>
      </ul>
      <p>Questions or deletion requests: <Mail />.</p>
    </Doc>
  );
}

export function Contact() {
  return (
    <Doc title="Contact" icon="message">
      <h2>Contact us</h2>
      <p>{BUSINESS}</p>
      {CONTACT ? <p>Email: <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p> : <p className="muted">Email address coming soon.</p>}
      <p className="small muted">We reply within 2 working days.</p>
    </Doc>
  );
}
