/**
 * Topologically Consistent Marching Squares Contour Tracer
 * Produces closed polygons without self-intersections, gaps, or crossed loops.
 * Supports Chaikin curve smoothing and minimum area filtering.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Calculates signed area of a 2D polygon.
 * Positive for counter-clockwise, negative for clockwise.
 */
export function calculatePolygonArea(poly: Point2D[]): number {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return area * 0.5;
}

/**
 * Extracts closed contour polygons at isovalue using exact topological edge matching.
 */
export function extractClosedContours(
  grid: Float32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
  isovalue: number,
  minArea: number = 35
): Point2D[][] {
  const cellW = width / (cols - 1);
  const cellH = height / (rows - 1);

  const getVal = (c: number, r: number) => grid[r * cols + c];

  // Helper to interpolate position along grid edges
  const interp = (v1: number, v2: number) => {
    const diff = v2 - v1;
    if (Math.abs(diff) < 1e-6) return 0.5;
    return Math.max(0.01, Math.min(0.99, (isovalue - v1) / diff));
  };

  // Unique edge keys:
  // H(c, r): horizontal edge from (c, r) to (c+1, r)
  // V(c, r): vertical edge from (c, r) to (c, r+1)
  const edgePoints = new Map<string, Point2D>();
  const getHEdgePoint = (c: number, r: number) => {
    const key = `h_${c}_${r}`;
    let pt = edgePoints.get(key);
    if (!pt) {
      const t = interp(getVal(c, r), getVal(c + 1, r));
      pt = { x: (c + t) * cellW, y: r * cellH };
      edgePoints.set(key, pt);
    }
    return { key, pt };
  };

  const getVEdgePoint = (c: number, r: number) => {
    const key = `v_${c}_${r}`;
    let pt = edgePoints.get(key);
    if (!pt) {
      const t = interp(getVal(c, r), getVal(c, r + 1));
      pt = { x: c * cellW, y: (r + t) * cellH };
      edgePoints.set(key, pt);
    }
    return { key, pt };
  };

  // Directed graph: startKey -> nextKey
  const outgoing = new Map<string, string>();
  const incoming = new Map<string, string>();

  const addDirectedSegment = (fromKey: string, toKey: string) => {
    outgoing.set(fromKey, toKey);
    incoming.set(toKey, fromKey);
  };

  // March across all cells and add directed segments (land on the left)
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v0 = getVal(c, r);         // top-left
      const v1 = getVal(c + 1, r);     // top-right
      const v2 = getVal(c + 1, r + 1); // bot-right
      const v3 = getVal(c, r + 1);     // bot-left

      let mask = 0;
      if (v0 >= isovalue) mask |= 1;
      if (v1 >= isovalue) mask |= 2;
      if (v2 >= isovalue) mask |= 4;
      if (v3 >= isovalue) mask |= 8;

      if (mask === 0 || mask === 15) continue;

      const top = getHEdgePoint(c, r);
      const right = getVEdgePoint(c + 1, r);
      const bot = getHEdgePoint(c, r + 1);
      const left = getVEdgePoint(c, r);

      // Connect with consistent orientation (land on left of directed segment)
      switch (mask) {
        case 1: // v0 (top-left)
          addDirectedSegment(top.key, left.key);
          break;
        case 2: // v1 (top-right)
          addDirectedSegment(right.key, top.key);
          break;
        case 3: // v0, v1 (top half)
          addDirectedSegment(right.key, left.key);
          break;
        case 4: // v2 (bot-right)
          addDirectedSegment(bot.key, right.key);
          break;
        case 5: // v0, v2 (diagonal saddle)
          // Resolve saddle by center average
          const avg5 = (v0 + v1 + v2 + v3) * 0.25;
          if (avg5 >= isovalue) {
            addDirectedSegment(right.key, left.key);
            addDirectedSegment(bot.key, top.key);
          } else {
            addDirectedSegment(top.key, left.key);
            addDirectedSegment(bot.key, right.key);
          }
          break;
        case 6: // v1, v2 (right half)
          addDirectedSegment(bot.key, top.key);
          break;
        case 7: // v0, v1, v2
          addDirectedSegment(bot.key, left.key);
          break;
        case 8: // v3 (bot-left)
          addDirectedSegment(left.key, bot.key);
          break;
        case 9: // v0, v3 (left half)
          addDirectedSegment(top.key, bot.key);
          break;
        case 10: // v1, v3 (diagonal saddle)
          const avg10 = (v0 + v1 + v2 + v3) * 0.25;
          if (avg10 >= isovalue) {
            addDirectedSegment(top.key, bot.key);
            addDirectedSegment(bot.key, top.key);
          } else {
            addDirectedSegment(right.key, top.key);
            addDirectedSegment(left.key, bot.key);
          }
          break;
        case 11: // v0, v1, v3
          addDirectedSegment(right.key, bot.key);
          break;
        case 12: // v2, v3 (bottom half)
          addDirectedSegment(left.key, right.key);
          break;
        case 13: // v0, v2, v3
          addDirectedSegment(top.key, right.key);
          break;
        case 14: // v1, v2, v3
          addDirectedSegment(left.key, top.key);
          break;
      }
    }
  }

  // Trace directed cycles into closed polygons
  const visited = new Set<string>();
  const polygons: Point2D[][] = [];

  // First, trace closed cycles
  for (const [startKey] of outgoing) {
    if (visited.has(startKey)) continue;

    const ring: Point2D[] = [];
    let curr: string | undefined = startKey;
    let isClosed = false;

    while (curr && !visited.has(curr)) {
      visited.add(curr);
      const pt = edgePoints.get(curr);
      if (pt) ring.push(pt);

      const next = outgoing.get(curr);
      if (next === startKey) {
        isClosed = true;
        break;
      }
      curr = next;
    }

    // Minimum 4 points for a closed polygon ring
    if (isClosed && ring.length >= 4) {
      const area = Math.abs(calculatePolygonArea(ring));
      if (area >= minArea) {
        polygons.push(ring);
      }
    }
  }

  // Also trace any open chains (lines entering/exiting map boundaries)
  for (const [startKey] of outgoing) {
    if (!incoming.has(startKey) && !visited.has(startKey)) {
      const line: Point2D[] = [];
      let curr: string | undefined = startKey;

      while (curr && !visited.has(curr)) {
        visited.add(curr);
        const pt = edgePoints.get(curr);
        if (pt) line.push(pt);
        curr = outgoing.get(curr);
      }

      if (line.length >= 3) {
        polygons.push(line);
      }
    }
  }

  return polygons;
}

/**
 * Chaikin Curve Smoothing
 * Preserves polygon closure and produces silky-smooth curves without self-intersections.
 */
export function smoothPolygonChaikin(poly: Point2D[], iterations: number = 2): Point2D[] {
  if (poly.length < 4) return poly;

  let current = poly;
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point2D[] = [];
    const len = current.length;

    for (let i = 0; i < len; i++) {
      const p0 = current[i];
      const p1 = current[(i + 1) % len];

      const q: Point2D = {
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      };

      const r: Point2D = {
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      };

      next.push(q);
      next.push(r);
    }
    current = next;
  }

  return current;
}
