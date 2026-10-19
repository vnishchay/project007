import type { IconName } from "../components/ui";

// Money on shop pages. Every shop has a currency (places.currency, an ISO 4217 code, INR unless the
// owner picks another), and its prices are whole amounts in that currency. The price column is still
// called price_inr from when every shop was in India. Plan prices (billing) are a separate thing.

export const DEFAULT_CURRENCY = "INR";

/** Currencies offered when a shop picks one, most used first. */
export const CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "OMR", "BHD", "SGD", "AUD", "NZD", "CAD",
  "JPY", "CNY", "HKD", "MYR", "THB", "IDR", "PHP", "LKR", "NPR", "BDT", "PKR", "ZAR", "KES", "NGN",
  "CHF", "SEK", "NOK", "DKK",
] as const;

const EURO = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"];
const BY_REGION: Record<string, string> = {
  IN: "INR", US: "USD", GB: "GBP", AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD", OM: "OMR", BH: "BHD",
  SG: "SGD", AU: "AUD", NZ: "NZD", CA: "CAD", JP: "JPY", CN: "CNY", HK: "HKD", MY: "MYR", TH: "THB",
  ID: "IDR", PH: "PHP", LK: "LKR", NP: "NPR", BD: "BDT", PK: "PKR", ZA: "ZAR", KE: "KES", NG: "NGN",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK",
  ...Object.fromEntries(EURO.map((r) => [r, "EUR"])),
};

/** A clean 3-letter code, or INR. */
export function currencyCode(c: string | null | undefined): string {
  const t = (c || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(t) ? t : DEFAULT_CURRENCY;
}

/**
 * The currency a new shop most likely uses, from the region in the phone's language settings
 * ("en-IN" -> INR, "en-US" -> USD, "de-AT" -> EUR). Settings without a region ("en") give INR.
 */
export function localCurrency(): string {
  try {
    const tags = typeof navigator === "undefined" ? [] : [...(navigator.languages || []), navigator.language];
    for (const tag of tags) {
      if (!tag) continue;
      const region = new Intl.Locale(tag).region;
      if (region && BY_REGION[region.toUpperCase()]) return BY_REGION[region.toUpperCase()]!;
    }
  } catch { /* old browser: fall through */ }
  return DEFAULT_CURRENCY;
}

const formats = new Map<string, Intl.NumberFormat>();
function formatter(currency: string, whole: boolean): Intl.NumberFormat {
  const key = `${currency}:${whole}`;
  let f = formats.get(key);
  if (!f) {
    // Rupee prices read the Indian way (₹1,20,000); "$" rather than "US$", since the shop's page says where it is.
    const locale = currency === "INR" ? "en-IN" : "en";
    const digits = whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {};
    try {
      f = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", ...digits });
    } catch {
      f = new Intl.NumberFormat(locale, { style: "currency", currency, ...digits });
    }
    formats.set(key, f);
  }
  return f;
}

/** "₹450", "$12", "€8", "AED 30". Whole amounts without decimals. Null when there's no price. */
export function formatPrice(amount: number | null | undefined, currency?: string | null): string | null {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const n = Number(amount);
  try {
    return formatter(currencyCode(currency), Number.isInteger(n)).format(n);
  } catch {
    return `${currencyCode(currency)} ${n.toLocaleString()}`;
  }
}

/** The currency's own sign: "₹", "$", "€", or a short code like "AED" where there is no sign. */
export function currencySymbol(currency?: string | null): string {
  try {
    return formatter(currencyCode(currency), true).formatToParts(0).find((p) => p.type === "currency")?.value || currencyCode(currency);
  } catch {
    return currencyCode(currency);
  }
}

/** A shop's price level, 1 to 4, in its own currency: "₹₹", "$$$", or "AED ••" where the sign is letters. */
export function priceLevelText(level: number | null | undefined, currency?: string | null): string {
  if (!level) return "";
  const s = currencySymbol(currency);
  return [...s].length === 1 ? s.repeat(level) : `${s} ${"•".repeat(level)}`;
}

/** An icon for price fields: the currency's own sign where there is one, otherwise a banknote. */
export function currencyIcon(currency?: string | null): IconName {
  const c = currencyCode(currency);
  if (c === "INR") return "rupee";
  if (c === "EUR") return "euro";
  if (c === "GBP") return "pound";
  if (c === "JPY" || c === "CNY") return "yen";
  if (["USD", "AUD", "CAD", "NZD", "SGD", "HKD"].includes(c)) return "dollar";
  return "banknote";
}

/** "INR · Indian Rupee", for the currency picker (the code first, so a narrow picker still shows it). */
export function currencyName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "currency" }).of(code);
    return name && name !== code ? `${code} · ${name}` : code;
  } catch {
    return code;
  }
}
