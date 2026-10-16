import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../../lib/supabase";
import { removePlaceMedia, uploadPlaceMedia } from "../../lib/media";
import { MediaImg } from "./MediaImg";
import type { Place } from "../../lib/types";
import { priceText, todaysHours } from "../../lib/util";
import { Icon, Spinner, useToast } from "../ui";

/** How the shop page looks, with camera buttons to change the cover and logo. */
export function ShopHeader({ place, onChange }: { place: Place; onChange: (p: Partial<Place>) => void }) {
  const toast = useToast();
  const coverIn = useRef<HTMLInputElement>(null);
  const logoIn = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "cover" | "logo">("");
  const today = todaysHours(place.hours);

  async function change(kind: "cover" | "logo", file: File | undefined) {
    if (!file) return;
    setBusy(kind);
    try {
      const path = await uploadPlaceMedia(place.id, file, kind === "cover" ? 1600 : 600);
      const col = kind === "cover" ? "cover_path" : "logo_path";
      const { error } = await supabase.from("places").update({ [col]: path }).eq("id", place.id);
      if (error) { await removePlaceMedia(path); throw error; }
      const old = place[col];
      onChange({ [col]: path });
      removePlaceMedia(old).catch(() => {});
      toast(kind === "cover" ? "Cover updated" : "Logo updated");
    } catch (e) {
      toast(`Photo not saved: ${errorText(e)}`);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mg-hero">
      <div className="mg-cover">
        <MediaImg path={place.cover_path} fallback={<div className="mg-cover-art"><Icon name="store" size={84} width={1.4} /></div>} />
        {busy === "cover" && <div className="mg-busy"><Spinner /></div>}
        <button type="button" className="mg-cam" style={{ top: 12, right: 12 }} aria-label="Change cover photo" disabled={Boolean(busy)} onClick={() => coverIn.current?.click()}>
          <Icon name="camera" size={19} />
        </button>
      </div>
      <div className="mg-logo">
        <MediaImg path={place.logo_path} fallback={<Icon name="store" size={32} />} />
        {busy === "logo" && <div className="mg-busy" style={{ borderRadius: 19 }}><Spinner /></div>}
        <button type="button" className="mg-cam sm" aria-label="Change logo" disabled={Boolean(busy)} onClick={() => logoIn.current?.click()}>
          <Icon name="camera" size={14} />
        </button>
      </div>
      <div className="mg-hero-body">
        <h1 className="ellipsis">{place.name}</h1>
        <div className="mg-meta">
          <span>{[place.category, place.area || place.city].filter(Boolean).join(" · ")}</span>
          {place.price_level ? <span className="strong" style={{ color: "var(--ink-2)" }}>{priceText(place.price_level)}</span> : null}
        </div>
        <div className="mg-meta">
          {today && <span className="row" style={{ gap: 4 }}><Icon name="clock" size={13} />{today}</span>}
          <span className={`badge ${place.status === "live" ? "" : place.status === "lapsed" ? "warn" : "red"}`}>{place.status === "live" ? "Live" : place.status === "lapsed" ? "Lapsed" : "Removed"}</span>
        </div>
      </div>
      <div className="mg-hero-actions">
        <Link to={`/p/${place.id}`} className="btn small ghost"><Icon name="eye" size={17} />View my page</Link>
        <Link to={`/review/${place.id}`} className="btn small ghost"><Icon name="star" size={17} />Review screen</Link>
      </div>
      <input ref={coverIn} type="file" accept="image/*" hidden onChange={(e) => { change("cover", e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={logoIn} type="file" accept="image/*" hidden onChange={(e) => { change("logo", e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
