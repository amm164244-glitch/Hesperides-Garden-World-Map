/**
 * Town Vector Editing Pure Functions
 * Geometry calculations, hit testing, vertex manipulation, gate editing, and snapping.
 * Decoupled from React, DOM, and Canvas contexts for robust unit testing.
 */

import {
  Pt,
  TownBuilding,
  TownDistrict,
  TownObject,
  TownObjectBounds,
  TownPier,
  TownRoad,
  TownWall,
  TownWallGate,
} from '../../types/town';
import { metersToUnits, pointInPolygon } from './townGeometry';

export interface SegmentProjection {
  distance: number;
  projection: Pt;
  t: number;
}

export interface NearestPolylineResult extends SegmentProjection {
  segmentIndex: number;
}

/**
 * Calculates perpendicular or clamped endpoint distance from point p to segment [a, b].
 */
export function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): SegmentProjection {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-10) {
    const d = Math.hypot(p[0] - a[0], p[1] - a[1]);
    return { distance: d, projection: [a[0], a[1]], t: 0 };
  }

  const rawT = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  const dist = Math.hypot(p[0] - projX, p[1] - projY);

  return { distance: dist, projection: [projX, projY], t };
}

/**
 * Finds the nearest point, segment index, and parameter t on a polyline or polygon perimeter.
 */
export function nearestPointOnPolyline(
  points: Pt[],
  p: Pt,
  closed: boolean = false
): NearestPolylineResult {
  if (points.length < 2) {
    const first = points[0] || [0, 0];
    return {
      distance: Math.hypot(p[0] - first[0], p[1] - first[1]),
      projection: [first[0], first[1]],
      segmentIndex: 0,
      t: 0,
    };
  }

  let minDistance = Infinity;
  let bestProj: Pt = [points[0][0], points[0][1]];
  let bestSegment = 0;
  let bestT = 0;

  const segmentCount = closed ? points.length : points.length - 1;

  for (let i = 0; i < segmentCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const res = pointToSegmentDistance(p, a, b);

    if (res.distance < minDistance) {
      minDistance = res.distance;
      bestProj = res.projection;
      bestSegment = i;
      bestT = res.t;
    }
  }

  return {
    distance: minDistance,
    projection: bestProj,
    segmentIndex: bestSegment,
    t: bestT,
  };
}

/**
 * Hit test for town objects following priority hierarchy:
 * 1. Fortified Walls & Watchtowers
 * 2. Buildings
 * 3. Piers & Bridges
 * 4. Roads
 * 5. Districts
 */
