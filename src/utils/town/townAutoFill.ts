/**
 * Town Vector District Procedural Auto-Fill
 * Automatically populates a designated district polygon with buildings:
 * - Arranges frontage buildings facing adjacent roads.
 * - Fills the interior in parallel rows according to dominant road alignment or OBB axis.
 * - Calibrated density, setbacks, size ranges, building composition, and plazas per district kind.
 * - Completely pure & deterministic (seed-based), decoupled from React and DOM.
 */

import {
  Pt,
  TownBuilding,
  TownBuildingKind,
  TownDistrict,
  TownDistrictKind,
  TownObject,
  TownPier,
  TownRoad,
  TownWall,
  DEFAULT_BUILDING_HEIGHTS,
} from '../../types/town';
import {
  polygonArea,
  polygonCentroid,
  pointInPolygon,
  metersToUnits,
  sampleCatmullRom,
} from './townGeometry';
import {
  pointToSegmentDistance,
} from './townEdit';
import {
  isSimplePolygon,
  minAreaRect,
  deterministicRoofTone,
  generatePresetPolygon,
} from './townBuild';
import { TerrainWaterSampler } from './townSample';
import { makeRng } from '../penSymbols';

export interface AutoFillConfig {
  density: number; // 0..1. Probability threshold per candidate slot
  frontage: boolean; // Whether to place buildings along road frontages
  interior: boolean; // Whether to fill remaining interior in rows
  roadSetbackM: number; // Setback from road edge
  gapM: number; // Minimum gap between buildings
  edgeSetbackM: number; // Minimum distance from district perimeter
  angleJitterDeg: number; // Angular jitter (±)
  orientationMode: 'auto' | 'fixed'; // Orientation mode for interior rows
  fixedAngleDeg: number;
  plazaRatio: number; // Center plaza radius ratio (0..0.6)
  maxBuildings: number; // Maximum buildings per run (default 400)
}

export interface AutoFillParams {
  district: TownDistrict;
  objects: TownObject[]; // Existing town objects for collision detection
  metersPerUnit: number;
  config: AutoFillConfig;
  seed: number;
  waterSampler?: TerrainWaterSampler;
}

export interface AutoFillResult {
  buildings: TownBuilding[];
  stats: {
    placed: number;
    rejectedOutside: number;
    rejectedRoad: number;
    rejectedOverlap: number;
    rejectedWater: number;
    rejectedWall: number;
    hitLimit: boolean;
  };
}

/**
 * Returns the default AutoFillConfig for a district kind, or null if excluded (e.g. park).
 */
export function getAutoFillDefaults(kind: TownDistrictKind): AutoFillConfig | null {
  switch (kind) {
    case 'residential':
      return {
        density: 0.75,
        frontage: true,
        interior: true,
        roadSetbackM: 1.5,
        gapM: 2,
        edgeSetbackM: 1.5,
        angleJitterDeg: 3,
        orientationMode: 'auto',
        fixedAngleDeg: 0,
        plazaRatio: 0,
        maxBuildings: 400,
      };
    case 'poor':
      return {
        density: 0.85,
        frontage: true,
        interior: true,
        roadSetbackM: 1,
        gapM: 1,
        edgeSetbackM: 1,
        angleJitterDeg: 10,
        orientationMode: 'auto',
        fixedAngleDeg: 0,
        plazaRatio: 0,
        maxBuildings: 400,
      };
    case 'market':
      return {
        density: 0.8,
        frontage: true,
        interior: true,
        roadSetbackM: 1,
        gapM: 1.5,
        edgeSetbackM: 1.5,
        angleJitterDeg: 2,
        orientationMode: 'auto',
        fixedAngleDeg: 0,
        plazaRatio: 0.25,
        maxBuildings: 400,
      };
    case 'noble':
      return {
        density: 0.45,
        frontage: true,
        interior: true,
        roadSetbackM: 3,
        gapM: 4,
        edgeSetbackM: 3,
        angleJitterDeg: 0,
        orientationMode: 'auto',
        fixedAngleDeg: 0,
        plazaRatio: 0,
        maxBuildings: 400,
      };
    case 'farmland':
      return {
        density: 0.12,
        frontage: true,
        interior: true,
        roadSetbackM: 4,
        gapM: 12,
        edgeSetbackM: 4,
        angleJitterDeg: 8,
        orientationMode: 'auto',
        fixedAngleDeg: 0,
        plazaRatio: 0,
        maxBuildings: 400,
      };
    case 'park':
    default:
      return null;
  }
}

