import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/ui";

// BarcodeDetector is built into Chrome on Android and recent Safari.
interface Detected { rawValue: string }
interface Detector { detect(src: CanvasImageSource): Promise<Detected[]> }
declare global {
  interface Window { BarcodeDetector?: new (opts: { formats: string[] }) => Detector }
}

function tokenFrom(text: string): string | null {
  const m = text.match(/\/q\/([A-Za-z0-9_-]+)/);
  if (m) return m[1]!;
  return /^[a-f0-9]{16}$/i.test(text.trim()) ? text.trim() : null;
}

export default function Scan() {
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "scanning" | "unsupported" | "denied">("starting");
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) { setState("unsupported"); return; }
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
      if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
      setState("scanning");
      const tick = async () => {
        if (stopped || !video.current) return;
        try {
          const found = await detector.detect(video.current);
          const t = found.map((f) => tokenFrom(f.rawValue)).find(Boolean);
          if (t) { stopped = true; nav(`/q/${t}`); return; }
        } catch { /* frame not ready */ }
        timer = window.setTimeout(tick, 300);
      };
      tick();
    }).catch(() => setState("denied"));
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [nav]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = tokenFrom(code);
    if (t) nav(`/q/${t}`); else setBad(true);
  }

  return (
    <div className="page">
      <TopBar title="Scan a table code" sub="Scanning unlocks a verified visit" />
      {state !== "unsupported" && state !== "denied" && (
        <div className="scanner"><video ref={video} muted playsInline /><div className="frame" /></div>
      )}
      {state === "unsupported" && <div className="notice">Your browser can't scan here. Open your phone's camera and point it at the code on the table; it opens Trusted Picks for you.</div>}
      {state === "denied" && <div className="notice warn">Camera access was blocked. Allow it in your browser settings, or use your phone's camera app to scan the code.</div>}
      <form className="stack" onSubmit={submit}>
        <label className="small strong" htmlFor="code">Or paste the link or code</label>
        <div className="row">
          <input id="code" className="input" placeholder="trustedpicks.app/q/…" value={code} onChange={(e) => { setCode(e.target.value); setBad(false); }} />
          <button className="btn small" style={{ height: 50 }}>Go</button>
        </div>
        {bad && <span className="small" style={{ color: "var(--danger)" }}>That doesn't look like a Trusted Picks code.</span>}
      </form>
    </div>
  );
}
