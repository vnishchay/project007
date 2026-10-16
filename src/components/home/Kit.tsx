import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import * as L from "lucide-react";
import { Icon, type IconName } from "../ui";
import "../../styles/home.css";

/* Icons ui.tsx doesn't carry, for categories and small touches. */
const EXTRA = {
  pizza: L.Pizza, croissant: L.Croissant, cake: L.CakeSlice, cocktail: L.Martini, spa: L.Flower2, soup: L.Soup,
  burger: L.Sandwich, pasta: L.CookingPot, gift: L.Gift, sun: L.Sun, moon: L.Moon, sunrise: L.Sunrise,
  shirt: L.Shirt, dumbbell: L.Dumbbell, iceCream: L.IceCreamCone, compass: L.Compass, mail: L.Mail,
  userMinus: L.UserMinus, userCheck: L.UserRoundCheck, handshake: L.HeartHandshake, party: L.PartyPopper,
  flashlight: L.Flashlight, keyboard: L.Keyboard, mapPinned: L.MapPinned, ghost: L.Ghost, wand: L.WandSparkles,
  basket: L.ShoppingBasket, salad: L.Salad,
} satisfies Record<string, L.LucideIcon>;
export type GlyphName = IconName | keyof typeof EXTRA;

export function Glyph({ name, size = 20, color = "currentColor", width = 2, fill }: { name: GlyphName; size?: number; color?: string; width?: number; fill?: string }) {
  if (name in EXTRA) {
    const C = EXTRA[name as keyof typeof EXTRA];
    return <C size={size} color={color} strokeWidth={width} fill={fill ?? "none"} aria-hidden="true" />;
  }
  return <Icon name={name as IconName} size={size} color={color} width={width} fill={fill} />;
}

export type Tone = "green" | "amber" | "coral" | "sky" | "violet";

export function Chip({ icon, tone = "green", size = "", iconSize }: { icon: GlyphName; tone?: Tone; size?: "" | "sm" | "lg"; iconSize?: number }) {
  return (
    <span className={`icon-chip ${tone === "green" ? "" : tone} ${size}`} aria-hidden="true">
      <Glyph name={icon} size={iconSize ?? (size === "sm" ? 16 : size === "lg" ? 26 : 20)} />
    </span>
  );
}

/* What kind of shop: an icon and a colour. Works on categories and search words. */
const LOOKS: [RegExp, GlyphName, Tone][] = [
  [/pizz/i, "pizza", "coral"],
  [/bak|bread|croissant|pastr/i, "croissant", "amber"],
  [/cake|dessert|sweet|ice ?cream|mithai/i, "cake", "coral"],
  [/caf|coffee|tea|chai/i, "coffee", "amber"],
  [/salon|hair|barber|beauty|nail/i, "scissors", "violet"],
  [/spa|massage|wellness/i, "spa", "violet"],
  [/gym|fitness|yoga/i, "dumbbell", "sky"],
  [/bar|pub|cocktail|brew/i, "cocktail", "violet"],
  [/biryani|curry|soup/i, "soup", "coral"],
  [/burger|sandwich/i, "burger", "amber"],
  [/pasta|italian/i, "pasta", "coral"],
  [/shop|store|boutique|cloth|fashion|retail|market/i, "bag", "sky"],
  [/grocery|kirana/i, "basket", "green"],
  [/restaurant|food|dine|kitchen|dhaba|meal|thali|dosa/i, "food", "green"],
];
export function lookFor(text: string | null | undefined): { icon: GlyphName; tone: Tone } {
  for (const [re, icon, tone] of LOOKS) if (re.test(text || "")) return { icon, tone };
  return { icon: "store", tone: "green" };
}

/* A friend's link: how they joined. */
export function viaLook(via: string): { icon: GlyphName; tone: Tone; label: string } {
  if (via === "review") return { icon: "star", tone: "amber", label: "a shared review" };
  if (via === "place") return { icon: "store", tone: "sky", label: "a shared place" };
  if (via === "qr") return { icon: "qr", tone: "violet", label: "QR code" };
  return { icon: "link", tone: "green", label: "invite link" };
}

/* A cover photo, or a coloured tile with the shop's icon. */
export function Cover({ url, category, size = 32 }: { url: string | null | undefined; category: string | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false);
  const look = lookFor(category);
  if (url && !broken) return <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />;
  return <span className={`thumb-fallback ${look.tone}`}><Glyph name={look.icon} size={size} width={1.8} /></span>;
}

export function SectionTitle({ icon, tone = "green", children, right }: { icon: GlyphName; tone?: Tone; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-title">
      <Chip icon={icon} tone={tone} size="sm" />
      <span className="grow">{children}</span>
      {right}
    </div>
  );
}

export function EmptyArt({ icon, tone = "green", title, children }: { icon: GlyphName; tone?: Tone; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty-art">
      <Chip icon={icon} tone={tone} iconSize={30} />
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function MenuRow({ to, icon, tone = "green", title, sub, right, onClick }: { to?: string; icon: GlyphName; tone?: Tone; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      <Chip icon={icon} tone={tone} />
      <span className="grow stack tight" style={{ minWidth: 0 }}>
        <span className="t ellipsis">{title}</span>
        {sub && <span className="s ellipsis">{sub}</span>}
      </span>
      {right ?? <Icon name="chev" size={18} color="var(--muted)" />}
    </>
  );
  if (to) return <Link to={to} className="menu-row">{inner}</Link>;
  return <button type="button" className="menu-row" onClick={onClick}>{inner}</button>;
}

export function Retry({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="notice err row" role="alert">
      <Icon name="alert" size={18} color="var(--danger)" />
      <span className="grow">{msg}</span>
      <button type="button" className="icon-act danger" aria-label="Retry" title="Retry" onClick={onRetry}><Icon name="refresh" size={18} /></button>
    </div>
  );
}

/* "Good morning", with a matching icon. */
export function greeting(now = new Date()): { text: string; icon: GlyphName } {
  const h = now.getHours();
  if (h < 5) return { text: "Hello, night owl", icon: "moon" };
  if (h < 12) return { text: "Good morning", icon: "sunrise" };
  if (h < 17) return { text: "Good afternoon", icon: "sun" };
  return { text: "Good evening", icon: "moon" };
}