/**
 * Randomly picks a building kind according to the district kind's distribution weights.
 * Excludes church, keep, and tower.
 */
export function pickBuildingKind(kind: TownDistrictKind, rng: () => number): TownBuildingKind {
  const r = rng() * 100;
  switch (kind) {
    case 'residential':
      if (r < 90) return 'house';
      if (r < 96) return 'shop';
      if (r < 98) return 'hall';
      return 'barn';
    case 'poor':
      return 'house';
    case 'market':
      if (r < 65) return 'shop';
      if (r < 95) return 'house';
      return 'hall';
    case 'noble':
      if (r < 60) return 'house';
      return 'hall';
    case 'farmland':
      if (r < 70) return 'barn';
      return 'house';
    case 'park':
    default:
      return 'house';
  }
}

/**
 * Returns the width and depth range in meters for a building kind in a district kind.
 */
export function buildingSizeRangeM(
  districtKind: TownDistrictKind,
  buildingKind: TownBuildingKind
): { w: [number, number]; d: [number, number] } {
  switch (districtKind) {
    case 'residential':
      if (buildingKind === 'shop') return { w: [6, 9], d: [7, 10] };
      if (buildingKind === 'hall') return { w: [10, 16], d: [8, 12] };
      if (buildingKind === 'barn') return { w: [10, 16], d: [7, 10] };
      return { w: [6, 10], d: [5, 8] }; // house
    case 'poor':
      return { w: [4, 7], d: [4, 6] }; // house
    case 'market':
      if (buildingKind === 'shop') return { w: [6, 9], d: [7, 10] };
      if (buildingKind === 'house') return { w: [6, 9], d: [5, 8] };
      if (buildingKind === 'hall') return { w: [10, 14], d: [8, 12] };
      return { w: [6, 9], d: [6, 9] };
    case 'noble':
      if (buildingKind === 'hall') return { w: [10, 16], d: [8, 12] };
      return { w: [8, 12], d: [7, 10] }; // house
    case 'farmland':
      if (buildingKind === 'barn') return { w: [10, 16], d: [7, 10] };
      return { w: [6, 9], d: [5, 7] }; // house
    case 'park':
    default:
      return { w: [6, 10], d: [5, 8] };
  }
}

// ---------------------------------------------------------------------------
// Internal Geometry & Collision Utilities
// ---------------------------------------------------------------------------

function segmentsIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const ccw = (p1: Pt, p2: Pt, p3: Pt) =>
    (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);

  const d1 = ccw(b1, b2, a1);
  const d2 = ccw(b1, b2, a2);
  const d3 = ccw(a1, a2, b1);
  const d4 = ccw(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

/**
 * Distance between point p and a closed polygon perimeter.
 */
function distanceToPolygonEdges(p: Pt, poly: Pt[]): number {
  let minDist = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const hit = pointToSegmentDistance(p, a, b);
    if (hit.distance < minDist) minDist = hit.distance;
  }
  return minDist;
}

/**
 * Checks if any edge of polyA intersects any edge of polyB.
 */
