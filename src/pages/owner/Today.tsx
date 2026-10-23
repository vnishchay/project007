import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Icon, type IconName } from "../../components/ui";
import { printed } from "../../components/manage/Insights";
import { bizOf } from "../../lib/modes";
import { useOwner, type Section } from "./OwnerApp";

/** Everything the Today screen shows, from owner_today(). Counts only, never who. */
export interface OwnerToday {
  today: string;
  visitors_today: number; visitors_yesterday: number; scans_today: number;
  days: { day: string; visitors: number; reviews: number }[];
  reviews_today: number; reviews_7d: number; reviews: number; avg_rating: number | null;
  need_reply: number; low_open: number; notes_unread: number;
  recovery_open?: number; recovery_overdue?: number; recovery_resolved_30d?: number; recovery_confirmed_30d?: number;
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

/**
 * The owner's home, kept to one idea per card: today's three numbers, the one thing to do next (with a big button),
 * then four quick actions. A new shop sees its setup list instead of empty numbers and charts.
 */
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
    <div className="notice warn row" style={{ gap: 8 }}><Icon name="info" size={16} /><span className="grow">Today's numbers could not load. Open Customer help to check requests, or refresh this page.</span></div>
  );

  const daysLeft = t.period_end ? Math.ceil((new Date(t.period_end).getTime() - Date.now()) / DAY_MS) : null;
  const catalogWord = catalog.toLowerCase();
  const biz = bizOf(place.kind, place.category);

  // What needs the owner, most urgent first. Each row opens the screen that fixes it.
  const todo: Todo[] = [];
  if ((t.recovery_open ?? 0) > 0) todo.push({ icon: "message", tone: "coral", text: `${t.recovery_open} help ${t.recovery_open === 1 ? "request needs" : "requests need"} attention`, sub: t.recovery_overdue ? `${t.recovery_overdue} past the 30-minute follow-up target. Assign someone and record the action taken.` : "Assign someone, take action, and ask the customer to confirm it is fixed.", to: "help", cta: "Handle requests" });
  if (!t.reviews_open) todo.push({ icon: "lock", tone: "coral", text: "Reviews are paused", sub: "Your plan ended or the trial is used up. Renew to take reviews again.", to: "plan", cta: "Renew" });
  if (t.low_open > 0) todo.push({ icon: "alert", tone: "coral", text: `${t.low_open} low ${t.low_open === 1 ? "rating needs" : "ratings need"} a reply`, sub: "Acknowledge the feedback. A public reply does not close a help request.", to: "reviews", cta: "Reply" });
  if (t.need_reply > 0) todo.push({ icon: "reply", tone: "amber", text: `${n(t.need_reply)} ${t.need_reply === 1 ? "review needs" : "reviews need"} a reply`, sub: "Say thanks. It shows on your page.", to: "reviews", cta: "Reply" });
  if (t.notes_unread > 0) todo.push({ icon: "message", tone: "violet", text: `${t.notes_unread} private ${t.notes_unread === 1 ? "note" : "notes"} to read`, sub: "Only you can see these.", to: "reviews", cta: "Read" });
  if (t.plan_status === "trial" && t.trial_reviews_left != null && t.trial_reviews_left <= 5 && t.reviews_open) todo.push({ icon: "crown", tone: "amber", text: `${t.trial_reviews_left} free ${t.trial_reviews_left === 1 ? "review" : "reviews"} left on your trial`, to: "plan", cta: "See plans" });
  else if (daysLeft != null && daysLeft >= 0 && daysLeft <= 7 && t.reviews_open) todo.push({ icon: "clock", tone: "amber", text: `Your plan ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`, to: "plan", cta: "Renew" });

  // The four things every new shop needs, in the order that makes sense.
  const setup: (Todo & { done: boolean })[] = [
    { done: hasPin === true, icon: "pin", tone: "sky", text: "Put your shop on the map", sub: "So people nearby can find you.", to: "details", cta: "Add map pin" },
    { done: (items ?? 0) >= 5, icon: "box", tone: "", text: `Add 5 things to your ${catalogWord}${items ? ` (${Math.min(items, 5)} of 5)` : ""}`, sub: "Customers tick what they liked. A photo of your menu works.", to: "menu", cta: `Add to ${catalogWord}` },
    { done: t.qr_active > 0 && (printed(place.id) || t.reviews > 0), icon: "print", tone: "violet", text: "Print your QR codes", sub: `Put them ${biz.qrWhere}.`, to: "qr", cta: "Print" },
    { done: t.reviews > 0, icon: "star", tone: "amber", text: "Invite honest feedback", sub: "Invite every customer to give feedback, whatever their experience.", to: biz.linkFirst ? "reviews" : "qr", cta: biz.linkFirst ? "Send a review link" : "Show my QR" },
  ];
  const setupLeft = items === null ? 0 : setup.filter((s) => !s.done).length;
  const starting = setupLeft > 0 && t.reviews === 0;
  // One clear next step: something urgent first, then the next setup step.
  const next = todo[0] ?? setup.find((s) => !s.done && items !== null) ?? null;
  const rest = todo.slice(1);
  const visits14 = t.days.reduce((a, d) => a + d.visitors, 0);

  return (
    <div className="ow-today">
      <section className="ow-hello" aria-label="Today">
        <div className="ow-hello-head">
          <span className="stack tight"><span className="ow-kicker">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</span><h1>{starting ? "Let's get you ready" : greeting()}</h1></span>
        </div>
        {starting ? (
          <div className="ow-ready">
            <div className="ow-meter light" aria-hidden="true"><span style={{ width: `${((setup.length - setupLeft) / setup.length) * 100}%` }} /></div>
            <span className="small">{setup.length - setupLeft} of {setup.length} done. About 10 minutes in all.</span>
          </div>
        ) : (
          <div className="ow-kpis three">
            <Kpi icon="message" label="Open help requests" value={t.recovery_open == null ? "–" : n(t.recovery_open)} sub={t.recovery_overdue ? `${t.recovery_overdue} past target` : "Check the help queue"} alert={Boolean(t.recovery_overdue)} onClick={() => go("help")} />
            <Kpi icon="checkCircle" label="Customer confirmed" value={t.recovery_confirmed_30d == null ? "–" : n(t.recovery_confirmed_30d)} sub="resolved in last 30 days" onClick={() => go("help")} />
            <Kpi icon="people" label="People who scanned" value={n(t.visitors_today)} sub="today · not total footfall" onClick={() => go("customers")} />
          </div>
        )}
      </section>

      <div className="ow-grid">
        <div className="ow-col">
          {next ? (
            <section className={`ow-card ow-next ow-o1 ${next.tone}`} aria-labelledby="next-h">
              <span className="ow-kicker dark">{todo[0] ? "Do this first" : "Next step"}</span>
              <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                <span className={`icon-chip ${next.tone}`}><Icon name={next.icon} size={22} /></span>
                <span className="grow stack tight" style={{ minWidth: 0 }}><h2 id="next-h">{next.text}</h2>{next.sub && <span className="small muted">{next.sub}</span>}</span>
              </div>
              <button type="button" className="btn green ow-next-btn" onClick={() => go(next.to, { replace: false })}>{next.cta}<Icon name="chev" size={18} /></button>
            </section>
          ) : (
            <section className="ow-card ow-o1" aria-label="All caught up">
              <div className="ow-clear"><span className="icon-chip lg"><Icon name="checkCircle" size={24} /></span><b>All caught up</b><span className="small muted">Nothing waiting for you. Enjoy your day.</span></div>
            </section>
          )}

          {starting ? (
            <section className="ow-card ow-o3" aria-labelledby="setup-h">
              <div className="ow-card-h"><span className="icon-chip sm"><Icon name="checkCircle" size={16} /></span><h2 id="setup-h" className="grow">Your setup list</h2><span className="badge gray">{setup.length - setupLeft} of {setup.length}</span></div>
              <div className="ow-list">
                {setup.map((x, i) => (
                  <button key={x.text} type="button" className={`ow-row ${x.done ? "done" : ""}`} disabled={x.done} onClick={() => go(x.to, { replace: false })}>
                    <span className="ow-tick" aria-hidden="true">{x.done ? <Icon name="check" size={14} width={3} /> : i + 1}</span>
                    <span className="grow">{x.text}</span>
                    {x.done ? <span className="sr-only">Done</span> : <Icon name="chev" size={16} color="var(--muted)" />}
                  </button>
                ))}
              </div>
            </section>
          ) : rest.length > 0 && (
            <section className="ow-card ow-o3" aria-labelledby="todo-h">
              <div className="ow-card-h"><span className="icon-chip sm coral"><Icon name="bell" size={16} /></span><h2 id="todo-h" className="grow">Also waiting</h2><span className="ow-count">{rest.length}</span></div>
              <div className="ow-list">
                {rest.map((x) => (
                  <button key={x.text} type="button" className="ow-row" onClick={() => go(x.to, { replace: false })}>
                    <span className={`icon-chip sm ${x.tone}`}><Icon name={x.icon} size={16} /></span>
                    <span className="grow stack tight" style={{ minWidth: 0 }}><b>{x.text}</b>{x.sub && <small className="muted">{x.sub}</small>}</span>
                    <Icon name="chev" size={18} color="var(--muted)" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {!starting && visits14 > 0 && <VisitsChart days={t.days} />}
        </div>

        <div className="ow-col">
          <section className={`ow-card ${starting ? "ow-o4" : "ow-o2"}`} aria-labelledby="qa-h">
            <div className="ow-card-h"><span className="icon-chip sm violet"><Icon name="zap" size={16} /></span><h2 id="qa-h" className="grow">Quick actions</h2></div>
            <div className="ow-actions four">
              <Action icon="print" tone="violet" label="Print QR" onClick={() => go("qr", { replace: false })} />
              {biz.linkFirst
                ? <Action icon="link" tone="sky" label="Review link" onClick={() => go("reviews")} />
                : <Action icon="message" tone="sky" label="Customer help" onClick={() => go("help")} />}
              <Action icon="ticket" tone="coral" label="New deal" onClick={() => go("deals")} />
              <Action icon="plus" tone="" label="Add item" onClick={() => go("menu", { replace: false })} />
            </div>
          </section>

          {!starting && (
            <section className="ow-card ow-o4" aria-labelledby="wk-h">
              <div className="ow-card-h"><span className="icon-chip sm coral"><Icon name="ticket" size={16} /></span><h2 id="wk-h" className="grow">Deals and QR codes</h2></div>
              <div className="ow-list">
                <button type="button" className="ow-row" onClick={() => go("deals")}>
                  <span className="grow stack tight"><b>{t.deals_live ? `${t.deals_on_now} of ${t.deals_live} deals on now` : "No deals yet"}</b>
                    <small className="muted">{t.deals_live ? `Used ${n(t.deal_uses_today)} ${t.deal_uses_today === 1 ? "time" : "times"} today` : "Publish a deal and track redemptions. A redemption does not establish an additional sale."}</small></span>
                  <Icon name="chev" size={18} color="var(--muted)" />
                </button>
                <button type="button" className="ow-row" onClick={() => go("qr", { replace: false })}>
                  <span className="grow stack tight"><b>{n(t.scans_today)} {t.scans_today === 1 ? "scan" : "scans"} today</b><small className="muted">{t.qr_active} of {t.qr_limit} QR codes on</small></span>
                  <Icon name="chev" size={18} color="var(--muted)" />
                </button>
              </div>
            </section>
          )}

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

interface Todo { icon: IconName; tone: string; text: string; sub?: string; to: Section; cta: string }

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

/** Visitors per day for two weeks: one series, so no legend; each bar has its own tooltip. */
function VisitsChart({ days }: { days: OwnerToday["days"] }) {
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const total = days.reduce((a, d) => a + d.visitors, 0);
  const [hover, setHover] = useState<number | null>(null);
  const label = (d: OwnerToday["days"][number]) => new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const shown = hover != null ? days[hover] : null;
  return (
    <section className="ow-card ow-o6" aria-labelledby="chart-h">
      <div className="ow-card-h"><span className="icon-chip sm sky"><Icon name="chart" size={16} /></span><h2 id="chart-h" className="grow">Daily scanner counts, last 14 days</h2><span className="small strong">{n(total)}</span></div>
      <p className="tiny muted">Unique people per day who opened a QR or review link, summed across days. Repeat people may appear on several days. This does not measure total customers or purchases.</p>
      <div className="ow-tip small" aria-live="polite">{shown ? <><b>{label(shown)}</b>: {shown.visitors} {shown.visitors === 1 ? "visitor" : "visitors"}, {shown.reviews} {shown.reviews === 1 ? "review" : "reviews"}</> : <span className="muted">Tap a bar to see the day</span>}</div>
      <div className="ow-bars" role="list" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <button key={d.day} type="button" role="listitem" className={`ow-bar ${i === days.length - 1 ? "now" : ""} ${hover === i ? "hot" : ""}`}
            aria-label={`${label(d)}: ${d.visitors} ${d.visitors === 1 ? "visitor" : "visitors"}, ${d.reviews} ${d.reviews === 1 ? "review" : "reviews"}`}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}>
            <span style={{ height: `${Math.max(d.visitors ? 6 : 2, (d.visitors / max) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="ow-axis tiny muted"><span>{days[0] ? label(days[0]) : ""}</span><span>Today</span></div>
    </section>
  );
}
