import { useEffect, useState } from "react";
import { placeMediaUrl } from "../../lib/media";
import { Icon, type IconName } from "../ui";

/** A product photo that falls back to an icon tile when there's no photo or it fails to load. */
export function ItemThumb({ path, icon = "food", size, className = "", alt = "" }: { path: string | null | undefined; icon?: IconName; size?: number; className?: string; alt?: string }) {
  const url = placeMediaUrl(path);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  return (
    <span className={`item-thumb ${className}`} style={size ? { width: size, height: size } : undefined}>
      {url && !broken
        ? <img src={url} alt={alt} loading="lazy" onError={() => setBroken(true)} />
        : <Icon name={icon} size={size ? Math.max(14, Math.round(size * 0.42)) : 28} width={1.8} />}
    </span>
  );
}