export function hitTestTownObjects(
  objects: TownObject[],
  point: Pt,
  toleranceUnits: number,
  metersPerUnit: number
): TownObject | null {
  const walls: TownWall[] = [];
  const buildings: TownBuilding[] = [];
  const piers: TownPier[] = [];
  const roads: TownRoad[] = [];
  const districts: TownDistrict[] = [];

  for (const obj of objects) {
    switch (obj.kind) {
      case 'wall':
        walls.push(obj);
        break;
      case 'building':
        buildings.push(obj);
        break;
      case 'pier':
        piers.push(obj);
        break;
      case 'road':
        roads.push(obj);
        break;
      case 'district':
        districts.push(obj);
        break;
    }
  }

  // 1. Walls & Towers (tested in reverse creation order, newest on top)
  for (let i = walls.length - 1; i >= 0; i--) {
    const wall = walls[i];
    const wallThickUnits = metersToUnits(wall.thicknessM, metersPerUnit);
    const threshold = Math.max(wallThickUnits * 0.5, toleranceUnits);

    // Vertex towers test
    if (wall.towers) {
      const towerRadiusUnits = metersToUnits(wall.towerRadiusM, metersPerUnit);
      const towerThresh = Math.max(towerRadiusUnits, toleranceUnits);
      for (const vertex of wall.points) {
        if (Math.hypot(point[0] - vertex[0], point[1] - vertex[1]) <= towerThresh) {
          return wall;
        }
      }
    }

    // Polyline edge test
    const nearest = nearestPointOnPolyline(wall.points, point, wall.closed);
    if (nearest.distance <= threshold) {
      return wall;
    }
  }

  // 2. Buildings (tested in reverse creation order)
  for (let i = buildings.length - 1; i >= 0; i--) {
    const bld = buildings[i];
    if (pointInPolygon(point, bld.polygon)) {
      return bld;
    }
    // Also check near border within tolerance
    const nearest = nearestPointOnPolyline(bld.polygon, point, true);
    if (nearest.distance <= toleranceUnits) {
      return bld;
    }
  }

  // 3. Piers & Bridges
  for (let i = piers.length - 1; i >= 0; i--) {
    const pier = piers[i];
    const pierWidthUnits = metersToUnits(pier.widthM, metersPerUnit);
    const threshold = Math.max(pierWidthUnits * 0.5, toleranceUnits);
    const nearest = nearestPointOnPolyline(pier.points, point, false);
    if (nearest.distance <= threshold) {
      return pier;
    }
  }

  // 4. Roads
  for (let i = roads.length - 1; i >= 0; i--) {
    const road = roads[i];
    const roadWidthUnits = metersToUnits(road.widthM, metersPerUnit);
    const threshold = Math.max(roadWidthUnits * 0.5, toleranceUnits);
    const nearest = nearestPointOnPolyline(road.points, point, false);
    if (nearest.distance <= threshold) {
      return road;
    }
  }

  // 5. Districts
  for (let i = districts.length - 1; i >= 0; i--) {
    const dist = districts[i];
    if (pointInPolygon(point, dist.polygon)) {
      return dist;
    }
    const nearest = nearestPointOnPolyline(dist.polygon, point, true);
    if (nearest.distance <= toleranceUnits) {
      return dist;
    }
  }

  return null;
}

/**
 * Translates any town object by [dx, dy] returning a new object (pure).
 */
export function translateObject<T extends TownObject>(obj: T, dx: number, dy: number): T {
  if (dx === 0 && dy === 0) return obj;

  if (obj.kind === 'district' || obj.kind === 'building') {
    return {
      ...obj,
      polygon: obj.polygon.map(([x, y]) => [x + dx, y + dy] as Pt),
    };
  }

  return {
    ...obj,
    points: obj.points.map(([x, y]) => [x + dx, y + dy] as Pt),
  };
}

/**
 * Moves vertex at given index to new position p.
 */
export function moveVertex<T extends TownObject>(obj: T, index: number, p: Pt): T {
  if (obj.kind === 'district' || obj.kind === 'building') {
    if (index < 0 || index >= obj.polygon.length) return obj;
    const nextPoly = [...obj.polygon];
    nextPoly[index] = [p[0], p[1]];
    return {
      ...obj,
      polygon: nextPoly,
    };
  }

  if (index < 0 || index >= obj.points.length) return obj;
  const nextPoints = [...obj.points];
  nextPoints[index] = [p[0], p[1]];
  return {
    ...obj,
    points: nextPoints,
  };
}

/**
 * Inserts a new vertex p after segmentIndex.
 * For a segment from index i to i+1, the new vertex is inserted at index i+1.
 */
export function insertVertex<T extends TownObject>(obj: T, segmentIndex: number, p: Pt): T {
  const insertIdx = segmentIndex + 1;

  if (obj.kind === 'district' || obj.kind === 'building') {
    const nextPoly = [...obj.polygon];
    nextPoly.splice(insertIdx, 0, [p[0], p[1]]);
    return {
      ...obj,
      polygon: nextPoly,
    };
  }

  const nextPoints = [...obj.points];
  nextPoints.splice(insertIdx, 0, [p[0], p[1]]);

  if (obj.kind === 'wall') {
    const oldPoints = obj.points;
    const newWall: TownWall = {
      ...obj,
      points: nextPoints,
    };
    return reprojectGates(newWall, oldPoints) as T;
  }

  return {
    ...obj,
    points: nextPoints,
  };
}

