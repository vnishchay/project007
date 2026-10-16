import { todaysHours } from "../../lib/util";
import { Icon } from "../ui";

/** One row per weekday, Monday first. `raw` keeps hours we couldn't read as times. */
export interface DayHours { open: boolean; from: string; to: string; raw?: string }

const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAY = [1, 2, 3, 4, 5, 6, 0];

function parseTime(t: string, suffix?: string): { h: number; m: number; s?: string } | null {
  const m = t.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2] || 0), s: (m[3] || suffix || "").replace(/\./g, "").toLowerCase() || undefined };
}
function to24({ h, m, s }: { h: number; m: number; s?: string }): string | null {
  if (s === "pm" && h < 12) h += 12;
  if (s === "am" && h === 12) h = 0;
  if (h > 24 || m > 59) return null;
  return `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function parseRange(v: string): { from: string; to: string } | null {
  const parts = v.split(/\s*(?:[–—-]|to)\s*/i);
  if (parts.length !== 2) return null;
  const b = parseTime(parts[1]!);
  const a = parseTime(parts[0]!, b?.s);
  const from = a && to24(a), to = b && to24(b);
  return from && to ? { from, to } : null;
}
function fmt(t: string): string {
  const [hh, mm] = t.split(":").map(Number) as [number, number];
  const s = hh >= 12 ? "pm" : "am";
  const h = hh % 12 || 12;
  return `${h}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${s}`;
}
function dayText(d: DayHours): string {
  if (!d.open) return "Closed";
  if (d.raw != null) return d.raw.trim() || "Open";
  return `${fmt(d.from)}–${fmt(d.to)}`;
}

/** Reads stored hours ({"Mon–Sat": "7 am–9 pm"}) into seven rows. */
export function readHours(hours: Record<string, string> | null | undefined): DayHours[] {
  return JS_DAY.map((jd) => {
    const date = new Date(2024, 0, 7 + jd); // 7 Jan 2024 was a Sunday
    const v = todaysHours(hours, date);
    if (!hours || v == null) return { open: !hours, from: "10:00", to: "21:00" };
    if (/closed/i.test(v)) return { open: false, from: "10:00", to: "21:00" };
    const r = parseRange(v);
    return r ? { open: true, ...r } : { open: true, from: "10:00", to: "21:00", raw: v };
  });
}

/** Seven rows back to compact entries, joining days in a row that share hours. */
export function writeHours(days: DayHours[]): Record<string, string> | null {
  if (days.every((d) => !d.open)) return null;
  const out: Record<string, string> = {};
  let i = 0;
  while (i < 7) {
    const t = dayText(days[i]!);
    let j = i;
    while (j + 1 < 7 && dayText(days[j + 1]!) === t) j++;
    out[i === j ? NAMES[i]! : `${NAMES[i]}–${NAMES[j]}`] = t;
    i = j + 1;
  }
  return out;
}

export function HoursEditor({ days, onChange }: { days: DayHours[]; onChange: (d: DayHours[]) => void }) {
  const todayIdx = JS_DAY.indexOf(new Date().getDay());
  const set = (i: number, patch: Partial<DayHours>) => onChange(days.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const copyAll = () => onChange(days.map(() => ({ ...days[todayIdx]! })));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="mg-today">
        <Icon name="clock" size={18} />
        <span className="grow">Today · {dayText(days[todayIdx]!)}</span>
        <button type="button" className="link-btn tiny" onClick={copyAll} aria-label="Use today's hours for every day"><Icon name="copy" size={14} />All days</button>
      </div>
      {days.map((d, i) => (
        <div key={NAMES[i]} className={`mg-day ${i === todayIdx ? "today" : ""}`}>
          <span className="d">{NAMES[i]}</span>
          <button type="button" role="switch" aria-checked={d.open} aria-label={`${NAMES[i]} open`} className={`mg-switch ${d.open ? "on" : ""}`} onClick={() => set(i, { open: !d.open })} />
          {!d.open ? <span className="closed">Closed</span> : d.raw != null ? (
            <div className="times"><input className="input" aria-label={`${NAMES[i]} hours`} value={d.raw} onChange={(e) => set(i, { raw: e.target.value })} />
              <button type="button" className="mg-act" aria-label="Pick times" onClick={() => set(i, { raw: undefined })}><Icon name="clock" size={16} /></button></div>
          ) : (
            <div className="times">
              <input className="input" type="time" aria-label={`${NAMES[i]} opens`} value={d.from} onChange={(e) => set(i, { from: e.target.value })} />
              <span className="muted">–</span>
              <input className="input" type="time" aria-label={`${NAMES[i]} closes`} value={d.to} onChange={(e) => set(i, { to: e.target.value })} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
