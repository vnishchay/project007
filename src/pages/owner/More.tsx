import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { setAppMode } from "../../lib/ownerMode";
import { Icon, useConfirm, type IconName } from "../../components/ui";
import { useOwner, type Section } from "./OwnerApp";

/** My shop: everything set up once and changed now and then: the shop page, QR codes, plan and the account. */
export function More() {
  const { place, go, catalog, today } = useOwner();
  const { signOut, isAdmin } = useAuth();
  const nav = useNavigate();
  const confirm = useConfirm();

  const shop: { id: Section; icon: IconName; tone: string; label: string; sub: string }[] = [
    { id: "qr", icon: "qr", tone: "violet", label: "QR codes", sub: today ? `${today.qr_active} of ${today.qr_limit} on · print, download or share` : "Print, download or share" },
    { id: "menu", icon: "box", tone: "", label: catalog, sub: "Add things, or snap a photo of your menu" },
    { id: "look", icon: "camera", tone: "coral", label: "Photos", sub: "Cover photo and logo" },
    { id: "details", icon: "clock", tone: "amber", label: "Details and hours", sub: "Opening hours, map pin, phone" },
    { id: "links", icon: "link", tone: "sky", label: "Links", sub: "Instagram, website, delivery apps" },
  ];
  const business: { id: Section; icon: IconName; tone: string; label: string; sub: string }[] = [
    { id: "insights", icon: "chart", tone: "sky", label: "How you're doing", sub: "What people love and what to fix" },
    { id: "plan", icon: "crown", tone: "amber", label: "Plan and payment", sub: today?.plan_name ? `${today.plan_name}` : "Plans and payments" },
  ];

  async function out() {
    if (!(await confirm({ title: "Sign out?", ok: "Sign out" }))) return;
    await signOut();
    nav("/", { replace: true });
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Group title="Your shop page" rows={shop} onGo={(s) => go(s, { replace: false })} />
      <Group title="Plan and numbers" rows={business} onGo={(s) => go(s, { replace: false })} />
      <section className="stack" style={{ gap: 8 }}>
        <h2 className="ow-group-h">Account</h2>
        <div className="ow-card ow-list flush">
          <Link to={`/p/${place.id}`} className="ow-row"><span className="icon-chip sm"><Icon name="eye" size={16} /></span><span className="grow"><b>View my page</b></span><Icon name="external" size={16} color="var(--muted)" /></Link>
          <Link to="/owner?pick=1" className="ow-row"><span className="icon-chip sm sky"><Icon name="store" size={16} /></span><span className="grow"><b>All my shops</b></span><Icon name="chev" size={18} color="var(--muted)" /></Link>
          <Link to="/business/setup" className="ow-row"><span className="icon-chip sm amber"><Icon name="plus" size={16} /></span><span className="grow"><b>Add another business</b></span><Icon name="chev" size={18} color="var(--muted)" /></Link>
          {isAdmin
            ? <Link to="/admin" className="ow-row"><span className="icon-chip sm sky"><Icon name="shield" size={16} /></span><span className="grow"><b>Admin</b></span><Icon name="chev" size={18} color="var(--muted)" /></Link>
            : <Link to="/" className="ow-row" onClick={() => setAppMode("diner")}><span className="icon-chip sm coral"><Icon name="search" size={16} /></span><span className="grow stack tight"><b>Diner app</b><small className="muted">Find places and rate as a customer</small></span><Icon name="chev" size={18} color="var(--muted)" /></Link>}
          <Link to="/me" className="ow-row"><span className="icon-chip sm violet"><Icon name="user" size={16} /></span><span className="grow"><b>My profile</b></span><Icon name="chev" size={18} color="var(--muted)" /></Link>
          <button type="button" className="ow-row" onClick={out}><span className="icon-chip sm coral"><Icon name="logout" size={16} /></span><span className="grow"><b>Sign out</b></span></button>
        </div>
      </section>
      <nav className="biz-footer-nav">
        <Link to="/pricing">Pricing</Link><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/contact">Contact</Link>
      </nav>
    </div>
  );
}

function Group({ title, rows, onGo }: { title: string; rows: { id: Section; icon: IconName; tone: string; label: string; sub: string }[]; onGo: (s: Section) => void }) {
  return (
    <section className="stack" style={{ gap: 8 }}>
      <h2 className="ow-group-h">{title}</h2>
      <div className="ow-tiles">
        {rows.map((r) => (
          <button key={r.id} type="button" className="ow-tile" onClick={() => onGo(r.id)}>
            <span className={`icon-chip ${r.tone}`}><Icon name={r.icon} size={20} /></span>
            <span className="stack tight" style={{ minWidth: 0 }}><b>{r.label}</b><small className="muted">{r.sub}</small></span>
          </button>
        ))}
      </div>
    </section>
  );
}
