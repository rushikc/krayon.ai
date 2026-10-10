function hashSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KAPPA = 0.5522847498;

function fmt(n: number): string {
  return n.toFixed(2);
}

export function sketchViewBox(aspect = 1): string {
  return `0 0 ${fmt(100 * Math.max(aspect, 0.2))} 100`;
}

export function sketchRoundedRectPath(
  id: string,
  options?: { aspect?: number; radius?: number; roughness?: number },
): string {
  const aspect = options?.aspect ?? 1;
  const roughness = options?.roughness ?? 0.85;
  const width = 100 * Math.max(aspect, 0.2);
  const height = 100;
  const inset = 3.2;
  const x0 = inset;
  const y0 = inset;
  const x1 = width - inset;
  const y1 = height - inset;
  const rand = mulberry32(hashSeed(id));
  const n = (scale = 1) => (rand() - 0.5) * 2 * roughness * scale;
  const r = Math.min(options?.radius ?? 18, (x1 - x0) / 2.4, (y1 - y0) / 2.4);
  const rk = r * KAPPA;

  const p = (x: number, y: number) => `${fmt(x + n())} ${fmt(y + n())}`;

  const topBow = n(0.45);
  const rightBow = n(0.45);
  const bottomBow = n(0.45);
  const leftBow = n(0.45);

  const midX = (x0 + x1) / 2;
  const midY = (y0 + y1) / 2;

  return [
    `M ${p(x0 + r, y0)}`,
    `C ${p(midX, y0 + topBow)} ${p(midX, y0 + topBow)} ${p(x1 - r, y0)}`,
    `C ${p(x1 - r + rk, y0)} ${p(x1, y0 + r - rk)} ${p(x1, y0 + r)}`,
    `C ${p(x1 + rightBow, midY)} ${p(x1 + rightBow, midY)} ${p(x1, y1 - r)}`,
    `C ${p(x1, y1 - r + rk)} ${p(x1 - r + rk, y1)} ${p(x1 - r, y1)}`,
    `C ${p(midX, y1 + bottomBow)} ${p(midX, y1 + bottomBow)} ${p(x0 + r, y1)}`,
    `C ${p(x0 + r - rk, y1)} ${p(x0, y1 - r + rk)} ${p(x0, y1 - r)}`,
    `C ${p(x0 + leftBow, midY)} ${p(x0 + leftBow, midY)} ${p(x0, y0 + r)}`,
    `C ${p(x0, y0 + r - rk)} ${p(x0 + r - rk, y0)} ${p(x0 + r, y0)}`,
    "Z",
  ].join(" ");
}

export function sketchCirclePath(
  id: string,
  options?: { roughness?: number },
): string {
  const roughness = options?.roughness ?? 0.7;
  const rand = mulberry32(hashSeed(`${id}-circle`));
  const n = (scale = 1) => (rand() - 0.5) * 2 * roughness * scale;
  const cx = 50;
  const cy = 50;
  const r = 45.5;
  const rk = r * KAPPA;
  const p = (x: number, y: number) => `${fmt(x + n())} ${fmt(y + n())}`;

  return [
    `M ${p(cx, cy - r)}`,
    `C ${p(cx + rk, cy - r)} ${p(cx + r, cy - rk)} ${p(cx + r, cy)}`,
    `C ${p(cx + r, cy + rk)} ${p(cx + rk, cy + r)} ${p(cx, cy + r)}`,
    `C ${p(cx - rk, cy + r)} ${p(cx - r, cy + rk)} ${p(cx - r, cy)}`,
    `C ${p(cx - r, cy - rk)} ${p(cx - rk, cy - r)} ${p(cx, cy - r)}`,
    "Z",
  ].join(" ");
}

export function sketchArrowCurve(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const rand = mulberry32(hashSeed(`${id}-arrow`));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const offset = (rand() - 0.5) * Math.min(6, length * 0.12);
  const mx = (x1 + x2) / 2 + nx * offset;
  const my = (y1 + y2) / 2 + ny * offset;
  return `M ${x1} ${y1} Q ${mx.toFixed(2)} ${my.toFixed(2)} ${x2} ${y2}`;
}
