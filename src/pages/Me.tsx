import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { ReviewRow } from "../lib/types";
import { Avatar, Icon, Spinner, StarInput, useToast } from "../components/ui";
import { ReviewCard, REVIEW_SELECT } from "../components/ReviewCard";
import { MePhoneRow } from "../components/MePhoneRow";

interface SavedRow { place_id: string; places: { name: string; area: string | null; category: string } | null }
interface Draft { id: string; rating: number; body: string }

function Retry({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="notice err row" role="alert">
      <span className="grow">{msg}</span>
      <button type="button" className="link-btn strong" style={{ color: "var(--danger)" }} onClick={onRetry}>Retry</button>
    </div>
  );
}

export default function Me() {
  const { session, profile, refreshProfile, signOut, isAdmin } = useAuth();
  const me = session!.user.id;
  const email = session!.user.email;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile?.display_name || "");
  const [city, setCity] = useState(profile?.city || "");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reviews, setReviews] = useState<ReviewRow[] | null>(null);
  const [reviewsErr, setReviewsErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRow[] | null>(null);
  const [savedErr, setSavedErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"reviews" | "saved">("reviews");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => { setName(profile?.display_name || ""); setCity(profile?.city || ""); }, [profile]);

  const loadReviews = useCallback(() => {
    setReviewsErr(null);
    supabase.from("reviews").select(REVIEW_SELECT).eq("user_id", me).order("created_at", { ascending: false }).limit(100)
      .then(({ data, error }) => { if (error) setReviewsErr(errorText(error)); else setReviews((data as unknown as ReviewRow[]) || []); });
  }, [me]);
  const loadSaved = useCallback(() => {
    setSavedErr(null);
    supabase.from("saved_places").select("place_id, places(name, area, category)").eq("user_id", me).order("created_at", { ascending: false })
      .then(({ data, error }) => { if (error) setSavedErr(errorText(error)); else setSaved((data as unknown as SavedRow[]) || []); });
  }, [me]);
  useEffect(() => { loadReviews(); loadSaved(); }, [loadReviews, loadSaved]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast("Add your name"); return; }
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ display_name: name.trim(), city: city.trim() || null }).eq("id", me);
    setBusy(false);
    if (error) toast(errorText(error)); else { await refreshProfile(); toast("Profile saved"); }
  }

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith("image/")) { toast("Pick an image file"); return; }
    if (file.size > 3 * 1024 * 1024) { toast("Pick a photo under 3 MB"); return; }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${me}/avatar-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) { toast(errorText(up.error)); return; }
      const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", me);
      if (error) toast(errorText(error)); else { await refreshProfile(); toast("Photo updated"); }
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this review?")) return;
    const { error } = await supabase.from("reviews").delete().eq("id", id);
    if (error) toast(errorText(error));
    else { setReviews((rs) => (rs || []).filter((r) => r.id !== id)); if (draft?.id === id) setDraft(null); toast("Review deleted"); }
  }

  async function saveReview(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (draft.rating < 1 || draft.rating > 5) { toast("Pick 1 to 5 stars"); return; }
    setSavingReview(true);
    const body = draft.body.trim();
    const { data, error } = await supabase.from("reviews").update({ rating: draft.rating, body }).eq("id", draft.id).select("id");
    setSavingReview(false);
    if (error) { toast(errorText(error)); return; }
    if (!data?.length) { toast("Couldn't save this review"); return; }
    setReviews((rs) => (rs || []).map((r) => (r.id === draft.id ? { ...r, rating: draft.rating, body } : r)));
    setDraft(null);
    toast("Review updated");
  }

  async function doSignOut() {
    setSigningOut(true);
    try { await signOut(); } catch (e) { toast(errorText(e)); setSigningOut(false); }
  }

  return (
    <div className="page">
      <div className="row" style={{ gap: 14 }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-label={uploading ? "Uploading photo" : "Change photo"}
          style={{ position: "relative", border: 0, padding: 0, background: "none", borderRadius: "50%", cursor: uploading ? "wait" : "pointer", flex: "none" }}
        >
          <span style={{ opacity: uploading ? 0.5 : 1, display: "block" }}>
            <Avatar id={me} name={profile?.display_name} path={profile?.avatar_path} size="lg" />
          </span>
          <span aria-hidden="true" style={{ position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: "50%", background: "var(--ink)", display: "grid", placeItems: "center", border: "2px solid var(--bg)" }}>
            <Icon name="plus" size={14} color="#fff" width={2.5} />
          </span>
        </button>
        <input
          ref={fileRef} type="file" accept="image/*" hidden tabIndex={-1}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadAvatar(f); }}
        />
        <div className="grow stack tight">
          <span className="strong" style={{ fontSize: 18 }}>{profile?.display_name || "Add your name"}</span>
          <span className="small muted ellipsis" title={email || undefined}>
            {email ? <>Signed in as <span className="strong" style={{ color: "var(--ink)" }}>{email}</span></> : session!.user.phone ? `Signed in with ${session!.user.phone}` : "Signed in"}
          </span>
          {uploading && <span className="tiny muted" role="status">Uploading photo…</span>}
        </div>
      </div>

      <form className="stack" onSubmit={saveProfile}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <div className="field"><label htmlFor="n">Name</label><input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" /></div>
          <div className="field"><label htmlFor="c">City</label><input id="c" className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Pune" maxLength={60} autoComplete="address-level2" /></div>
        </div>
        <button className="btn ghost block" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>

      <MePhoneRow />

      <div className="list">
        <Link to="/business" className="list-item"><Icon name="store" color="var(--green)" /><span className="grow strong">List your business</span><Icon name="chev" size={16} color="var(--muted)" /></Link>
        {isAdmin && <Link to="/admin" className="list-item"><Icon name="shield" color="var(--green)" /><span className="grow strong">Admin</span><Icon name="chev" size={16} color="var(--muted)" /></Link>}
      </div>

      <div className="tabs" role="tablist" aria-label="Your activity">
        <button type="button" role="tab" aria-selected={tab === "reviews"} className={tab === "reviews" ? "on" : ""} onClick={() => setTab("reviews")}>
          My reviews{reviews ? ` (${reviews.length})` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>
          Saved{saved ? ` (${saved.length})` : ""}
        </button>
      </div>

      {tab === "reviews" ? (
        reviewsErr ? <Retry msg={`Couldn't load your reviews: ${reviewsErr}`} onRetry={loadReviews} /> :
        reviews === null ? <Spinner /> :
        reviews.length === 0 ? <div className="empty"><p>Your reviews show up here.</p><Link to="/scan" className="btn ghost">Scan a table code</Link></div> :
          <div className="stack">
            {reviews.map((r) => {
              const editing = draft?.id === r.id;
              return (
                <ReviewCard key={r.id} r={editing ? { ...r, rating: draft.rating, body: "" } : r} mine showPlace>
                  {editing ? (
                    <form className="stack" onSubmit={saveReview}>
                      <StarInput value={draft.rating} onChange={(v) => setDraft({ ...draft, rating: v })} />
                      <div className="field">
                        <label htmlFor={`body-${r.id}`}>Your review</label>
                        <textarea id={`body-${r.id}`} className="textarea" value={draft.body} maxLength={2000}
                          onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                        <span className="tiny muted" style={{ alignSelf: "flex-end" }}>{draft.body.length}/2000</span>
                      </div>
                      <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
                        <button type="button" className="btn small quiet" onClick={() => setDraft(null)} disabled={savingReview}>Cancel</button>
                        <button className="btn small" disabled={savingReview}>{savingReview ? "Saving…" : "Save"}</button>
                      </div>
                    </form>
                  ) : (
                    <div className="row wrap" style={{ justifyContent: "flex-end", gap: 14 }}>
                      {r.status === "hidden" && <span className="badge red" style={{ marginRight: "auto" }}>Hidden by moderators</span>}
                      {r.status === "published" && <Link to={`/saved/${r.id}`} className="small strong">Post on Google</Link>}
                      <button type="button" className="link-btn small strong" onClick={() => setDraft({ id: r.id, rating: r.rating, body: r.body || "" })}
                        aria-label={`Edit review of ${r.items?.name || "this item"}`}>Edit</button>
                      <button type="button" className="link-btn small strong" style={{ color: "var(--danger)" }} onClick={() => remove(r.id)}
                        aria-label={`Delete review of ${r.items?.name || "this item"}`}>Delete</button>
                    </div>
                  )}
                </ReviewCard>
              );
            })}
          </div>
      ) : (
        savedErr ? <Retry msg={`Couldn't load saved places: ${savedErr}`} onRetry={loadSaved} /> :
        saved === null ? <Spinner /> :
        saved.length === 0 ? <div className="empty"><p>Tap the bookmark on a place to save it.</p><Link to="/" className="btn ghost">Discover places</Link></div> :
          <div className="list">{saved.map((s) => (
            <Link key={s.place_id} to={`/p/${s.place_id}`} className="list-item">
              <div className="grow stack tight"><span className="strong">{s.places?.name || "Place no longer listed"}</span><span className="small muted">{[s.places?.category, s.places?.area].filter(Boolean).join(" · ")}</span></div>
              <Icon name="chev" size={16} color="var(--muted)" />
            </Link>
          ))}</div>
      )}

      <button type="button" className="btn quiet block" onClick={doSignOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
    </div>
  );
}
