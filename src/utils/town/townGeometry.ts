/**
 * Town Vector Geometry Pure Helpers
 * Math, spline interpolation, spatial bounds, and geometric operations for town objects.
 * Completely decoupled from React, DOM, and Canvas contexts.
 */

import { Pt, TownObject, TownObjectBounds } from '../../types/town';

/**
 * Calculates the signed area of a 2D polygon using the Shoelace formula.
 * Positive for clockwise or counter-clockwise depending on coordinate system orientation.
 */
export function polygonArea(pts: Pt[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return area * 0.5;
}

/**
 * Calculates the geometric centroid [cx, cy] of a 2D polygon.
 * Falls back to arithmetic mean if area is near zero.
 */
export function polygonCentroid(pts: Pt[]): Pt {
  const n = pts.length;
  if (n === 0) return [0, 0];
  if (n === 1) return [pts[0][0], pts[0][1]];
  if (n === 2) return [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];

  const area = polygonArea(pts);
  if (Math.abs(area) < 1e-7) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += pts[i][0];
      sy += pts[i][1];
    }
    return [sx / n, sy / n];
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const factor = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    cx += (pts[i][0] + pts[j][0]) * factor;
    cy += (pts[i][1] + pts[j][1]) * factor;
  }
  const factor = 1 / (6 * area);
  return [cx * factor, cy * factor];
}

/**
 * Tests whether a point [px, py] is inside, on an edge of, or outside a polygon.
 */
export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  const [px, py] = p;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];

    // Check if point lies directly on segment (within small tolerance)
    const cross = (px - xi) * (yj - yi) - (py - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-6) {
      if (
        px >= Math.min(xi, xj) - 1e-6 &&
        px <= Math.max(xi, xj) + 1e-6 &&
        py >= Math.min(yi, yj) - 1e-6 &&
        py <= Math.max(yi, yj) + 1e-6
      ) {
        return true;
      }
    }

    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Calculates total arc length of a polyline in map units.
 */
export function polylineLength(pts: Pt[]): number {
  if (pts.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return len;
}

/**
 * Converts real-world meters to map units given metersPerUnit.
 * metersPerUnit = (effectiveWidthKm * 1000) / mapWidth
 */
export function metersToUnits(m: number, metersPerUnit: number): number {
  if (metersPerUnit <= 0) return 0;
  return m / metersPerUnit;
}

/**
 * Computes axis-aligned bounding box (AABB) for any TownObject in local map units.
 */
export function objectBounds(obj: TownObject): TownObjectBounds {
  let pts: Pt[] = [];

  switch (obj.kind) {
    case 'district':
    case 'building':
      pts = obj.polygon;
      break;
    case 'road':
    case 'pier':
    case 'wall':
      pts = obj.points;
      break;
  }

  if (!pts || pts.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0];
    const y = pts[i][1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  // Pad slightly for objects with width / height displacement
  let padding = 1;
  if (obj.kind === 'building') {
    padding = Math.max(2, obj.heightM * 0.5);
  } else if (obj.kind === 'wall') {
    padding = Math.max(4, obj.thicknessM * 1.5, obj.towerRadiusM * 2);
  } else if (obj.kind === 'road' || obj.kind === 'pier') {
    padding = Math.max(2, obj.widthM);
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

/**
 * Checks if two bounding boxes intersect (AABB overlap test).
 */
export function isBoundsVisible(
  bounds: TownObjectBounds,
  viewBounds: TownObjectBounds
): boolean {
  return !(
    bounds.maxX < viewBounds.minX ||
    bounds.minX > viewBounds.maxX ||
    bounds.maxY < viewBounds.minY ||
    bounds.minY > viewBounds.maxY
  );
}

/**
 * Interpolates smooth Catmull-Rom spline curves passing exactly through the given control points.
 */
export function sampleCatmullRom(
  points: Pt[],
  segmentsPerEdge: number = 8,
  closed: boolean = false
): Pt[] {
  const n = points.length;
  if (n < 2) return points.map((p) => [p[0], p[1]]);
  if (n === 2 && !closed) {
    // For 2 points, linear interpolation is clean and exact
    const res: Pt[] = [];
    const p0 = points[0];
    const p1 = points[1];
    for (let s = 0; s <= segmentsPerEdge; s++) {
      const t = s / segmentsPerEdge;
      res.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
    }
    return res;
  }

  const result: Pt[] = [];
  const count = closed ? n : n - 1;

  for (let i = 0; i < count; i++) {
    const p0 = closed
      ? points[(i - 1 + n) % n]
      : points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = closed
      ? points[(i + 2) % n]
      : points[Math.min(n - 1, i + 2)];

    for (let s = 0; s < segmentsPerEdge; s++) {
      const t = s / segmentsPerEdge;
      const t2 = t * t;
      const t3 = t2 * t;

      // Standard Catmull-Rom spline basis matrix with alpha = 0.5
      const f1 = -0.5 * t3 + t2 - 0.5 * t;
      const f2 = 1.5 * t3 - 2.5 * t2 + 1.0;
      const f3 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
      const f4 = 0.5 * t3 - 0.5 * t2;

      const x = p0[0] * f1 + p1[0] * f2 + p2[0] * f3 + p3[0] * f4;
      const y = p0[1] * f1 + p1[1] * f2 + p2[1] * f3 + p3[1] * f4;
      result.push([x, y]);
    }
  }

  // Include final point
  const endPoint = closed ? points[0] : points[n - 1];
  result.push([endPoint[0], endPoint[1]]);

  return result;
}

/**
 * Computes offset lines on the left and right sides of a polyline by normal distance.
 */
export function offsetPolyline(
  points: Pt[],
  distance: number
): { left: Pt[]; right: Pt[] } {
  const n = points.length;
  if (n < 2) {
    return {
      left: points.map((p) => [p[0], p[1]]),
      right: points.map((p) => [p[0], p[1]]),
    };
  }

  const left: Pt[] = [];
  const right: Pt[] = [];

  // Calculate normals at each vertex
  for (let i = 0; i < n; i++) {
    let nx = 0;
    let ny = 0;

    if (i === 0) {
      // First point normal
      const dx = points[1][0] - points[0][0];
      const dy = points[1][1] - points[0][1];
      const len = Math.hypot(dx, dy) || 1;
      nx = -dy / len;
      ny = dx / len;
    } else if (i === n - 1) {
      // Last point normal
      const dx = points[n - 1][0] - points[n - 2][0];
      const dy = points[n - 1][1] - points[n - 2][1];
      const len = Math.hypot(dx, dy) || 1;
      nx = -dy / len;
      ny = dx / len;
    } else {
      // Average normal of adjacent segments
      const dx1 = points[i][0] - points[i - 1][0];
      const dy1 = points[i][1] - points[i - 1][1];
      const len1 = Math.hypot(dx1, dy1) || 1;

      const dx2 = points[i + 1][0] - points[i][0];
      const dy2 = points[i + 1][1] - points[i][1];
      const len2 = Math.hypot(dx2, dy2) || 1;

      const nx1 = -dy1 / len1;
      const ny1 = dx1 / len1;
      const nx2 = -dy2 / len2;
      const ny2 = dx2 / len2;

      nx = (nx1 + nx2) / 2;
      ny = (ny1 + ny2) / 2;
      const nlen = Math.hypot(nx, ny) || 1;
      nx /= nlen;
      ny /= nlen;
    }

    left.push([points[i][0] + nx * distance, points[i][1] + ny * distance]);
    right.push([points[i][0] - nx * distance, points[i][1] - ny * distance]);
  }

  return { left, right };
}
