import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { isUuid, type Place, type QrCode } from "../../lib/types";
import { goBack } from "../../lib/nav";
import { modeOf } from "../../lib/modes";
import { usePin } from "../../lib/pin";
import { setAppMode, setLastShop } from "../../lib/ownerMode";
import { Icon, Spinner, type IconName } from "../../components/ui";
import { MediaImg } from "../../components/manage/MediaImg";
import { ShopHeader } from "../../components/manage/ShopHeader";
import { Products } from "../../components/manage/Products";
import { ShopDetails } from "../../components/manage/ShopDetails";
import { QrPrintSheet, ShopQr } from "../../components/manage/ShopQr";
import { Insights, type ManageTab } from "../../components/manage/Insights";
import { LinksEditor } from "../../components/manage/LinksEditor";
import { Messages, type Audience } from "../../components/manage/Messages";
import { Visitors } from "../../components/manage/Visitors";
import { Deals } from "../../components/manage/Deals";
import { ReviewsTab } from "../../components/manage/ReviewsTab";
import { GoogleConnect } from "../../components/manage/GoogleConnect";
import { ShareKit } from "../../components/manage/ShareKit";
import { Plan } from "../../components/manage/Plan";
import { Locked, RecheckBanner } from "../../components/owner/ShopGate";
import { Today, type OwnerToday } from "./Today";
import { More } from "./More";
import "../../styles/manage.css";
import "../../styles/owner.css";

const COLS = "id, google_place_id, name, kind, category, area, city, about, hours, price_level, status, listed_until, created_at, cover_path, logo_path, currency";

/** Screens of the owner app. "" is Today. */
export type Section = "" | "reviews" | "customers" | "deals" | "messages" | "more" | "menu" | "details" | "links" | "qr" | "plan" | "insights" | "look";
const SECTIONS: Section[] = ["", "reviews", "customers", "deals", "messages", "more", "menu", "details", "links", "qr", "plan", "insights", "look"];

/** The old Manage page ids, as the shared panels still use them. */
export const SECTION_OF: Record<ManageTab, Section> = {
  insights: "insights", plan: "plan", reviews: "reviews", visitors: "customers", deals: "deals",
  updates: "messages", products: "menu", details: "details", links: "links", qr: "qr",
};

/** Bottom tabs on phones, first block of the sidebar on desktop. Offers covers deals and messages. */
const TABS: { id: Section; label: string; icon: IconName; also?: Section[] }[] = [
  { id: "", label: "Today", icon: "dashboard" },
  { id: "reviews", label: "Reviews", icon: "star" },
  { id: "customers", label: "Customers", icon: "people" },
  { id: "deals", label: "Offers", icon: "ticket", also: ["messages"] },
  { id: "more", label: "More", icon: "grid" },
];

interface OwnerCtx {
  place: Place;
  today: OwnerToday | null | undefined;
  reloadToday: () => void;
  go: (s: Section, opts?: { replace?: boolean }) => void;
  goTab: (t: ManageTab) => void;
  catalog: string;
}
const Ctx = createContext<OwnerCtx | null>(null);
export const useOwner = () => useContext(Ctx)!;

