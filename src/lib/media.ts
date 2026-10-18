import { supabase } from "./supabase";
import { demoArtUrl, isDemoArt, isDemoPhoto } from "./demoArt";

/** A stock picture (a Pexels URL the AI found, or a demo photo), as opposed to a photo the shop uploaded. */
export const isStockPhoto = (path: string | null | undefined): boolean =>
  Boolean(path && (/^https:\/\/images\.pexels\.com\//.test(path) || isDemoPhoto(path)));

/** Public URL of a shop's cover, logo or product photo (bucket place-media, path <place_id>/<file>). `w` is the width asked of stock photos. */
export function placeMediaUrl(path: string | null | undefined, w = 800): string | null {
  if (!path) return null;
  if (isDemoArt(path)) return demoArtUrl(path, w);
  if (isStockPhoto(path)) return path;
  return supabase.storage.from("place-media").getPublicUrl(path).data.publicUrl;
}

/** Shrinks a photo to at most `max` px on its longest side and returns a JPEG (re-encoded, so no EXIF/GPS).
 * Throws when the browser can't decode it, rather than passing the original file through. */
export async function shrinkImage(file: Blob, max = 1400, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) throw new Error("Couldn't read that photo. Try a JPEG or PNG.");
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process that photo."))), "image/jpeg", quality));
}

/** Uploads a shop photo; returns its storage path. */
export async function uploadPlaceMedia(placeId: string, file: File, max = 1400): Promise<string> {
  const blob = await shrinkImage(file, max);
  const path = `${placeId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("place-media").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

export async function removePlaceMedia(path: string | null | undefined) {
  if (path && !isStockPhoto(path) && !isDemoArt(path)) await supabase.storage.from("place-media").remove([path]);
}
