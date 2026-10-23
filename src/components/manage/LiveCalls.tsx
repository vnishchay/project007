import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, errorText } from "../../lib/supabase";
import { pushState, turnOnReminders, type PushState } from "../../lib/push";
import { CALLS, answerCall, loadBoard, waited, type LiveBoard, type TableCall } from "../../lib/service";
import { Icon, useToast } from "../ui";
import "../../styles/service.css";

const SOUND_KEY = "tp-live-sound";
/** Waiting longer than this shows in red. */
const LATE_MS = 4 * 60000;

/** Two soft notes, like a counter bell. Browsers only allow it after a tap on the page, which opening this tab is. */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1318].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.65);
    });
    window.setTimeout(() => void ctx.close(), 1200);
  } catch { /* no sound on this browser */ }
}

const secs = (s: number | null) => (s == null ? "–" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

/**
 * The live board: tables calling the staff, asking for the bill, or telling the shop something now.
 * Keep it open on the counter phone or tablet; it rings for each new call. Phone alerts work even when closed.
 */
export function LiveCalls({ placeId, live }: { placeId: string; live: boolean }) {
  const toast = useToast();
  const [b, setB] = useState<LiveBoard | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(() => { try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; } });
  const [push, setPush] = useState<PushState | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const load = useCallback(async () => {
    const x = await loadBoard(placeId);
    if (!x) { setB((old) => old ?? null); return; }
    // Ring for calls that are new (or pinged again) since the last look; not for the first load.
    const keys = new Set(x.open.map((c) => `${c.id}:${c.pinged_at}`));
    if (known.current) {
      const added = x.open.filter((c) => !known.current!.has(`${c.id}:${c.pinged_at}`));
      if (added.length) {
        if (soundRef.current) chime();
        navigator.vibrate?.([120, 80, 120]);
        setFresh((f) => new Set([...f, ...added.map((c) => c.id)]));
      }
    }
    known.current = keys;
    setB(x);
    setNow(Date.now());
  }, [placeId]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); else setNow(Date.now()); }, 4000);
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);
  useEffect(() => { pushState().then(setPush, () => setPush("unsupported")); }, []);

  // The tab title shows how many are waiting, so a busy counter sees it from any tab.
  const waiting = b?.open.length ?? 0;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = waiting ? `(${waiting}) ${base}` : base;
    return () => { document.title = document.title.replace(/^\(\d+\) /, ""); };
  }, [waiting]);

  async function act(c: TableCall, a: "seen" | "done") {
    setB((x) => x && {
      ...x,
      open: a === "done" ? x.open.filter((o) => o.id !== c.id) : x.open.map((o) => (o.id === c.id ? { ...o, seen_at: new Date().toISOString() } : o)),
      done: a === "done" ? [{ ...c, done_at: new Date().toISOString() }, ...x.done] : x.done,
    });
    setFresh((f) => { const n = new Set(f); n.delete(c.id); return n; });
    try { await answerCall(c.id, a); } catch (e) { toast(errorText(e)); }
    void load();
  }

  async function setCalls(on: boolean) {
    setB((x) => x && { ...x, calls: on });
    const { error } = await supabase.rpc("set_table_calls", { p_place: placeId, p_on: on });
    if (error) { toast(errorText(error)); void load(); return; }
    toast(on ? "Tables can call you now" : "Table calls are off");
  }

  async function setAlerts(on: boolean) {
    if (on) {
      const s = await turnOnReminders().catch(() => "unsupported" as PushState);
      setPush(s);
      if (s !== "on") {
        toast(s === "install" ? "On iPhone, add the app to your Home Screen first, then turn alerts on there"
          : s === "denied" ? "Notifications are blocked for this site in your phone's settings"
          : "This browser can't show alerts. Keep this screen open instead");
        return;
      }
    }
    const { error } = await supabase.rpc("set_shop_alerts", { p_place: placeId, p_on: on });
    if (error) { toast(errorText(error)); return; }
    setB((x) => x && { ...x, alerts: on });
    toast(on ? "Alerts on for this account's phones" : "Alerts off");
  }

  function flipSound() {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem(SOUND_KEY, next ? "on" : "off"); } catch { /* fine */ }
    if (next) chime();
  }

  if (b === undefined) return <div className="skeleton" style={{ height: 160 }} />;
  if (b === null) return <p className="notice err">Couldn't load table calls. Check your connection.</p>;

  return (
    <div className="lv">
      <section className="mg-section">
        <div className="lv-top">
          <span className={`lv-dot ${live ? "" : "off"}`} aria-hidden="true" />
          <b className="grow">{live ? "Live now" : "Your page isn't live yet"}</b>
          <button type="button" className="chip" onClick={flipSound} aria-pressed={sound}>
            <Icon name={sound ? "volume" : "volumeOff"} size={15} />{sound ? "Sound on" : "Sound off"}
          </button>
        </div>
        <label className="switch-row">
          <input type="checkbox" role="switch" checked={b.calls} onChange={(e) => void setCalls(e.target.checked)} />
          <span><b>Table calls</b><br /><span className="tiny muted">Diners tap Call staff or Get the bill on the table code. Turn it off if nobody can watch this.</span></span>
        </label>
        {push !== "unset" && (
          <label className="switch-row">
            <input type="checkbox" role="switch" checked={b.alerts && push === "on"} onChange={(e) => void setAlerts(e.target.checked)} />
            <span><b>Alert my phone</b><br /><span className="tiny muted">A notification for every call, even with the app closed.</span></span>
          </label>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>"Tell the shop now" messages always come here. You see the table, never who sent it, and it's never linked to a review.</p>
      </section>

      <div className="lv-stats">
        <div><b>{waiting}</b><small>Waiting now</small></div>
        <div><b>{b.today.count}</b><small>Calls today</small></div>
        <div><b>{secs(b.today.answer_s)}</b><small>Typical answer</small></div>
      </div>

      <div className="lv-list" aria-live="polite">
        {b.open.length === 0 ? (
          <div className="lv-empty">
            <Icon name="service" size={34} color="var(--good)" />
            <b style={{ color: "var(--ink)" }}>All tables happy</b>
            <span className="small">{b.calls ? "New calls ring here. Keep this screen open at the counter." : "Turn on table calls to let diners call you from their table."}</span>
          </div>
        ) : b.open.map((c) => {
          const k = CALLS[c.kind];
          const age = now - new Date(c.pinged_at).getTime();
          return (
            <div key={c.id} className={`lv-card tone-${k.tone} ${fresh.has(c.id) && !c.seen_at ? "new" : ""}`}>
              <span className="ic"><Icon name={k.icon} size={22} /></span>
              <span className="t"><b>{c.table_label || "Counter"}</b>
                <span className={age > LATE_MS && !c.seen_at ? "late" : ""}>{waited(c.pinged_at, now)}{c.pinged_at !== c.created_at ? " · asked again" : ""}</span></span>
              {c.kind === "help" ? <span className="m">“{c.message}”</span> : <span className="k">{k.owner}</span>}
              <span className="acts">
                {!c.seen_at && <button type="button" className="btn ghost" onClick={() => void act(c, "seen")}><Icon name="check" size={16} />On it</button>}
                <button type="button" className="btn" onClick={() => void act(c, "done")}><Icon name="checkCircle" size={16} />Done</button>
              </span>
            </div>
          );
        })}
      </div>

      {b.done.length > 0 && (
        <section className="mg-section">
          <div className="mg-section-head"><span className="icon-chip sm" style={{ background: "var(--good-soft)", color: "var(--good-dark)" }}><Icon name="check" size={16} /></span><span className="grow">Done today</span><span className="badge gray">{b.done.length}</span></div>
          <div>
            {b.done.map((c) => (
              <div key={c.id} className="lv-done">
                <Icon name={CALLS[c.kind].icon} size={16} />
                <span className="grow"><b>{c.table_label || "Counter"}</b> · {c.kind === "help" ? c.message : CALLS[c.kind].owner}</span>
                <span className="tiny">{secs(Math.round((new Date(c.done_at!).getTime() - new Date(c.created_at).getTime()) / 1000))}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
