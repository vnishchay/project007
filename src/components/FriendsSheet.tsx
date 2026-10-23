import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { supabase, errorText } from "../lib/supabase";
import { Avatar, Icon, useConfirm, useToast } from "./ui";

interface Friend { id: string; display_name: string | null; avatar_path: string | null; since: string; is_guest: boolean }

/** Your friends, with a way to remove one. Friends only come from invites, so there's no search here. */
export function FriendsSheet({ onClose, onChanged }: { onClose: () => void; onChanged: (n: number) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Friend[] | null>(null);

  useEffect(() => {
    supabase.rpc("my_friends").then(({ data, error }) => setList(error ? [] : ((data as Friend[]) || [])), () => setList([]));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function remove(f: Friend) {
    const name = f.display_name || "this friend";
    if (!(await confirm({ title: `Remove ${name}?`, body: "You stop seeing each other's named reviews as friends. They aren't told.", ok: "Remove", danger: true }))) return;
    const { error } = await supabase.rpc("remove_friend", { p_friend: f.id });
    if (error) { toast(errorText(error)); return; }
    const next = (list || []).filter((x) => x.id !== f.id);
    setList(next);
    onChanged(next.length);
    toast(`Removed ${name}`);
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="fr-t" onClick={(e) => e.stopPropagation()}>
        <div className="row"><h2 id="fr-t" className="grow" style={{ margin: 0, fontSize: 20 }}>Your friends</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div>
        {list === null ? <div className="skeleton" style={{ height: 120 }} /> : list.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>No friends yet. Share your invite link and they'll show up here.</p>
        ) : (
          <div className="sheet-list">
            <div className="menu">
              {list.map((f) => {
                const name = f.display_name || (f.is_guest ? "Guest" : "Friend");
                return (
                  <div key={f.id} className="menu-row" style={{ cursor: "default" }}>
                    <Link to={`/u/${f.id}`} className="row grow" style={{ gap: 10, minWidth: 0, color: "inherit" }} onClick={onClose}>
                      <Avatar id={f.id} name={name} path={f.avatar_path} size="sm" />
                      <span className="grow stack tight" style={{ minWidth: 0 }}><span className="t ellipsis">{name}</span><span className="s">Friends since {new Date(f.since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span></span>
                    </Link>
                    <button type="button" className="icon-btn" aria-label={`Remove ${name}`} onClick={() => void remove(f)}><Icon name="userMinus" size={18} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>Friends join through your invite link. Removing someone doesn't tell them.</p>
      </div>
    </div>,
    document.body,
  );
}
