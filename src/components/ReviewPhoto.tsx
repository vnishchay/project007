import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./ui";
import { Chip } from "./home/Kit";

const MAX_SIDE = 1600;

/** Resize to at most 1600px on the long side and re-encode as JPEG. */
export async function compressImage(file: File, maxSide = MAX_SIDE, quality = 0.82): Promise<Blob> {
  let src: ImageBitmap | HTMLImageElement;
  let w: number, h: number;
  try {
    // Honors EXIF rotation from phone cameras.
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    src = bmp; w = bmp.width; h = bmp.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      src = img; w = img.naturalWidth; h = img.naturalHeight;
    } finally {
      // The decoded image stays usable after the URL is revoked.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
  if (!w || !h) throw new Error("That photo couldn't be read. Try another one.");
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("That photo couldn't be read. Try another one.");
  g.fillStyle = "#fff"; // transparent PNGs get a white background instead of black
  g.fillRect(0, 0, cw, ch);
  g.drawImage(src, 0, 0, cw, ch);
  if ("close" in src) src.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) throw new Error("That photo couldn't be read. Try another one.");
  return blob;
}

/** Optional photo of the order: pick or take one, preview, remove. Hands back a compressed JPEG. */
export function ReviewPhotoPicker({ value, onChange, disabled }: { value: Blob | null; onChange: (b: Blob | null) => void; disabled?: boolean }) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!value) { setPreview(null); return; }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // picking the same file again still fires change
    if (!f) return;
    setErr("");
    if (!f.type.startsWith("image/") && !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name)) { setErr("Pick a photo (JPEG, PNG or similar)."); return; }
    setBusy(true);
    try {
      onChange(await compressImage(f));
    } catch (x) {
      setErr((x as Error)?.message || "That photo couldn't be read. Try another one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <input ref={input} id={inputId} type="file" accept="image/*" onChange={pick} hidden disabled={disabled || busy} />
      {preview ? (
        <div style={{ position: "relative" }}>
          <img src={preview} alt="Your photo of the order" style={{ width: "100%", maxHeight: 280, objectFit: "cover", borderRadius: 12, display: "block" }} />
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove photo"
            disabled={disabled}
            onClick={() => onChange(null)}
            style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,0.92)" }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : (
        <button type="button" className="photo-drop" disabled={disabled || busy} onClick={() => input.current?.click()}>
          <Chip icon="camera" tone="sky" />
          <span className="grow">{busy ? "Preparing photo…" : "Add a photo"}</span>
          <Icon name="imagePlus" size={18} color="var(--muted)" />
        </button>
      )}
      {preview && (
        <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }} disabled={disabled || busy} onClick={() => input.current?.click()}>
          <Icon name="camera" size={16} />{busy ? "Preparing photo…" : "Change photo"}
        </button>
      )}
      {err && <span className="small" role="alert" style={{ color: "var(--danger)" }}>{err}</span>}
    </div>
  );
}
