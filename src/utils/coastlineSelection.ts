import { Point2D, extractClosedContours } from './marchingSquares';
import { pointInPolygon, simplifyPolyline } from './regionShape';

// Cache contours for elevationGrid reference + seaLevel
let cachedGridRef: Float32Array | null = null;
let cachedSeaLevel: number = -1;
let cachedContours: [number, number][][] = [];

/**
 * Extracts and caches coastline contours for a given elevation grid and sea level.
 */
export function getCoastlineContours(
  grid: Float32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
  seaLevel: number
): [number, number][][] {
  if (cachedGridRef === grid && cachedSeaLevel === seaLevel && cachedContours.length > 0) {
    return cachedContours;
  }

  // Extract contours with minArea = 8 (preserves small islands and rias features)
  const rawContours = extractClosedContours(grid, cols, rows, width, height, seaLevel, 8);
  const result: [number, number][][] = [];

  for (const ring of rawContours) {
    if (ring.length < 3) continue;
    const pts: [number, number][] = ring.map((p) => [p.x, p.y]);
    // Ensure ring is closed
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      pts.push([first[0], first[1]]);
    }
    result.push(pts);
  }

  cachedGridRef = grid;
  cachedSeaLevel = seaLevel;
  cachedContours = result;
  return result;
}

export interface CoastlineSnapResult {
  point: [number, number];
  distance: number;
  contourIndex: number;
  segmentIndex: number;
}

/**
 * Finds the nearest point on any coastline contour within maxDistance (in world units).
 */
export function findNearestCoastlinePoint(
  worldX: number,
  worldY: number,
  grid: Float32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
  seaLevel: number,
  maxDistance: number
): CoastlineSnapResult | null {
  const contours = getCoastlineContours(grid, cols, rows, width, height, seaLevel);
  if (contours.length === 0) return null;

  let bestDist = maxDistance;
  let bestPoint: [number, number] | null = null;
  let bestContourIdx = -1;
  let bestSegIdx = -1;

  for (let cIdx = 0; cIdx < contours.length; cIdx++) {
    const poly = contours[cIdx];
    if (poly.length < 2) continue;

    // Quick AABB test with margin
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const px = poly[i][0];
      const py = poly[i][1];
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    if (
      worldX < minX - bestDist ||
      worldX > maxX + bestDist ||
      worldY < minY - bestDist ||
      worldY > maxY + bestDist
    ) {
      continue;
    }

    // Check each segment in contour
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];

      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lenSq = dx * dx + dy * dy;

      let t = 0;
      if (lenSq > 1e-8) {
        t = ((worldX - a[0]) * dx + (worldY - a[1]) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }

      const projX = a[0] + t * dx;
      const projY = a[1] + t * dy;
      const dist = Math.hypot(worldX - projX, worldY - projY);

      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = [projX, projY];
        bestContourIdx = cIdx;
        bestSegIdx = i;
      }
    }
  }

  if (!bestPoint) return null;
  return {
    point: bestPoint,
    distance: bestDist,
    contourIndex: bestContourIdx,
    segmentIndex: bestSegIdx,
  };
}

/**
 * Traces a path along the coastline contour between two world points.
 * If both points are near the same contour, walks along the coastline and returns
 * the intermediate contour vertices.
 * If they are on different contours or not near a coast, returns straight line [p1, p2].
 */
