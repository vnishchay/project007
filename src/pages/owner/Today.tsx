import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { Icon, Stars, type IconName } from "../../components/ui";
import { printed } from "../../components/manage/Insights";
import { useOwner, type Section } from "./OwnerApp";

/** Everything the Today screen shows, from owner_today(). Counts only, never who. */
export interface OwnerToday {
  today: string;
  visitors_today: number; visitors_yesterday: number; scans_today: number;
  days: { day: string; visitors: number; reviews: number }[];
  reviews_today: number; reviews_7d: number; reviews: number; avg_rating: number | null;
  need_reply: number; low_open: number; notes_unread: number;
  deals_live: number; deals_on_now: number; deal_uses_today: number;
  stamp_goal: number | null; stamp_reward: string | null; stamps_today: number; rewards_today: number;
  offers_7d: number; offers_seen_7d: number; offers_used_7d: number; updates_today: number;
  qr_active: number; qr_limit: number;
  plan: string | null; plan_name: string | null; plan_status: string | null; period_end: string | null; trial_reviews_left: number | null; reviews_open: boolean;
}

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString();
const DAY_MS = 86_400_000;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The owner's home: what happened today, what needs them, and the tools they use most, one tap away. */
export function Today({ hasPin }: { hasPin: boolean | null }) {
  const { place, today: t, go, catalog } = useOwner();
  const [items, setItems] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.from("items").select("id", { count: "exact", head: true }).eq("place_id", place.id).then(({ count, error }) => { if (alive) setItems(error ? null : count ?? 0); });
    return () => { alive = false; };
  }, [place.id]);

  if (t === undefined) return (
    <div className="ow-grid">
      <div className="skeleton" style={{ height: 120, borderRadius: 20 }} />
      <div className="skeleton" style={{ height: 220, borderRadius: 20 }} />
      <div className="skeleton" style={{ height: 180, borderRadius: 20 }} />
    </div>
  );
  if (t === null) return (
    <div className="notice warn row" style={{ gap: 8 }}><Icon name="info" size={16} /><span className="grow">Today's numbers need the latest server update (run-now-51.sql). Everything else works.</span></div>
  );

  const delta = t.visitors_today - t.visitors_yesterday;
  const daysLeft = t.period_end ? Math.ceil((new Date(t.period_end).getTime() - Date.now()) / DAY_MS) : null;
  const catalogWord = catalog.toLowerCase();

  // What needs the owner, most urgent first. Each row opens the screen that fixes it.
  const todo: { icon: IconName; tone: string; text: string; sub?: string; to: Section }[] = [];
  if (!t.reviews_open) todo.push({ icon: "lock", tone: "coral", text: "Reviews are paused", sub: "Your plan ended or the trial is used up. Renew to take reviews again.", to: "plan" });
  if (t.low_open > 0) todo.push({ icon: "alert", tone: "coral", text: `${t.low_open} low ${t.low_open === 1 ? "rating" : "ratings"} without a reply`, sub: "Last 30 days. A kind reply often wins people back.", to: "reviews" });
  if (t.need_reply > 0) todo.push({ icon: "reply", tone: "amber", text: `${n(t.need_reply)} ${t.need_reply === 1 ? "review needs" : "reviews need"} a reply`, to: "reviews" });
  if (t.notes_unread > 0) todo.push({ icon: "message", tone: "violet", text: `${t.notes_unread} private ${t.notes_unread === 1 ? "note" : "notes"} to read`, sub: "Only you can see these.", to: "reviews" });
  if (t.plan_status === "trial" && t.trial_reviews_left != null && t.trial_reviews_left <= 5 && t.reviews_open) todo.push({ icon: "crown", tone: "amber", text: `${t.trial_reviews_left} free ${t.trial_reviews_left === 1 ? "review" : "reviews"} left on your trial`, to: "plan" });
  else if (daysLeft != null && daysLeft >= 0 && daysLeft <= 7 && t.reviews_open) todo.push({ icon: "clock", tone: "amber", text: `Your plan ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`, to: "plan" });
  if (t.deals_live === 0) todo.push({ icon: "ticket", tone: "sky", text: "Add a deal", sub: "Deals show as tickets at the top of your page.", to: "deals" });

  const setup = [
    { done: hasPin === true, label: "Put your shop on the map", icon: "pin" as IconName, to: "details" as Section },
    { done: (items ?? 0) >= 5, label: `Add 5 things to your ${catalogWord}${items ? ` (${Math.min(items, 5)} of 5)` : ""}`, icon: "box" as IconName, to: "menu" as Section },
    { done: t.qr_active > 0 && printed(place.id), label: "Print your table QR codes", icon: "print" as IconName, to: "qr" as Section },
    { done: t.reviews > 0, label: "Get your first review", icon: "star" as IconName, to: "qr" as Section },
  ];
  const setupLeft = setup.filter((s) => !s.done).length;

  return (
    <div className="ow-today">
      <section className="ow-hello" aria-label="Today">
        <div className="ow-hello-head">
          <span className="stack tight"><span className="ow-kicker">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</span><h1>{greeting()}</h1></span>
        </div>
        <div className="ow-kpis">
          <Kpi icon="people" label="Visitors today" value={n(t.visitors_today)}
            sub={t.visitors_yesterday || t.visitors_today ? <><span className={delta > 0 ? "up" : delta < 0 ? "down" : ""}>{delta > 0 ? `+${delta}` : delta}</span> vs yesterday</> : "Scans of your table QR"} onClick={() => go("customers")} />
          <Kpi icon="star" label="Reviews today" value={n(t.reviews_today)} sub={`${n(t.reviews_7d)} this week`} onClick={() => go("reviews")} />
          <Kpi icon="reply" label="Need a reply" value={n(t.need_reply)} sub={t.low_open ? `${t.low_open} low rated` : "All reviews"} alert={t.low_open > 0} onClick={() => go("reviews")} />
          <Kpi icon="trophy" label="Average rating" value={t.avg_rating != null ? Number(t.avg_rating).toFixed(1) : "–"}
            sub={t.avg_rating != null ? <><Stars value={Number(t.avg_rating)} size={11} /> {n(t.reviews)}</> : "No reviews yet"} onClick={() => go("insights", { replace: false })} />
        </div>
      </section>

      <div className="ow-grid">
        <div className="ow-col">
          <section className="ow-card ow-o1" aria-labelledby="todo-h">
            <div className="ow-card-h"><span className="icon-chip sm coral"><Icon name="bell" size={16} /></span><h2 id="todo-h" className="grow">Needs you</h2>{todo.length > 0 && <span className="ow-count">{todo.length}</span>}</div>
            {todo.length === 0 ? (
              <div className="ow-clear"><span className="icon-chip lg"><Icon name="checkCircle" size={24} /></span><b>All caught up</b><span className="small muted">Nothing waiting for you right now.</span></div>
            ) : (
              <div className="ow-list">
                {todo.map((x) => (
                  <button key={x.text} type="button" className="ow-row" onClick={() => go(x.to, { replace: false })}>
                    <span className={`icon-chip sm ${x.tone}`}><Icon name={x.icon} size={16} /></span>
                    <span className="grow stack tight" style={{ minWidth: 0 }}><b>{x.text}</b>{x.sub && <small className="muted">{x.sub}</small>}</span>
                    <Icon name="chev" size={18} color="var(--muted)" />
                  </button>
                ))}
              </div>
            )}
          </section>

          {setupLeft > 0 && items !== null && (
            <section className="ow-card ow-o3" aria-labelledby="setup-h">
              <div className="ow-card-h"><span className="icon-chip sm"><Icon name="checkCircle" size={16} /></span><h2 id="setup-h" className="grow">Finish setting up</h2><span className="badge gray">{setup.length - setupLeft} of {setup.length}</span></div>
              <div className="ow-meter" aria-hidden="true"><span style={{ width: `${((setup.length - setupLeft) / setup.length) * 100}%` }} /></div>
              <div className="ow-list">
                {setup.map((x) => (
                  <button key={x.label} type="button" className={`ow-row ${x.done ? "done" : ""}`} disabled={x.done} onClick={() => go(x.to, { replace: false })}>
                    <span className="ow-tick" aria-hidden="true">{x.done ? <Icon name="check" size={14} width={3} /> : <Icon name={x.icon} size={15} />}</span>
                    <span className="grow">{x.label}</span>
                    {x.done ? <span className="sr-only">Done</span> : <Icon name="chev" size={16} color="var(--muted)" />}
                  </button>
                ))}
              </div>
            </section>
          )}

          <VisitsChart days={t.days} />
        </div>

        <div className="ow-col">
          <section className="ow-card ow-o2" aria-labelledby="qa-h">
            <div className="ow-card-h"><span className="icon-chip sm violet"><Icon name="zap" size={16} /></span><h2 id="qa-h" className="grow">Quick actions</h2></div>
            <div className="ow-actions">
              <Action icon="service" tone="sky" label="Table calls" onClick={() => go("live", { replace: false })} />
              <Action icon="qr" tone="violet" label="QR codes" onClick={() => go("qr", { replace: false })} />
              <Action icon="ticket" tone="coral" label="New deal" onClick={() => go("deals")} />
              <Action icon="gift" tone="amber" label="Send offer" onClick={() => go("customers")} />
              <Action icon="send" tone="sky" label="Post news" onClick={() => go("messages")} />
              <Action icon="plus" tone="" label={`Add to ${catalogWord}`} onClick={() => go("menu", { replace: false })} />
              <Action icon="link" tone="sky" label="Review link" onClick={() => go("reviews")} />
            </div>
          </section>

          <section className="ow-card ow-o4" aria-labelledby="off-h">
            <div className="ow-card-h"><span className="icon-chip sm coral"><Icon name="ticket" size={16} /></span><h2 id="off-h" className="grow">Offers today</h2><button type="button" className="link-btn small" onClick={() => go("deals")}>Manage</button></div>
            <div className="ow-stats">
              <Stat value={t.deals_live ? `${t.deals_on_now} of ${t.deals_live}` : "None"} label="deals on now" tone={t.deals_on_now > 0 ? "good" : ""} />
              <Stat value={n(t.deal_uses_today)} label="deals used today" />
              {t.stamp_goal ? <Stat value={n(t.stamps_today)} label="stamps given today" /> : <Stat value="Off" label="stamp card" />}
              <Stat value={n(t.rewards_today)} label="rewards claimed" />
            </div>
            <p className="small muted ow-foot">
              {t.offers_7d > 0 ? <>Private offers this week: <b>{t.offers_7d}</b> sent, <b>{t.offers_seen_7d}</b> opened, <b>{t.offers_used_7d}</b> used.</> : "No private offers sent this week."}
              {" "}{3 - Math.min(t.updates_today, 3)} news {3 - Math.min(t.updates_today, 3) === 1 ? "post" : "posts"} left today.
            </p>
          </section>

          <section className="ow-card ow-o5" aria-labelledby="qr-h">
            <div className="ow-card-h"><span className="icon-chip sm violet"><Icon name="scan" size={16} /></span><h2 id="qr-h" className="grow">QR codes</h2></div>
            <div className="ow-stats">
              <Stat value={n(t.scans_today)} label="scans today" />
              <Stat value={`${t.qr_active} of ${t.qr_limit}`} label="codes on" />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn small green grow" onClick={() => go("qr", { replace: false })}><Icon name="print" size={16} />Print codes</button>
              <Link to={`/p/${place.id}`} className="btn small ghost grow"><Icon name="eye" size={16} />My page</Link>
            </div>
          </section>

          <button type="button" className="ow-card ow-plan ow-o7" onClick={() => go("plan", { replace: false })}>
            <span className="icon-chip sm amber"><Icon name="crown" size={16} /></span>
            <span className="grow stack tight" style={{ textAlign: "left" }}>
              <b>{t.plan_name || "Free trial"}</b>
              <small className="muted">
                {!t.reviews_open ? "Reviews paused" : t.plan_status === "trial" && t.trial_reviews_left != null ? `${t.trial_reviews_left} free reviews left` : daysLeft != null ? `Until ${new Date(t.period_end!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
              </small>
            </span>
            <Icon name="chev" size={18} color="var(--muted)" />
          </button>
        </div>
      </div>
      <p className="tiny muted center row" style={{ justifyContent: "center", gap: 6 }}><Icon name="lock" size={13} />Reviews stay anonymous. You see counts, never who wrote what.</p>
    </div>
  );
}

function Kpi({ icon, label, value, sub, alert, onClick }: { icon: IconName; label: string; value: string; sub?: React.ReactNode; alert?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`ow-kpi ${alert ? "alert" : ""}`} onClick={onClick}>
      <span className="ow-kpi-l"><Icon name={icon} size={14} />{label}</span>
      <span className="ow-kpi-n">{value}</span>
      {sub && <span className="ow-kpi-s">{sub}</span>}
    </button>
  );
}

function Action({ icon, tone, label, onClick }: { icon: IconName; tone: string; label: string; onClick: () => void }) {
  return (
    <button type="button" className="ow-action" onClick={onClick}>
      <span className={`icon-chip ${tone}`}><Icon name={icon} size={20} /></span>
      <span className="ellipsis">{label}</span>
    </button>
  );
}

function Stat({ value, label, tone = "" }: { value: string; label: string; tone?: string }) {
  return <div className={`ow-stat ${tone}`}><b>{value}</b><small>{label}</small></div>;
}

/** Visitors per day for two weeks: one series, so no legend; each bar has its own tooltip. */
function VisitsChart({ days }: { days: OwnerToday["days"] }) {
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const total = days.reduce((a, d) => a + d.visitors, 0);
  const [hover, setHover] = useState<number | null>(null);
  const label = (d: OwnerToday["days"][number]) => new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const shown = hover != null ? days[hover] : null;
  return (
    <section className="ow-card ow-o6" aria-labelledby="chart-h">
      <div className="ow-card-h"><span className="icon-chip sm sky"><Icon name="chart" size={16} /></span><h2 id="chart-h" className="grow">Visitors, last 14 days</h2><span className="small strong">{n(total)}</span></div>
      <div className="ow-tip small" aria-live="polite">{shown ? <><b>{label(shown)}</b>: {shown.visitors} {shown.visitors === 1 ? "visitor" : "visitors"}, {shown.reviews} {shown.reviews === 1 ? "review" : "reviews"}</> : <span className="muted">Tap a bar to see the day</span>}</div>
      <div className="ow-bars" role="list" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <button key={d.day} type="button" role="listitem" className={`ow-bar ${i === days.length - 1 ? "now" : ""} ${hover === i ? "hot" : ""}`}
            aria-label={`${label(d)}: ${d.visitors} visitors, ${d.reviews} reviews`}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}>
            <span style={{ height: `${Math.max(d.visitors ? 6 : 2, (d.visitors / max) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="ow-axis tiny muted"><span>{days[0] ? label(days[0]) : ""}</span><span>Today</span></div>
    </section>
  );
}
