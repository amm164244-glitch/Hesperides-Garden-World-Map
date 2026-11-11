/**
 * Topographic Water Elevation Analysis and Validation
 * Provides rigorous elevation profiling, downhill flow verification, valley thalweg snapping,
 * lake surface elevation computation, and topological connection checks.
 */

import { RiverData, LakeData } from '../types/water';
import { sampleElev, pointInLake } from './waterGenerator';

export interface RiverElevationProfile {
  elevations: number[];
  startElev: number;
  endElev: number;
  minElev: number;
  maxElev: number;
  totalDrop: number;
  uphillSegments: number;
  maxUphill: number;
  isMonotonic: boolean;
  isReversed: boolean;
  waterSurfaceProfile: number[];
}

export interface LakeElevationProfile {
  surfaceElevation: number;
  minRimElevation: number;
  maxRimElevation: number;
  avgRimElevation: number;
  minBedElevation: number;
  depth: number;
  spillPoint: [number, number];
}

export interface RiverConnectionAnalysis {
  sourceType: 'spring' | 'lake';
  sourceLakeId?: string;
  terminatesAt: 'ocean' | 'lake' | 'river' | 'inland';
  targetLakeId?: string;
  connectedRiverId?: string;
  elevationStart: number;
  elevationEnd: number;
}

/**
 * Samples and analyzes the elevation profile along a river's points.
 */
export function analyzeRiverElevation(
  points: [number, number][],
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  seaLevel: number = 35.0,
  uphillTolerance: number = 0.35,
  terminatesAt?: 'ocean' | 'lake' | 'river' | 'inland'
): RiverElevationProfile {
  const n = points.length;
  if (n === 0) {
    return {
      elevations: [],
      startElev: 0,
      endElev: 0,
      minElev: 0,
      maxElev: 0,
      totalDrop: 0,
      uphillSegments: 0,
      maxUphill: 0,
      isMonotonic: true,
      isReversed: false,
      waterSurfaceProfile: [],
    };
  }

  const elevations: number[] = new Array(n);
  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let i = 0; i < n; i++) {
    const e = sampleElev(grid, cols, rows, mapW, mapH, points[i][0], points[i][1]);
    elevations[i] = e;
    if (e < minElev) minElev = e;
    if (e > maxElev) maxElev = e;
  }

  const startElev = elevations[0];
  const rawEndElev = elevations[n - 1];
  const isOceanMouth = (terminatesAt === 'ocean' || (terminatesAt !== 'lake' && terminatesAt !== 'river')) && rawEndElev <= seaLevel + 1.8;
  const endElev = isOceanMouth ? Math.min(rawEndElev, seaLevel) : rawEndElev;
  const totalDrop = startElev - endElev;

  // Check monotonicity (downhill progression)
  let uphillSegments = 0;
  let maxUphill = 0;
  for (let i = 0; i < n - 1; i++) {
    const diff = elevations[i + 1] - elevations[i];
    if (diff > uphillTolerance) {
      uphillSegments++;
      if (diff > maxUphill) {
        maxUphill = diff;
      }
    }
  }

  const isMonotonic = uphillSegments === 0;
  // A river is considered reversed if drawn from mouth upwards into high ground
  const isReversed = endElev > startElev + 1.5;

  // Compute physically valid downhill water surface level (monotonically decreasing downstream)
  // Ensures river never flatlines at a local depression and flows continuously downhill from start to end
  const waterSurfaceProfile: number[] = new Array(n);
  const cumDists = new Float32Array(n);
  cumDists[0] = 0;
  for (let i = 0; i < n - 1; i++) {
    cumDists[i + 1] = cumDists[i] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  const totalL = cumDists[n - 1] || 1;

  if (startElev >= endElev) {
    // Normal flow direction (high to low)
    waterSurfaceProfile[0] = startElev;
    for (let i = 1; i < n; i++) {
      const frac = cumDists[i] / totalL;
      const gradBaseline = startElev - (startElev - endElev) * frac;
      const stepDelta = Math.max(0.005, (startElev - endElev) * ((cumDists[i] - cumDists[i - 1]) / totalL) * 0.3);
      const maxAllowed = waterSurfaceProfile[i - 1] - stepDelta;
      const naturalElev = Math.min(elevations[i], gradBaseline);
      waterSurfaceProfile[i] = Math.max(endElev, Math.min(maxAllowed, naturalElev));
    }
    waterSurfaceProfile[n - 1] = endElev;

    // Backward pass to guarantee smooth downhill slope and no plateaus
    for (let i = n - 2; i >= 0; i--) {
      const stepDelta = Math.max(0.005, (startElev - endElev) * ((cumDists[i + 1] - cumDists[i]) / totalL) * 0.3);
      if (waterSurfaceProfile[i] < waterSurfaceProfile[i + 1] + stepDelta) {
        waterSurfaceProfile[i] = Math.min(startElev, waterSurfaceProfile[i + 1] + stepDelta);
      }
    }
    waterSurfaceProfile[0] = startElev;
  } else {
    // River drawn backwards (low to high): establish downhill progression from end (source) to start (mouth)
    waterSurfaceProfile[n - 1] = endElev;
    for (let i = n - 2; i >= 0; i--) {
      const frac = (totalL - cumDists[i]) / totalL;
      const gradBaseline = endElev - (endElev - startElev) * frac;
      const stepDelta = Math.max(0.005, (endElev - startElev) * ((cumDists[i + 1] - cumDists[i]) / totalL) * 0.3);
      const maxAllowed = waterSurfaceProfile[i + 1] - stepDelta;
      const naturalElev = Math.min(elevations[i], gradBaseline);
      waterSurfaceProfile[i] = Math.max(startElev, Math.min(maxAllowed, naturalElev));
    }
    waterSurfaceProfile[0] = startElev;
  }

  return {
    elevations,
    startElev,
    endElev,
    minElev,
    maxElev,
    totalDrop,
    uphillSegments,
    maxUphill,
    isMonotonic,
    isReversed,
    waterSurfaceProfile,
  };
}

