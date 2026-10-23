import { InviteCard } from "../components/home/InviteCard";
import { PasskeysCard } from "../components/Passkeys";
import { ReminderRow } from "../components/Reminders";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { InstallNudge } from "../components/Install";
import { useAuth } from "../lib/auth";
import { placeMediaUrl, shrinkImage } from "../lib/media";
import { STATUS_WORDS, copyText, timeAgo } from "../lib/util";
import { Avatar, Icon, TopBar, useToast } from "../components/ui";
import { Chip, Cover, Glyph, MenuRow, SectionTitle } from "../components/home/Kit";
import "../styles/home.css";

interface MyPlace { id: string; name: string; area: string | null; city: string; status: string; cover_path: string | null; logo_path: string | null }
interface Mine { id: string; place_id: string; verified: boolean; is_public: boolean }
interface ShopSeen { place_id: string; place_name: string; area: string | null; logo_path: string | null; last_visit: string; hidden: boolean; no_offers: boolean }


/** Your profile and settings. What you rated and saved lives on Your picks (/picks). */
export default function Me() {
  const { session, profile, refreshProfile, signOut, isAdmin, isGuest } = useAuth();
  const me = session!.user.id;
  const email = session!.user.email;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile?.display_name || "");
  const [city, setCity] = useState(profile?.city || "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [shops, setShops] = useState<MyPlace[]>([]);
  const [badges, setBadges] = useState<string[]>([]);
  const [seenBy, setSeenBy] = useState<ShopSeen[] | null>(null);

  useEffect(() => { setName(profile?.display_name || ""); setCity(profile?.city || ""); }, [profile]);

  useEffect(() => {
    supabase.rpc("my_reviews", { p_limit: 500 }).select("id, place_id, verified, is_public")
      .then(({ data, error }) => setMine(error ? [] : ((data as unknown as Mine[]) || [])));
    // Shops that saw your visits, with your Hide and Offers switches for each.
    supabase.rpc("my_shop_privacy_list").then(({ data, error }) => setSeenBy(error ? [] : ((data as ShopSeen[]) || [])), () => setSeenBy([]));
  }, [me]);

  // Friends, your shops and topic badges. All quietly stay empty on a database without them.
  useEffect(() => {
    if (isGuest) return;
    supabase.rpc("my_friends").then(({ data, error }) => { if (!error) setFriendCount(((data as unknown[]) || []).length); });
    supabase.rpc("my_places").then(({ data, error }) => { if (!error) setShops((data as MyPlace[]) || []); });
    supabase.from("user_topic_stats").select("topics(name)").eq("user_id", me).eq("is_expert", true)
      .then(({ data, error }) => { if (!error && data) setBadges((data as unknown as { topics: { name: string } | null }[]).map((t) => t.topics?.name || "").filter(Boolean)); });
  }, [me, isGuest]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast("Add your name"); return; }
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ display_name: name.trim(), city: city.trim() || null }).eq("id", me);
    setBusy(false);
    if (error) toast(errorText(error)); else { await refreshProfile(); setEditing(false); toast("Profile saved"); }
  }

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith("image/")) { toast("Pick an image file"); return; }
    if (file.size > 15 * 1024 * 1024) { toast("Pick a photo under 15 MB"); return; }
    setUploading(true);
    try {
      // Re-encoded so the photo's location and camera details never leave the phone.
      const blob = await shrinkImage(file, 512, 0.85).catch(() => null);
      if (!blob) { toast("Couldn't read that photo. Try a JPEG or PNG."); return; }
      const path = `${me}/avatar-${Date.now()}.jpg`;
      const up = await supabase.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (up.error) { toast(errorText(up.error)); return; }
      const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", me);
      if (error) toast(errorText(error)); else { await refreshProfile(); toast("Photo updated"); }
    } finally {
      setUploading(false);
    }
  }

  async function shareProfile() {
    // The public page shows only reviews you chose to put your name on.
    const url = `${window.location.origin}/u/${me}`;
    const text = `My picks on Trusted Picks`;
    if (navigator.share) { try { await navigator.share({ title: text, url }); } catch { /* dismissed */ } return; }
    toast(await copyText(url) ? "Profile link copied" : url);
  }

  async function setShop(s: ShopSeen, patch: { hidden?: boolean; no_offers?: boolean }) {
    const prev = seenBy;
    setSeenBy((xs) => (xs || []).map((x) => (x.place_id === s.place_id ? { ...x, ...patch } : x)));
    const { error } = await supabase.rpc("set_shop_privacy", { p_place: s.place_id, ...(patch.hidden !== undefined ? { p_hidden: patch.hidden } : {}), ...(patch.no_offers !== undefined ? { p_no_offers: patch.no_offers } : {}) });
    if (error) { setSeenBy(prev); toast("Couldn't change that. Try again."); }
  }

  async function doSignOut() {
    setSigningOut(true);
    try { await signOut(); } catch (e) { toast(errorText(e)); setSigningOut(false); }
  }

  const list = mine || [];
  const verified = list.filter((r) => r.verified).length;
  const places = new Set(list.map((r) => r.place_id)).size;
  const named = list.filter((r) => r.is_public).length;
  const n = (v: number | null | undefined) => (mine === null || v == null ? "–" : v);
  // One row of numbers, the same for guests and members.
  const stats = (
    <div className="stat-tiles">
      <div className="stat-tile"><span className="n"><Icon name="star" size={16} />{n(list.length)}</span><span className="l">reviews</span></div>
      <div className="stat-tile"><span className="n"><Icon name="store" size={16} />{n(places)}</span><span className="l">places</span></div>
      <div className="stat-tile"><span className="n"><Icon name="verified" size={16} />{n(verified)}</span><span className="l">verified</span></div>
      {!isGuest && <div className="stat-tile"><span className="n"><Icon name="people" size={16} />{friendCount ?? "–"}</span><span className="l">{friendCount === 1 ? "friend" : "friends"}</span></div>}
    </div>
  );

  return (
    <div className="page" style={{ gap: 18 }}>
      <TopBar title="Profile" tone={isGuest ? "sunset" : "hero"} />
      {isGuest ? (
        <header className="hero sunset">
          <div className="row" style={{ gap: 12 }}>
            <span className="success-burst"><Glyph name="ghost" size={34} color="#fff" /></span>
            <div className="grow stack tight">
              <h1 style={{ fontSize: 24 }}>Guest</h1>
              <span className="hero-sub"><Icon name="eyeOff" size={16} />Your reviews are anonymous and kept on this phone</span>
            </div>
          </div>
          {stats}
          <Link to="/signin" className="btn white block" style={{ color: "#9c4733" }}><Icon name="login" size={18} />Keep my picks diary (optional)</Link>
        </header>
      ) : (
        <>
          <header className="hero">
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
                <span aria-hidden="true" style={{ position: "absolute", right: -4, bottom: -4, width: 24, height: 24, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: "var(--accent-dark)" }}>
                  <Icon name="camera" size={13} width={2.4} />
                </span>
              </button>
              <input
                ref={fileRef} type="file" accept="image/*" hidden tabIndex={-1}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadAvatar(f); }}
              />
              <div className="grow stack tight" style={{ minWidth: 0 }}>
                <span className="strong ellipsis" style={{ fontSize: 20 }}>{profile?.display_name || "Add your name"}</span>
                <span className="hero-sub ellipsis" title={email || undefined}>
                  <Glyph name={email ? "mail" : "user"} size={14} />
                  <span className="ellipsis">{email || session!.user.phone || "Signed in"}</span>
                </span>
                {profile?.city && <span className="hero-sub"><Icon name="pin" size={14} />{profile.city}</span>}
                {uploading && <span className="hero-sub" role="status">Uploading photo…</span>}
              </div>
              <button type="button" className="glass-btn round" aria-label="Edit profile" aria-expanded={editing} title="Edit profile" onClick={() => setEditing((v) => !v)}>
                <Icon name={editing ? "close" : "edit"} size={18} />
              </button>
            </div>
            {stats}
            {badges.length > 0 && (
              <div className="chips" aria-label="Community badges">
                {badges.map((b) => <span key={b} className="chip"><Icon name="trophy" size={12} />{b} expert</span>)}
              </div>
            )}
          </header>

          {editing && (
            <form className="card" onSubmit={saveProfile}>
              <SectionTitle icon="edit" tone="sky">Your profile</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                <div className="field"><label htmlFor="n">Name</label><input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" /></div>
                <div className="field"><label htmlFor="c">City</label><input id="c" className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Pune" maxLength={60} autoComplete="address-level2" /></div>
              </div>
              <button className="btn green block" disabled={busy}><Icon name="check" size={18} />{busy ? "Saving…" : "Save"}</button>
            </form>
          )}

          <div className="menu">
            <MenuRow to="/picks" icon="heart" tone="coral" title="Your picks" sub="Ready to rate, your diary, reviews and saved places" />
            <MenuRow icon="share" tone="sky" title="Share your profile" sub={named ? `Shows the ${named} review${named === 1 ? "" : "s"} with your name` : "Only reviews with your name show on it"} onClick={shareProfile} />
          </div>

          <InviteCard />

          <div className="menu">
            {shops.length > 0 && <MenuRow to="/owner" icon="dashboard" tone="violet" title="Owner app" sub="Today's visitors, reviews to reply to, deals and QR codes" />}
            {shops.map((s) => (
              <Link key={s.id} to={`/owner/${s.id}`} className="menu-row">
                <span className="thumb" style={{ width: 40, height: 40, borderRadius: 12 }}><Cover url={placeMediaUrl(s.logo_path) || placeMediaUrl(s.cover_path)} category={s.name} size={20} /></span>
                <span className="grow stack tight" style={{ minWidth: 0 }}>
                  <span className="t ellipsis">{s.name}</span>
                  <span className="s ellipsis row" style={{ gap: 4 }}><Icon name="store" size={12} />Your shop{s.area ? ` · ${s.area}` : ""}{s.status !== "live" ? ` · ${STATUS_WORDS[s.status] || s.status}` : ""}</span>
                </span>
                <Icon name="settings" size={18} color="var(--muted)" />
              </Link>
            ))}
            <MenuRow to="/business" icon={shops.length ? "plus" : "store"} tone="amber" title={shops.length ? "Add another business" : "List your business"} />
            {isAdmin && <MenuRow to="/admin" icon="shield" tone="sky" title="Admin" />}
          </div>
        </>
      )}

      {/* Every shop that saw a visit of yours, with the two switches in one place. */}
      {seenBy && seenBy.length > 0 && (
        <section className="stack" style={{ gap: 10 }} aria-labelledby="seen-h">
          <SectionTitle icon="eye" tone="violet"><span id="seen-h">Shops that can see you</span></SectionTitle>
          <p className="small muted" style={{ margin: 0 }}>When you scan a shop's QR code, that shop sees your name or "Guest" and when you came. They never see which review is yours.</p>
          <div className="menu">
            {seenBy.map((s) => (
              <div key={s.place_id} className="menu-row seen-row">
                <span className="thumb" style={{ width: 40, height: 40, borderRadius: 12 }}><Cover url={placeMediaUrl(s.logo_path)} category={s.place_name} size={20} /></span>
                <span className="grow stack tight" style={{ minWidth: 0 }}>
                  <Link to={`/p/${s.place_id}`} className="t ellipsis" style={{ color: "inherit" }}>{s.place_name}</Link>
                  <span className="s ellipsis">Last visit {timeAgo(s.last_visit)}{s.area ? ` · ${s.area}` : ""}</span>
                </span>
                <span className="stack tight seen-switches">
                  <label className="switch-row"><input type="checkbox" role="switch" checked={!s.hidden} onChange={(e) => void setShop(s, { hidden: !e.target.checked })} /><span>{s.hidden ? "Hidden" : "Visible"}</span></label>
                  <label className="switch-row"><input type="checkbox" role="switch" checked={!s.no_offers} onChange={(e) => void setShop(s, { no_offers: !e.target.checked })} /><span>{s.no_offers ? "No offers" : "Offers"}</span></label>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isGuest && (
        <div className="callout green">
          <Chip icon={named ? "eye" : "eyeOff"} size="sm" />
          <span className="small grow">{named ? `${named} review${named === 1 ? " shows" : "s show"} your name. The rest are anonymous.` : "All your reviews are anonymous. You can show your name on any of them in Your picks."}</span>
        </div>
      )}

      <ReminderRow />

      <InstallNudge look="row" title="Add to home screen" sub="Open Trusted Picks like an app" />

      {!isGuest && <PasskeysCard />}

      {!isGuest && (
        <div className="menu">
          <MenuRow icon="logout" tone="coral" title={signingOut ? "Signing out…" : "Sign out"} onClick={doSignOut} right={<span />} />
        </div>
      )}
    </div>
  );
}
