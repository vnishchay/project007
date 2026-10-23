import { useEffect, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { googleConfigured } from "../../lib/google";
import type { Place } from "../../lib/types";
import { Icon, Stars, type IconName } from "../ui";
import { MediaImg } from "./MediaImg";
import { assist } from "../../lib/assist";
import { modeOf } from "../../lib/modes";
import { REVIEW_FEED } from "../ReviewCard";

interface ShopStats { reviews: number; avg_rating: number | null; reviews_30d: number; verified: number; google_handoffs: number; google_handoffs_30d: number; scans_30d: number; saves: number; items_rated: number; link_visits_30d?: number }
interface ItemStat { item_id: string; name: string; image_path: string | null; reviews: number; avg_rating: number; low_ratings: number }

export type ManageTab = "insights" | "live" | "plan" | "reviews" | "visitors" | "deals" | "updates" | "products" | "details" | "links" | "qr";

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString(undefined);

/** What the app brings the shop: counts only, never who. */
export function Insights({ place, onGo, hasPin }: { place: Place; onGo: (t: ManageTab) => void; hasPin: boolean | null }) {
  const [stats, setStats] = useState<ShopStats | null | undefined>(undefined);
  const [items, setItems] = useState<ItemStat[]>([]);
  const [err, setErr] = useState("");
  const [old, setOld] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hasInsights, setHasInsights] = useState<boolean | null>(null);
  const [hasAi, setHasAi] = useState<boolean | null>(null);
  const [planCode, setPlanCode] = useState<string>("trial");
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [qrCount, setQrCount] = useState<number | null>(null);
  const [needReply, setNeedReply] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setErr("");
    Promise.all([
      supabase.rpc("shop_stats", { p_place: place.id }),
      supabase.rpc("shop_item_stats", { p_place: place.id }),
      supabase.rpc("place_has_feature", { p_place: place.id, p_feature: "insights" }),
      supabase.rpc("place_has_feature", { p_place: place.id, p_feature: "ai_insights" }),
      supabase.rpc("my_plan", { p_place: place.id }),
      supabase.from("items").select("id", { count: "exact", head: true }).eq("place_id", place.id),
      supabase.from("qr_codes").select("id", { count: "exact", head: true }).eq("place_id", place.id).eq("active", true),
      supabase.from(REVIEW_FEED).select("id", { count: "exact", head: true }).eq("place_id", place.id).eq("status", "published").is("owner_reply", null),
    ]).then(([s, i, fi, fa, mp, ic, qc, nr]) => {
      if (!alive) return;
      if (s.error?.code === "PGRST202") { setOld(true); setStats(null); return; }
      if (s.error) { setErr(errorText(s.error)); setStats(null); return; }
      setStats(((s.data as ShopStats[]) || [])[0] ?? null);
      setItems((i.data as ItemStat[]) || []);
      if (!fi.error && typeof fi.data === "boolean") setHasInsights(fi.data);
      if (!fa.error && typeof fa.data === "boolean") setHasAi(fa.data);
      const plan = (mp.data as { plan?: string }[] | null)?.[0]?.plan;
      if (plan) setPlanCode(plan);
      setItemCount(ic.error ? null : ic.count ?? 0);
      setQrCount(qc.error ? null : qc.count ?? 0);
      setNeedReply(nr.error ? null : nr.count ?? 0);
    });
    return () => { alive = false; };
  }, [place.id, attempt]);

  if (stats === undefined) return (
    <div className="stack"><div className="skeleton" style={{ height: 132, borderRadius: 24 }} /><div className="grid2"><div className="skeleton" style={{ height: 96 }} /><div className="skeleton" style={{ height: 96 }} /></div></div>
  );
  if (old) return <div className="notice warn row" style={{ gap: 8 }}><Icon name="info" size={16} /><span className="grow">This isn't available yet. Check back soon.</span></div>;
  if (err) return <div className="notice err row"><span className="grow">{err}</span><button className="link-btn" onClick={() => setAttempt((x) => x + 1)}><Icon name="refresh" size={15} />Retry</button></div>;

  const s = stats ?? { reviews: 0, avg_rating: null, reviews_30d: 0, verified: 0, google_handoffs: 0, google_handoffs_30d: 0, scans_30d: 0, saves: 0, items_rated: 0 };
  const isStandardOrPro = hasInsights ?? (planCode !== "trial" && planCode !== "starter");
  const isPro = hasAi ?? (planCode === "pro" || planCode === "growth_pro" || planCode === "autopilot_vip");
  const best = items.filter((i) => i.reviews > 0 && Number(i.avg_rating) >= 3.5).slice(0, 3);
  const attention = items.filter((i) => i.low_ratings > 0).sort((a, b) => b.low_ratings - a.low_ratings || Number(a.avg_rating) - Number(b.avg_rating)).slice(0, 3);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <SetupList steps={[
        { done: hasPin === true, label: "Put your shop on the map", icon: "pin", go: "details" },
        ...(googleConfigured ? [{ done: Boolean(place.google_place_id), label: "Connect your Google profile", icon: "globe" as const, go: "details" as const }] : []),
        { done: (itemCount ?? 0) >= 5, label: `Add 5 things to your ${modeOf(place.kind, place.category).catalog.toLowerCase()}${itemCount ? ` (${Math.min(itemCount, 5)} of 5)` : ""}`, icon: "box", go: "products" },
        { done: (qrCount ?? 0) > 0 && (printed(place.id) || s.reviews > 0), label: "Print your QR codes", icon: "print", go: "qr" },
        { done: s.reviews > 0, label: "Get your first review", icon: "star", go: "qr" },
      ]} onGo={onGo} loading={itemCount === null && qrCount === null} />

      {/* What matters most first: reviews this month and the average. */}
      <div className="in-hero">
        <span className="in-hero-art" aria-hidden="true"><Icon name="star" size={120} width={1.4} /></span>
        <span className="row tiny strong" style={{ gap: 6, opacity: 0.95 }}><Icon name="star" size={14} fill="#fff" />Reviews this month</span>
        <span className="in-hero-n">{n(s.reviews_30d)}</span>
        <span className="small row" style={{ gap: 6, opacity: 0.92 }}>
          {s.avg_rating != null ? <><b>{Number(s.avg_rating).toFixed(1)}</b><Stars value={Number(s.avg_rating)} size={12} />average from {n(s.reviews)} reviews</> : "Customers review after scanning your QR code"}
        </span>
      </div>

      {needReply != null && needReply > 0 && (
        <button type="button" className="in-nudge" onClick={() => onGo("reviews")}>
          <span className="icon-chip sm amber"><Icon name="reply" size={16} /></span>
          <span className="grow">{needReply} {needReply === 1 ? "review needs" : "reviews need"} a reply</span>
          <Icon name="chev" size={18} />
        </button>
      )}

      <div className="in-tiles">
        <Tile icon="verified" cls="" value={n(s.verified)} label="visits with a review" sub="from a QR code or review link" />
        <Tile icon="scan" cls="violet" value={n(s.scans_30d)} label="QR scans" sub={s.link_visits_30d ? `last 30 days · +${n(s.link_visits_30d)} via links` : "last 30 days"} />
        <Tile icon="bookmark" cls="sky" value={n(s.saves)} label="saves" sub="get your updates" />
        <Tile icon="external" cls="amber" value={n(s.google_handoffs)} label="opened Google to post" sub={s.google_handoffs_30d ? `+${n(s.google_handoffs_30d)} in 30 days` : null} />
      </div>


      {s.reviews === 0 ? (
        <div className="mg-empty">
          <div className="mg-empty-art" aria-hidden="true">
            <span className="icon-chip lg violet a"><Icon name="scan" size={24} /></span>
            <span className="icon-chip lg amber b" style={{ width: 60, height: 60 }}><Icon name="star" size={28} /></span>
            <span className="icon-chip lg c"><Icon name="chart" size={24} /></span>
          </div>
          <h2>Your first reviews start here</h2>
          <p className="small muted" style={{ maxWidth: 270 }}>Put your QR code where customers see it. They scan, rate their visit, and these numbers grow.</p>
          <button className="btn green" onClick={() => onGo("qr")}><Icon name="print" size={18} />Print QR codes</button>
        </div>
      ) : (
        <>
          {isStandardOrPro ? (
            <>
              {best.length > 0 && <ItemBlock title="Most loved" icon="trophy" cls="amber" rows={best} />}
              {attention.length > 0 && <ItemBlock title="Needs attention" icon="alert" cls="coral" rows={attention} low />}
              {best.length === 0 && attention.length === 0 && <p className="small muted center">Product ratings show here once customers rate them.</p>}
            </>
          ) : (
            <div style={{ position: "relative" }}>
              <div style={{ filter: "blur(4.5px)", pointerEvents: "none", userSelect: "none", opacity: 0.6 }}>
                <ItemBlock
                  title="Most loved (example)"
                  icon="trophy"
                  cls="amber"
                  rows={[
                    { item_id: "sample-1", name: "Truffle Pasta", image_path: null, reviews: 24, avg_rating: 4.8, low_ratings: 0 },
                    { item_id: "sample-2", name: "Artisan Burrata", image_path: null, reviews: 18, avg_rating: 4.6, low_ratings: 1 },
                  ]}
                />
              </div>
              <div className="callout violet" style={{ margin: "10px 0", alignItems: "flex-start" }}>
                <span className="icon-chip sm violet"><Icon name="lock" size={16} /></span>
                <div className="grow stack tight">
                  <strong>Ratings for every item</strong>
                  <span className="tiny">Bigger plans show how each item is rated and warn you about low ratings.</span>
                  <button type="button" className="btn green small" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => onGo("plan")}>
                    <Icon name="crown" size={14} />See plans
                  </button>
                </div>
              </div>
            </div>
          )}
          {s.reviews >= 3 && <AiTips placeId={place.id} isPro={isPro} onGo={onGo} />}
        </>
      )}
      <p className="tiny muted center row" style={{ justifyContent: "center", gap: 6 }}><Icon name="lock" size={13} />Reviews stay anonymous. You see counts, never who wrote what.</p>
    </div>
  );
}