/**
 * Automatically orients river points so flow travels downhill (from higher elevation to lower elevation).
 * If start point is lower than end point, reverses points array.
 */
export function autoOrientRiverDownhill(
  points: [number, number][],
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number
): { points: [number, number][]; wasReversed: boolean } {
  if (points.length < 2) return { points, wasReversed: false };

  const startE = sampleElev(grid, cols, rows, mapW, mapH, points[0][0], points[0][1]);
  const endE = sampleElev(grid, cols, rows, mapW, mapH, points[points.length - 1][0], points[points.length - 1][1]);

  if (endE > startE + 1.2) {
    // Reverse points so source is at higher elevation
    const rev = [...points].reverse();
    return { points: rev, wasReversed: true };
  }

  return { points, wasReversed: false };
}

/**
 * Snaps river vertices laterally to local valley bottoms (thalweg) to remove unnatural uphill climbs.
 * Preserves endpoints and respects maximum search displacement.
 */
export function snapRiverToValleys(
  points: [number, number][],
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  maxSearchDist: number = 24.0,
  iterations: number = 2
): [number, number][] {
  const n = points.length;
  if (n < 3) return points;

  let current = points.map((p) => [p[0], p[1]] as [number, number]);

  for (let iter = 0; iter < iterations; iter++) {
    const next: [number, number][] = [current[0]];

    for (let i = 1; i < n - 1; i++) {
      const pPrev = current[i - 1];
      const pCurr = current[i];
      const pNext = current[i + 1];

      // Segment normal
      const dx = pNext[0] - pPrev[0];
      const dy = pNext[1] - pPrev[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      const currElev = sampleElev(grid, cols, rows, mapW, mapH, pCurr[0], pCurr[1]);
      let bestX = pCurr[0];
      let bestY = pCurr[1];
      let bestElev = currElev;

      // Probe left and right along normal
      const probeSteps = 7;
      for (let s = -probeSteps; s <= probeSteps; s++) {
        if (s === 0) continue;
        const dist = (s / probeSteps) * maxSearchDist;
        const candX = pCurr[0] + nx * dist;
        const candY = pCurr[1] + ny * dist;

        if (candX < 0 || candX > mapW || candY < 0 || candY > mapH) continue;

        const candElev = sampleElev(grid, cols, rows, mapW, mapH, candX, candY);
        // Reward lower elevation (valley floor)
        if (candElev < bestElev - 0.2) {
          bestElev = candElev;
          bestX = candX;
          bestY = candY;
        }
      }

      next.push([bestX, bestY]);
    }

    next.push(current[n - 1]);
    current = next;
  }

  return current;
}

/**
 * Evaluates lake water surface elevation, perimeter rim elevations, and depth.
 * The physically natural water level of an inland lake is governed by its lowest rim point (spillway).
 */
export function evaluateLakeElevation(
  polygon: [number, number][],
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  seaLevel: number = 35.0
): LakeElevationProfile {
  const n = polygon.length;
  if (n < 3) {
    const e = n > 0 ? sampleElev(grid, cols, rows, mapW, mapH, polygon[0][0], polygon[0][1]) : seaLevel;
    return {
      surfaceElevation: e,
      minRimElevation: e,
      maxRimElevation: e,
      avgRimElevation: e,
      minBedElevation: e - 5.0,
      depth: 5.0,
      spillPoint: n > 0 ? polygon[0] : [0, 0],
    };
  }

  // 1. Sample perimeter elevations
  let minRim = Infinity;
  let maxRim = -Infinity;
  let sumRim = 0;
  let spillPt: [number, number] = polygon[0];

  for (let i = 0; i < n; i++) {
    const pt = polygon[i];
    const e = sampleElev(grid, cols, rows, mapW, mapH, pt[0], pt[1]);
    sumRim += e;
    if (e < minRim) {
      minRim = e;
      spillPt = pt;
    }
    if (e > maxRim) {
      maxRim = e;
    }
  }

  const avgRim = sumRim / n;

  // 2. Sample interior / bed elevation
  let minBed = minRim;

  // Sample centroid
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += polygon[i][0];
    cy += polygon[i][1];
  }
  cx /= n;
  cy /= n;
  const centerElev = sampleElev(grid, cols, rows, mapW, mapH, cx, cy);
  if (centerElev < minBed) {
    minBed = centerElev;
  }

  // Sample bounding box interior points
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = polygon[i][0];
    const y = polygon[i][1];
    if (x < bMinX) bMinX = x;
    if (x > bMaxX) bMaxX = x;
    if (y < bMinY) bMinY = y;
    if (y > bMaxY) bMaxY = y;
  }

  const sampleCols = 5;
  const sampleRows = 5;
  for (let r = 1; r < sampleRows; r++) {
    const sy = bMinY + (r / sampleRows) * (bMaxY - bMinY);
    for (let c = 1; c < sampleCols; c++) {
      const sx = bMinX + (c / sampleCols) * (bMaxX - bMinX);
      if (pointInLake(sx, sy, polygon)) {
        const bedE = sampleElev(grid, cols, rows, mapW, mapH, sx, sy);
        if (bedE < minBed) {
          minBed = bedE;
        }
      }
    }
  }

  // The lake surface elevation is defined by the rim spillway elevation
  const surfaceElevation = Math.max(seaLevel, Number(minRim.toFixed(2)));
  const depth = Math.max(1.0, Number((surfaceElevation - minBed).toFixed(2)));

  return {
    surfaceElevation,
    minRimElevation: Number(minRim.toFixed(2)),
    maxRimElevation: Number(maxRim.toFixed(2)),
    avgRimElevation: Number(avgRim.toFixed(2)),
    minBedElevation: Number(minBed.toFixed(2)),
    depth,
    spillPoint: spillPt,
  };
}

