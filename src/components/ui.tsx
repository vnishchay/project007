import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { useAuth } from "../lib/auth";
import { avatarUrl } from "../lib/supabase";
import { avatarColor, initials } from "../lib/util";

/* ---------- Icons ---------- */
const paths: Record<string, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  chev: <path d="M9 5l7 7-7 7" />,
  down: <path d="M6 9l6 6 6-6" />,
  star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
  locate: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="7" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 12h8" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2A5 5 0 0 1 21.5 19" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  pin: <><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
  share: <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  store: <path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  print: <><path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>,
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
};

export function Icon({ name, size = 20, color = "currentColor", width = 2 }: { name: keyof typeof paths | string; size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/* ---------- Stars ---------- */
const STAR = "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z";

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={i <= Math.round(value) ? "currentColor" : "#E6E8E3"} aria-hidden="true"><path d={STAR} /></svg>
      ))}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="star-input" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? "s" : ""}`} onClick={() => onChange(i)}>
          <svg width="42" height="42" viewBox="0 0 24 24" fill={i <= value ? "#E0A100" : "#E6E8E3"} aria-hidden="true"><path d={STAR} /></svg>
        </button>
      ))}
    </div>
  );
}

/* ---------- Avatar ---------- */
export function Avatar({ id, name, path, size = "" }: { id: string; name: string | null | undefined; path?: string | null; size?: "" | "lg" | "sm" }) {
  const url = avatarUrl(path);
  return (
    <span className={`avatar ${size}`} style={{ background: avatarColor(id) }} title={name || undefined}>
      {url ? <img src={url} alt="" /> : initials(name)}
    </span>
  );
}

/* ---------- Layout ---------- */
export function Layout({ children }: { children: ReactNode }) {
  const { authError, clearAuthError } = useAuth();
  const loc = useLocation();
  return (
    <div className="app">
      {authError && loc.pathname !== "/signin" && (
        <div className="notice err row no-print" style={{ margin: "12px 20px 0" }} role="alert">
          <span className="grow">Sign-in didn't finish: {authError}. <Link to="/signin">Try again</Link></span>
          <button className="link-btn" aria-label="Dismiss" onClick={clearAuthError}><Icon name="close" size={16} color="var(--danger)" /></button>
        </div>
      )}
      {children}
      <BottomNav />
    </div>
  );
}

function BottomNav() {
  return (
    <nav className="nav no-print" aria-label="Main">
      <NavLink to="/" end><Icon name="home" size={22} />Discover</NavLink>
      <NavLink to="/circle"><Icon name="people" size={22} />Circle</NavLink>
      <NavLink to="/scan" aria-label="Scan a table QR"><span className="scan-dot"><Icon name="scan" size={22} color="#fff" /></span></NavLink>
      <NavLink to="/rate"><Icon name="star" size={22} />Rate</NavLink>
      <NavLink to="/me"><Icon name="user" size={22} />You</NavLink>
    </nav>
  );
}

export function TopBar({ title, sub, right }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="topbar">
      <button className="icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav("/"))}><Icon name="back" /></button>
      <div className="grow">
        {title && <div className="strong ellipsis" style={{ fontSize: 16 }}>{title}</div>}
        {sub && <div className="tiny muted ellipsis">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Spinner() { return <div className="spinner" role="status" aria-label="Loading" />; }

/**
 * guestOk: pages anyone can use without an account (writing a review). A guest session is
 * started quietly. Other pages need a real sign-in; guests are sent to the sign-in page.
 */
export function RequireAuth({ children, admin = false, guestOk = false, allowGuest = false }: { children: ReactNode; admin?: boolean; guestOk?: boolean; allowGuest?: boolean }) {
  const { session, loading, profile, isAdmin, isGuest, startGuest } = useAuth();
  const loc = useLocation();
  const [guestFailed, setGuestFailed] = useState(false);
  useEffect(() => {
    if (guestOk && !loading && !session && !guestFailed) startGuest().then((ok) => { if (!ok) setGuestFailed(true); });
  }, [guestOk, loading, session, guestFailed, startGuest]);
  const next = `/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`;
  if (guestOk && !session && guestFailed) return <Navigate to={next} replace />;
  if (loading || (session && !profile) || (guestOk && !session)) return <div className="page"><Spinner /></div>;
  if (!session || (isGuest && !guestOk && !allowGuest)) return <Navigate to={next} replace />;
  if (admin && !isAdmin) return <div className="page"><div className="empty"><h2>Admins only</h2><p>This page is for the Trusted Picks team.</p><Link to="/" className="btn ghost">Go home</Link></div></div>;
  return <>{children}</>;
}

/* ---------- Toast ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  const show = useCallback((m: string) => setToast({ msg: m, id: Date.now() + Math.random() }), []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div key={toast.id} className="toast" role="status" aria-live="polite">{toast.msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- QR image ---------- */
export function QrImage({ text, size = 200, dark = "#111311", light = "#FFFFFF" }: { text: string; size?: number; dark?: string; light?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: "M", color: { dark, light } }).then(setSrc);
  }, [text, size, dark, light]);
  return src ? <img src={src} width={size} height={size} alt="QR code" /> : <div style={{ width: size, height: size }} />;
}

export async function qrPngDataUrl(text: string, dark = "#111311", light = "#FFFFFF"): Promise<string> {
  return QRCode.toDataURL(text, { width: 1200, margin: 2, errorCorrectionLevel: "M", color: { dark, light } });
}