export default function OwnerApp() {
  const { placeId = "", section: raw = "" } = useParams();
  const section = (SECTIONS.includes(raw as Section) ? raw : "") as Section;
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [today, setToday] = useState<OwnerToday | null | undefined>(undefined);
  const [todayN, setTodayN] = useState(0);
  const [codes, setCodes] = useState<QrCode[]>([]);
  const [count, setCount] = useState<number | null>(null);
  // Visitors picked for an offer, kept while moving between Customers and Messages.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [audience, setAudience] = useState<Audience>("update");
  const [sentN, setSentN] = useState(0);
  const pinState = usePin(placeId, place?.google_place_id);

  useEffect(() => {
    if (!isUuid(placeId)) { setAllowed(false); setPlace(null); return; }
    let alive = true;
    setErr("");
    (async () => {
      const can = await supabase.rpc("can_manage_place", { p_place: placeId });
      if (!alive) return;
      const ok = can.error ? (can.error.code === "PGRST202" ? isAdmin : null) : Boolean(can.data);
      if (ok === null) { setErr(errorText(can.error)); return; }
      setAllowed(ok);
      if (!ok) return;
      let res = await supabase.from("places").select(`${COLS}, links, verification`).eq("id", placeId).maybeSingle();
      if (res.error?.code === "42703") res = await supabase.from("places").select(COLS.replace(" kind,", "")).eq("id", placeId).maybeSingle();
      if (!alive) return;
      if (res.error) setErr(errorText(res.error));
      setPlace((res.data as Place) ?? null);
    })();
    return () => { alive = false; };
  }, [placeId, isAdmin, attempt]);

  // Opening the owner app makes it the app this person lands in.
  useEffect(() => { if (allowed && !isAdmin) { setAppMode("owner"); setLastShop(placeId); } }, [allowed, isAdmin, placeId]);

  // Today's numbers: fetched on open, when coming back to Today, and when the phone comes back to the app.
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    supabase.rpc("owner_today", { p_place: placeId }).then(({ data, error }) => {
      if (alive) setToday(error ? null : ((data as OwnerToday | null) ?? null));
    });
    return () => { alive = false; };
  }, [allowed, placeId, todayN, section === ""]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === "visible") setTodayN((x) => x + 1); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);

  const go = useCallback((s: Section, opts?: { replace?: boolean }) => {
    const tab = TABS.some((t) => t.id === s || t.also?.includes(s));
    nav(`/owner/${placeId}${s ? `/${s}` : ""}`, { replace: opts?.replace ?? tab });
  }, [nav, placeId]);
  const goTab = useCallback((t: ManageTab) => go(SECTION_OF[t], { replace: false }), [go]);
  const onCount = useCallback((n: number) => setCount(n), []);

  if (err) return (
    <OwnerFrame>
      <div className="notice err row"><span className="grow">{err}</span><button className="link-btn" onClick={() => setAttempt((x) => x + 1)}><Icon name="refresh" size={15} />Retry</button></div>
    </OwnerFrame>
  );
  if (allowed === false) return <Locked />;
  if (allowed === undefined || place === undefined) return <OwnerFrame><Spinner /></OwnerFrame>;
  if (!place) return (
    <OwnerFrame>
      <div className="empty"><span className="icon-chip lg"><Icon name="store" size={26} /></span><h2>Shop not found</h2><Link to="/owner?pick=1" className="btn ghost small">Your shops</Link></div>
    </OwnerFrame>
  );

  const merge = (p: Partial<Place>) => setPlace((x) => (x ? { ...x, ...p } : x));
  const mode = modeOf(place.kind, place.category);
  const live = place.status === "live";
  const ctx: OwnerCtx = { place, today, reloadToday: () => setTodayN((x) => x + 1), go, goTab, catalog: mode.catalog };

  const banners = (
    <>
      {(place.status === "removed" || place.verification === "rejected") && <RecheckBanner placeId={place.id} />}
      {pinState.pin && !pinState.pin.has_pin && !pinState.syncing && section !== "details" && (
        <button type="button" className="callout amber ow-banner" onClick={() => go("details", { replace: false })}>
          <span className="icon-chip sm amber"><Icon name="pin" size={16} /></span>
          <span className="grow small"><b>Add your map pin.</b> People nearby can't find you until you do.</span>
          <Icon name="chev" size={18} />
        </button>
      )}
    </>
  );

  let title = "";
  let body: ReactNode = null;
  switch (section) {
    case "":
      body = <Today hasPin={pinState.pin ? pinState.pin.has_pin : null} />;
      break;
    case "reviews":
      title = "Reviews";
      body = <ReviewsTab placeId={place.id} placeName={place.name} live={live} onGo={goTab} />;
      break;
    case "customers":
      title = "Customers";
      body = <Visitors placeId={place.id} picked={picked} setPicked={setPicked} reload={sentN} onWrite={() => { setAudience("offer"); go("messages", { replace: false }); }} />;
      break;
    case "deals":
    case "messages":
      title = "Offers";
      body = (
        <>
          <div className="ow-seg" role="tablist" aria-label="Offers">
            <button type="button" role="tab" aria-selected={section === "deals"} className={section === "deals" ? "on" : ""} onClick={() => go("deals")}><Icon name="ticket" size={17} />Deals and stamps</button>
            <button type="button" role="tab" aria-selected={section === "messages"} className={section === "messages" ? "on" : ""} onClick={() => go("messages")}>
              <Icon name="send" size={17} />Messages{picked.size > 0 && <span className="badge" style={{ marginLeft: 4 }}>{picked.size}</span>}
            </button>
          </div>
          {section === "deals"
            ? <Deals placeId={place.id} currency={place.currency} live={live} />
            : <Messages placeId={place.id} placeName={place.name} logoPath={place.logo_path ?? null} live={live}
                audience={audience} onAudience={setAudience} picked={[...picked]} onPick={() => { setAudience("offer"); go("customers"); }}
                onSent={() => { if (audience === "offer") setPicked(new Set()); setSentN((x) => x + 1); setTodayN((x) => x + 1); }} />}
        </>
      );
      break;
    case "more":
      title = "More";
      body = <More />;
      break;
    case "menu":
      title = count ? `${mode.catalog} (${count})` : mode.catalog;
      body = <Products placeId={place.id} isAdmin={isAdmin} mode={mode} links={place.links ?? []} currency={place.currency} onCount={onCount} />;
      break;
    case "look":
      title = "Photos and look";
      body = <ShopHeader place={place} onChange={merge} />;
      break;
    case "details":
      title = "Details and hours";
      body = <><GoogleConnect place={place} isAdmin={isAdmin} onSaved={merge} /><ShopDetails place={place} isAdmin={isAdmin} onSaved={merge} pinState={pinState} /></>;
      break;
    case "links":
      title = "Links";
      body = <LinksEditor placeId={place.id} links={place.links ?? []} onSaved={(links) => merge({ links })} />;
      break;
    case "qr":
      title = "QR codes";
      body = <><ShopQr place={place} isAdmin={isAdmin} onCodes={setCodes} /><ShareKit placeId={place.id} placeName={place.name} live={live} /></>;
      break;
    case "plan":
      title = "Plan";
      body = <Plan placeId={place.id} placeName={place.name} />;
      break;
    case "insights":
      title = "Insights";
      body = <Insights place={place} onGo={goTab} hasPin={pinState.pin ? pinState.pin.has_pin : null} />;
      break;
  }

  return (
    <Ctx.Provider value={ctx}>
      <OwnerShell section={section} title={title} needReply={today?.need_reply ?? 0}>
        {banners}
        {body}
      </OwnerShell>
      {section === "qr" && <QrPrintSheet place={place} codes={codes} />}
    </Ctx.Provider>
  );
}

