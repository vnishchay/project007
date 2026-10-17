import { useEffect, useRef, useState } from "react";
import { fetchGoogleDetails, googlePhotoUrl, type GoogleDetails, type GooglePhoto, type GoogleReview } from "../../lib/google";
import { initials } from "../../lib/util";
import { Icon, Stars } from "../ui";

/** Waits until the element is near the screen (saves Google calls for people who never scroll). */
function useNearView<T extends Element>(margin = "300px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (!("IntersectionObserver" in window)) { setNear(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near] as const;
}

function Photo({ p }: { p: GooglePhoto }) {
  const [broken, setBroken] = useState(false);
  const a = p.authorAttributions?.[0];
  if (broken) return null;
  return (
    <figure className="gg-photo">
      <img src={googlePhotoUrl(p, 600)} alt="" loading="lazy" onError={() => setBroken(true)} />
      {a?.displayName && (
        <figcaption>Photo: {a.uri ? <a href={a.uri} target="_blank" rel="noopener noreferrer">{a.displayName}</a> : a.displayName}</figcaption>
      )}
    </figure>
  );
}

function Review({ r }: { r: GoogleReview }) {
  const [open, setOpen] = useState(false);
  const [noPic, setNoPic] = useState(false);
  const a = r.authorAttribution;
  const text = r.text?.text || r.originalText?.text || "";
  const long = text.length > 180;
  return (
    <article className="gg-review">
      <div className="gg-review-head">
        <span className="gg-av">
          {a?.photoUri && !noPic ? <img src={a.photoUri} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setNoPic(true)} /> : initials(a?.displayName)}
        </span>
        <span className="grow stack tight" style={{ minWidth: 0 }}>
          {a?.uri ? <a className="gg-name ellipsis" href={a.uri} target="_blank" rel="noopener noreferrer">{a.displayName || "Google user"}</a>
            : <span className="gg-name ellipsis">{a?.displayName || "Google user"}</span>}
          <span className="row" style={{ gap: 6 }}>
            {r.rating != null && <Stars value={r.rating} size={12} />}
            {r.relativePublishTimeDescription && <span className="tiny muted">{r.relativePublishTimeDescription}</span>}
          </span>
        </span>
        {r.googleMapsUri && (
          <a className="gg-open" href={r.googleMapsUri} target="_blank" rel="noopener noreferrer" aria-label="Open this review on Google Maps"><Icon name="external" size={15} /></a>
        )}
      </div>
      {text && <p className={`gg-text ${open || !long ? "open" : ""}`}>{text}</p>}
      {long && <button type="button" className="link-btn small" onClick={() => setOpen(!open)}>{open ? "Less" : "More"}</button>}
    </article>
  );
}

/** Google's own description, photos and reviews, fetched live and never saved. */
export function OnGoogle({ googlePlaceId }: { googlePlaceId: string }) {
  const [ref, near] = useNearView<HTMLElement>();
  const [d, setD] = useState<GoogleDetails | null | undefined>(undefined);
  useEffect(() => {
    if (!near) return;
    let alive = true;
    fetchGoogleDetails(googlePlaceId).then((x) => alive && setD(x));
    return () => { alive = false; };
  }, [near, googlePlaceId]);

  if (d === null) return null;
  const empty = d && !d.summary && !d.photos.length && !d.reviews.length && d.rating == null;
  if (empty && !d.mapsUri) return null;

  return (
    <section ref={ref} className="gg" id="on-google" aria-label="On Google">
      <div className="gg-head">
        <span className="gg-g" aria-hidden="true">G</span>
        <span className="grow stack tight">
          <span className="gg-title">On Google</span>
          <span className="tiny muted">Not from Trusted Picks reviewers</span>
        </span>
        {d?.rating != null && (
          <span className="gg-score">
            <b>{d.rating.toFixed(1)}</b><Stars value={d.rating} size={11} />
            <span className="tiny muted">{d.count.toLocaleString("en-IN")} reviews</span>
          </span>
        )}
      </div>

      {d === undefined ? (
        <div className="stack"><div className="skeleton" style={{ height: 130 }} /><div className="skeleton" style={{ height: 90 }} /></div>
      ) : (
        <>
          {d.summary && <p className="gg-summary">{d.summary}</p>}
          {d.photos.length > 0 && <div className="hscroll gg-photos">{d.photos.map((p) => <Photo key={p.name} p={p} />)}</div>}
          {d.reviews.length > 0 && <div className="stack" style={{ gap: 10 }}>{d.reviews.map((r) => <Review key={r.name} r={r} />)}</div>}
          {d.mapsUri && (
            <a className="btn ghost block gg-all" href={d.mapsUri} target="_blank" rel="noopener noreferrer">
              <Icon name="map" size={18} />See all on Google Maps<Icon name="external" size={14} />
            </a>
          )}
        </>
      )}
      <span className="gg-attr">From <span className="gg-word">Google</span></span>
    </section>
  );
}
