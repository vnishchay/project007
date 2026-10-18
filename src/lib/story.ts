// Sleek Spotify-Wrapped style 1080x1920 story card for Instagram / Snapchat / TikTok
export interface StoryCardParams {
  itemName: string;
  placeName: string;
  rating: number;
  body?: string | null;
  photoBlob?: Blob | File | null;
}

export async function generateStoryCard({
  itemName,
  placeName,
  rating,
  body,
  photoBlob,
}: StoryCardParams): Promise<File | null> {
  try {
    await document.fonts?.ready;
    const c = document.createElement("canvas");
    c.width = 1080;
    c.height = 1920;
    const g = c.getContext("2d")!;

    // Luxury dark gradient backdrop
    const bg = g.createLinearGradient(0, 0, 1080, 1920);
    bg.addColorStop(0, "#0c110e");
    bg.addColorStop(0.5, "#141e17");
    bg.addColorStop(1, "#090d0b");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1080, 1920);

    // Subtle radial glow
    const radial = g.createRadialGradient(540, 500, 40, 540, 500, 700);
    radial.addColorStop(0, "rgba(30, 122, 70, 0.3)");
    radial.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = radial;
    g.fillRect(0, 0, 1080, 1920);

    // Card frame
    g.fillStyle = "rgba(255, 255, 255, 0.05)";
    roundRect(g, 60, 120, 960, 1680, 56);
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = "rgba(255, 255, 255, 0.12)";
    g.stroke();

    // App Branding
    g.fillStyle = "#E2E8F0";
    g.font = "800 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    g.fillText("TRUSTED PICKS", 120, 220);

    // Verified Pill
    g.fillStyle = "rgba(34, 197, 94, 0.18)";
    roundRect(g, 620, 175, 340, 60, 30);
    g.fill();
    g.strokeStyle = "#22C55E";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#4ADE80";
    g.font = "700 23px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    g.fillText("✓ VERIFIED AT TABLE", 648, 213);

    let curY = 270;

    // Optional Photo
    if (photoBlob) {
      try {
        const img = new Image();
        const url = URL.createObjectURL(photoBlob);
        img.src = url;
        await img.decode();
        g.save();
        roundRect(g, 120, curY, 840, 780, 44);
        g.clip();
        const scale = Math.max(840 / img.width, 780 / img.height);
        const nw = img.width * scale;
        const nh = img.height * scale;
        const nx = 120 + (840 - nw) / 2;
        const ny = curY + (780 - nh) / 2;
        g.drawImage(img, nx, ny, nw, nh);
        g.restore();
        URL.revokeObjectURL(url);
        curY += 820;
      } catch {
        curY += 60;
      }
    } else {
      curY += 80;
    }

    // Score / Vibe Stamp
    const scoreText = rating === 5 ? "MUST TRY 🔥" : rating === 4 ? "SOLID PICK 👍" : `${rating} / 5 STARS`;
    g.fillStyle = rating >= 4 ? "rgba(245, 158, 11, 0.2)" : "rgba(239, 68, 68, 0.2)";
    roundRect(g, 120, curY, 460, 64, 20);
    g.fill();
    g.fillStyle = rating >= 4 ? "#FBBF24" : "#F87171";
    g.font = "800 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    g.fillText(scoreText, 145, curY + 42);
    curY += 105;

    // Dish Name
    g.fillStyle = "#FFFFFF";
    g.font = "900 66px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    wrap(g, itemName || "Signature Item", 120, curY, 840, 76, 2);
    curY += 95;

    // Restaurant Name
    g.fillStyle = "#94A3B8";
    g.font = "700 36px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    g.fillText(`@ ${placeName || "Local Favorite"}`, 120, curY);
    curY += 65;

    // Review snippet
    if (body) {
      g.fillStyle = "#CBD5E1";
      g.font = "italic 500 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      wrap(g, `"${body}"`, 120, curY, 840, 48, 3);
    }

    // Bottom Watermark
    g.fillStyle = "#64748B";
    g.font = "600 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    g.fillText("Scan tabletop QR to rate dishes & discover hidden gems", 120, 1730);

    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    return blob ? new File([blob], "verified-dish-story.png", { type: "image/png" }) : null;
  } catch {
    return null;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, lines: number) {
  const words = text.split(/\s+/);
  let line = "";
  let n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) {
      if (++n >= lines) {
        g.fillText(line + "…", x, y);
        return;
      }
      g.fillText(line, x, y);
      y += lh;
      line = w;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
}