function polygonEdgesIntersect(polyA: Pt[], polyB: Pt[]): boolean {
  const nA = polyA.length;
  const nB = polyB.length;
  for (let i = 0; i < nA; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % nA];
    for (let j = 0; j < nB; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % nB];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Computes exact minimum distance between two convex polygons.
 * If they intersect or one contains the other, returns 0.
 */
function distanceBetweenPolygons(polyA: Pt[], polyB: Pt[]): number {
  if (polygonEdgesIntersect(polyA, polyB)) return 0;
  if (pointInPolygon(polyA[0], polyB) || pointInPolygon(polyB[0], polyA)) return 0;

  let minDist = Infinity;
  const nA = polyA.length;
  const nB = polyB.length;

  for (let i = 0; i < nA; i++) {
    const v = polyA[i];
    for (let j = 0; j < nB; j++) {
      const b0 = polyB[j];
      const b1 = polyB[(j + 1) % nB];
      const d = pointToSegmentDistance(v, b0, b1).distance;
      if (d < minDist) minDist = d;
    }
  }

  for (let j = 0; j < nB; j++) {
    const u = polyB[j];
    for (let i = 0; i < nA; i++) {
      const a0 = polyA[i];
      const a1 = polyA[(i + 1) % nA];
      const d = pointToSegmentDistance(u, a0, a1).distance;
      if (d < minDist) minDist = d;
    }
  }

  return minDist;
}

/**
 * Computes distance from a polygon to a polyline.
 */
function distancePolygonToPolyline(poly: Pt[], polyline: Pt[], closed: boolean): number {
  const n = polyline.length;
  if (n < 2) return Infinity;

  const segCount = closed ? n : n - 1;
  const polyEdges = poly.length;

  for (let i = 0; i < segCount; i++) {
    const p0 = polyline[i];
    const p1 = polyline[(i + 1) % n];

    // Check segment intersection with polygon edges
    for (let j = 0; j < polyEdges; j++) {
      const e0 = poly[j];
      const e1 = poly[(j + 1) % polyEdges];
      if (segmentsIntersect(p0, p1, e0, e1)) return 0;
    }

    if (pointInPolygon(p0, poly) || pointInPolygon(p1, poly)) return 0;
  }

  let minDist = Infinity;
  // Test polygon vertices against polyline segments
  for (const v of poly) {
    for (let i = 0; i < segCount; i++) {
      const p0 = polyline[i];
      const p1 = polyline[(i + 1) % n];
      const d = pointToSegmentDistance(v, p0, p1).distance;
      if (d < minDist) minDist = d;
    }
  }

  // Test polyline vertices against polygon edges
  for (let i = 0; i < n; i++) {
    const pt = polyline[i];
    for (let j = 0; j < polyEdges; j++) {
      const e0 = poly[j];
      const e1 = poly[(j + 1) % polyEdges];
      const d = pointToSegmentDistance(pt, e0, e1).distance;
      if (d < minDist) minDist = d;
    }
  }

  return minDist;
}

// ---------------------------------------------------------------------------
// Main AutoFill Implementation
// ---------------------------------------------------------------------------

export function autoFillDistrict(params: AutoFillParams): AutoFillResult {
  const { district, objects, metersPerUnit, config, seed, waterSampler } = params;

  const emptyStats = {
    placed: 0,
    rejectedOutside: 0,
    rejectedRoad: 0,
    rejectedOverlap: 0,
    rejectedWater: 0,
    rejectedWall: 0,
    hitLimit: false,
  };

  // 1. Validation of District Polygon
  if (!district.polygon || district.polygon.length < 3 || !isSimplePolygon(district.polygon)) {
    return { buildings: [], stats: emptyStats };
  }

  const rng = makeRng(seed);
  const stats = { ...emptyStats };
  const buildings: TownBuilding[] = [];

  // Index existing objects for collision
  const existingBuildings = objects.filter((o): o is TownBuilding => o.kind === 'building');
  const roads = objects.filter((o): o is TownRoad => o.kind === 'road');
  const walls = objects.filter((o): o is TownWall => o.kind === 'wall');
  const piers = objects.filter((o): o is TownPier => o.kind === 'pier');

  const existingIdSet = new Set(objects.map((o) => o.id));
  let nextSeq = 1;
  const generateUniqueId = (): string => {
    let candidate = `bld_af_${seed}_${nextSeq}`;
    while (existingIdSet.has(candidate)) {
      nextSeq++;
      candidate = `bld_af_${seed}_${nextSeq}`;
    }
    existingIdSet.add(candidate);
    nextSeq++;
    return candidate;
  };

  // District properties
  const distPoly = district.polygon;
  const distCentroid = polygonCentroid(distPoly);
  const distArea = Math.abs(polygonArea(distPoly)); // in map units squared
  const plazaRadiusUnits =
    config.plazaRatio > 0 && distArea > 0
      ? config.plazaRatio * Math.sqrt(distArea / Math.PI)
      : 0;

  // Compute district bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of distPoly) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }

  // 2. Interior Row Orientation Angle
  let interiorAngleRad = 0;
  if (config.orientationMode === 'fixed') {
    interiorAngleRad = (config.fixedAngleDeg * Math.PI) / 180;
  } else {
    // Mode 'auto':
    // (a) Sample road and wall edges within district bbox expanded by 40m
    const expandUnits = 40 / metersPerUnit;
    const expMinX = minX - expandUnits;
    const expMinY = minY - expandUnits;
    const expMaxX = maxX + expandUnits;
    const expMaxY = maxY + expandUnits;

    let totalWeight = 0;
    // We bin 90-degree periodic angles into 18 bins of 5 degrees (pi/36 radians)
    const BIN_COUNT = 18;
    const BIN_SIZE = Math.PI / 2 / BIN_COUNT;
    const angleBins = new Float64Array(BIN_COUNT);

    const checkEdge = (p0: Pt, p1: Pt) => {
      // Bbox overlap test of segment
      const segMinX = Math.min(p0[0], p1[0]);
      const segMaxX = Math.max(p0[0], p1[0]);
      const segMinY = Math.min(p0[1], p1[1]);
      const segMaxY = Math.max(p0[1], p1[1]);
      if (segMaxX < expMinX || segMinX > expMaxX || segMaxY < expMinY || segMinY > expMaxY) return;

      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) return;

      let ang = Math.atan2(dy, dx);
      // Normalize to [0, pi/2)
      ang = ang % (Math.PI / 2);
      if (ang < 0) ang += Math.PI / 2;

      const bin = Math.min(BIN_COUNT - 1, Math.floor(ang / BIN_SIZE));
      angleBins[bin] += len;
      totalWeight += len;
    };

    for (const r of roads) {
      const pts = r.smooth ? sampleCatmullRom(r.points) : r.points;
      for (let i = 0; i < pts.length - 1; i++) {
        checkEdge(pts[i], pts[i + 1]);
      }
    }
    for (const w of walls) {
      const pts = w.points;
      const count = w.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < count; i++) {
        checkEdge(pts[i], pts[(i + 1) % pts.length]);
      }
    }

    if (totalWeight > 1e-3) {
      let maxBinWeight = -1;
      let bestBin = 0;
      for (let b = 0; b < BIN_COUNT; b++) {
        if (angleBins[b] > maxBinWeight) {
          maxBinWeight = angleBins[b];
          bestBin = b;
        }
      }
      interiorAngleRad = (bestBin + 0.5) * BIN_SIZE;
    } else {
      // (b) Fallback to long edge of minAreaRect
      const obb = minAreaRect(distPoly);
      const e0Len = Math.hypot(obb[1][0] - obb[0][0], obb[1][1] - obb[0][1]);
      const e1Len = Math.hypot(obb[2][0] - obb[1][0], obb[2][1] - obb[1][1]);
      if (e0Len >= e1Len) {
        interiorAngleRad = Math.atan2(obb[1][1] - obb[0][1], obb[1][0] - obb[0][0]);
      } else {
        interiorAngleRad = Math.atan2(obb[2][1] - obb[1][1], obb[2][0] - obb[1][0]);
      }
    }
  }

  // Pre-expand road polylines
  const processedRoads = roads.map((r) => ({
    road: r,
    points: r.smooth ? sampleCatmullRom(r.points) : r.points,
  }));

  // Fast building candidate validator
  const validateCandidate = (
    center: Pt,
    polygon: Pt[],
    widthM: number,
    depthM: number,
    facingRoadId?: string
  ): boolean => {
    // 1. Min Edge Length
    if (widthM < 1.5 || depthM < 1.5) return false;

    // 2. Plaza Circle Exclusion
    if (plazaRadiusUnits > 0) {
      const distToCentroid = Math.hypot(center[0] - distCentroid[0], center[1] - distCentroid[1]);
      if (distToCentroid < plazaRadiusUnits) {
        stats.rejectedOutside++;
        return false;
      }
    }

    // 3. District Interior & Edge Setback
    const edgeSetbackUnits = metersToUnits(config.edgeSetbackM, metersPerUnit);
    const testPoints: Pt[] = [
      polygon[0],
      polygon[1],
      polygon[2],
      polygon[3],
      [(polygon[0][0] + polygon[1][0]) * 0.5, (polygon[0][1] + polygon[1][1]) * 0.5],
      [(polygon[1][0] + polygon[2][0]) * 0.5, (polygon[1][1] + polygon[2][1]) * 0.5],
      [(polygon[2][0] + polygon[3][0]) * 0.5, (polygon[2][1] + polygon[3][1]) * 0.5],
      [(polygon[3][0] + polygon[0][0]) * 0.5, (polygon[3][1] + polygon[0][1]) * 0.5],
    ];

    for (const pt of testPoints) {
      if (!pointInPolygon(pt, distPoly)) {
        stats.rejectedOutside++;
        return false;
      }
      const distToEdge = distanceToPolygonEdges(pt, distPoly);
      if (distToEdge < edgeSetbackUnits - 1e-4) {
        stats.rejectedOutside++;
        return false;
      }
    }

    // Check if building polygon intersects district perimeter (e.g. crossing exterior concave bends)
    if (polygonEdgesIntersect(polygon, distPoly)) {
      stats.rejectedOutside++;
      return false;
    }

    // 4. Road Setback
    for (const pr of processedRoads) {
      const isFacing = facingRoadId !== undefined && pr.road.id === facingRoadId;
      const allowedSetbackM = isFacing
        ? Math.max(0.5, config.roadSetbackM - 0.5)
        : config.roadSetbackM;
      const requiredDistUnits = metersToUnits(
        pr.road.widthM * 0.5 + allowedSetbackM,
        metersPerUnit
      );

      const d = distancePolygonToPolyline(polygon, pr.points, false);
      if (d < requiredDistUnits - 1e-4) {
        stats.rejectedRoad++;
        return false;
      }
    }

    // 5. Pier / Bridge Setback
    for (const pier of piers) {
      const requiredDistUnits = metersToUnits(pier.widthM * 0.5 + 1.0, metersPerUnit);
      const d = distancePolygonToPolyline(polygon, pier.points, false);
      if (d < requiredDistUnits - 1e-4) {
        stats.rejectedRoad++;
        return false;
      }
    }

    // 6. Wall Setback
    for (const wall of walls) {
      const requiredDistUnits = metersToUnits(wall.thicknessM * 0.5 + 2.0, metersPerUnit);
      const d = distancePolygonToPolyline(polygon, wall.points, wall.closed);
      if (d < requiredDistUnits - 1e-4) {
        stats.rejectedWall++;
        return false;
      }
    }

    // 7. Building Overlap & Gap Check
    const gapUnits = metersToUnits(config.gapM, metersPerUnit);
    // Candidate AABB with gap padding
    let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
    for (const p of polygon) {
      if (p[0] < cMinX) cMinX = p[0];
      if (p[1] < cMinY) cMinY = p[1];
      if (p[0] > cMaxX) cMaxX = p[0];
      if (p[1] > cMaxY) cMaxY = p[1];
    }
    const padMinX = cMinX - gapUnits;
    const padMinY = cMinY - gapUnits;
    const padMaxX = cMaxX + gapUnits;
    const padMaxY = cMaxY + gapUnits;

    // Check against existing buildings
    for (const eb of existingBuildings) {
      const pts = eb.polygon;
      let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      for (const p of pts) {
        if (p[0] < bMinX) bMinX = p[0];
        if (p[1] < bMinY) bMinY = p[1];
        if (p[0] > bMaxX) bMaxX = p[0];
        if (p[1] > bMaxY) bMaxY = p[1];
      }
      if (bMaxX < padMinX || bMinX > padMaxX || bMaxY < padMinY || bMinY > padMaxY) continue;

      const d = distanceBetweenPolygons(polygon, pts);
      if (d < gapUnits - 1e-4) {
        stats.rejectedOverlap++;
        return false;
      }
    }

    // Check against placed buildings in this run
    for (const nb of buildings) {
      const pts = nb.polygon;
      let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      for (const p of pts) {
        if (p[0] < bMinX) bMinX = p[0];
        if (p[1] < bMinY) bMinY = p[1];
        if (p[0] > bMaxX) bMaxX = p[0];
        if (p[1] > bMaxY) bMaxY = p[1];
      }
      if (bMaxX < padMinX || bMinX > padMaxX || bMaxY < padMinY || bMinY > padMaxY) continue;

      const d = distanceBetweenPolygons(polygon, pts);
      if (d < gapUnits - 1e-4) {
        stats.rejectedOverlap++;
        return false;
      }
    }

    // 8. Water Sampler Check
    if (waterSampler) {
      const waterTestPoints: Pt[] = [
        center,
        polygon[0],
        polygon[1],
        polygon[2],
        polygon[3],
        [(polygon[0][0] + polygon[1][0]) * 0.5, (polygon[0][1] + polygon[1][1]) * 0.5],
        [(polygon[1][0] + polygon[2][0]) * 0.5, (polygon[1][1] + polygon[2][1]) * 0.5],
        [(polygon[2][0] + polygon[3][0]) * 0.5, (polygon[2][1] + polygon[3][1]) * 0.5],
        [(polygon[3][0] + polygon[0][0]) * 0.5, (polygon[3][1] + polygon[0][1]) * 0.5],
      ];
      for (const wp of waterTestPoints) {
        if (waterSampler.isWater(wp[0], wp[1])) {
          stats.rejectedWater++;
          return false;
        }
      }
    }

    return true;
  };

  const commitBuilding = (
    kind: TownBuildingKind,
    polygon: Pt[]
  ) => {
    const id = generateUniqueId();
    const defaultH = DEFAULT_BUILDING_HEIGHTS[kind] ?? 6;
    const heightVariation = 0.85 + rng() * 0.3; // ±15%
    const heightM = Math.round(defaultH * heightVariation * 2) / 2; // round to 0.5m
    const tone = deterministicRoofTone(id);

    buildings.push({
      id,
      kind: 'building',
      buildingKind: kind,
      polygon,
      heightM,
      tone,
    });
    stats.placed++;
  };

  // -------------------------------------------------------------------------
  // 3. Frontage Phase (Walk along adjacent roads)
  // -------------------------------------------------------------------------
  if (config.frontage) {
    const maxRoadDistUnits = metersToUnits(config.roadSetbackM + 16, metersPerUnit);

    for (const pr of processedRoads) {
      if (buildings.length >= config.maxBuildings) {
        stats.hitLimit = true;
        break;
      }

      // Check if road is close to district
      const roadDistToDist = distancePolygonToPolyline(distPoly, pr.points, false);
      if (roadDistToDist > maxRoadDistUnits) continue;

      const pts = pr.points;
      if (pts.length < 2) continue;

      // Arc length parameterization
      const segLengths: number[] = [];
      let totalLength = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        segLengths.push(l);
        totalLength += l;
      }

      const getPointAndTangent = (s: number): { pt: Pt; tangent: Pt } => {
        let cur = s;
        for (let i = 0; i < segLengths.length; i++) {
          const l = segLengths[i];
          if (cur <= l || i === segLengths.length - 1) {
            const t = l > 1e-6 ? Math.max(0, Math.min(1, cur / l)) : 0;
            const p0 = pts[i];
            const p1 = pts[i + 1];
            const px = p0[0] + (p1[0] - p0[0]) * t;
            const py = p0[1] + (p1[1] - p0[1]) * t;
            const tx = l > 1e-6 ? (p1[0] - p0[0]) / l : 1;
            const ty = l > 1e-6 ? (p1[1] - p0[1]) / l : 0;
            return { pt: [px, py], tangent: [tx, ty] };
          }
          cur -= l;
        }
        const last = pts[pts.length - 1];
        return { pt: [last[0], last[1]], tangent: [1, 0] };
      };

      let s = metersToUnits(config.gapM, metersPerUnit);
      while (s < totalLength - metersToUnits(config.gapM, metersPerUnit)) {
        if (buildings.length >= config.maxBuildings) {
          stats.hitLimit = true;
          break;
        }

        const { pt: roadPt, tangent } = getPointAndTangent(s);
        const tangentAngle = Math.atan2(tangent[1], tangent[0]);

        // Left normal: (-ty, tx), Right normal: (ty, -tx)
        const leftNorm: Pt = [-tangent[1], tangent[0]];
        const rightNorm: Pt = [tangent[1], -tangent[0]];

        // Attempt Left Side
        const kindL = pickBuildingKind(district.districtKind, rng);
        const { w: wRangeL, d: dRangeL } = buildingSizeRangeM(district.districtKind, kindL);
        const widthML = wRangeL[0] + rng() * (wRangeL[1] - wRangeL[0]);
        const depthML = dRangeL[0] + rng() * (dRangeL[1] - dRangeL[0]);

        const distML = pr.road.widthM * 0.5 + config.roadSetbackM + depthML * 0.5;
        const distUnitsL = metersToUnits(distML, metersPerUnit);
        const centerL: Pt = [
          roadPt[0] + leftNorm[0] * distUnitsL,
          roadPt[1] + leftNorm[1] * distUnitsL,
        ];
        const jitterRadL = ((rng() * 2 - 1) * config.angleJitterDeg * Math.PI) / 180;
        const angleL = tangentAngle + jitterRadL;
        const polyL = generatePresetPolygon(centerL, kindL, widthML, depthML, angleL, metersPerUnit);

        if (validateCandidate(centerL, polyL, widthML, depthML, pr.road.id)) {
          commitBuilding(kindL, polyL);
          if (buildings.length >= config.maxBuildings) {
            stats.hitLimit = true;
            break;
          }
        }

        // Attempt Right Side
        const kindR = pickBuildingKind(district.districtKind, rng);
        const { w: wRangeR, d: dRangeR } = buildingSizeRangeM(district.districtKind, kindR);
        const widthMR = wRangeR[0] + rng() * (wRangeR[1] - wRangeR[0]);
        const depthMR = dRangeR[0] + rng() * (dRangeR[1] - dRangeR[0]);

        const distMR = pr.road.widthM * 0.5 + config.roadSetbackM + depthMR * 0.5;
        const distUnitsR = metersToUnits(distMR, metersPerUnit);
        const centerR: Pt = [
          roadPt[0] + rightNorm[0] * distUnitsR,
          roadPt[1] + rightNorm[1] * distUnitsR,
        ];
        const jitterRadR = ((rng() * 2 - 1) * config.angleJitterDeg * Math.PI) / 180;
        const angleR = tangentAngle + jitterRadR;
        const polyR = generatePresetPolygon(centerR, kindR, widthMR, depthMR, angleR, metersPerUnit);

        if (validateCandidate(centerR, polyR, widthMR, depthMR, pr.road.id)) {
          commitBuilding(kindR, polyR);
          if (buildings.length >= config.maxBuildings) {
            stats.hitLimit = true;
            break;
          }
        }

        const stepM = Math.max(widthML, widthMR) + config.gapM;
        s += Math.max(1, metersToUnits(stepM, metersPerUnit));
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Interior Phase (Fill remaining interior in rows)
  // -------------------------------------------------------------------------
  if (config.interior && !stats.hitLimit) {
    const cosA = Math.cos(interiorAngleRad);
    const sinA = Math.sin(interiorAngleRad);

    // Rotate district vertices into aligned coordinate system (x', y')
    let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
    for (const p of distPoly) {
      const rx = p[0] * cosA + p[1] * sinA;
      const ry = -p[0] * sinA + p[1] * cosA;
      if (rx < rMinX) rMinX = rx;
      if (ry < rMinY) rMinY = ry;
      if (rx > rMaxX) rMaxX = rx;
      if (ry > rMaxY) rMaxY = ry;
    }

    const { d: avgDepthRange } = buildingSizeRangeM(district.districtKind, 'house');
    const avgDepthM = (avgDepthRange[0] + avgDepthRange[1]) * 0.5;
    const rowStepUnits = metersToUnits(avgDepthM + config.gapM, metersPerUnit);

    const startY = rMinY + metersToUnits(config.edgeSetbackM + avgDepthM * 0.5, metersPerUnit);
    const endY = rMaxY - metersToUnits(config.edgeSetbackM + avgDepthM * 0.5, metersPerUnit);

    let curY = startY;
    while (curY <= endY) {
      if (buildings.length >= config.maxBuildings) {
        stats.hitLimit = true;
        break;
      }

      let curX = rMinX + metersToUnits(config.edgeSetbackM, metersPerUnit);
      const rowEndX = rMaxX - metersToUnits(config.edgeSetbackM, metersPerUnit);

      while (curX <= rowEndX) {
        if (buildings.length >= config.maxBuildings) {
          stats.hitLimit = true;
          break;
        }

        const bKind = pickBuildingKind(district.districtKind, rng);
        const { w: wRange, d: dRange } = buildingSizeRangeM(district.districtKind, bKind);
        const widthM = wRange[0] + rng() * (wRange[1] - wRange[0]);
        const depthM = dRange[0] + rng() * (dRange[1] - dRange[0]);

        const widthUnits = metersToUnits(widthM, metersPerUnit);
        const stepXUnits = widthUnits + metersToUnits(config.gapM, metersPerUnit);

        // Density acceptance check
        if (rng() <= config.density) {
          const slotCenterX = curX + widthUnits * 0.5;
          const slotCenterY = curY;

          // Rotate back to map coordinates
          const cx = slotCenterX * cosA - slotCenterY * sinA;
          const cy = slotCenterX * sinA + slotCenterY * cosA;

          const jitterRad = ((rng() * 2 - 1) * config.angleJitterDeg * Math.PI) / 180;
          const angle = interiorAngleRad + jitterRad;

          const poly = generatePresetPolygon([cx, cy], bKind, widthM, depthM, angle, metersPerUnit);

          if (validateCandidate([cx, cy], poly, widthM, depthM)) {
            commitBuilding(bKind, poly);
            if (buildings.length >= config.maxBuildings) {
              stats.hitLimit = true;
              break;
            }
          }
        }

        curX += Math.max(0.5, stepXUnits);
      }

      curY += Math.max(1, rowStepUnits);
    }
  }

  return {
    buildings,
    stats,
  };
}
