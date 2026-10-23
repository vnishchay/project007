import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { isUuid, type Place, type QrCode } from "../lib/types";
import { Icon, Spinner, TopBar, useTabKeys, useToast } from "../components/ui";
import { ShopHeader } from "../components/manage/ShopHeader";
import { Products } from "../components/manage/Products";
import { ShopDetails } from "../components/manage/ShopDetails";
import { QrPrintSheet, ShopQr } from "../components/manage/ShopQr";
import { Insights, type ManageTab } from "../components/manage/Insights";
import { LinksEditor } from "../components/manage/LinksEditor";
import { Messages, type Audience } from "../components/manage/Messages";
import { Visitors } from "../components/manage/Visitors";
import { Deals } from "../components/manage/Deals";
import { LiveCalls } from "../components/manage/LiveCalls";
import { ReviewsTab } from "../components/manage/ReviewsTab";
import { GoogleConnect } from "../components/manage/GoogleConnect";
import { ShareKit } from "../components/manage/ShareKit";
import { Plan } from "../components/manage/Plan";
import type { IconName } from "../components/ui";
import { modeOf } from "../lib/modes";
import { usePin } from "../lib/pin";
import "../styles/manage.css";

const COLS = "id, google_place_id, name, kind, category, area, city, about, hours, price_level, status, listed_until, created_at, cover_path, logo_path, currency";
type Tab = ManageTab;
type Group = "home" | "reviews" | "customers" | "shop";
/** Four groups instead of eight tabs. ?tab= keeps the page ids (plan, qr…) so old links still land in the right place. */
const GROUPS: { id: Group; label: string; icon: IconName; tabs: { id: Tab; label: string }[] }[] = [
  { id: "home", label: "Home", icon: "chart", tabs: [{ id: "insights", label: "Overview" }, { id: "live", label: "Live" }, { id: "plan", label: "Plan" }] },
  { id: "reviews", label: "Reviews", icon: "star", tabs: [{ id: "reviews", label: "Reviews" }] },
  { id: "customers", label: "Customers", icon: "people", tabs: [{ id: "visitors", label: "Visitors" }, { id: "deals", label: "Deals" }, { id: "updates", label: "Messages" }] },
  { id: "shop", label: "Shop page", icon: "store", tabs: [{ id: "products", label: "Catalog" }, { id: "details", label: "Details" }, { id: "links", label: "Links" }, { id: "qr", label: "QR codes" }] },
];
const TABS = GROUPS.flatMap((g) => g.tabs);
const groupOf = (t: Tab) => GROUPS.find((g) => g.tabs.some((x) => x.id === t))!;

