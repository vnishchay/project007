import { useEffect, useState, type ReactNode } from "react";
import { placeMediaUrl } from "../../lib/media";

/** A shop photo that falls back quietly when the file is missing. */
export function MediaImg({ path, src, fallback = null, className }: { path?: string | null; src?: string | null; fallback?: ReactNode; className?: string }) {
  const url = src ?? placeMediaUrl(path);
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [url]);
  if (!url || bad) return <>{fallback}</>;
  return <img src={url} alt="" loading="lazy" className={className} onError={() => setBad(true)} />;
}
