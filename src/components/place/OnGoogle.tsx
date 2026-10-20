import { useEffect, useState } from "react";
import { fetchGoogleDetails, googlePhotoUrl, type GoogleDetails, type GooglePhoto, type GoogleReview } from "../../lib/google";
import { initials } from "../../lib/util";
import { Icon, Stars } from "../ui";

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

function Chips({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="stack tight">
      <span className="tiny strong muted">{title}</span>
      <div className="pl-amenities-chips">{items.map((i) => <span key={i} className="pl-amenity-chip">{i}</span>)}</div>
    </div>
  );
}

/** Google's own description, photos and reviews, fetched live and never saved. */
export function OnGoogle({ googlePlaceId }: { googlePlaceId: string }) {
  // Google bills every lookup, so nothing loads until the visitor asks for it.
  const [near, setNear] = useState(false);
  const [d, setD] = useState<GoogleDetails | null | undefined>(undefined);
  useEffect(() => {
    if (!near) return;
    let alive = true;
    fetchGoogleDetails(googlePlaceId).then((x) => alive && setD(x));
    return () => { alive = false; };
  }, [near, googlePlaceId]);

  if (!near) return (
    <button type="button" className="btn ghost block" id="on-google" onClick={() => setNear(true)}>
      <span className="gg-g" aria-hidden="true">G</span>See rating, photos and reviews on Google
    </button>
  );
  if (d === null) return null;
  const empty = d && !d.summary && !d.photos.length && !d.reviews.length && d.rating == null && !d.serves.length && !d.goodToKnow.length;
  if (empty && !d.mapsUri) return null;

  return (
    <section className="gg" id="on-google" aria-label="On Google">
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
          {(d.openNow != null || d.priceRange) && (
            <div className="row wrap" style={{ gap: 8 }}>
              {d.openNow != null && <span className={`pill ${d.openNow ? "green" : ""}`}><Icon name="clock" size={13} />{d.openNow ? "Open now" : "Closed now"}</span>}
              {d.priceRange && <span className="pill"><Icon name="wallet" size={13} />{d.priceRange} per person</span>}
            </div>
          )}
          {d.reviewSummary && (
            <div className="pl-summary">
              <span className="row tiny strong" style={{ gap: 6 }}><Icon name="spark" size={14} />What Google reviewers say</span>
              <p className="small">{d.reviewSummary.text}</p>
              <span className="tiny muted">
                {d.reviewSummary.disclosure}
                {d.reviewSummary.flagUri && <> · <a href={d.reviewSummary.flagUri} target="_blank" rel="noopener noreferrer">Report</a></>}
              </span>
            </div>
          )}
          {d.serves.length > 0 && <Chips title="Serves" items={d.serves} />}
          {d.goodToKnow.length > 0 && <Chips title="Good to know" items={d.goodToKnow} />}
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