export default function Manage() {
  const { placeId = "" } = useParams();
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "insights") as Tab;
  const group = groupOf(tab);
  // Visitors picked for an offer, kept while moving between Visitors and Messages.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [audience, setAudience] = useState<Audience>("update");
  const [sentN, setSentN] = useState(0);
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [codes, setCodes] = useState<QrCode[]>([]);
  const [attempt, setAttempt] = useState(0);
  // The shop's map pin; a Google-linked shop fills in and refreshes it from Google by itself.
  const pinState = usePin(placeId, place?.google_place_id);

  useEffect(() => {
    if (!isUuid(placeId)) {
      setAllowed(false);
      setPlace(null);
      return;
    }
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
      const { data, error } = res;
      if (error) setErr(errorText(error));
      setPlace((data as Place) ?? null);
    })();
    return () => { alive = false; };
  }, [placeId, isAdmin, attempt]);

  const onCount = useCallback((n: number) => setCount(n), []);
  const setTab = useCallback((t: Tab) => { setParams(t === "insights" ? {} : { tab: t }, { replace: true }); window.scrollTo({ top: 0 }); }, [setParams]);
  const groupKeys = useTabKeys(GROUPS.map((g) => g.id), group.id, (g) => setTab(GROUPS.find((x) => x.id === g)!.tabs[0]!.id));
  const subKeys = useTabKeys(group.tabs.map((t) => t.id), tab, setTab);

  if (err) return (
    <div className="page"><TopBar title="Your shop" />
      <div className="notice err row"><span className="grow">{err}</span><button className="link-btn" onClick={() => setAttempt((x) => x + 1)}><Icon name="refresh" size={15} />Retry</button></div>
    </div>
  );
  if (allowed === false) return <Locked />;
  if (allowed === undefined || place === undefined) return <div className="page"><Spinner /></div>;
  if (!place) return (
    <div className="page"><TopBar title="Your shop" />
      <div className="empty"><span className="icon-chip lg"><Icon name="store" size={26} /></span><h2>Shop not found</h2><Link to="/business" className="btn ghost small">Your shops</Link></div>
    </div>
  );

  const merge = (p: Partial<Place>) => setPlace((x) => (x ? { ...x, ...p } : x));
  const catalog = modeOf(place.kind, place.category).catalog;

  return (
    <div className="page narrow-gap">
      <div className="no-print stack" style={{ gap: 14 }}>
        <TopBar title="Manage shop" sub={isAdmin ? "Admin view" : undefined}
          right={<Link to="/business" className="icon-btn" aria-label="All your shops"><Icon name="store" size={20} /></Link>} />
        <ShopHeader place={place} onChange={merge} />
        {(place.status === "removed" || place.verification === "rejected") && <RecheckBanner placeId={place.id} />}
        {pinState.pin && !pinState.pin.has_pin && !pinState.syncing && tab !== "details" && (
          <button type="button" className="callout amber" style={{ border: 0, textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => setTab("details")}>
            <span className="icon-chip sm amber"><Icon name="pin" size={16} /></span>
            <span className="grow small"><b>Add your map pin.</b> People nearby can't find you until you do.</span>
            <Icon name="chev" size={18} />
          </button>
        )}
        <div className="mg-groups" role="tablist" aria-label="Manage" onKeyDown={groupKeys}>
          {GROUPS.map((g) => (
            <button key={g.id} type="button" role="tab" tabIndex={group.id === g.id ? 0 : -1} aria-selected={group.id === g.id} className={group.id === g.id ? "on" : ""} onClick={() => setTab(g.tabs[0]!.id)}>
              <Icon name={g.icon} size={20} />{g.label}
            </button>
          ))}
        </div>
        {group.tabs.length > 1 && (
          <div className="mg-sub" role="tablist" aria-label={group.label} onKeyDown={subKeys}>
            {group.tabs.map((t) => (
              <button key={t.id} type="button" role="tab" tabIndex={tab === t.id ? 0 : -1} aria-selected={tab === t.id} className={`chip ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
                {t.id === "products" ? catalog : t.label}
                {t.id === "products" && count != null && count > 0 && <span className="muted"> {count}</span>}
                {t.id === "updates" && picked.size > 0 && <span className="badge" style={{ marginLeft: 4 }}>{picked.size}</span>}
              </button>
            ))}
          </div>
        )}
        {tab === "insights" && <Insights place={place} onGo={setTab} hasPin={pinState.pin ? pinState.pin.has_pin : null} />}
        {tab === "live" && <LiveCalls placeId={place.id} live={place.status === "live"} />}
        {tab === "plan" && <Plan placeId={place.id} placeName={place.name} />}
        {tab === "reviews" && <ReviewsTab placeId={place.id} placeName={place.name} live={place.status === "live"} onGo={setTab} />}
        {tab === "visitors" && <Visitors placeId={place.id} picked={picked} setPicked={setPicked} reload={sentN} onWrite={() => { setAudience("offer"); setTab("updates"); }} />}
        {tab === "deals" && <Deals placeId={place.id} currency={place.currency} live={place.status === "live"} />}
        {tab === "updates" && <Messages placeId={place.id} placeName={place.name} logoPath={place.logo_path ?? null} live={place.status === "live"}
          audience={audience} onAudience={setAudience} picked={[...picked]} onPick={() => { setAudience("offer"); setTab("visitors"); }}
          onSent={() => { if (audience === "offer") setPicked(new Set()); setSentN((x) => x + 1); }} />}
        {tab === "products" && <Products placeId={place.id} isAdmin={isAdmin} mode={modeOf(place.kind, place.category)} links={place.links ?? []} currency={place.currency} onCount={onCount} />}
        {tab === "details" && <>
          <GoogleConnect place={place} isAdmin={isAdmin} onSaved={merge} />
          <ShopDetails place={place} isAdmin={isAdmin} onSaved={merge} pinState={pinState} />
        </>}
        {tab === "links" && <LinksEditor placeId={place.id} links={place.links ?? []} onSaved={(links) => merge({ links })} />}
        {tab === "qr" && <>
          <ShopQr place={place} isAdmin={isAdmin} onCodes={setCodes} />
          <ShareKit placeId={place.id} placeName={place.name} live={place.status === "live"} />
        </>}
      </div>
      {tab === "qr" && <QrPrintSheet place={place} codes={codes} />}
    </div>
  );
}

interface PlaceCheck { status: Place["status"]; verification: string; note: string | null; next_recheck_at: string | null }

/** A removed or rejected shop: the team's note, and a way to ask for another check once it's fixed. */
function RecheckBanner({ placeId }: { placeId: string }) {
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

function Locked() {
  return (
    <div className="page">
      <TopBar title="Manage shop" />
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
