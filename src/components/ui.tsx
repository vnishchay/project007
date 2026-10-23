import { allowedInFocus, clearFocusShop, focusShop } from "../lib/focus";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import QRCode from "qrcode";
import * as L from "lucide-react";
import { useAuth } from "../lib/auth";
import { avatarUrl } from "../lib/supabase";
import { acceptPendingInvite, pendingRef } from "../lib/invite";
import { avatarColor, initials } from "../lib/util";
import { goBack } from "../lib/nav";
import { ErrorBoundary } from "./ErrorBoundary";

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
  gift: L.Gift, bell: L.Bell, chevronRight: L.ChevronRight, arrowLeft: L.ArrowLeft, fileText: L.FileText,
  key: L.KeyRound, fingerprint: L.Fingerprint, nfc: L.Nfc, walletCards: L.WalletCards,
  dollar: L.DollarSign, euro: L.Euro, pound: L.PoundSterling, yen: L.JapaneseYen, banknote: L.Banknote, reply: L.Reply,
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
  const navType = useNavigationType();
  // Every new screen opens at the top. Back/forward (POP) keeps the browser's own restored position.
  useLayoutEffect(() => { if (navType !== "POP") window.scrollTo(0, 0); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  // Shop mode keeps customers (guests, signed-out visitors) with the shop they scanned. A signed-in
  // account may be the owner, so it always gets the full app, never a redirect to the shop page.
  const account = Boolean(session) && !isGuest;
  useEffect(() => { if (account) clearFocusShop(); }, [account, loc.pathname]);
  const shop = account || loading ? null : focusShop();
  const tabbed = !shop && TAB_ROOTS.includes(loc.pathname);
  // The owner app has its own full-width shell (sidebar on desktop, its own tab bar on phones).
  const owner = loc.pathname === "/owner" || loc.pathname.startsWith("/owner/");
  return (
    <div className={`app ${tabbed ? "tabbed" : ""} ${owner ? "owner-app" : ""}`}>
      {authError && loc.pathname !== "/signin" && (
        <div className="notice err row no-print" style={{ margin: "12px 20px 0" }} role="alert">
          <span className="grow">Sign-in didn't finish: {authError}. <Link to="/signin">Try again</Link></span>
          <button className="link-btn" aria-label="Dismiss" onClick={clearAuthError}><Icon name="close" size={16} color="var(--danger)" /></button>
        </div>
      )}
      <InviteAcceptor />
      <ErrorBoundary resetKey={loc.pathname}>{shop && !allowedInFocus(loc.pathname, shop) ? <Navigate to={`/p/${shop}`} replace /> : children}</ErrorBoundary>
      <BottomNav />
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

/** back: where Back goes when the page was opened directly (no history in the app). */
export function TopBar({ title, sub, right, tone, back = "/" }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; tone?: "hero" | "sunset"; back?: string }) {
  const nav = useNavigate();
  return (
    <div className={tone ? `topbar on-${tone}` : "topbar"}>
      {!focusShop() && <button className="icon-btn" aria-label="Back" onClick={() => goBack(nav, back)}><Icon name="back" /></button>}
      <div className="grow">
        {title && <div className="strong ellipsis" style={{ fontSize: 16 }}>{title}</div>}
        {sub && <div className="tiny muted ellipsis">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** Back button for the dark review-style screens. Hidden in shop mode, where customers stay with the shop they scanned. */
export function RvxBack({ fallback = "/" }: { fallback?: string }) {
  const nav = useNavigate();
  if (focusShop()) return null;
  return <button type="button" className="rvx-back" aria-label="Back" onClick={() => goBack(nav, fallback)}><Icon name="back" size={20} /></button>;
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
/** An optional button inside the toast: a link (`to`) or an action (`onClick`), like "Sign in" or "Undo". */
export interface ToastAction { label: string; to?: string; onClick?: () => void }
type ToastFn = (msg: string, action?: ToastAction) => void;
const ToastCtx = createContext<ToastFn>(() => {});

/** Asks before something that can't be undone, in an in-app sheet instead of the browser's box. */
export interface ConfirmOpts { title: string; body?: string; ok: string; cancel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; id: number; action?: ToastAction } | null>(null);
  const [ask, setAsk] = useState<(ConfirmOpts & { done: (ok: boolean) => void }) | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!toast) return;
    // Long messages and ones with a button stay longer, so there's time to read and tap.
    const t = setTimeout(() => setToast(null), toast.action || toast.msg.length > 60 ? 4500 : 3000);
    return () => clearTimeout(t);
  }, [toast]);
  const show = useCallback<ToastFn>((m, action) => setToast({ msg: m, id: Date.now() + Math.random(), action }), []);
  const confirmFn = useCallback((o: ConfirmOpts) => new Promise<boolean>((done) => setAsk({ ...o, done })), []);
  const answer = (ok: boolean) => { ask?.done(ok); setAsk(null); };
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { ask.done(false); setAsk(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask]);
  return (
    <ToastCtx.Provider value={show}>
      <ConfirmCtx.Provider value={confirmFn}>
        {children}
        {toast && (
          <div key={toast.id} className={`toast ${toast.action ? "has-act" : ""}`} role="status" aria-live="polite">
            <span className="grow">{toast.msg}</span>
            {toast.action && (
              <button type="button" className="toast-act" onClick={() => { const a = toast.action!; setToast(null); if (a.to) nav(a.to); a.onClick?.(); }}>{toast.action.label}</button>
            )}
          </div>
        )}
        {ask && (
          <div className="sheet-backdrop" onClick={() => answer(false)}>
            <div className="sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="cf-t" onClick={(e) => e.stopPropagation()}>
              <h2 id="cf-t">{ask.title}</h2>
              {ask.body && <p className="small muted">{ask.body}</p>}
              <div className="stack" style={{ gap: 8 }}>
                <button type="button" className={`btn block ${ask.danger ? "danger-solid" : "green"}`} autoFocus onClick={() => answer(true)}>
                  {ask.danger && <Icon name="trash" size={18} />}{ask.ok}
                </button>
                <button type="button" className="btn block ghost" onClick={() => answer(false)}>{ask.cancel || "Cancel"}</button>
              </div>
            </div>
          </div>
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
export const useConfirm = () => useContext(ConfirmCtx);

/* ---------- Bottom bar ---------- */
const TAB_ROOTS = ["/", "/picks", "/pocket", "/me"];
/** Discover, Your picks, Pocket and Profile, on the main screens. Never in shop mode (a customer at a table stays with that shop). */
export function BottomNav() {
  const loc = useLocation();
  if (focusShop() || !TAB_ROOTS.includes(loc.pathname)) return null;
  const tabs: { to: string; label: string; icon: IconName }[] = [
    { to: "/", label: "Discover", icon: "search" },
    { to: "/picks", label: "Your picks", icon: "heart" },
    { to: "/pocket", label: "Pocket", icon: "ticket" },
    { to: "/me", label: "Profile", icon: "user" },
  ];
  return (
    <nav className="bottom-nav no-print" aria-label="Main">
      {tabs.map((t) => {
        const on = loc.pathname === t.to;
        return (
          <Link key={t.to} to={t.to} replace className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
            <Icon name={t.icon} size={22} width={on ? 2.4 : 2} />{t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Tabs that work like the platform's: one tab stop for the row, arrow keys move between tabs.
 * `items` are [id, label] (label may be any node).
 */
export function useTabKeys<T extends string>(ids: readonly T[], current: T, pick: (t: T) => void) {
  return (e: React.KeyboardEvent) => {
    const i = ids.indexOf(current);
    let j = -1;
    if (e.key === "ArrowRight") j = (i + 1) % ids.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + ids.length) % ids.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = ids.length - 1;
    if (j < 0) return;
    e.preventDefault();
    pick(ids[j]!);
    const row = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => (row.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus());
  };
}

/* ---------- QR image ---------- */
export function QrImage({ text, size = 200, dark = "#1d1b22", light = "#FFFFFF" }: { text: string; size?: number; dark?: string; light?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: "M", color: { dark, light } }).then(setSrc);
  }, [text, size, dark, light]);
  return src ? <img src={src} width={size} height={size} alt="QR code" /> : <div style={{ width: size, height: size }} />;
}

/** The printed-stand look: rounded dots, soft corners and the Trusted Picks mark in the middle (high error correction keeps it scannable). */
export async function brandQrPngDataUrl(text: string, dark = "#1d1b22", light = "#FFFFFF", size = 1200): Promise<string> {
  const { default: QRCodeStyling } = await import("qr-code-styling");
  const qr = new QRCodeStyling({
    width: size, height: size, margin: Math.round(size / 30), type: "canvas", data: text, image: "/icon-192.png",
    qrOptions: { errorCorrectionLevel: "H" },
    imageOptions: { margin: Math.round(size / 120), imageSize: 0.22, hideBackgroundDots: true, crossOrigin: "anonymous" },
    dotsOptions: { type: "rounded", color: dark },
    cornersSquareOptions: { type: "extra-rounded", color: dark },
    cornersDotOptions: { type: "dot", color: dark },
    backgroundOptions: { color: light },
  });
  const blob = await qr.getRawData("png");
  if (!(blob instanceof Blob)) return qrPngDataUrl(text, dark, light);
  return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(blob); });
}

/** A branded QR (see brandQrPngDataUrl); shows the plain one while the styled one is drawn, or if drawing fails. */
export function BrandQr({ text, size = 200, dark = "#1d1b22", light = "#FFFFFF" }: { text: string; size?: number; dark?: string; light?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    brandQrPngDataUrl(text, dark, light, Math.max(size * 3, 480)).then((u) => { if (alive) setSrc(u); }, () => {});
    return () => { alive = false; };
  }, [text, size, dark, light]);
  return src ? <img src={src} width={size} height={size} alt="QR code" /> : <QrImage text={text} size={size} dark={dark} light={light} />;
}

export async function qrPngDataUrl(text: string, dark = "#1d1b22", light = "#FFFFFF"): Promise<string> {
  return QRCode.toDataURL(text, { width: 1200, margin: 2, errorCorrectionLevel: "M", color: { dark, light } });
}
