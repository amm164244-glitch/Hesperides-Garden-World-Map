import { RegionalBounds } from '../types/map';

/**
 * Computes axis-aligned bounding box of a polygon or polyline.
 */
export function polygonBounds(points: [number, number][]): RegionalBounds {
  if (!points || points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = points[0][0];
  let maxX = points[0][0];
  let minY = points[0][1];
  let maxY = points[0][1];

  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Ray-casting algorithm to test whether a 2D point is inside a polygon (even-odd rule).
 */
export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  if (!polygon || polygon.length < 3) return false;
  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Perpendicular distance from a point to a line segment.
 */
function perpendicularDistance(
  p: [number, number],
  p1: [number, number],
  p2: [number, number]
): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const l2 = dx * dx + dy * dy;

  if (l2 === 0) {
    return Math.hypot(p[0] - p1[0], p[1] - p1[1]);
  }

  // Cross product divided by segment length
  return Math.abs(dy * p[0] - dx * p[1] + p2[0] * p1[1] - p2[1] * p1[0]) / Math.sqrt(l2);
}

/**
 * Ramer-Douglas-Peucker polyline simplification algorithm.
 * Reduces the number of points within the specified tolerance.
 */
export function simplifyPolyline(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2 || tolerance <= 0) {
    return [...points];
  }

  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPolyline(points.slice(0, index + 1), tolerance);
    const right = simplifyPolyline(points.slice(index), tolerance);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [points[0], points[end]];
  }
}

/**
 * Catmull-Rom closed spline smoothing for polygons.
 * Returns a smoothed polygon with segmentsPerEdge interpolated points per vertex.
 */
export function smoothPolygon(
  points: [number, number][],
  segmentsPerEdge: number = 4
): [number, number][] {
  const n = points.length;
  if (n < 3 || segmentsPerEdge <= 1) {
    return [...points];
  }

  const result: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    for (let s = 0; s < segmentsPerEdge; s++) {
      const t = s / segmentsPerEdge;
      const t2 = t * t;
      const t3 = t2 * t;

      // Standard Catmull-Rom spline formula
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);

      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

      result.push([x, y]);
    }
  }

  return result;
}

/**
 * Rasterizes a polygon in parent world coordinates into a binary Float32Array mask (1.0 = inside, 0.0 = outside)
 * using the scanline fill algorithm with even-odd rule.
 */
export function rasterizePolygonMask(
  polygon: [number, number][],
  bounds: RegionalBounds,
  gridCols: number,
  gridRows: number
): Float32Array {
  const mask = new Float32Array(gridCols * gridRows);
  if (!polygon || polygon.length < 3) {
    mask.fill(1.0);
    return mask;
  }

  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  if (bw <= 0 || bh <= 0) {
    mask.fill(1.0);
    return mask;
  }

  // Convert parent world polygon coordinates to child grid coordinates
  const polyGrid: [number, number][] = polygon.map(([wx, wy]) => {
    const gx = ((wx - bounds.minX) / bw) * (gridCols - 1);
    const gy = ((wy - bounds.minY) / bh) * (gridRows - 1);
    return [gx, gy];
  });

  const n = polyGrid.length;

  // Scanline algorithm for each grid row
  for (let r = 0; r < gridRows; r++) {
    const y = r;
    const intersections: number[] = [];

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const p1 = polyGrid[j];
      const p2 = polyGrid[i];

      // Check if scanline intersects segment (half-open [min, max) to avoid counting vertices twice)
      if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
        const t = (y - p1[1]) / (p2[1] - p1[1]);
        const x = p1[0] + t * (p2[0] - p1[0]);
        intersections.push(x);
      }
    }

    if (intersections.length === 0) continue;
    intersections.sort((a, b) => a - b);

    const rowOffset = r * gridCols;

    for (let k = 0; k < intersections.length; k += 2) {
      if (k + 1 >= intersections.length) break;
      const xStart = intersections[k];
      const xEnd = intersections[k + 1];

      // Round / clamp columns to grid bounds
      const cStart = Math.max(0, Math.ceil(xStart));
      const cEnd = Math.min(gridCols - 1, Math.floor(xEnd));

      for (let c = cStart; c <= cEnd; c++) {
        mask[rowOffset + c] = 1.0;
      }
    }
  }

  return mask;
}

/**
 * 2-pass separable sliding-window box blur for Float32Array mask.
 * Applied 2 times to approximate Gaussian blur with O(N) linear time complexity.
 */
export function blurMask(
  srcMask: Float32Array,
  gridCols: number,
  gridRows: number,
  radius: number
): Float32Array {
  const r = Math.round(radius);
  if (r <= 0) {
    return new Float32Array(srcMask);
  }

  let current = new Float32Array(srcMask);
  const temp = new Float32Array(gridCols * gridRows);

  const windowSize = 2 * r + 1;

  // Perform 2 iterations of separable horizontal + vertical box blur
  for (let pass = 0; pass < 2; pass++) {
    // 1. Horizontal Pass
    for (let row = 0; row < gridRows; row++) {
      const rowOffset = row * gridCols;

      // Initialize sliding window sum
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const c = Math.max(0, Math.min(gridCols - 1, i));
        sum += current[rowOffset + c];
      }

      for (let col = 0; col < gridCols; col++) {
        temp[rowOffset + col] = sum / windowSize;

        // Slide window
        const nextCol = Math.max(0, Math.min(gridCols - 1, col + r + 1));
        const prevCol = Math.max(0, Math.min(gridCols - 1, col - r));
        sum += current[rowOffset + nextCol] - current[rowOffset + prevCol];
      }
    }

    // 2. Vertical Pass
    for (let col = 0; col < gridCols; col++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const row = Math.max(0, Math.min(gridRows - 1, i));
        sum += temp[row * gridCols + col];
      }

      for (let row = 0; row < gridRows; row++) {
        current[row * gridCols + col] = sum / windowSize;

        // Slide window
        const nextRow = Math.max(0, Math.min(gridRows - 1, row + r + 1));
        const prevRow = Math.max(0, Math.min(gridRows - 1, row - r));
        sum += temp[nextRow * gridCols + col] - temp[prevRow * gridCols + col];
      }
    }
  }

  // Ensure values stay clamped strictly in [0, 1]
  for (let i = 0; i < current.length; i++) {
    const val = current[i];
    if (val < 0) current[i] = 0;
    else if (val > 1) current[i] = 1;
  }

  return current;
}

/**
 * Lowers elevation outside the polygon mask to seaLevel - 15 using smoothstep interpolation.
 */
export function applyShapeMaskElevation(
  elevationGrid: Float32Array,
  mask: Float32Array,
  seaLevel: number
): void {
  const targetElev = seaLevel - 15;
  const len = elevationGrid.length;

  for (let i = 0; i < len; i++) {
    const m = mask[i];
    // Smoothstep interpolation factor s in [0, 1]
    const s = m <= 0 ? 0 : m >= 1 ? 1 : m * m * (3 - 2 * m);
    elevationGrid[i] = targetElev + (elevationGrid[i] - targetElev) * s;
  }
}
