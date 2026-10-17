import { Facebook, Globe, Instagram, Link as LinkGlyph, Mail, MapPin, MessageCircle, Phone, Youtube, type LucideIcon } from "lucide-react";

export type LinkKindDef = { kind: string; label: string; match: RegExp; color: string; letter?: string; icon?: LucideIcon };

// Order matters: first match wins in guessLinkKind.
export const LINK_KINDS: LinkKindDef[] = [
  { kind: "swiggy", label: "Swiggy", match: /swiggy\.(com|in)|swig\.gy/i, color: "#fc8019", letter: "S" },
  { kind: "zomato", label: "Zomato", match: /zomato\.com|zoma\.to/i, color: "#e23744", letter: "Z" },
  { kind: "magicpin", label: "magicpin", match: /magicpin\.(in|com)/i, color: "#e2156b", letter: "m" },
  { kind: "eatsure", label: "EatSure", match: /eatsure\.com/i, color: "#5b2d90", letter: "E" },
  { kind: "instagram", label: "Instagram", match: /instagram\.com|instagr\.am/i, color: "#d62976", icon: Instagram },
  { kind: "facebook", label: "Facebook", match: /facebook\.com|fb\.(com|me)/i, color: "#1877f2", icon: Facebook },
  { kind: "youtube", label: "YouTube", match: /youtube\.com|youtu\.be/i, color: "#ff0000", icon: Youtube },
  { kind: "whatsapp", label: "WhatsApp", match: /wa\.me|whatsapp\.com/i, color: "#25d366", icon: MessageCircle },
  { kind: "maps", label: "Directions", match: /maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google\./i, color: "#34a853", icon: MapPin },
  { kind: "justdial", label: "Justdial", match: /justdial\.com/i, color: "#0f6fc6", letter: "Jd" },
  { kind: "phone", label: "Call", match: /^tel:/i, color: "#0e9f6e", icon: Phone },
  { kind: "email", label: "Email", match: /^mailto:/i, color: "#6b7280", icon: Mail },
  { kind: "website", label: "Website", match: /^https?:\/\//i, color: "#3b5bdb", icon: Globe },
  { kind: "other", label: "Link", match: /.^/, color: "#64748b", icon: LinkGlyph },
];

const BY_KIND = new Map(LINK_KINDS.map(k => [k.kind, k]));
const kindDef = (kind: string) => BY_KIND.get(kind) ?? BY_KIND.get("other")!;

export function guessLinkKind(url: string): string {
  const u = (url || "").trim();
  if (!u) return "other";
  if (/^\+?[\d\s()-]{7,}$/.test(u)) return "phone";
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(u)) return "email";
  const withScheme = /^[a-z]+:/i.test(u) ? u : `https://${u}`;
  return LINK_KINDS.find(k => k.match.test(withScheme))?.kind ?? "other";
}

export function linkLabel(l: { kind: string; label?: string | null }): string {
  return l.label?.trim() || kindDef(l.kind).label;
}

export function LinkIcon({ kind, size = 36 }: { kind: string; size?: number }) {
  const d = kindDef(kind);
  const Glyph = d.icon;
  return (
    <span
      className="link-icon"
      aria-hidden
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.28), background: d.color, color: "#fff",
        display: "inline-grid", placeItems: "center", flexShrink: 0,
        fontWeight: 800, fontSize: Math.round(size * (d.letter && d.letter.length > 1 ? 0.38 : 0.5)), lineHeight: 1,
        letterSpacing: "-0.02em", fontFamily: "inherit",
      }}
    >
      {Glyph ? <Glyph size={Math.round(size * 0.54)} strokeWidth={2.2} /> : d.letter}
    </span>
  );
}
