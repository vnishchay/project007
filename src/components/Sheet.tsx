import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

/** A bottom sheet that slides up over the page. Escape, the backdrop or the close button shuts it. */
export function Sheet({ open, onClose, title, children, className = "" }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={`sheet-wrap ${className}`} role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1} ref={panel} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-title grow">{title}</div>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
