"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient "memory constellation" behind the landing hero: faint thoughts drift,
 * nearby ones link, and every few seconds one link commits with a blue pulse —
 * the product's memory-graph metaphor rendered as texture.
 *
 * Constraints honored: no dependencies, DPR-aware canvas, pauses when hidden or
 * off-screen, renders a single static frame under reduced motion, re-reads the
 * palette when the theme class flips. All color comes from the token palette.
 */

type Node = {
  x: number;
  y: number;
  z: number; // depth 0 (far) .. 1 (near)
  r: number;
  vx: number;
  vy: number;
  halo: boolean;
};

type Pulse = {
  a: number;
  b: number;
  started: number;
};

type Committed = {
  a: number;
  b: number;
  at: number;
};

const CHARGE_MS = 260;
const TRAVEL_MS = 560;
const SETTLE_MS = 900;
const PULSE_EVERY_MIN = 4200;
const PULSE_EVERY_MAX = 7800;
const MAX_COMMITTED = 6;
const MAX_DEGREE = 3;

function smoothstep(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const light = document.documentElement.classList.contains("memora-theme-light");
  return {
    light,
    blue: styles.getPropertyValue("--blue-bright").trim() || "#8aa8ff",
    // ink of the dust and hairlines; light theme needs a touch more alpha to read
    monoRgb: light ? "12, 12, 14" : "255, 255, 255",
    dotAlpha: light ? 0.24 : 0.46,
    lineAlpha: light ? 0.135 : 0.115,
  };
}

