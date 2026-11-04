/**
 * Town Vector Building, District, Transformation & Alignment Pure Helpers
 * Geometry, clipping, rotation, alignment, and clipboard operations.
 * Completely decoupled from React, DOM, and Canvas contexts.
 */

import {
  Pt,
  TownBuilding,
  TownBuildingKind,
  TownClipboardData,
  TownDistrict,
  TownObject,
  TownPier,
  TownRoad,
  TownWall,
} from '../../types/town';
import {
  pointToSegmentDistance,
  getGateWorldPosition,
} from './townEdit';
import {
  polygonCentroid,
} from './townGeometry';

/**
 * Creates a 4-vertex rectangle from edge a->b and third point c.
 * Point c specifies the signed perpendicular depth from line a->b.
 * Returns [p0, p1, p2, p3] with exact right angles.
 */
export function rectangleFrom3Points(a: Pt, b: Pt, c: Pt): Pt[] {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len = Math.hypot(vx, vy);

  if (len < 1e-6) {
    return [
      [a[0], a[1]],
      [a[0] + 1, a[1]],
      [a[0] + 1, a[1] + 1],
      [a[0], a[1] + 1],
    ];
  }

  // Unit vector along edge AB
  const ux = vx / len;
  const uy = vy / len;

  // Perpendicular normal vector (to the left of AB)
  const nx = -uy;
  const ny = ux;

  // Vector AC
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];

  // Signed depth: projection of AC onto normal
  const depth = acx * nx + acy * ny;

  // Perpendicular offset
  const ox = nx * depth;
  const oy = ny * depth;

  const p0: Pt = [a[0], a[1]];
  const p1: Pt = [b[0], b[1]];
  const p2: Pt = [b[0] + ox, b[1] + oy];
  const p3: Pt = [a[0] + ox, a[1] + oy];

  return [p0, p1, p2, p3];
}

/**
 * Generates an n-sided regular polygon approximating a circle with radius r centered at center.
 * Used for round watchtowers, rotunda, etc.
 */
export function circlePolygon(center: Pt, radius: number, n: number = 12): Pt[] {
  const count = Math.max(3, n);
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    pts.push([
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ]);
  }
  return pts;
}

/**
 * Orientation test: cross product of vectors (b - a) and (c - a).
 */