/**
 * Removes a vertex at given index.
 * Returns null if removing the vertex would violate minimum vertex constraints:
 * - Line objects (road, pier, open wall): minimum 2 vertices
 * - Closed shapes (district, building, closed wall): minimum 3 vertices
 */
export function removeVertex<T extends TownObject>(obj: T, index: number): T | null {
  if (obj.kind === 'district' || obj.kind === 'building') {
    if (obj.polygon.length <= 3) return null;
    if (index < 0 || index >= obj.polygon.length) return obj;
    const nextPoly = obj.polygon.filter((_, i) => i !== index);
    return {
      ...obj,
      polygon: nextPoly,
    };
  }

  const minPts = obj.kind === 'wall' && obj.closed ? 3 : 2;
  if (obj.points.length <= minPts) return null;
  if (index < 0 || index >= obj.points.length) return obj;

  const nextPoints = obj.points.filter((_, i) => i !== index);

  if (obj.kind === 'wall') {
    const oldPoints = obj.points;
    const newWall: TownWall = {
      ...obj,
      points: nextPoints,
    };
    return reprojectGates(newWall, oldPoints) as T;
  }

  return {
    ...obj,
    points: nextPoints,
  };
}

/**
 * Reprojects gates onto the nearest edge of a modified wall so gate positions don't shift wildly when vertices are added/removed.
 */
export function reprojectGates(wall: TownWall, oldPoints: Pt[]): TownWall {
  if (!wall.gates || wall.gates.length === 0) return wall;
  if (!oldPoints || oldPoints.length < 2 || wall.points.length < 2) return wall;

  const oldN = oldPoints.length;
  const updatedGates: TownWallGate[] = wall.gates.map((g) => {
    const sIdx = Math.max(0, Math.min(oldN - 1, g.segmentIndex));
    const p0 = oldPoints[sIdx];
    const p1 = oldPoints[(sIdx + 1) % oldN];
    const worldP: Pt = [
      p0[0] + (p1[0] - p0[0]) * g.t,
      p0[1] + (p1[1] - p0[1]) * g.t,
    ];

    const nearest = nearestPointOnPolyline(wall.points, worldP, wall.closed);
    return {
      ...g,
      segmentIndex: nearest.segmentIndex,
      t: Math.max(0.05, Math.min(0.95, nearest.t)),
    };
  });

  return {
    ...wall,
    gates: updatedGates,
  };
}

/**
 * Adds a new gate to a fortified wall at a specific segment and parameter t.
 */
export function addGate(
  wall: TownWall,
  segmentIndex: number,
  t: number,
  widthM: number = 4
): TownWall {
  const safeT = Math.max(0.05, Math.min(0.95, t));
  const newGate: TownWallGate = {
    segmentIndex,
    t: safeT,
    widthM: Math.max(2, widthM),
  };
  return {
    ...wall,
    gates: [...wall.gates, newGate],
  };
}

/**
 * Moves an existing gate on a wall to another segment or position.
 */
export function moveGate(
  wall: TownWall,
  gateIndex: number,
  segmentIndex: number,
  t: number
): TownWall {
  if (gateIndex < 0 || gateIndex >= wall.gates.length) return wall;
  const safeT = Math.max(0.05, Math.min(0.95, t));
  const nextGates = [...wall.gates];
  nextGates[gateIndex] = {
    ...nextGates[gateIndex],
    segmentIndex,
    t: safeT,
  };
  return {
    ...wall,
    gates: nextGates,
  };
}

/**
 * Removes a gate from a fortified wall by its index in wall.gates.
 */
export function removeGate(wall: TownWall, gateIndex: number): TownWall {
  if (gateIndex < 0 || gateIndex >= wall.gates.length) return wall;
  return {
    ...wall,
    gates: wall.gates.filter((_, i) => i !== gateIndex),
  };
}