/** A bare frame while the shop loads, so the owner app never flashes the diner look. */
function OwnerFrame({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="ow">
      <div className="ow-main">
        <header className="ow-top"><button type="button" className="ow-icon" aria-label="Back" onClick={() => goBack(nav, "/owner?pick=1")}><Icon name="back" size={20} /></button><span className="ow-brand-t grow">Owner app</span></header>
        <main className="ow-content">{children}</main>
      </div>
    </div>
  );
}

function OwnerShell({ section, title, needReply, children }: { section: Section; title: string; needReply: number; children: ReactNode }) {
  const { place, go, catalog, today } = useOwner();
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const base = `/owner/${place.id}`;
  const isTab = TABS.some((t) => t.id === section || t.also?.includes(section));
  const tabOn = (t: (typeof TABS)[number]) => t.id === section || Boolean(t.also?.includes(section));
  const status = place.status === "live" ? (today?.reviews_open === false ? "paused" : "live") : place.status;

  const sideMore: { id: Section; label: string; icon: IconName }[] = [
    { id: "qr", label: "QR codes", icon: "qr" },
    { id: "menu", label: catalog, icon: "box" },
    { id: "look", label: "Photos and look", icon: "camera" },
    { id: "details", label: "Details and hours", icon: "clock" },
    { id: "links", label: "Links", icon: "link" },
    { id: "insights", label: "Insights", icon: "chart" },
    { id: "plan", label: "Plan", icon: "crown" },
  ];

  return (
    <div className="ow no-print">
      <aside className="ow-side no-print" aria-label="Owner app">
        <div className="ow-brand"><span className="ow-brand-mark"><Icon name="store" size={18} /></span><span className="stack tight"><b>Trusted Picks</b><small>Owner app</small></span></div>
        <Link to="/owner?pick=1" className="ow-shop" aria-label={`${place.name}. Switch shop`}>
          <span className="ow-shop-logo"><MediaImg path={place.logo_path || place.cover_path} fallback={<Icon name="store" size={18} />} /></span>
          <span className="grow stack tight" style={{ minWidth: 0 }}><b className="ellipsis">{place.name}</b><small className={`ow-status ${status}`}>{STATUS_LABEL[status] ?? status}</small></span>
          <Icon name="down" size={16} />
        </Link>
        <nav className="ow-side-nav">
          {TABS.filter((t) => t.id !== "more").map((t) => (
            <NavLink key={t.id} to={t.id ? `${base}/${t.id}` : base} end replace className={tabOn(t) ? "on" : ""} aria-current={tabOn(t) ? "page" : undefined}>
              <Icon name={t.icon} size={19} /><span className="grow">{t.label}</span>
              {t.id === "reviews" && needReply > 0 && <span className="ow-count">{needReply > 99 ? "99+" : needReply}</span>}
            </NavLink>
          ))}
          <span className="ow-side-h">Shop</span>
          {sideMore.map((t) => (
            <NavLink key={t.id} to={`${base}/${t.id}`} className={section === t.id ? "on" : ""} aria-current={section === t.id ? "page" : undefined}>
              <Icon name={t.icon} size={19} /><span className="grow">{t.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="ow-side-foot">
          <Link to={`/p/${place.id}`}><Icon name="eye" size={18} />View my page</Link>
          {!isAdmin && <Link to="/" onClick={() => setAppMode("diner")}><Icon name="search" size={18} />Diner app</Link>}
          {isAdmin && <Link to="/admin"><Icon name="shield" size={18} />Admin</Link>}
        </div>
      </aside>

      <div className="ow-main">
        <header className="ow-top no-print">
          {isTab ? (
            <Link to="/owner?pick=1" className="ow-top-shop" aria-label={`${place.name}. Switch shop`}>
              <span className="ow-shop-logo sm"><MediaImg path={place.logo_path || place.cover_path} fallback={<Icon name="store" size={16} />} /></span>
              <span className="grow stack tight" style={{ minWidth: 0 }}>
                <b className="ellipsis">{section === "" ? place.name : title}</b>
                <small className={`ow-status ${status}`}>{section === "" ? STATUS_LABEL[status] ?? status : place.name}</small>
              </span>
            </Link>
          ) : (
            <>
              <button type="button" className="ow-icon" aria-label="Back" onClick={() => goBack(nav, `${base}/more`)}><Icon name="back" size={20} /></button>
              <span className="grow stack tight" style={{ minWidth: 0 }}><b className="ellipsis">{title}</b><small className="ellipsis">{place.name}</small></span>
            </>
          )}
          <span className="ow-top-title">{section === "" ? "Today" : title}</span>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="ow-icon" aria-label="QR codes" onClick={() => go("qr", { replace: false })}><Icon name="qr" size={20} /></button>
            <Link to={`/p/${place.id}`} className="ow-icon" aria-label="View my page"><Icon name="eye" size={20} /></Link>
          </div>
        </header>
        <main className="ow-content">{children}</main>
      </div>

      <nav className="ow-tabs no-print" aria-label="Owner app">
        {TABS.map((t) => (
          <Link key={t.id} to={t.id ? `${base}/${t.id}` : base} replace className={tabOn(t) || (t.id === "more" && !isTab) ? "on" : ""} aria-current={tabOn(t) ? "page" : undefined}>
            <span className="ow-tab-ico"><Icon name={t.icon} size={22} width={tabOn(t) ? 2.4 : 2} />{t.id === "reviews" && needReply > 0 && <span className="ow-dot" aria-label={`${needReply} need a reply`} />}</span>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { live: "Live · taking reviews", paused: "Live · reviews paused", lapsed: "Plan ended", removed: "Off the app", pending: "Waiting for approval" };
