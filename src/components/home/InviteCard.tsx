import { useState } from "react";
import { shareOrCopy, useInviteLink } from "../../lib/invite";
import { copyText } from "../../lib/util";
import { Icon, QrImage, useToast } from "../ui";

/** Your invite link: share it, copy it, or show it as a QR. Whoever joins through it becomes your friend. */
export function InviteCard() {
  const link = useInviteLink("/", "invite");
  const qrLink = useInviteLink("/", "qr");
  const toast = useToast();
  const [qr, setQr] = useState(false);

  async function share() {
    if (!link) return;
    const r = await shareOrCopy({ title: "Trusted Picks", text: "Join me on Trusted Picks: the best places near you, rated by friends.", url: link });
    if (r === "copied") toast("Invite link copied");
  }
  async function copy() {
    if (!link) return;
    toast((await copyText(link)) ? "Invite link copied" : "Couldn't copy the link");
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="link-box" aria-label="Your invite link">
        <Icon name="link" size={16} />
        <span>{link ? link.replace(/^https?:\/\//, "") : "Making your link…"}</span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn white grow" style={{ height: 46 }} onClick={share} disabled={!link}><Icon name="share" size={18} />Share invite</button>
        <button type="button" className="glass-btn round" onClick={copy} disabled={!link} aria-label="Copy invite link" title="Copy"><Icon name="copy" size={18} /></button>
        <button type="button" className="glass-btn round" onClick={() => setQr((v) => !v)} aria-pressed={qr} aria-label="My QR" title="My QR"
          style={qr ? { background: "#fff", color: "var(--green-dark)" } : undefined}><Icon name="qr" size={18} /></button>
      </div>
      {qr && qrLink && (
        <div className="qr-pop">
          <QrImage text={qrLink} size={196} />
          <span className="small strong row" style={{ gap: 6 }}><Icon name="scan" size={16} color="var(--green)" />Scan to become friends</span>
        </div>
      )}
    </div>
  );
}
