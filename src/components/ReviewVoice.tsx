import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

export interface VoiceClip { blob: Blob; mime: string; ext: string; seconds: number }

export const MAX_VOICE_SECONDS = 60;
const HOLD_MS = 450; // a press longer than this is "hold to talk"; shorter is a tap that toggles

export function canRecordVoice(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"];
  for (const m of options) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* old Safari */ }
  }
  return "";
}

export function extFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base === "audio/webm" || base === "video/webm") return "webm";
  if (base === "audio/mp4" || base === "video/mp4" || base === "audio/x-m4a") return "m4a";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/aac") return "aac";
  if (base === "audio/mpeg") return "mp3";
  return "webm";
}

function clock(s: number): string {
  const n = Math.max(0, Math.floor(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/**
 * Voice note recorder. Hold the button to talk and let go to stop, or tap once to
 * start and tap again to stop (also works from the keyboard). Stops itself at 60 s.
 */
export function ReviewVoiceRecorder({ value, onChange, disabled, onRecordingChange }: {
  value: VoiceClip | null;
  onChange: (c: VoiceClip | null) => void;
  disabled?: boolean;
  onRecordingChange?: (on: boolean) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "starting" | "recording">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState("");
  const [url, setUrl] = useState<string | null>(null);

  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const tick = useRef(0);
  const startedAt = useRef(0);
  const pressAt = useRef(0);
  const pressedWhileIdle = useRef(false);
  const stopWanted = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRecRef = useRef(onRecordingChange);
  onRecRef.current = onRecordingChange;

  useEffect(() => {
    if (!value) { setUrl(null); return; }
    const u = URL.createObjectURL(value.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [value]);

  function teardown() {
    cancelAnimationFrame(raf.current);
    clearInterval(tick.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setLevel(0);
  }

  // Stop everything if the page goes away mid-recording.
  useEffect(() => () => {
    const r = rec.current;
    if (r) { r.ondataavailable = null; r.onstop = null; if (r.state !== "inactive") try { r.stop(); } catch { /* already stopped */ } }
    rec.current = null;
    teardown();
  }, []);

  useEffect(() => { onRecRef.current?.(phase !== "idle"); }, [phase]);

  async function start() {
    if (phase !== "idle" || disabled) return;
    setErr("");
    stopWanted.current = false;
    setPhase("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mime = pickMime();
      const r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      rec.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        const seconds = (performance.now() - startedAt.current) / 1000;
        const type = r.mimeType || mime || chunks[0]?.type || "audio/webm";
        teardown();
        rec.current = null;
        setPhase("idle");
        if (!chunks.length || seconds < 0.6) { setErr("That was too short. Hold the button and talk, or tap once to start."); return; }
        const blob = new Blob(chunks, { type });
        onChangeRef.current({ blob, mime: type, ext: extFor(type), seconds: Math.min(MAX_VOICE_SECONDS, seconds) });
      };

      // Live level meter.
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) {
          const ctx = new AC();
          audioCtx.current = ctx;
          const an = ctx.createAnalyser();
          an.fftSize = 512;
          ctx.createMediaStreamSource(s).connect(an);
          const buf = new Uint8Array(an.fftSize);
          const loop = () => {
            an.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) { const v = (buf[i]! - 128) / 128; sum += v * v; }
            setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
            raf.current = requestAnimationFrame(loop);
          };
          loop();
        }
      } catch { /* meter is optional */ }

      r.start(250);
      startedAt.current = performance.now();
      setElapsed(0);
      setPhase("recording");
      tick.current = window.setInterval(() => {
        const s2 = (performance.now() - startedAt.current) / 1000;
        setElapsed(s2);
        if (s2 >= MAX_VOICE_SECONDS) stop();
      }, 200);
      // Let go while the permission prompt was up: still recording, tap to stop.
      if (stopWanted.current) stop();
    } catch (e) {
      teardown();
      rec.current = null;
      setPhase("idle");
      const name = (e as { name?: string })?.name;
      setErr(name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access is blocked. Allow it in your browser settings to record a voice note."
        : name === "NotFoundError" ? "No microphone was found." : "Recording didn't start. Try again.");
    }
  }

  function stop() {
    const r = rec.current;
    if (!r) { stopWanted.current = true; return; }
    clearInterval(tick.current);
    if (r.state !== "inactive") { try { r.stop(); } catch { teardown(); setPhase("idle"); } }
  }

  // Pointer: press starts; releasing after a hold stops; a quick tap leaves it running until the next tap.
  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || disabled) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    pressAt.current = performance.now();
    if (phase === "idle") { pressedWhileIdle.current = true; void start(); }
    else { pressedWhileIdle.current = false; stop(); }
  }
  function onPointerUp() {
    if (!pressedWhileIdle.current) return;
    pressedWhileIdle.current = false;
    const held = performance.now() - pressAt.current;
    // Only a real hold that began recording counts; time spent on a permission prompt doesn't.
    if (held > HOLD_MS && rec.current && performance.now() - startedAt.current > HOLD_MS) stop();
  }
  // Keyboard and screen readers fire click with detail 0: plain toggle.
  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (e.detail !== 0) return;
    if (phase === "idle") void start(); else stop();
  }

  if (value && url && phase === "idle") {
    return (
      <div className="card soft" style={{ padding: 12, gap: 8 }}>
        <div className="row between">
          <span className="small strong"><Icon name="mic" size={14} /> Voice note · {clock(value.seconds)}</span>
          <button type="button" className="link-btn" style={{ color: "var(--danger)" }} onClick={() => onChange(null)} disabled={disabled} aria-label="Remove voice note">
            <Icon name="close" size={14} color="var(--danger)" />Remove
          </button>
        </div>
        <audio controls src={url} preload="metadata" style={{ width: "100%", height: 36 }} aria-label="Your voice note" />
      </div>
    );
  }

  const recording = phase === "recording";
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap">
        <button
          type="button"
          className={`btn small ${recording ? "green" : "ghost"}`}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onClick}
          onContextMenu={(e) => e.preventDefault()}
          disabled={disabled && !recording}
          aria-pressed={recording}
          style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
        >
          <Icon name="mic" size={16} />
          {phase === "starting" ? "Starting mic…" : recording ? `Recording ${clock(elapsed)} · tap to stop` : "Hold to record a voice note"}
        </button>
        {recording && (
          <span className="tiny muted" aria-hidden="true">{clock(MAX_VOICE_SECONDS - elapsed)} left</span>
        )}
      </div>
      {recording && (
        <div className="bar" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
          <span style={{ width: `${Math.max(4, level * 100)}%`, transition: "width 80ms linear" }} />
        </div>
      )}
      <span role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {recording ? "Recording" : ""}
      </span>
      {!recording && phase === "idle" && <span className="tiny muted">Or tap once to start and again to stop. Up to {MAX_VOICE_SECONDS} seconds.</span>}
      {err && <span className="small" role="alert" style={{ color: "var(--danger)" }}>{err}</span>}
    </div>
  );
}