/**
 * Analyzes topological connections of a river to lakes, other rivers, or the sea,
 * ensuring elevation consistency across junctions.
 */
export function analyzeRiverConnections(
  points: [number, number][],
  allRivers: RiverData[],
  allLakes: LakeData[],
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  seaLevel: number = 35.0,
  snapDistance: number = 20.0
): RiverConnectionAnalysis {
  const n = points.length;
  if (n < 2) {
    return {
      sourceType: 'spring',
      terminatesAt: 'inland',
      elevationStart: 50,
      elevationEnd: 40,
    };
  }

  const pStart = points[0];
  const pEnd = points[n - 1];

  let startElev = sampleElev(grid, cols, rows, mapW, mapH, pStart[0], pStart[1]);
  let endElev = sampleElev(grid, cols, rows, mapW, mapH, pEnd[0], pEnd[1]);

  let sourceType: 'spring' | 'lake' = 'spring';
  let sourceLakeId: string | undefined;

  let terminatesAt: 'ocean' | 'lake' | 'river' | 'inland' = 'inland';
  let targetLakeId: string | undefined;
  let connectedRiverId: string | undefined;

  // 1. Check Source Lake Connection (Lake Outflow)
  for (const lake of allLakes) {
    if (pointInLake(pStart[0], pStart[1], lake.polygon)) {
      sourceType = 'lake';
      sourceLakeId = lake.id;
      if (lake.elevation !== undefined) {
        startElev = lake.elevation;
      }
      break;
    }
    // Perimeter check
    for (const lp of lake.polygon) {
      if (Math.hypot(pStart[0] - lp[0], pStart[1] - lp[1]) <= snapDistance) {
        sourceType = 'lake';
        sourceLakeId = lake.id;
        if (lake.elevation !== undefined) {
          startElev = lake.elevation;
        }
        break;
      }
    }
    if (sourceLakeId) break;
  }

  // 2. Check Mouth Ocean Connection
  if (endElev <= seaLevel + 0.8) {
    terminatesAt = 'ocean';
    endElev = seaLevel;
  }

  // 3. Check Mouth Lake Connection (Lake Inflow)
  if (terminatesAt !== 'ocean') {
    for (const lake of allLakes) {
      if (pointInLake(pEnd[0], pEnd[1], lake.polygon)) {
        terminatesAt = 'lake';
        targetLakeId = lake.id;
        if (lake.elevation !== undefined) {
          endElev = lake.elevation;
        }
        break;
      }
      for (const lp of lake.polygon) {
        if (Math.hypot(pEnd[0] - lp[0], pEnd[1] - lp[1]) <= snapDistance) {
          terminatesAt = 'lake';
          targetLakeId = lake.id;
          if (lake.elevation !== undefined) {
            endElev = lake.elevation;
          }
          break;
        }
      }
      if (targetLakeId) break;
    }
  }

  // 4. Check Mouth River Connection (Tributary Confluence)
  if (terminatesAt !== 'ocean' && terminatesAt !== 'lake') {
    for (const r of allRivers) {
      if (r.points.length < 2) continue;
      for (let s = 0; s < r.points.length - 1; s++) {
        const A = r.points[s];
        const B = r.points[s + 1];
        const ABx = B[0] - A[0];
        const ABy = B[1] - A[1];
        const len2 = ABx * ABx + ABy * ABy;
        if (len2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((pEnd[0] - A[0]) * ABx + (pEnd[1] - A[1]) * ABy) / len2));
        const projX = A[0] + t * ABx;
        const projY = A[1] + t * ABy;
        const d = Math.hypot(pEnd[0] - projX, pEnd[1] - projY);
        if (d <= snapDistance) {
          terminatesAt = 'river';
          connectedRiverId = r.id;
          endElev = sampleElev(grid, cols, rows, mapW, mapH, projX, projY);
          break;
        }
      }
      if (connectedRiverId) break;
    }
  }

  return {
    sourceType,
    sourceLakeId,
    terminatesAt,
    targetLakeId,
    connectedRiverId,
    elevationStart: Number(startElev.toFixed(2)),
    elevationEnd: Number(endElev.toFixed(2)),
  };
}
