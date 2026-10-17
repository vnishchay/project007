import { POOLS } from "./demoPools";

/**
 * Pictures for the demo data. Instead of an upload, a demo row keeps a token:
 *   demo:<pool>:<n>                 a stock photo (dish, shop, product); <n> picks one from the pool
 *   demo:logo:<colour>:<name>       a made-up logo, the shop's initials on that colour
 *   demo:person:<m|w>:<n>           a portrait for a demo person
 * The tokens are turned into web addresses here, so nothing in the database depends on a picture host.
 * Real shops and people never get one: they upload their own.
 */
export const isDemoArt = (path: string | null | undefined): path is string => Boolean(path && path.startsWith("demo:"));

/** A demo photo of food, a place or a product (not a logo or a face). */
export const isDemoPhoto = (path: string | null | undefined): boolean => isDemoArt(path) && !/^demo:(logo|person):/.test(path!);

const enc = encodeURIComponent;

/** First address, with the stand-ins it falls back to after "#fb=" (the part after # never goes to the server). */
function withFallbacks(urls: string[]): string {
  const [first, ...rest] = urls;
  return rest.length ? `${first}#fb=${rest.map(enc).join(",")}` : first!;
}

function photoUrl(src: string, w: number): string {
  const [kind, id, file] = src.split(":");
  return kind === "px"
    ? `https://images.pexels.com/photos/${id}/${file || `pexels-photo-${id}.jpeg`}?auto=compress&cs=tinysrgb&w=${w}`
    : `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;
}

export function demoArtUrl(path: string, w = 800): string | null {
  const [, kind = "", a = "", ...more] = path.split(":");
  if (kind === "logo") {
    const name = more.join(":") || "Shop";
    return withFallbacks([
      `https://api.dicebear.com/9.x/initials/svg?seed=${enc(name)}&backgroundColor=${a}&textColor=ffffff&fontWeight=700&chars=2`,
      `https://ui-avatars.com/api/?name=${enc(name)}&background=${a}&color=ffffff&size=256&bold=true&length=2`,
    ]);
  }
  if (kind === "person") {
    const n = Number(more[0]) || 0;
    return withFallbacks([
      `https://randomuser.me/api/portraits/${a === "w" ? "women" : "men"}/${n % 100}.jpg`,
      `https://i.pravatar.cc/200?img=${(n % 70) + 1}`,
      `https://api.dicebear.com/9.x/personas/svg?seed=${a}${n}`,
    ]);
  }
  const n = Number(a) || 0;
  const pool = POOLS[kind];
  const pick = (p: typeof pool | undefined) => (p && p.ids.length ? photoUrl(p.ids[n % p.ids.length]!, w) : null);
  const urls = [pick(pool), pick(pool?.then ? POOLS[pool.then] : undefined), `https://picsum.photos/seed/${enc(kind)}-${n}/${w}/${Math.round(w * 0.75)}`]
    .filter((u): u is string => Boolean(u));
  return withFallbacks(urls);
}

let installed = false;
/**
 * When a demo picture won't load, try the next stand-in before the page notices. Runs once, in the capture
 * phase, so components that hide a broken image only see an error after every stand-in has failed.
 */
export function installImageFallback(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const at = img.src.indexOf("#fb=");
    if (at < 0) return;
    const [next, ...rest] = img.src.slice(at + 4).split(",").map(decodeURIComponent);
    if (!next) return;
    e.stopImmediatePropagation();
    img.src = rest.length ? withFallbacks([next, ...rest]) : next;
  }, true);
}