function makeGlowSprite(color: string) {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 64;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return sprite;
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const n = parseInt(
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value,
    16,
  );
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function LandingConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.dataset.constellation = "unsupported";
      return;
    }
    const el: HTMLCanvasElement = canvas;

    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let committed: Committed[] = [];
    let pulse: Pulse | null = null;
    let nextPulseAt = 0;
    let raf = 0;
    let running = false;
    let inView = true;
    let last = 0;
    let linkRadius = 120;
    let palette = readPalette();
    let glow = makeGlowSprite(hexToRgba(palette.blue, 0.55));

    const reducedQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const isStatic = () =>
      (reducedQuery?.matches ?? false) ||
      document.documentElement.classList.contains("memora-reduce-motion");

    function seed() {
      const count = Math.max(24, Math.min(72, Math.round((width * height) / 24000)));
      const cols = Math.max(3, Math.round(Math.sqrt((count * width) / Math.max(height, 1))));
      const rows = Math.max(3, Math.ceil(count / cols));
      const cw = width / cols;
      const ch = height / rows;
      nodes = [];
      for (let i = 0; i < count; i += 1) {
        const c = i % cols;
        const r = Math.floor(i / cols) % rows;
        const z = Math.random();
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.0011 + z * 0.0023; // px per ms — drift felt, not seen
        nodes.push({
          x: (c + 0.1 + Math.random() * 0.8) * cw,
          y: (r + 0.1 + Math.random() * 0.8) * ch,
          z,
          r: 0.7 + z * 1.3,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          halo: i % 7 === 3,
        });
      }
      committed = [];
      pulse = null;
      linkRadius = Math.max(76, Math.min(150, Math.min(width, height) * 0.17));
    }

    function pairs() {
      // Spatial grid keeps this O(n) at our scale.
      const cell = linkRadius;
      const grid = new Map<string, number[]>();
      nodes.forEach((n, i) => {
        const key = `${Math.floor(n.x / cell)}:${Math.floor(n.y / cell)}`;
        (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
      });
      const found: Array<{ a: number; b: number; d: number }> = [];
      const degree = new Array<number>(nodes.length).fill(0);
      nodes.forEach((n, i) => {
        const cx = Math.floor(n.x / cell);
        const cy = Math.floor(n.y / cell);
        for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
          for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
            for (const j of grid.get(`${gx}:${gy}`) ?? []) {
              if (j <= i || degree[i] >= MAX_DEGREE || degree[j] >= MAX_DEGREE) continue;
              const dx = n.x - nodes[j].x;
              const dy = n.y - nodes[j].y;
              const d = Math.hypot(dx, dy);
              if (d < linkRadius) {
                found.push({ a: i, b: j, d });
                degree[i] += 1;
                degree[j] += 1;
              }
            }
          }
        }
      });
      return found;
    }

    function drawFrame(now: number, dt: number) {
      ctx!.clearRect(0, 0, width, height);
      const { monoRgb, dotAlpha, lineAlpha, blue } = palette;

      for (const n of nodes) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < -24) n.x = width + 24;
        if (n.x > width + 24) n.x = -24;
        if (n.y < -24) n.y = height + 24;
        if (n.y > height + 24) n.y = -24;
      }

      const links = pairs();
      committed = committed.filter((c) => {
        const a = nodes[c.a];
        const b = nodes[c.b];
        return Math.hypot(a.x - b.x, a.y - b.y) < linkRadius * 1.4;
      });

      for (const { a, b, d } of links) {
        const na = nodes[a];
        const nb = nodes[b];
        const closeness = smoothstep(1 - d / linkRadius);
        const depth = 0.45 + ((na.z + nb.z) / 2) * 0.55;
        const isCommitted = committed.some(
          (c) => (c.a === a && c.b === b) || (c.a === b && c.b === a),
        );
        ctx!.beginPath();
        ctx!.moveTo(na.x, na.y);
        ctx!.lineTo(nb.x, nb.y);
        ctx!.lineWidth = 1;
        ctx!.strokeStyle = isCommitted
          ? hexToRgba(blue, 0.1 + closeness * 0.18)
          : `rgba(${monoRgb}, ${(closeness * lineAlpha * depth).toFixed(3)})`;
        ctx!.stroke();
      }

      for (const n of nodes) {
        const alpha = dotAlpha * (0.35 + n.z * 0.65);
        if (n.halo) {
          const s = 10 + n.z * 14;
          ctx!.globalAlpha = palette.light ? 0.07 : 0.16 + n.z * 0.1;
          ctx!.drawImage(glow, n.x - s / 2, n.y - s / 2, s, s);
          ctx!.globalAlpha = 1;
        }
        ctx!.fillStyle = `rgba(${monoRgb}, ${alpha.toFixed(3)})`;
        if (n.r < 1.05) {
          ctx!.fillRect(n.x, n.y, n.r * 2, n.r * 2);
        } else {
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          ctx!.fill();
        }
      }

      // One committed pulse at a time: charge, travel, settle.
      if (!pulse && now >= nextPulseAt && links.length > 0) {
        const candidates = links
          .filter(({ a, b }) => nodes[a].x > width * 0.35 || nodes[b].x > width * 0.35)
          .sort((p, q) => p.d - q.d);
        const pick = candidates[Math.floor(Math.random() * Math.min(4, candidates.length))];
        if (pick) pulse = { a: pick.a, b: pick.b, started: now };
      }
      if (pulse) {
        const na = nodes[pulse.a];
        const nb = nodes[pulse.b];
        const t = now - pulse.started;
        const gone = Math.hypot(na.x - nb.x, na.y - nb.y) > linkRadius * 1.5;
        if (gone || t > CHARGE_MS + TRAVEL_MS + SETTLE_MS) {
          if (!gone) {
            committed.push({ a: pulse.a, b: pulse.b, at: now });
            if (committed.length > MAX_COMMITTED) committed.shift();
          }
          pulse = null;
          nextPulseAt = now + PULSE_EVERY_MIN + Math.random() * (PULSE_EVERY_MAX - PULSE_EVERY_MIN);
        } else {
          const charge = smoothstep(t / CHARGE_MS);
          const travel = easeOutCubic(Math.min(1, Math.max(0, (t - CHARGE_MS) / TRAVEL_MS)));
          const settle = 1 - smoothstep((t - CHARGE_MS - TRAVEL_MS) / SETTLE_MS);
          ctx!.beginPath();
          ctx!.moveTo(na.x, na.y);
          ctx!.lineTo(nb.x, nb.y);
          ctx!.lineWidth = 1;
          ctx!.strokeStyle = hexToRgba(blue, 0.16 + 0.3 * charge * settle);
          ctx!.stroke();
          const px = na.x + (nb.x - na.x) * travel;
          const py = na.y + (nb.y - na.y) * travel;
          const s = 24 * charge * settle;
          if (s > 0.5) {
            ctx!.globalAlpha = 0.9;
            ctx!.drawImage(glow, px - s / 2, py - s / 2, s, s);
            ctx!.globalAlpha = 1;
          }
        }
      }
    }

    function frame(now: number) {
      raf = 0;
      if (!running) return;
      const dt = Math.min(50, last ? now - last : 16);
      last = now;
      drawFrame(now, dt);
      raf = requestAnimationFrame(frame);
    }

    function renderStatic() {
      // A designed still: run the simulation forward silently, commit a few links.
      for (let i = 0; i < 4 && nodes.length > 1; i += 1) {
        const links = pairs().sort((p, q) => p.d - q.d);
        const pick = links[i * 3];
        if (pick) committed.push({ a: pick.a, b: pick.b, at: 0 });
      }
      drawFrame(0, 0);
    }

    function start() {
      if (isStatic()) {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        renderStatic();
        el.dataset.constellation = "static";
        return;
      }
      el.dataset.constellation = "animated";
      if (running || document.hidden || !inView) return;
      running = true;
      last = 0;
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    function resize() {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      nextPulseAt = performance.now() + 1600;
      if (isStatic()) renderStatic();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(el);

    const intersection = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true;
      if (inView) start();
      else stop();
    });
    intersection.observe(el);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    const themeObserver = new MutationObserver(() => {
      palette = readPalette();
      glow = makeGlowSprite(hexToRgba(palette.blue, 0.55));
      if (isStatic()) {
        stop();
        renderStatic();
        el.dataset.constellation = "static";
      } else if (!running) {
        start();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-memora-theme"],
    });
    reducedQuery?.addEventListener?.("change", () => {
      stop();
      start();
    });

    resize();
    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-constellation" aria-hidden="true" />;
}
