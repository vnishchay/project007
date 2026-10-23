import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { lastShop, setAppMode, useMyShops } from "../../lib/ownerMode";
import { STATUS_WORDS, initials } from "../../lib/util";
import { Icon, Spinner } from "../../components/ui";
import { MediaImg } from "../../components/manage/MediaImg";
import { SECTION_OF } from "./OwnerApp";
import type { ManageTab } from "../../components/manage/Insights";
import "../../styles/owner.css";

/**
 * /owner: opens the shop the owner used last (or their only shop). With ?pick=1, or several shops and
 * none used yet, it lists them. Someone with no shop gets a way to list one.
 */
export default function OwnerStart() {
  const shops = useMyShops();
  const [params] = useSearchParams();
  const { isAdmin } = useAuth();
  const pick = params.get("pick") === "1";

  if (shops === undefined) return <div className="ow"><div className="ow-main"><main className="ow-content"><Spinner /></main></div></div>;
  if (!pick && shops.length > 0) {
    const last = lastShop();
    const to = shops.find((s) => s.id === last) ?? (shops.length === 1 ? shops[0] : null);
    if (to) return <Navigate to={`/owner/${to.id}`} replace />;
  }

  return (
    <div className="ow ow-start">
      <div className="ow-main">
        <main className="ow-content narrow">
          <div className="ow-brand big"><span className="ow-brand-mark"><Icon name="store" size={22} /></span><span className="stack tight"><b>Trusted Picks</b><small>Owner app</small></span></div>
          {shops.length === 0 ? (
            <section className="ow-card ow-empty">
              <span className="icon-chip lg"><Icon name="store" size={26} /></span>
              <h1>Run your shop from here</h1>
              <p className="small muted">List your business to see today's visitors, reply to reviews, run deals and print your review QR codes.</p>
              <Link to="/business/setup" className="btn green"><Icon name="plus" size={18} />List my business</Link>
            </section>
          ) : (
            <section className="stack" style={{ gap: 10 }}>
              <h1 className="ow-start-h">Pick a shop</h1>
              <div className="ow-card ow-list flush">
                {shops.map((s) => (
                  <Link key={s.id} to={`/owner/${s.id}`} replace className="ow-row">
                    <span className="ow-shop-logo"><MediaImg path={s.logo_path || s.cover_path} fallback={initials(s.name)} /></span>
                    <span className="grow stack tight" style={{ minWidth: 0 }}>
                      <b className="ellipsis">{s.name}</b>
                      <small className="muted ellipsis">{[s.area, s.city].filter(Boolean).join(" · ")} · {STATUS_WORDS[s.status] || s.status}{s.verification === "pending" ? " · being checked" : ""}</small>
                    </span>
                    <Icon name="chev" size={18} color="var(--muted)" />
                  </Link>
                ))}
                <Link to="/business/setup" className="ow-row"><span className="icon-chip sm amber"><Icon name="plus" size={16} /></span><span className="grow"><b>Add another business</b></span><Icon name="chev" size={18} color="var(--muted)" /></Link>
              </div>
            </section>
          )}
          <div className="row wrap" style={{ justifyContent: "center", gap: 8 }}>
            {isAdmin
              ? <Link to="/admin" className="btn ghost small"><Icon name="shield" size={16} />Admin</Link>
              : <Link to="/" className="btn ghost small" onClick={() => setAppMode("diner")}><Icon name="search" size={16} />Diner app</Link>}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Old /manage/:id?tab=… links (emails, bookmarks, the shop page) open the same screen in the owner app. */
export function ManageRedirect() {
  const { placeId = "" } = useParams();
  const [params] = useSearchParams();
  const section = SECTION_OF[params.get("tab") as ManageTab] ?? "";
  return <Navigate to={`/owner/${placeId}${section && section !== "insights" ? `/${section}` : ""}`} replace />;
}
