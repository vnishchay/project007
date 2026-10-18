import { allowedInFocus, clearFocusShop, focusShop } from "../lib/focus";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import * as L from "lucide-react";
import { useAuth } from "../lib/auth";
import { avatarUrl } from "../lib/supabase";
import { acceptPendingInvite, pendingRef } from "../lib/invite";
import { avatarColor, initials } from "../lib/util";
import { goBack } from "../lib/nav";

/* ---------- Icons (lucide) ---------- */
const ICONS = {
  search: L.Search, back: L.ChevronLeft, chev: L.ChevronRight, down: L.ChevronDown, up: L.ArrowUp, arrowDown: L.ArrowDown,
  star: L.Star, locate: L.LocateFixed, globe: L.Globe, close: L.X, home: L.House, scan: L.ScanLine, qr: L.QrCode,
  people: L.Users, user: L.UserRound, userPlus: L.UserPlus, pin: L.MapPin, check: L.Check, checkCircle: L.CircleCheck,
  bookmark: L.Bookmark, share: L.Share2, mic: L.Mic, spark: L.Sparkles, copy: L.Copy, external: L.ExternalLink,
  store: L.Store, shield: L.ShieldCheck, plus: L.Plus, print: L.Printer, download: L.Download, camera: L.Camera,
  image: L.Image, imagePlus: L.ImagePlus, edit: L.Pencil, trash: L.Trash2, eye: L.Eye, eyeOff: L.EyeOff,
  food: L.Utensils, heart: L.Heart, message: L.MessageSquare, thumbs: L.ThumbsUp, thumbsDown: L.ThumbsDown, verified: L.BadgeCheck,
  clock: L.Clock, phone: L.Phone, navigate: L.Navigation, link: L.Link, settings: L.Settings, logout: L.LogOut,
  login: L.LogIn, minus: L.Minus, crown: L.Crown, box: L.Package, tag: L.Tag, rupee: L.IndianRupee, grip: L.GripVertical,
  flame: L.Flame, trophy: L.Trophy, award: L.Award, lock: L.Lock, send: L.Send, info: L.Info, alert: L.CircleAlert,
  zap: L.Zap, flag: L.Flag, wallet: L.Wallet, dashboard: L.LayoutDashboard, chart: L.ChartBar, filter: L.Filter, list: L.List,
  grid: L.Grid2x2, bag: L.ShoppingBag, coffee: L.Coffee, cake: L.CakeSlice, scissors: L.Scissors, map: L.Map, refresh: L.RefreshCw, ticket: L.Ticket,
} satisfies Record<string, L.LucideIcon>;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = "currentColor", width = 2, fill }: { name: IconName; size?: number; color?: string; width?: number; fill?: string }) {
  const C = ICONS[name];
  return <C size={size} color={color} strokeWidth={width} fill={fill ?? "none"} aria-hidden="true" />;
}

/* ---------- Stars ---------- */
const STAR = "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z";

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={i <= Math.round(value) ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden="true"><path d={STAR} /></svg>
      ))}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="star-input" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? "s" : ""}`} onClick={() => onChange(i)}>
          <svg width="42" height="42" viewBox="0 0 24 24" fill={i <= value ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" aria-hidden="true"><path d={STAR} /></svg>
        </button>
      ))}
    </div>
  );
}

/* ---------- Avatar ---------- */
export function Avatar({ id, name, path, size = "" }: { id: string; name: string | null | undefined; path?: string | null; size?: "" | "lg" | "sm" }) {
  const url = avatarUrl(path);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  return (
    <span className={`avatar ${size}`} style={{ background: avatarColor(id) }} title={name || undefined}>
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

/* ---------- Layout ---------- */
export function Layout({ children }: { children: ReactNode }) {
  const { authError, clearAuthError, session, isGuest, loading } = useAuth();
  const loc = useLocation();
  // Shop mode keeps customers (guests, signed-out visitors) with the shop they scanned. A signed-in
  // account may be the owner, so it always gets the full app, never a redirect to the shop page.
  const account = Boolean(session) && !isGuest;
  useEffect(() => { if (account) clearFocusShop(); }, [account, loc.pathname]);
  const shop = account || loading ? null : focusShop();
  return (
    <div className="app">
      {authError && loc.pathname !== "/signin" && (
        <div className="notice err row no-print" style={{ margin: "12px 20px 0" }} role="alert">
          <span className="grow">Sign-in didn't finish: {authError}. <Link to="/signin">Try again</Link></span>
          <button className="link-btn" aria-label="Dismiss" onClick={clearAuthError}><Icon name="close" size={16} color="var(--danger)" /></button>
        </div>
      )}
      <InviteAcceptor />
      {shop && !allowedInFocus(loc.pathname, shop) ? <Navigate to={`/p/${shop}`} replace /> : children}
    </div>
  );
}

/** Someone opened a friend's link: once they have a session, make them friends. */
function InviteAcceptor() {
  const { session, isGuest } = useAuth();
  const toast = useToast();
  const uid = session?.user.id;
  useEffect(() => {
    if (!uid || !pendingRef()) return;
    acceptPendingInvite(isGuest).then((f) => {
      if (f?.is_new) toast(`You and ${f.display_name || "your friend"} are now friends`);
    });
  }, [uid, isGuest, toast]);
  return null;
}

export function TopBar({ title, sub, right }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="topbar">
      {!focusShop() && <button className="icon-btn" aria-label="Back" onClick={() => goBack(nav)}><Icon name="back" /></button>}
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
export function QrImage({ text, size = 200, dark = "#1d1b22", light = "#FFFFFF" }: { text: string; size?: number; dark?: string; light?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: "M", color: { dark, light } }).then(setSrc);
  }, [text, size, dark, light]);
  return src ? <img src={src} width={size} height={size} alt="QR code" /> : <div style={{ width: size, height: size }} />;
}

export async function qrPngDataUrl(text: string, dark = "#1d1b22", light = "#FFFFFF"): Promise<string> {
  return QRCode.toDataURL(text, { width: 1200, margin: 2, errorCorrectionLevel: "M", color: { dark, light } });
}
