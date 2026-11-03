/**
 * Pen & Ink Cartography Drawing Helpers
 * Provides deterministic PRNG, color blending, hand-drawn line roughening,
 * and parallel line hatching for antique map ornaments and town structures.
 */

/**
 * Creates a deterministic pseudo-random number generator [0, 1) from a numeric seed or string ID.
 */
export function makeRng(seed: number | string): () => number {
  let s: number;
  if (typeof seed === 'string') {
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    s = hash >>> 0;
  } else {
    s = (seed >>> 0) || 0x12345678;
  }

  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Blends two hex colors (e.g. #cfae7e, #2b2118) by weight in [0, 1].
 */
export function mixHex(hex1: string, hex2: string, weight: number): string {
  const w = Math.max(0, Math.min(1, weight));
  const parse = (h: string) => {
    const clean = h.replace('#', '');
    if (clean.length === 3) {
      return [
        parseInt(clean[0] + clean[0], 16),
        parseInt(clean[1] + clean[1], 16),
        parseInt(clean[2] + clean[2], 16),
      ];
    }
    return [
      parseInt(clean.slice(0, 2), 16) || 0,
      parseInt(clean.slice(2, 4), 16) || 0,
      parseInt(clean.slice(4, 6), 16) || 0,
    ];
  };

  const [r1, g1, b1] = parse(hex1);
  const [r2, g2, b2] = parse(hex2);

  const r = Math.round(r1 * (1 - w) + r2 * w);
  const g = Math.round(g1 * (1 - w) + g2 * w);
  const b = Math.round(b1 * (1 - w) + b2 * w);

  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Perturbs polyline or polygon vertices to simulate hand-drawn fountain pen wobbles.
 * Subdivides longer segments and displaces points perpendicular to edges.
 */
export function roughen(
  points: [number, number][],
  amount: number,
  rng?: () => number
): [number, number][] {
  if (points.length < 2 || amount <= 0) return points.map((p) => [p[0], p[1]]);

  const rand = rng || Math.random;
  const result: [number, number][] = [];

  for (let i = 0; i < points.length; i++) {
    const p0 = points[i];
    result.push([p0[0], p0[1]]);

    const nextIdx = (i + 1) % points.length;
    // For open polylines, stop at last point
    if (i === points.length - 1 && nextIdx === 0 && points.length > 2) {
      // Check if closed polygon (first == last)
      const isClosed =
        Math.hypot(points[0][0] - p0[0], points[0][1] - p0[1]) < 1e-4;
      if (!isClosed) break;
    }

    const p1 = points[nextIdx];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dist = Math.hypot(dx, dy);

    if (dist > amount * 2.5) {
      // Subdivide edge with slight organic displacement
      const steps = Math.min(4, Math.max(1, Math.floor(dist / (amount * 5))));
      const nx = -dy / dist;
      const ny = dx / dist;

      for (let s = 1; s <= steps; s++) {
        const t = s / (steps + 1);
        const mx = p0[0] + dx * t;
        const my = p0[1] + dy * t;
        const jitter = (rand() - 0.5) * 2 * amount;
        result.push([mx + nx * jitter, my + ny * jitter]);
      }
    }
  }

  // Final point for open lines
  if (result.length > 0 && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    const isClosed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-4;
    if (isClosed && result.length > 1) {
      result.push([result[0][0], result[0][1]]);
    }
  }

  return result;
}

/**
 * Strokes parallel hatching lines clipped strictly inside the given polygon.
 * @param ctx 2D Canvas context
 * @param polygon Polygon vertices [[x, y], ...]
 * @param angleRad Hatching angle in radians (e.g. Math.PI / 4 for 45 deg)
 * @param spacing Distance between parallel lines in canvas units
 */
export function hatchPoly(
  ctx: CanvasRenderingContext2D,
  polygon: [number, number][],
  angleRad: number,
  spacing: number
): void {
  if (polygon.length < 3 || spacing <= 0) return;

  // Compute bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const diag = Math.hypot(w, h);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(polygon[0][0], polygon[0][1]);
  for (let i = 1; i < polygon.length; i++) {
    ctx.lineTo(polygon[i][0], polygon[i][1]);
  }
  ctx.closePath();
  ctx.clip();

  // Draw rotated parallel lines across diagonal
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const perpX = -sin;
  const perpY = cos;

  const halfSteps = Math.ceil(diag / spacing);
  ctx.beginPath();
  for (let i = -halfSteps; i <= halfSteps; i++) {
    const offset = i * spacing;
    const px = cx + perpX * offset;
    const py = cy + perpY * offset;

    const x1 = px - cos * diag;
    const y1 = py - sin * diag;
    const x2 = px + cos * diag;
    const y2 = py + sin * diag;

    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.restore();
}
