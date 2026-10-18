// Lightweight, zero-dependency canvas confetti burst
export function triggerConfetti(originX = 0.5, originY = 0.6, particleCount = 45) {
  try {
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "9999";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.remove();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const colors = ["#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899", "#8b5cf6", "#fbbf24", "#34d399"];
    const particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      color: string;
      rotation: number;
      rotationSpeed: number;
      alpha: number;
      decay: number;
    }[] = [];

    const startX = window.innerWidth * originX;
    const startY = window.innerHeight * originY;

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      const speed = Math.random() * 8 + 4;
      particles.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed * (Math.random() + 0.5),
        vy: (Math.sin(angle) * speed - 6) * (Math.random() + 0.5),
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)] || "#f59e0b",
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        alpha: 1,
        decay: Math.random() * 0.015 + 0.012,
      });
    }

    let animId: number;
    function animate() {
      ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);
      let alive = false;

      for (const p of particles) {
        if (p.alpha <= 0) continue;
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.22; // gravity
        p.vx *= 0.98; // drag
        p.rotation += p.rotationSpeed;
        p.alpha -= p.decay;

        ctx!.save();
        ctx!.globalAlpha = Math.max(0, p.alpha);
        ctx!.translate(p.x, p.y);
        ctx!.rotate((p.rotation * Math.PI) / 180);
        ctx!.fillStyle = p.color;
        ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx!.restore();
      }

      if (alive) {
        animId = requestAnimationFrame(animate);
      } else {
        cancelAnimationFrame(animId);
        canvas.remove();
      }
    }

    animId = requestAnimationFrame(animate);
  } catch {
    // Graceful fallback if DOM/canvas unavailable
  }
}