/**
 * Computes world coordinate of a gate on a wall.
 */
export function getGateWorldPosition(wall: TownWall, gate: TownWallGate): Pt {
  const pts = wall.points;
  const n = pts.length;
  if (n < 2) return [0, 0];

  const i0 = gate.segmentIndex % n;
  const i1 = (i0 + 1) % n;
  const p0 = pts[i0];
  const p1 = pts[i1];

  return [p0[0] + (p1[0] - p0[0]) * gate.t, p0[1] + (p1[1] - p0[1]) * gate.t];
}

/**
 * Snaps a target point p to the closest candidate point if within tolerance.
 */
export function snapPoint(
  p: Pt,
  candidates: Pt[],
  tolerance: number
): { snapped: Pt; didSnap: boolean; target?: Pt } {
  if (!candidates || candidates.length === 0 || tolerance <= 0) {
    return { snapped: [p[0], p[1]], didSnap: false };
  }

  let minDistance = Infinity;
  let bestTarget: Pt | undefined = undefined;
  const px = p[0];
  const py = p[1];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const dx = Math.abs(px - c[0]);
    if (dx > tolerance) continue;
    const dy = Math.abs(py - c[1]);
    if (dy > tolerance) continue;
    const d = Math.hypot(dx, dy);
    if (d <= tolerance && d < minDistance) {
      minDistance = d;
      bestTarget = c;
    }
  }

  if (bestTarget) {
    return { snapped: [bestTarget[0], bestTarget[1]], didSnap: true, target: bestTarget };
  }

  return { snapped: [p[0], p[1]], didSnap: false };
}

/**
 * Constrains the angle between two points to increments of stepDeg (default 15 degrees).
 */
export function snapAngle(from: Pt, to: Pt, stepDeg: number = 15): Pt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);

  if (distance < 1e-6) return [to[0], to[1]];

  const rawAngle = Math.atan2(dy, dx);
  const stepRad = (stepDeg * Math.PI) / 180;
  const snappedAngle = Math.round(rawAngle / stepRad) * stepRad;

  return [
    from[0] + distance * Math.cos(snappedAngle),
    from[1] + distance * Math.sin(snappedAngle),
  ];
}

/**
 * Tests if any part of an object intersects or is contained inside an axis-aligned box rect.
 */
export function objectIntersectsRect(obj: TownObject, rect: TownObjectBounds): boolean {
  const pts: Pt[] =
    obj.kind === 'district' || obj.kind === 'building' ? obj.polygon : obj.points;

  if (!pts || pts.length === 0) return false;

  const minX = Math.min(rect.minX, rect.maxX);
  const maxX = Math.max(rect.minX, rect.maxX);
  const minY = Math.min(rect.minY, rect.maxY);
  const maxY = Math.max(rect.minY, rect.maxY);

  // 1. Any vertex inside rect?
  for (const [x, y] of pts) {
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      return true;
    }
  }

  // 2. Center of rect inside polygon? (For large districts/buildings that engulf rect)
  if (obj.kind === 'district' || obj.kind === 'building') {
    const center: Pt = [(minX + maxX) * 0.5, (minY + maxY) * 0.5];
    if (pointInPolygon(center, obj.polygon)) {
      return true;
    }
  }

  return false;
}

/**
 * Filters all objects that intersect with marquee selection box rect.
 */
export function objectsInRect(objects: TownObject[], rect: TownObjectBounds): TownObject[] {
  return objects.filter((o) => objectIntersectsRect(o, rect));
}

/**
 * Computes unified bounding box encompassing a list of objects.
 */
export function selectionBounds(objects: TownObject[]): TownObjectBounds | null {
  if (!objects || objects.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const obj of objects) {
    const pts = obj.kind === 'district' || obj.kind === 'building' ? obj.polygon : obj.points;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

export * from './townBuild';
