import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, Spinner, TopBar } from "../components/ui";

// BarcodeDetector is built into Chrome on Android and some Safari versions. Everywhere
// else (iPhone Safari, Firefox, desktop) frames are decoded with jsQR instead.
interface Detected { rawValue: string }
interface Detector { detect(src: CanvasImageSource): Promise<Detected[]> }
interface DetectorCtor {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
}
declare global {
  interface Window { BarcodeDetector?: DetectorCtor }
}

type JsQr = typeof import("jsqr").default;
type CamState = "starting" | "scanning" | "unsupported" | "denied" | "nocamera" | "busy" | "failed";

/** A token from a scanned value: only our /q/<token> links or a bare 16-hex token. */
function tokenFromScan(text: string): string | null {
  const m = text.match(/\/q\/([A-Za-z0-9_-]+)/);
  if (m) return m[1]!;
  const t = text.trim();
  return /^[a-f0-9]{16}$/i.test(t) ? t : null;
}

/** Typed input is looser: any link with /q/<token>, or a bare code. */
function tokenFromInput(text: string): string | null {
  const fromLink = tokenFromScan(text);
  if (fromLink) return fromLink;
  const t = text.trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(t) ? t : null;
}

async function makeDetector(): Promise<Detector | null> {
  const C = window.BarcodeDetector;
  if (!C) return null;
  try {
    if (C.getSupportedFormats) {
      const f = await C.getSupportedFormats();
      if (!f.includes("qr_code")) return null;
    }
    return new C({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

function camStateFrom(e: unknown): CamState {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "nocamera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "failed";
}

export default function Scan() {
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [state, setState] = useState<CamState>("starting");
  const [attempt, setAttempt] = useState(0);
  const [torchOk, setTorchOk] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [foreign, setForeign] = useState(false);
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setState("unsupported"); return; }
    let stream: MediaStream | null = null;
    let timer = 0;
    let raf = 0;
    let stopped = false;
    let foreignTimer = 0;
    setState("starting");
    setTorchOk(false);
    setTorchOn(false);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const found = (raw: string) => {
      const t = tokenFromScan(raw);
      if (t) { stopped = true; stream?.getTracks().forEach((tr) => tr.stop()); nav(`/q/${t}`); return true; }
      // Some other QR code (a menu, Wi-Fi…): say so, keep scanning.
      setForeign(true);
      clearTimeout(foreignTimer);
      foreignTimer = window.setTimeout(() => setForeign(false), 2500);
      return false;
    };

    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const track = s.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        try {
          const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
          setTorchOk(Boolean(caps.torch));
        } catch { /* no capabilities API */ }
        const v = video.current;
        if (v) {
          v.srcObject = s;
          await v.play().catch(() => {});
        }
        if (stopped) return;
        setState("scanning");

        let detector = await makeDetector();
        let jsqr: JsQr | null = null;
        const loadJsQr = async () => { if (!jsqr) jsqr = (await import("jsqr")).default; return jsqr; };
        if (!detector) await loadJsQr();
        let detectorFails = 0;

        const tick = async () => {
          if (stopped) return;
          const el = video.current;
          if (el && el.readyState >= 2 && el.videoWidth > 0) {
            try {
              if (detector) {
                const res = await detector.detect(el);
                detectorFails = 0;
                for (const r of res) if (found(r.rawValue)) return;
              } else if (jsqr && ctx) {
                // Downscale for speed; QR codes on a table card decode fine at 640px.
                const scale = Math.min(1, 640 / el.videoWidth);
                const w = Math.round(el.videoWidth * scale), h = Math.round(el.videoHeight * scale);
                if (canvas.width !== w) canvas.width = w;
                if (canvas.height !== h) canvas.height = h;
                ctx.drawImage(el, 0, 0, w, h);
                const img = ctx.getImageData(0, 0, w, h);
                const qr = jsqr(img.data, w, h, { inversionAttempts: "attemptBoth" });
                if (qr?.data && found(qr.data)) return;
              }
            } catch {
              // A detector that keeps failing (some desktop builds) hands over to jsQR.
              if (detector && ++detectorFails > 5) { detector = null; await loadJsQr().catch(() => {}); }
            }
          }
          if (stopped) return;
          // About 8 frames a second, drawn in step with the display.
          timer = window.setTimeout(() => { raf = requestAnimationFrame(() => { void tick(); }); }, 125);
        };
        void tick();
      } catch (e) {
        if (!stopped) setState(camStateFrom(e));
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(foreignTimer);
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      if (video.current) video.current.srcObject = null;
    };
  }, [nav, attempt]);

  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchOk(false);
    }
  }, [torchOn]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = tokenFromInput(code);
    if (t) nav(`/q/${t}`); else setBad(true);
  }

  const live = state === "starting" || state === "scanning";
  const problem: Record<Exclude<CamState, "starting" | "scanning">, { cls: string; text: string; retry: boolean }> = {
    unsupported: { cls: "", text: "This browser can't use the camera here. Open your phone's camera app and point it at the code on the table; it opens Trusted Picks for you.", retry: false },
    denied: { cls: "warn", text: "Camera access is blocked. Allow the camera for this site in your browser settings (on iPhone: Settings › Safari › Camera), then try again. You can also scan with your phone's camera app.", retry: true },
    nocamera: { cls: "warn", text: "No camera was found on this device. Type the code from the table card below.", retry: true },
    busy: { cls: "warn", text: "The camera is being used by another app. Close it and try again.", retry: true },
    failed: { cls: "warn", text: "The camera didn't start. Try again, or type the code below.", retry: true },
  };

  return (
    <div className="page">
      <TopBar title="Scan a table code" sub="Scanning unlocks a verified visit" />
      {live && (
        <div className="scanner">
          <video ref={video} muted playsInline autoPlay aria-label="Camera view" />
          <div className="frame" aria-hidden="true" />
          {state === "starting" && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff" }}>
              <div className="stack center" style={{ alignItems: "center", gap: 0 }}><Spinner /><span className="small">Starting camera…</span></div>
            </div>
          )}
          {torchOk && (
            <button
              type="button"
              className="btn small"
              onClick={toggleTorch}
              aria-pressed={torchOn}
              aria-label="Flashlight"
              style={{ position: "absolute", right: 12, bottom: 12, background: torchOn ? "#fff" : "rgba(0,0,0,0.6)", color: torchOn ? "var(--ink)" : "#fff" }}
            >
              {torchOn ? "Flashlight on" : "Flashlight"}
            </button>
          )}
        </div>
      )}
      {state === "scanning" && (
        <p className="small muted center" role="status" aria-live="polite">
          {foreign ? "That QR code isn't a Trusted Picks table code." : "Point the camera at the QR code on your table."}
        </p>
      )}
      {!live && (
        <div className={`notice ${problem[state].cls}`} role="alert">
          <div className="stack" style={{ gap: 8 }}>
            <span>{problem[state].text}</span>
            {problem[state].retry && (
              <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => setAttempt((n) => n + 1)}>Try the camera again</button>
            )}
          </div>
        </div>
      )}
      <form className="stack" onSubmit={submit} noValidate>
        <label className="small strong" htmlFor="code">Or type the code or paste the link</label>
        <div className="row">
          <input
            id="code"
            className="input"
            placeholder="e.g. 3f9a1c… or trustedpicks.app/q/…"
            value={code}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            aria-invalid={bad || undefined}
            aria-describedby={bad ? "code-err" : undefined}
            onChange={(e) => { setCode(e.target.value); setBad(false); }}
          />
          <button className="btn small" style={{ height: 50 }} disabled={!code.trim()}>Go <Icon name="chev" size={16} /></button>
        </div>
        {bad && <span id="code-err" className="small" role="alert" style={{ color: "var(--danger)" }}>That doesn't look like a Trusted Picks code.</span>}
      </form>
    </div>
  );
}
