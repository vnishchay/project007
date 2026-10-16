import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Place, QrCode } from "../lib/types";
import { Icon, Spinner, TopBar } from "../components/ui";
import { ShopHeader } from "../components/manage/ShopHeader";
import { Products } from "../components/manage/Products";
import { ShopDetails } from "../components/manage/ShopDetails";
import { QrPrintSheet, ShopQr } from "../components/manage/ShopQr";
import "../styles/manage.css";

const COLS = "id, google_place_id, name, category, area, city, about, hours, price_level, status, listed_until, created_at, cover_path, logo_path";
type Tab = "products" | "details" | "qr";

export default function Manage() {
  const { placeId = "" } = useParams();
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (["products", "details", "qr"].includes(params.get("tab") || "") ? params.get("tab") : "products") as Tab;
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [codes, setCodes] = useState<QrCode[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr("");
    (async () => {
      const can = await supabase.rpc("can_manage_place", { p_place: placeId });
      if (!alive) return;
      const ok = can.error ? (can.error.code === "PGRST202" ? isAdmin : null) : Boolean(can.data);
      if (ok === null) { setErr(errorText(can.error)); return; }
      setAllowed(ok);
      if (!ok) return;
      const { data, error } = await supabase.from("places").select(COLS).eq("id", placeId).maybeSingle();
      if (!alive) return;
      if (error) setErr(errorText(error));
      setPlace((data as Place) ?? null);
    })();
    return () => { alive = false; };
  }, [placeId, isAdmin, attempt]);

  const onCount = useCallback((n: number) => setCount(n), []);
  const setTab = (t: Tab) => setParams(t === "products" ? {} : { tab: t }, { replace: true });

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

  return (
    <div className="page narrow-gap">
      <div className="no-print stack" style={{ gap: 14 }}>
        <TopBar title="Manage shop" sub={isAdmin ? "Admin view" : undefined}
          right={<Link to="/business" className="icon-btn" aria-label="All your shops"><Icon name="store" size={20} /></Link>} />
        <ShopHeader place={place} onChange={merge} />
        <div className="mg-tabs" role="tablist" aria-label="Manage">
          <button role="tab" aria-selected={tab === "products"} className={tab === "products" ? "on" : ""} onClick={() => setTab("products")}>
            <Icon name="box" size={17} />Products{count != null && <span className="count">{count}</span>}
          </button>
          <button role="tab" aria-selected={tab === "details"} className={tab === "details" ? "on" : ""} onClick={() => setTab("details")}><Icon name="store" size={17} />Details</button>
          <button role="tab" aria-selected={tab === "qr"} className={tab === "qr" ? "on" : ""} onClick={() => setTab("qr")}><Icon name="qr" size={17} />QR</button>
        </div>
        {tab === "products" && <Products placeId={place.id} isAdmin={isAdmin} onCount={onCount} />}
        {tab === "details" && <ShopDetails place={place} isAdmin={isAdmin} onSaved={merge} />}
        {tab === "qr" && <ShopQr place={place} isAdmin={isAdmin} onCodes={setCodes} />}
      </div>
      {tab === "qr" && <QrPrintSheet place={place} codes={codes} />}
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