export function traceCoastlinePath(
  p1: [number, number],
  p2: [number, number],
  grid: Float32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
  seaLevel: number,
  maxSnapDist: number = 20
): [number, number][] {
  const snap1 = findNearestCoastlinePoint(p1[0], p1[1], grid, cols, rows, width, height, seaLevel, maxSnapDist);
  const snap2 = findNearestCoastlinePoint(p2[0], p2[1], grid, cols, rows, width, height, seaLevel, maxSnapDist);

  // If both endpoints are snapped to the SAME coastline contour within maxSnapDist:
  if (
    snap1 &&
    snap2 &&
    snap1.contourIndex === snap2.contourIndex &&
    snap1.distance <= maxSnapDist &&
    snap2.distance <= maxSnapDist
  ) {
    const contours = getCoastlineContours(grid, cols, rows, width, height, seaLevel);
    const contour = contours[snap1.contourIndex];
    if (contour.length >= 3) {
      // Find fractional indices along the contour
      const idx1 = snap1.segmentIndex;
      const idx2 = snap2.segmentIndex;

      // Closed loop: length is contour.length - 1 (since last == first)
      const loopLen = contour.length - 1;

      // Two possible directions: forward and backward
      const forwardIndices: number[] = [];
      let cur = (idx1 + 1) % loopLen;
      while (cur !== (idx2 + 1) % loopLen) {
        forwardIndices.push(cur);
        cur = (cur + 1) % loopLen;
      }

      const backwardIndices: number[] = [];
      cur = idx1;
      while (cur !== idx2) {
        backwardIndices.push(cur);
        cur = (cur - 1 + loopLen) % loopLen;
      }

      // Compute total polyline length for both paths
      const calcPathLen = (indices: number[], startPt: [number, number], endPt: [number, number]) => {
        if (indices.length === 0) return Math.hypot(endPt[0] - startPt[0], endPt[1] - startPt[1]);
        let total = Math.hypot(contour[indices[0]][0] - startPt[0], contour[indices[0]][1] - startPt[1]);
        for (let k = 0; k < indices.length - 1; k++) {
          total += Math.hypot(
            contour[indices[k + 1]][0] - contour[indices[k]][0],
            contour[indices[k + 1]][1] - contour[indices[k]][1]
          );
        }
        total += Math.hypot(endPt[0] - contour[indices[indices.length - 1]][0], endPt[1] - contour[indices[indices.length - 1]][1]);
        return total;
      };

      const lenFwd = calcPathLen(forwardIndices, snap1.point, snap2.point);
      const lenBwd = calcPathLen(backwardIndices, snap1.point, snap2.point);

      const chosenIndices = lenFwd <= lenBwd ? forwardIndices : backwardIndices;
      const path: [number, number][] = [p1];
      if (Math.hypot(snap1.point[0] - p1[0], snap1.point[1] - p1[1]) > 0.8) {
        path.push(snap1.point);
      }
      for (const idx of chosenIndices) {
        path.push([contour[idx][0], contour[idx][1]]);
      }
      if (Math.hypot(p2[0] - snap2.point[0], p2[1] - snap2.point[1]) > 0.8) {
        path.push(snap2.point);
      }
      path.push(p2);

      // Clean consecutive identical points (< 0.5 units)
      const cleaned: [number, number][] = [path[0]];
      for (let i = 1; i < path.length; i++) {
        const prev = cleaned[cleaned.length - 1];
        if (Math.hypot(path[i][0] - prev[0], path[i][1] - prev[1]) > 0.5) {
          cleaned.push(path[i]);
        }
      }
      return cleaned;
    }
  }

  // Fallback: direct straight segment (boundary between coast and inland polygon)
  return [p1, p2];
}

/**
 * Finds the entire closed coastline contour of the island or landmass containing (worldX, worldY).
 * If clicked in shallow water right off the coast, snaps to the nearest island contour.
 */
export function findEnclosingIslandContour(
  worldX: number,
  worldY: number,
  grid: Float32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
  seaLevel: number
): [number, number][] | null {
  const contours = getCoastlineContours(grid, cols, rows, width, height, seaLevel);
  if (contours.length === 0) return null;

  // 1. Check if the point is directly inside any contour
  let smallestArea = Infinity;
  let bestContour: [number, number][] | null = null;

  for (const poly of contours) {
    if (pointInPolygon([worldX, worldY], poly)) {
      // Calculate approximate area
      let area = 0;
      for (let i = 0; i < poly.length - 1; i++) {
        area += poly[i][0] * poly[i + 1][1] - poly[i + 1][0] * poly[i][1];
      }
      const absArea = Math.abs(area * 0.5);
      if (absArea < smallestArea) {
        smallestArea = absArea;
        bestContour = poly;
      }
    }
  }

  if (bestContour) {
    // Return simplified contour (avoid excessive vertices while preserving rias character)
    return simplifyPolyline(bestContour, 1.2);
  }

  // 2. If not strictly inside, find the closest contour within reasonable reach (~40 world units)
  const snap = findNearestCoastlinePoint(worldX, worldY, grid, cols, rows, width, height, seaLevel, 45);
  if (snap) {
    const poly = contours[snap.contourIndex];
    return simplifyPolyline(poly, 1.2);
  }

  return null;
}
