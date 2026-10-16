import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { ReviewRow } from "../lib/types";
import { Avatar, Icon, useToast } from "../components/ui";
import { ReviewCard, REVIEW_SELECT } from "../components/ReviewCard";

interface SavedRow { place_id: string; places: { name: string; area: string | null; category: string } | null }

export default function Me() {
  const { session, profile, refreshProfile, signOut, isAdmin } = useAuth();
  const me = session!.user.id;
  const toast = useToast();
  const [name, setName] = useState(profile?.display_name || "");
  const [city, setCity] = useState(profile?.city || "");
  const [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const [tab, setTab] = useState<"reviews" | "saved">("reviews");

  useEffect(() => { setName(profile?.display_name || ""); setCity(profile?.city || ""); }, [profile]);
  useEffect(() => {
    supabase.from("reviews").select(REVIEW_SELECT).eq("user_id", me).order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => setReviews((data as unknown as ReviewRow[]) || []));
    supabase.from("saved_places").select("place_id, places(name, area, category)").eq("user_id", me).order("created_at", { ascending: false })
      .then(({ data }) => setSaved((data as unknown as SavedRow[]) || []));
  }, [me]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ display_name: name.trim(), city: city.trim() || null }).eq("id", me);
    setBusy(false);
    if (error) toast(errorText(error)); else { await refreshProfile(); toast("Profile saved"); }
  }

  async function uploadAvatar(file: File) {
    if (file.size > 3 * 1024 * 1024) { toast("Pick a photo under 3 MB"); return; }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${me}/avatar-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) { toast(errorText(up.error)); return; }
    const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", me);
    if (error) toast(errorText(error)); else { await refreshProfile(); toast("Photo updated"); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this review?")) return;
    const { error } = await supabase.from("reviews").delete().eq("id", id);
    if (error) toast(errorText(error)); else setReviews((rs) => rs.filter((r) => r.id !== id));
  }

  return (
    <div className="page">
      <div className="row" style={{ gap: 14 }}>
        <label style={{ cursor: "pointer", position: "relative" }} aria-label="Change photo">
          <Avatar id={me} name={profile?.display_name} path={profile?.avatar_path} size="lg" />
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
        </label>
        <div className="grow stack tight">
          <span className="strong" style={{ fontSize: 18 }}>{profile?.display_name || "Add your name"}</span>
          <span className="small muted ellipsis">{session!.user.email || session!.user.phone}</span>
        </div>
      </div>

      <form className="stack" onSubmit={saveProfile}>
        <div className="grid2">
          <div className="field"><label htmlFor="n">Name</label><input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></div>
          <div className="field"><label htmlFor="c">City</label><input id="c" className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Pune" maxLength={60} /></div>
        </div>
        <button className="btn ghost block" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>

      <div className="list">
        <Link to="/business" className="list-item"><Icon name="store" color="var(--green)" /><span className="grow strong">List your business</span><Icon name="chev" size={16} color="var(--muted)" /></Link>
        {isAdmin && <Link to="/admin" className="list-item"><Icon name="shield" color="var(--green)" /><span className="grow strong">Admin</span><Icon name="chev" size={16} color="var(--muted)" /></Link>}
      </div>

      <div className="tabs">
        <button className={tab === "reviews" ? "on" : ""} onClick={() => setTab("reviews")}>My reviews ({reviews.length})</button>
        <button className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>Saved ({saved.length})</button>
      </div>

      {tab === "reviews" ? (
        reviews.length === 0 ? <div className="empty"><p>Your reviews show up here.</p><Link to="/scan" className="btn ghost">Scan a table code</Link></div> :
          reviews.map((r) => (
            <div key={r.id} className="stack tight">
              <ReviewCard r={r} mine showPlace />
              <div className="row" style={{ justifyContent: "flex-end", gap: 14 }}>
                {r.status === "hidden" && <span className="badge red">Hidden by moderators</span>}
                <Link to={`/saved/${r.id}`} className="small strong">Post on Google</Link>
                <button className="link-btn" style={{ color: "var(--danger)" }} onClick={() => remove(r.id)}>Delete</button>
              </div>
            </div>
          ))
      ) : (
        saved.length === 0 ? <div className="empty"><p>Tap the bookmark on a place to save it.</p></div> :
          <div className="list">{saved.map((s) => (
            <Link key={s.place_id} to={`/p/${s.place_id}`} className="list-item">
              <div className="grow stack tight"><span className="strong">{s.places?.name}</span><span className="small muted">{[s.places?.category, s.places?.area].filter(Boolean).join(" · ")}</span></div>
              <Icon name="chev" size={16} color="var(--muted)" />
            </Link>
          ))}</div>
      )}

      <button className="btn quiet block" onClick={signOut}>Sign out</button>
    </div>
  );
}