function ccw(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * Tests if segment a1-a2 and segment b1-b2 intersect strictly (not just at shared vertex).
 */
function segmentsIntersectStrict(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const d1 = ccw(b1, b2, a1);
  const d2 = ccw(b1, b2, a2);
  const d3 = ccw(a1, a2, b1);
  const d4 = ccw(a1, a2, b2);

  return (
    ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
    ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
  );
}

/**
 * Checks whether a polygon is simple (non-self-intersecting).
 * Returns true if polygon has >= 3 vertices and no non-adjacent edges cross.
 */
export function isSimplePolygon(pts: Pt[]): boolean {
  const n = pts.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];

    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges that naturally share a vertex
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;

      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];

      if (segmentsIntersectStrict(a1, a2, b1, b2)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Tests if any edge of a polygon has length less than minM meters.
 */
export function hasEdgeLessThanM(polygon: Pt[], minM: number, metersPerUnit: number): boolean {
  const n = polygon.length;
  if (n < 2) return true;
  for (let i = 0; i < n; i++) {
    const p0 = polygon[i];
    const p1 = polygon[(i + 1) % n];
    const distM = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * metersPerUnit;
    if (distM < minM) {
      return true;
    }
  }
  return false;
}

/**
 * Rotates a 2D point around center by angleRad.
 */
export function rotatePoint(p: Pt, center: Pt, cosA: number, sinA: number): Pt {
  const dx = p[0] - center[0];
  const dy = p[1] - center[1];
  return [
    center[0] + dx * cosA - dy * sinA,
    center[1] + dx * sinA + dy * cosA,
  ];
}

/**
 * Rotates a TownObject around center by angleRad.
 * Fortified wall gates maintain their parameter t along rotated segments.
 */
export function rotateObject(obj: TownObject, center: Pt, angleRad: number): TownObject {
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const rot = (p: Pt) => rotatePoint(p, center, cosA, sinA);

  switch (obj.kind) {
    case 'district':
      return {
        ...obj,
        polygon: obj.polygon.map(rot),
      };
    case 'building':
      return {
        ...obj,
        polygon: obj.polygon.map(rot),
      };
    case 'road':
      return {
        ...obj,
        points: obj.points.map(rot),
      };
    case 'pier':
      return {
        ...obj,
        points: obj.points.map(rot),
      };
    case 'wall':
      return {
        ...obj,
        points: obj.points.map(rot),
        gates: obj.gates.map((g) => ({ ...g })),
      };
  }
}

/**
 * Reflects a point across a horizontal or vertical axis passing through center.
 */
export function reflectPoint(p: Pt, center: Pt, axis: 'x' | 'y'): Pt {
  if (axis === 'x') {
    // Horizontal flip (reflect x across center[0])
    return [2 * center[0] - p[0], p[1]];
  } else {
    // Vertical flip (reflect y across center[1])
    return [p[0], 2 * center[1] - p[1]];
  }
}

/**
 * Flips a TownObject across axis ('x' = horizontal flip, 'y' = vertical flip) through center.
 * Fortified wall gates preserve their exact world position upon reflection.
 */
export function flipObject(obj: TownObject, center: Pt, axis: 'x' | 'y'): TownObject {
  const ref = (p: Pt) => reflectPoint(p, center, axis);

  switch (obj.kind) {
    case 'district':
      return {
        ...obj,
        polygon: obj.polygon.map(ref),
      };
    case 'building':
      return {
        ...obj,
        polygon: obj.polygon.map(ref),
      };
    case 'road':
      return {
        ...obj,
        points: obj.points.map(ref),
      };
    case 'pier':
      return {
        ...obj,
        points: obj.points.map(ref),
      };
    case 'wall':
      return {
        ...obj,
        points: obj.points.map(ref),
        gates: obj.gates.map((g) => ({ ...g })),
      };
  }
}

/**
 * Maps a transformation function over an array of TownObjects.
 */
export function transformObjects(
  objects: TownObject[],
  fn: (obj: TownObject) => TownObject
): TownObject[] {
  return objects.map(fn);
}

/**
 * Computes the overall geometric centroid of an array of TownObjects.
 */
export function getObjectsCentroid(objects: TownObject[]): Pt {
  const allPts: Pt[] = [];
  for (const obj of objects) {
    if (obj.kind === 'district' || obj.kind === 'building') {
      allPts.push(...obj.polygon);
    } else {
      allPts.push(...obj.points);
    }
  }

  if (allPts.length === 0) return [0, 0];

  let sx = 0;
  let sy = 0;
  for (const p of allPts) {
    sx += p[0];
    sy += p[1];
  }

  return [sx / allPts.length, sy / allPts.length];
}

/**
 * Finds the nearest road or wall edge direction within maxDistM meters of a given point.
 * Returns { angleRad, distanceM } or null if none within maxDistM.
 */
export function nearestSegmentDirection(
  objects: TownObject[],
  point: Pt,
  maxDistM: number,
  metersPerUnit: number
): { angleRad: number; distanceM: number } | null {
  const candidates = objects.filter((o) => o.kind === 'road' || o.kind === 'wall') as (
    | TownRoad
    | TownWall
  )[];

  if (candidates.length === 0) return null;

  let bestDistM = Infinity;
  let bestAngle = 0;

  for (const obj of candidates) {
    const pts = obj.points;
    const n = pts.length;
    if (n < 2) continue;

    const isClosed = obj.kind === 'wall' && obj.closed;
    const numEdges = isClosed ? n : n - 1;

    for (let i = 0; i < numEdges; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      const hit = pointToSegmentDistance(point, p0, p1);
      const distM = hit.distance * metersPerUnit;

      if (distM < bestDistM) {
        bestDistM = distM;
        bestAngle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      }
    }
  }

  if (bestDistM <= maxDistM) {
    return { angleRad: bestAngle, distanceM: bestDistM };
  }

  return null;
}

/**
 * Serializes objects into a scale-independent clipboard representation in relative meters from centroid.
 */
export function objectsToClipboard(
  objects: TownObject[],
  metersPerUnit: number
): TownClipboardData {
  const center = getObjectsCentroid(objects);

  const relObjects: TownObject[] = objects.map((obj) => {
    const toRel = (p: Pt): Pt => [
      (p[0] - center[0]) * metersPerUnit,
      (p[1] - center[1]) * metersPerUnit,
    ];

    switch (obj.kind) {
      case 'district':
        return { ...obj, polygon: obj.polygon.map(toRel) };
      case 'building':
        return { ...obj, polygon: obj.polygon.map(toRel) };
      case 'road':
        return { ...obj, points: obj.points.map(toRel) };
      case 'pier':
        return { ...obj, points: obj.points.map(toRel) };
      case 'wall':
        return { ...obj, points: obj.points.map(toRel) };
    }
  });

  return {
    metersPerUnit,
    objects: relObjects,
  };
}

/**
 * Reconstructs objects from clipboard at anchor point using target map's metersPerUnit.
 * Assigns new unique IDs.
 */
export function clipboardToObjects(
  clip: TownClipboardData,
  anchor: Pt,
  metersPerUnit: number,
  newIds?: string[]
): TownObject[] {
  const now = Date.now();

  return clip.objects.map((obj, idx) => {
    const id = newIds && newIds[idx] ? newIds[idx] : `${obj.kind}_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const fromRel = (p: Pt): Pt => [
      anchor[0] + p[0] / metersPerUnit,
      anchor[1] + p[1] / metersPerUnit,
    ];

    switch (obj.kind) {
      case 'district':
        return { ...obj, id, polygon: obj.polygon.map(fromRel) };
      case 'building':
        return { ...obj, id, polygon: obj.polygon.map(fromRel) };
      case 'road':
        return { ...obj, id, points: obj.points.map(fromRel) };
      case 'pier':
        return { ...obj, id, points: obj.points.map(fromRel) };
      case 'wall':
        return {
          ...obj,
          id,
          points: obj.points.map(fromRel),
          gates: obj.gates.map((g) => ({ ...g })),
        };
    }
  });
}

/**
 * Rotates each building around its centroid to align with the nearest road or wall within 40m.
 * Adjusts angle modulo 90 degrees so the building takes the closest orientation (within +/- 45 deg).
 */
export function alignParallel(
  buildings: TownBuilding[],
  referenceObjects: TownObject[],
  metersPerUnit: number
): TownBuilding[] {
  return buildings.map((b) => {
    const center = polygonCentroid(b.polygon);
    const nearest = nearestSegmentDirection(referenceObjects, center, 40, metersPerUnit);
    if (!nearest) return b;

    // Determine current primary direction of building (longest edge)
    const pts = b.polygon;
    let maxEdgeLen = -1;
    let curAngle = 0;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % pts.length];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (len > maxEdgeLen) {
        maxEdgeLen = len;
        curAngle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      }
    }

    const roadAngle = nearest.angleRad;
    const diff = roadAngle - curAngle;

    // Smallest rotation within +/- 45 degrees (modulo 90 degrees)
    const halfPi = Math.PI / 2;
    const k = Math.round(diff / halfPi);
    const rot = diff - k * halfPi;

    return rotateObject(b, center, rot) as TownBuilding;
  });
}

/**
 * Aligns 2 or more buildings along their principal linear axis (PCA).
 * Each building centroid is projected onto the best-fit line through the mean centroid.
 */
export function alignToLine(buildings: TownBuilding[]): TownBuilding[] {
  if (buildings.length < 2) return [...buildings];

  const centroids = buildings.map((b) => polygonCentroid(b.polygon));
  const n = centroids.length;

  let meanX = 0;
  let meanY = 0;
  for (const c of centroids) {
    meanX += c[0];
    meanY += c[1];
  }
  meanX /= n;
  meanY /= n;

  // Covariance matrix
  let covXX = 0;
  let covYY = 0;
  let covXY = 0;
  for (const c of centroids) {
    const dx = c[0] - meanX;
    const dy = c[1] - meanY;
    covXX += dx * dx;
    covYY += dy * dy;
    covXY += dx * dy;
  }

  // Principal axis angle
  let theta = 0;
  if (Math.abs(covXX) > 1e-9 || Math.abs(covYY) > 1e-9 || Math.abs(covXY) > 1e-9) {
    theta = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  }

  const ux = Math.cos(theta);
  const uy = Math.sin(theta);

  return buildings.map((b, idx) => {
    const c = centroids[idx];
    const dx = c[0] - meanX;
    const dy = c[1] - meanY;
    const t = dx * ux + dy * uy;
    const targetX = meanX + t * ux;
    const targetY = meanY + t * uy;
    const shiftX = targetX - c[0];
    const shiftY = targetY - c[1];

    return {
      ...b,
      polygon: b.polygon.map((p) => [p[0] + shiftX, p[1] + shiftY]),
    };
  });
}

/**
 * Spaces 3 or more buildings evenly along their principal axis.
 * Endpoints remain fixed in position; intermediate buildings are spaced uniformly.
 */
export function distributeEvenly(buildings: TownBuilding[]): TownBuilding[] {
  if (buildings.length < 3) return [...buildings];

  const centroids = buildings.map((b) => polygonCentroid(b.polygon));
  const n = centroids.length;

  let meanX = 0;
  let meanY = 0;
  for (const c of centroids) {
    meanX += c[0];
    meanY += c[1];
  }
  meanX /= n;
  meanY /= n;

  // Covariance matrix
  let covXX = 0;
  let covYY = 0;
  let covXY = 0;
  for (const c of centroids) {
    const dx = c[0] - meanX;
    const dy = c[1] - meanY;
    covXX += dx * dx;
    covYY += dy * dy;
    covXY += dx * dy;
  }

  let theta = 0;
  if (Math.abs(covXX) > 1e-9 || Math.abs(covYY) > 1e-9 || Math.abs(covXY) > 1e-9) {
    theta = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  }

  const ux = Math.cos(theta);
  const uy = Math.sin(theta);

  // Project centroids onto line
  const indexed = buildings.map((b, idx) => {
    const c = centroids[idx];
    const t = (c[0] - meanX) * ux + (c[1] - meanY) * uy;
    return { b, c, t, idx };
  });

  indexed.sort((a, b) => a.t - b.t);

  const tStart = indexed[0].t;
  const tEnd = indexed[n - 1].t;
  const span = tEnd - tStart;

  if (Math.abs(span) < 1e-6) {
    return [...buildings];
  }

  const step = span / (n - 1);
  const result: TownBuilding[] = new Array(n);

  for (let k = 0; k < n; k++) {
    const item = indexed[k];
    const targetT = tStart + k * step;
    const targetX = meanX + targetT * ux;
    const targetY = meanY + targetT * uy;
    const shiftX = targetX - item.c[0];
    const shiftY = targetY - item.c[1];

    result[item.idx] = {
      ...item.b,
      polygon: item.b.polygon.map((p) => [p[0] + shiftX, p[1] + shiftY]),
    };
  }

  return result;
}

/**
 * Computes the minimum area oriented bounding box (OBB) of a polygon.
 * Tests edge-aligned bounding boxes (caliper search).
 */
export function minAreaRect(polygon: Pt[]): Pt[] {
  const n = polygon.length;
  if (n < 3) return polygon.map((p) => [p[0], p[1]]);

  let bestArea = Infinity;
  let bestAngle = 0;
  let bestMinX = 0;
  let bestMinY = 0;
  let bestMaxX = 0;
  let bestMaxY = 0;

  for (let i = 0; i < n; i++) {
    const p0 = polygon[i];
    const p1 = polygon[(i + 1) % n];
    const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);

    const cosA = Math.cos(-angle);
    const sinA = Math.sin(-angle);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let j = 0; j < n; j++) {
      const p = polygon[j];
      const rx = p[0] * cosA - p[1] * sinA;
      const ry = p[0] * sinA + p[1] * cosA;

      if (rx < minX) minX = rx;
      if (ry < minY) minY = ry;
      if (rx > maxX) maxX = rx;
      if (ry > maxY) maxY = ry;
    }

    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) {
      bestArea = area;
      bestAngle = angle;
      bestMinX = minX;
      bestMinY = minY;
      bestMaxX = maxX;
      bestMaxY = maxY;
    }
  }

  // Reconstruct 4 corners rotated back
  const cosB = Math.cos(bestAngle);
  const sinB = Math.sin(bestAngle);

  const corners: Pt[] = [
    [bestMinX, bestMinY],
    [bestMaxX, bestMinY],
    [bestMaxX, bestMaxY],
    [bestMinX, bestMaxY],
  ];

  return corners.map(([rx, ry]) => [
    rx * cosB - ry * sinB,
    rx * sinB + ry * cosB,
  ]);
}

/**
 * Deterministically generates a roof tone (0 to 1) based on a building's unique id.
 */
export function deterministicRoofTone(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

/**
 * Generates polygon points for a preset building size (widthM x depthM) or 12-sided tower.
 * Rotated by angleRad and centered on center.
 */
export function generatePresetPolygon(
  center: Pt,
  kind: TownBuildingKind,
  widthM: number,
  depthM: number,
  angleRad: number,
  metersPerUnit: number
): Pt[] {
  if (kind === 'tower') {
    const radiusUnits = (widthM / metersPerUnit) / 2;
    return circlePolygon(center, radiusUnits, 12);
  }

  const hw = (widthM / metersPerUnit) / 2;
  const hd = (depthM / metersPerUnit) / 2;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const localCorners: Pt[] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];

  return localCorners.map(([lx, ly]) => [
    center[0] + lx * cosA - ly * sinA,
    center[1] + lx * sinA + ly * cosA,
  ]);
}
