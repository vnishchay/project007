import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Icon } from "../ui";
import type { ManageTab } from "./Insights";
import { ShopReviews } from "./ShopReviews";
import { ReviewLinks } from "./ReviewLinks";

/** The Reviews group in Manage: reviews to reply to, private notes, and one-time review links. */
export function ReviewsTab({ placeId, placeName, live, onGo }: { placeId: string; placeName: string; live: boolean; onGo: (t: ManageTab) => void }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <ShopReviews placeId={placeId} shopName={placeName} />
      <PrivateNotes placeId={placeId} onGo={onGo} />
      <ReviewLinks placeId={placeId} placeName={placeName} live={live} />
      <p className="tiny muted center row" style={{ justifyContent: "center", gap: 6 }}><Icon name="lock" size={13} />Reviews stay anonymous. You never see who wrote an anonymous review or sent a note.</p>
    </div>
  );
}

interface NoteRow { id: string; item_name: string | null; created_at: string; read_at: string | null; locked: boolean; body: string | null; contact: string | null }

/** Private notes from customers at the shop. The server withholds the text and contact until the plan includes notes. */
export function PrivateNotes({ placeId, onGo }: { placeId: string; onGo: (t: ManageTab) => void }) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.rpc("my_owner_notes", { p_place: placeId }).then(({ data, error }) => {
      if (alive) setNotes(error ? [] : ((data as NoteRow[]) || []));
    });
    return () => { alive = false; };
  }, [placeId]);

  async function markRead(id: string) {
    const { error } = await supabase.rpc("mark_note_read", { p_note: id });
    if (!error) setNotes((prev) => (prev || []).map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  }

  if (!notes || notes.length === 0) return null;
  const locked = notes.some((n) => n.locked);
  const unread = notes.filter((n) => !n.read_at).length;

  return (
    <section className="mg-section" style={{ gap: 10 }}>
      <div className="mg-section-head">
        <span className="icon-chip sm coral"><Icon name="message" size={16} /></span>
        <span className="grow strong">Private notes</span>
        <span className="badge gray">{notes.length} {notes.length === 1 ? "note" : "notes"}</span>
        {unread > 0 && <span className="badge coral">{unread} new</span>}
      </div>
      <p className="tiny muted" style={{ margin: "-4px 0 6px" }}>Customers at your shop can send you a note. You never see who sent it, unless they leave a phone or email for a reply.</p>
      <div className="stack" style={{ gap: 8 }}>
        {notes.slice(0, 30).map((n) => (
          <div key={n.id} className="card" style={{ padding: 12 }}>
            <div className="row" style={{ alignItems: "center", gap: 6, marginBottom: 4 }}>
              {!n.read_at && <span className="badge coral">New</span>}
              {n.item_name && <strong className="small grow ellipsis">{n.item_name}</strong>}
              <span className="tiny muted" style={{ marginLeft: "auto" }}>{new Date(n.created_at).toLocaleString(undefined, { day: "numeric", month: "short", year: new Date(n.created_at).getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" })}</span>
            </div>
            {n.locked ? (
              <p className="small" aria-hidden="true" style={{ margin: 0, filter: "blur(5px)", userSelect: "none" }}>A private note is waiting for you. Upgrade your plan to read it.</p>
            ) : (
              <>
                <p className="small" style={{ margin: 0, color: "var(--ink-2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.body}</p>
                {n.contact && <p className="tiny muted" style={{ margin: "6px 0 0" }}>Reply to: <strong style={{ color: "var(--ink)" }}>{n.contact}</strong></p>}
                {!n.read_at && <button type="button" className="btn ghost small" style={{ marginTop: 8 }} onClick={() => markRead(n.id)}><Icon name="check" size={14} />Mark as read</button>}
              </>
            )}
          </div>
        ))}
      </div>
      {locked && (
        <button type="button" className="btn green small" style={{ alignSelf: "flex-start" }} onClick={() => onGo("plan")}><Icon name="crown" size={14} />See plans</button>
      )}
    </section>
  );
}