interface Tips { summary: string; loved: string[]; fix: string[] }

/** On demand only, so it costs an AI call just when the owner asks. */
function AiTips({ placeId, isPro, onGo }: { placeId: string; isPro: boolean; onGo: (t: ManageTab) => void }) {
  const [tips, setTips] = useState<Tips | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run() {
    setBusy(true); setErr("");
    try { setTips(await assist<Tips>("insights", placeId)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <section className="mg-section ai-tips">
      <div className="mg-section-head"><span className="icon-chip sm violet"><Icon name="spark" size={16} /></span><span className="grow">What your reviews say</span></div>
      {!isPro ? (
        <div className="callout violet" style={{ margin: "4px 0", alignItems: "flex-start" }}>
          <span className="icon-chip sm violet"><Icon name="lock" size={16} /></span>
          <div className="grow stack tight">
            <strong style={{ fontSize: 14 }}>AI tips from your reviews</strong>
            <span className="tiny">On the top plans, AI reads your reviews and tells you what customers love and what to fix first.</span>
            <button type="button" className="btn green small" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => onGo("plan")}>
              <Icon name="crown" size={14} />See plans
            </button>
          </div>
        </div>
      ) : !tips ? (
        <>
          <p className="small muted">AI reads your recent reviews and tells you what customers love and what to fix first.</p>
          <button type="button" className="btn ghost block" disabled={busy} onClick={run}><Icon name="spark" size={18} />{busy ? "Reading your reviews…" : "Read my reviews"}</button>
        </>
      ) : (
        <>
          {tips.summary && <p className="small">{tips.summary}</p>}
          {tips.loved.length > 0 && <ul className="ai-list">{tips.loved.map((t) => <li key={t}><Icon name="heart" size={15} color="var(--accent)" />{t}</li>)}</ul>}
          {tips.fix.length > 0 && <ul className="ai-list">{tips.fix.map((t) => <li key={t}><Icon name="zap" size={15} color="#c2410c" />{t}</li>)}</ul>}
        </>
      )}
      {err && <div className="notice err small">{err}</div>}
    </section>
  );
}

function Tile({ icon, cls, value, label, sub }: { icon: IconName; cls: string; value: string; label: string; sub?: React.ReactNode }) {
  return (
    <div className="in-tile">
      <span className={`icon-chip sm ${cls}`}><Icon name={icon} size={16} /></span>
      <span className="in-n">{value}</span>
      <span className="in-l">{label}</span>
      {sub && <span className="in-sub">{sub}</span>}
    </div>
  );
}

function ItemBlock({ title, icon, cls, rows, low = false }: { title: string; icon: IconName; cls: string; rows: ItemStat[]; low?: boolean }) {
  return (
    <div className="mg-section" style={{ gap: 10 }}>
      <div className="mg-section-head"><span className={`icon-chip sm ${cls}`}><Icon name={icon} size={16} /></span>{title}</div>
      {rows.map((r) => {
        const avg = Number(r.avg_rating);
        return (
          <div key={r.item_id} className="in-item">
            <span className="thumb mg-thumb-empty"><MediaImg path={r.image_path} fallback={<Icon name="image" size={18} />} /></span>
            <span className="grow stack tight" style={{ minWidth: 0 }}>
              <span className="row" style={{ gap: 6 }}>
                <span className="strong ellipsis grow">{r.name}</span>
                <span className={`rating-pill ${avg < 3 ? "low" : ""}`} style={{ padding: "2px 7px", fontSize: 12 }}><Icon name="star" size={10} fill="#fff" />{avg.toFixed(1)}</span>
              </span>
              <span className={`bar ${avg < 3 ? "low" : ""}`}><span style={{ width: `${(avg / 5) * 100}%` }} /></span>
              <span className="tiny muted">
                {r.reviews} {r.reviews === 1 ? "review" : "reviews"}
                {low && <> · <b style={{ color: "var(--danger)" }}>{r.low_ratings} rated 1–2★</b></>}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Remembered on this phone once the owner prints their QR sheet. */
export const printed = (placeId: string) => { try { return localStorage.getItem(`tp-printed:${placeId}`) === "1"; } catch { return false; } };
export const markPrinted = (placeId: string) => { try { localStorage.setItem(`tp-printed:${placeId}`, "1"); } catch { /* storage blocked */ } };

/** First things to do, ticked off as they happen. Hidden once everything is done. */
function SetupList({ steps, onGo, loading }: { steps: { done: boolean; label: string; icon: IconName; go: ManageTab }[]; onGo: (t: ManageTab) => void; loading: boolean }) {
  const left = steps.filter((x) => !x.done).length;
  if (loading || !left) return null;
  return (
    <section className="mg-section" style={{ gap: 8 }} aria-labelledby="setup-h">
      <div className="mg-section-head"><span className="icon-chip sm"><Icon name="checkCircle" size={16} /></span><span className="grow" id="setup-h">Get set up</span><span className="badge gray">{steps.length - left} of {steps.length}</span></div>
      <div className="mg-setup">
        {steps.map((x) => (
          <button key={x.label} type="button" className={`mg-setup-row ${x.done ? "done" : ""}`} onClick={() => onGo(x.go)} disabled={x.done}>
            <span className="tick" aria-hidden="true">{x.done ? <Icon name="check" size={14} width={3} /> : <Icon name={x.icon} size={15} />}</span>
            <span className="grow">{x.label}</span>
            {x.done ? <span className="sr-only">Done</span> : <Icon name="chev" size={16} color="var(--muted)" />}
          </button>
        ))}
      </div>
    </section>
  );
}
