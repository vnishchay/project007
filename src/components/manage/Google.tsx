import { useEffect, useState } from "react";
import { categoryFromTypes, fetchGoogleDetails, findFromGoogleLink, googlePhotoUrl, type GoogleDetails, type GoogleMatch } from "../../lib/google";
import { Icon, Stars } from "../ui";

/** Splits a Google address into a best-guess area and city ("…, Koregaon Park, Pune, Maharashtra 411001, India"). */
export function areaCityFromAddress(address: string | null): { area: string; city: string } {
  const parts = (address || "").split(",").map((s) => s.trim())
    .filter((p) => p && !/^india$/i.test(p) && !/^[A-Za-z .]*\s?\d{5,6}$/.test(p));
  const city = parts.length >= 2 ? parts[parts.length - 1]! : "";
  const area = parts.length >= 3 ? parts[parts.length - 2]! : "";
  return { area: /^\d/.test(area) ? "" : area, city };
}

export const matchCategory = (m: GoogleMatch) => categoryFromTypes(m.types);

/** Paste a Google Maps link or type a name, then pick the right business. */
export function GoogleFind({ onPick, cta = "Find", placeholder = "Google Maps link or shop name", autoFocus }: {
  onPick: (m: GoogleMatch) => void; cta?: string; placeholder?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<GoogleMatch[] | null>(null);

  async function find() {
    if (!q.trim()) return;
    setBusy(true);
    const m = await findFromGoogleLink(q);
    setBusy(false);
    setMatches(m);
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="gf-bar">
        <Icon name="search" size={18} color="var(--muted)" />
        <input className="grow" value={q} autoFocus={autoFocus} aria-label="Google Maps link or shop name" placeholder={placeholder}
          onChange={(e) => { setQ(e.target.value); setMatches(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); find(); } }} />
        <button type="button" className="btn small green" disabled={busy || !q.trim()} onClick={find}>{busy ? "…" : cta}</button>
      </div>
      {matches && (matches.length === 0 ? (
        <p className="small muted row" style={{ gap: 6 }}><Icon name="info" size={15} />No match on Google. Try the shop name and area.</p>
      ) : (
        <div className="gf-list" role="list" aria-label="Google matches">
          {matches.map((m) => (
            <button type="button" role="listitem" key={m.id} className="gf-match" onClick={() => { onPick(m); setMatches(null); setQ(""); }}>
              <span className="icon-chip sm sky"><Icon name="pin" size={15} /></span>
              <span className="grow stack tight" style={{ minWidth: 0 }}>
                <span className="strong ellipsis">{m.name}</span>
                <span className="tiny muted ellipsis">{[matchCategory(m), m.address].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="gf-pick">This one</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function useGoogleDetails(id: string | null | undefined) {
  const [d, setD] = useState<GoogleDetails | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setD(undefined);
    if (!id) { setD(null); return; }
    fetchGoogleDetails(id).then((x) => { if (alive) setD(x); });
    return () => { alive = false; };
  }, [id]);
  return d;
}

export function GoogleMark() {
  return (
    <span className="g-mark" aria-label="Google">
      <span style={{ color: "#4285F4" }}>G</span><span style={{ color: "#EA4335" }}>o</span><span style={{ color: "#FBBC05" }}>o</span>
      <span style={{ color: "#4285F4" }}>g</span><span style={{ color: "#34A853" }}>l</span><span style={{ color: "#EA4335" }}>e</span>
    </span>
  );
}

/** Live from Google, never stored: name, rating, a few photos. */
export function GooglePreview({ id, mini = false, note = "Shown live on your page, from Google" }: { id: string; mini?: boolean; note?: string }) {
  const d = useGoogleDetails(id);
  if (d === undefined) return <div className="skeleton" style={{ height: mini ? 72 : 168 }} />;
  if (!d) return <p className="small muted row" style={{ gap: 6 }}><Icon name="alert" size={15} />Couldn't load from Google right now.</p>;
  const photos = d.photos.slice(0, 3);
  const credit = photos.map((p) => p.authorAttributions?.[0]?.displayName).filter(Boolean).slice(0, 2).join(", ");

  if (mini) return (
    <div className="gp-mini">
      <span className="thumb gp-mini-photo">{photos[0] ? <img src={googlePhotoUrl(photos[0], 200)} alt="" /> : <Icon name="store" size={22} />}</span>
      <span className="grow stack tight" style={{ minWidth: 0 }}>
        <span className="strong ellipsis">{d.name}</span>
        {d.rating != null
          ? <span className="row tiny" style={{ gap: 6 }}><b>{d.rating.toFixed(1)}</b><Stars value={d.rating} size={12} /><span className="muted">{d.count.toLocaleString("en-IN")}</span></span>
          : <span className="tiny muted">No Google rating yet</span>}
        <span className="tiny muted row" style={{ gap: 4 }}>Live from <GoogleMark /></span>
      </span>
      <Icon name="checkCircle" size={22} color="var(--green)" />
    </div>
  );

  return (
    <div className="gp">
      <div className="row" style={{ gap: 10 }}>
        <span className="grow stack tight" style={{ minWidth: 0 }}>
          <span className="strong ellipsis" style={{ fontSize: 16 }}>{d.name}</span>
          {d.address && <span className="tiny muted ellipsis">{d.address}</span>}
        </span>
        {d.rating != null && (
          <span className="gp-rating"><b>{d.rating.toFixed(1)}</b><Stars value={d.rating} size={11} /><span className="tiny muted">{d.count.toLocaleString("en-IN")} reviews</span></span>
        )}
      </div>
      {photos.length > 0 && (
        <div className="gp-photos">{photos.map((p) => <span key={p.name} className="thumb"><img src={googlePhotoUrl(p, 400)} alt="" loading="lazy" /></span>)}</div>
      )}
      <div className="gp-foot">
        <span className="row tiny" style={{ gap: 5 }}><Icon name="eye" size={13} />{note}</span>
        <GoogleMark />
      </div>
      {credit && <span className="tiny muted">Photos: {credit}</span>}
    </div>
  );
}
