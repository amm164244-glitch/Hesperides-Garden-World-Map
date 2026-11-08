/**
 * River Extraction and Topological Flow Tracing
 * Traces strictly downhill rivers from flow accumulation fields,
 * extends headwaters toward drainage divides, applies valley relaxation and constrained meandering,
 * aligns confluences and estuaries, and enforces elevation monotonicity.
 */

import { RiverData, LakeData } from '../types/water';
import { HydrologyResult } from './hydrology';
import { Noise2D } from './prng';
import { findNearestLakePerimeterPoint, clampRiverToLakePerimeter } from './lakeExtraction';
import { sampleElev } from './waterGenerator';

export const FANTASY_RIVER_NAMES = [
  '大河アンドゥイン',
  '銀流河',
  '白銀川',
  'アイゼン川',
  'エント川',
  'ミセルセイル川',
  'セルデュイン川',
  'ブランディワイン川',
  '霧降川',
  '翡翠川',
  '碧流河',
  '紅蓮川',
  '疾風川',
  '静水河',
  '深緑川',
  '蒼穹川',
  '清流シルヴァ',
  '月影河',
  '白樺川',
  '黄金河',
  '青龍川',
  '星雫川',
  '双子河',
  '黎明川',
];

export interface RiverExtractionParams {
  cols: number;
  rows: number;
  mapWidth: number;
  mapHeight: number;
  seaLevel: number;
  seed?: number;
  worldWidthKm?: number;
  riverDensity?: number; // 0 ~ 100, default 40
  meander?: number;      // 0 ~ 1.0 (or 0~100%), default 0.6
  headExtension?: number;// 0 ~ 1.0, default 0.8
  maxMainRivers?: number;// default 14
  minLengthCells?: number;// default 8
}

/**
 * Open polyline Chaikin smoothing with pinned endpoints.
 */
function chaikinOpen(points: [number, number][], iterations: number = 3): [number, number][] {
  if (points.length < 3) return points;

  let current = points;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [];
    next.push(current[0]);

    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];

      next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
      next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
    }

    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/**
 * Valley relaxation (Laplacian smoothing towards neighbor average, 3 iterations).
 * Pinned at endpoints, step clamped to 0.8 * cellSize, and elevation monotonicity enforced.
 */
function relaxRiverValley(
  points: [number, number][],
  filledGrid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  maxDist: number,
  iterations: number = 3
): [number, number][] {
  if (points.length < 3) return points;

  let current = points.map((p) => [p[0], p[1]] as [number, number]);

  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [current[0]];

    for (let i = 1; i < current.length - 1; i++) {
      const pPrev = current[i - 1];
      const pCurr = current[i];
      const pNext = current[i + 1];

      const avgX = 0.5 * (pPrev[0] + pNext[0]);
      const avgY = 0.5 * (pPrev[1] + pNext[1]);

      let dx = (avgX - pCurr[0]) * 0.35;
      let dy = (avgY - pCurr[1]) * 0.35;
      const dist = Math.hypot(dx, dy);

      if (dist > maxDist) {
        dx = (dx / dist) * maxDist;
        dy = (dy / dist) * maxDist;
      }

      const candX = pCurr[0] + dx;
      const candY = pCurr[1] + dy;

      const prevElev = sampleElev(filledGrid, cols, rows, mapW, mapH, next[i - 1][0], next[i - 1][1]);
      const candElev = sampleElev(filledGrid, cols, rows, mapW, mapH, candX, candY);

      if (candElev <= prevElev + 0.3) {
        next.push([candX, candY]);
      } else {
        next.push(pCurr);
      }
    }

    next.push(current[current.length - 1]);
    current = next;
  }

  return current;
}

/**
 * Ramer-Douglas-Peucker polyline simplification.
 */
function ramerDouglasPeucker(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;
  const pStart = points[0];
  const pEnd = points[end];
  const lineDx = pEnd[0] - pStart[0];
  const lineDy = pEnd[1] - pStart[1];
  const lineLen = Math.hypot(lineDx, lineDy);

  for (let i = 1; i < end; i++) {
    const pt = points[i];
    let d = 0;
    if (lineLen < 1e-6) {
      d = Math.hypot(pt[0] - pStart[0], pt[1] - pStart[1]);
    } else {
      d = Math.abs(lineDy * pt[0] - lineDx * pt[1] + pEnd[0] * pStart[1] - pEnd[1] * pStart[0]) / lineLen;
    }
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const rec1 = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const rec2 = ramerDouglasPeucker(points.slice(index), epsilon);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  } else {
    return [pStart, pEnd];
  }
}

/**
 * Iteratively removes middle points where the direction change angle exceeds maxAngleDeg (up to 20 passes).
 */
function cleanAcuteHooks(points: [number, number][], maxAngleDeg: number = 110): [number, number][] {
  if (points.length < 3) return points;
  const pts = points.map((p) => [p[0], p[1]] as [number, number]);
  const maxCos = Math.cos((maxAngleDeg * Math.PI) / 180);

  for (let iter = 0; iter < 20; iter++) {
    let removed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const v1x = pts[i][0] - pts[i - 1][0];
      const v1y = pts[i][1] - pts[i - 1][1];
      const v2x = pts[i + 1][0] - pts[i][0];
      const v2y = pts[i + 1][1] - pts[i][1];
      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      if (len1 < 1e-6 || len2 < 1e-6) continue;

      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
      if (dot < maxCos) {
        pts.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (!removed || pts.length < 3) break;
  }
  return pts;
}

/**
 * Checks if any segment pair within the first checkCount points has a direction change > maxAngleDeg.
 */
function hasHeadwaterHook(points: [number, number][], checkCount: number = 12, maxAngleDeg: number = 100): boolean {
  if (points.length < 3) return false;
  const maxCos = Math.cos((maxAngleDeg * Math.PI) / 180);
  const n = Math.min(points.length - 1, checkCount);

  for (let i = 1; i < n; i++) {
    const v1x = points[i][0] - points[i - 1][0];
    const v1y = points[i][1] - points[i - 1][1];
    const v2x = points[i + 1][0] - points[i][0];
    const v2y = points[i + 1][1] - points[i][1];
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-6 || len2 < 1e-6) continue;

    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    if (dot < maxCos) {
      return true;
    }
  }
  return false;
}

/**
 * Resamples polyline at approximately targetSpacing while keeping endpoints fixed.
 */
function resamplePolyline(points: [number, number][], targetSpacing: number): [number, number][] {
  if (points.length < 2) return points;

  const cumDists: number[] = [0];
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    cumDists.push(cumDists[i] + d);
  }

  const totalLength = cumDists[cumDists.length - 1];
  if (totalLength < 1e-4) return points;

  const numSegments = Math.max(points.length - 1, Math.round(totalLength / targetSpacing));
  const step = totalLength / numSegments;

  const result: [number, number][] = [points[0]];
  let segIdx = 0;

  for (let s = 1; s < numSegments; s++) {
    const targetD = s * step;
    while (segIdx < cumDists.length - 2 && cumDists[segIdx + 1] < targetD) {
      segIdx++;
    }
    const d0 = cumDists[segIdx];
    const d1 = cumDists[segIdx + 1];
    const segLen = d1 - d0;
    const t = segLen > 1e-6 ? (targetD - d0) / segLen : 0;
    const p0 = points[segIdx];
    const p1 = points[segIdx + 1];
    result.push([
      p0[0] + t * (p1[0] - p0[0]),
      p0[1] + t * (p1[1] - p0[1]),
    ]);
  }

  result.push(points[points.length - 1]);
  return result;
}

/**
 * Breaks straight runs of >= 12 consecutive points with < 3 deg direction change
 * using sinusoidal displacement (amplitude 0.5 * cellSize, wavelength 12 * cellSize).
 */
function breakStraightRuns(
  points: [number, number][],
  filledGrid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  cellSize: number,
  seed: number
): [number, number][] {
  const n = points.length;
  if (n < 12) return points;

  const pts = points.map((p) => [p[0], p[1]] as [number, number]);
  const threeDegRad = (3 * Math.PI) / 180;

  const cumDists: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    cumDists.push(cumDists[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
  }

  let i = 0;
  while (i < n - 7) {
    let runEnd = i + 1;
    const vBaseX = pts[i + 1][0] - pts[i][0];
    const vBaseY = pts[i + 1][1] - pts[i][1];
    const lenBase = Math.hypot(vBaseX, vBaseY);
    if (lenBase < 1e-6) {
      i++;
      continue;
    }

    while (runEnd < n - 1) {
      const vCurrX = pts[runEnd + 1][0] - pts[runEnd][0];
      const vCurrY = pts[runEnd + 1][1] - pts[runEnd][1];
      const lenCurr = Math.hypot(vCurrX, vCurrY);
      if (lenCurr < 1e-6) {
        runEnd++;
        continue;
      }

      const dot = (vBaseX * vCurrX + vBaseY * vCurrY) / (lenBase * lenCurr);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle < threeDegRad) {
        runEnd++;
      } else {
        break;
      }
    }

    const runPtCount = runEnd + 1 - i;
    if (runPtCount >= 8) {
      const runStart = i;
      const runEndIdx = runEnd;
      const sStart = cumDists[runStart];
      const lambdaRun = Math.max(8 * cellSize, (cumDists[runEndIdx] - sStart));
      const amp = 0.5 * cellSize;

      const savedRun: [number, number][] = [];
      for (let k = runStart; k <= runEndIdx; k++) {
        savedRun.push([pts[k][0], pts[k][1]]);
      }

      for (let k = runStart + 1; k < runEndIdx; k++) {
        const pPrev = pts[k - 1];
        const pCurr = pts[k];
        const pNext = pts[k + 1];

        const tx = pNext[0] - pPrev[0];
        const ty = pNext[1] - pPrev[1];
        const tLen = Math.hypot(tx, ty) || 1;
        const nx = -ty / tLen;
        const ny = tx / tLen;

        const sK = cumDists[k];
        const windowFactor = Math.sin(((k - runStart) / (runEndIdx - runStart)) * Math.PI);
        let disp = amp * Math.sin(((sK - sStart) / lambdaRun) * 2 * Math.PI) * windowFactor;

        let candX = pCurr[0] + nx * disp;
        let candY = pCurr[1] + ny * disp;

        const prevElev = sampleElev(filledGrid, cols, rows, mapW, mapH, pts[k - 1][0], pts[k - 1][1]);
        let candElev = sampleElev(filledGrid, cols, rows, mapW, mapH, candX, candY);

        let accepted = candElev <= prevElev + 0.3;
        if (!accepted) {
          for (let h = 1; h <= 5; h++) {
            disp *= 0.5;
            candX = pCurr[0] + nx * disp;
            candY = pCurr[1] + ny * disp;
            candElev = sampleElev(filledGrid, cols, rows, mapW, mapH, candX, candY);
            if (candElev <= prevElev + 0.3) {
              accepted = true;
              break;
            }
          }
        }

        if (accepted) {
          pts[k] = [candX, candY];
        }
      }

      if (hasSelfIntersection(pts)) {
        for (let k = runStart; k <= runEndIdx; k++) {
          pts[k] = savedRun[k - runStart];
        }
      }

      i = runEndIdx;
    } else {
      i++;
    }
  }

  return pts;
}

/**
 * Eliminates accidental corners with direction change > 90 degrees by relaxing corner points.
 */
export function clampSharpCorners(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;
  const pts = points.map((p) => [p[0], p[1]] as [number, number]);

  for (let it = 0; it < 3; it++) {
    let hadSharp = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const v1x = pts[i][0] - pts[i - 1][0];
      const v1y = pts[i][1] - pts[i - 1][1];
      const v2x = pts[i + 1][0] - pts[i][0];
      const v2y = pts[i + 1][1] - pts[i][1];

      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      if (len1 < 1e-6 || len2 < 1e-6) continue;

      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
      if (dot < 0) {
        pts[i] = [0.5 * (pts[i - 1][0] + pts[i + 1][0]), 0.5 * (pts[i - 1][1] + pts[i + 1][1])];
        hadSharp = true;
      }
    }
    if (!hadSharp) break;
  }

  return pts;
}

/**
 * Intersects river mouth endpoint with the coastline (seaLevel contour).
 */
function adjustRiverMouthToCoastline(
  pts: [number, number][],
  filledGrid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  seaLevel: number
): [number, number][] {
  if (pts.length < 2) return pts;

  const n = pts.length;
  const pPrev = pts[n - 2];
  const pLast = pts[n - 1];

  const ePrev = sampleElev(filledGrid, cols, rows, mapW, mapH, pPrev[0], pPrev[1]);
  const eLast = sampleElev(filledGrid, cols, rows, mapW, mapH, pLast[0], pLast[1]);

  if ((ePrev >= seaLevel && eLast < seaLevel) || (ePrev > seaLevel && eLast <= seaLevel)) {
    const t = (seaLevel - ePrev) / (eLast - ePrev);
    const clampT = Math.max(0, Math.min(1, t));
    pts[n - 1] = [
      pPrev[0] + clampT * (pLast[0] - pPrev[0]),
      pPrev[1] + clampT * (pLast[1] - pPrev[1]),
    ];
    return pts;
  }

  // Scan backwards from mouth to find where it crossed seaLevel
  for (let k = n - 2; k >= 0; k--) {
    const eK = sampleElev(filledGrid, cols, rows, mapW, mapH, pts[k][0], pts[k][1]);
    const eK1 = sampleElev(filledGrid, cols, rows, mapW, mapH, pts[k + 1][0], pts[k + 1][1]);
    if (eK >= seaLevel && eK1 < seaLevel) {
      const t = Math.max(0, Math.min(1, (seaLevel - eK) / (eK1 - eK)));
      pts[k + 1] = [
        pts[k][0] + t * (pts[k + 1][0] - pts[k][0]),
        pts[k][1] + t * (pts[k + 1][1] - pts[k][1]),
      ];
      return pts.slice(0, k + 2);
    }
  }

  return pts;
}

/**
 * Checks if 2D polyline self-intersects using bounding boxes and spatial hashing.
 */
export function hasSelfIntersection(points: [number, number][]): boolean {
  const n = points.length;
  if (n < 4) return false;

  const ccw = (p1: [number, number], p2: [number, number], p3: [number, number]) =>
    (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);

  const segsIntersect = (
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    p4: [number, number]
  ): boolean => {
    if (
      Math.max(p1[0], p2[0]) < Math.min(p3[0], p4[0]) ||
      Math.min(p1[0], p2[0]) > Math.max(p3[0], p4[0]) ||
      Math.max(p1[1], p2[1]) < Math.min(p3[1], p4[1]) ||
      Math.min(p1[1], p2[1]) > Math.max(p3[1], p4[1])
    ) {
      return false;
    }
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  };

  if (n < 60) {
    for (let i = 0; i < n - 3; i++) {
      for (let j = i + 2; j < n - 1; j++) {
        if (segsIntersect(points[i], points[i + 1], points[j], points[j + 1])) {
          return true;
        }
      }
    }
    return false;
  }

  let totalLen = 0;
  for (let i = 0; i < n - 1; i++) {
    totalLen += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  const avgLen = totalLen / (n - 1) || 10;
  const hashCellSize = Math.max(avgLen * 2.5, 10);
  const grid = new Map<string, number[]>();

  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const minX = Math.floor(Math.min(p1[0], p2[0]) / hashCellSize);
    const maxX = Math.floor(Math.max(p1[0], p2[0]) / hashCellSize);
    const minY = Math.floor(Math.min(p1[1], p2[1]) / hashCellSize);
    const maxY = Math.floor(Math.max(p1[1], p2[1]) / hashCellSize);

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        const key = `${gx},${gy}`;
        let list = grid.get(key);
        if (!list) {
          list = [];
          grid.set(key, list);
        }
        list.push(i);
      }
    }
  }

  const checkedPairs = new Set<number>();
  for (const list of grid.values()) {
    if (list.length <= 1) continue;
    for (let a = 0; a < list.length; a++) {
      const i = list[a];
      for (let b = a + 1; b < list.length; b++) {
        const j = list[b];
        if (Math.abs(i - j) <= 1) continue;
        const u = Math.min(i, j);
        const v = Math.max(i, j);
        const pairKey = u * n + v;
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);

        if (segsIntersect(points[u], points[u + 1], points[v], points[v + 1])) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Aligns tributary confluences cleanly onto their main river stems:
 * Snaps final point directly onto closest main river segment and bends incoming tangent by 60%.
 */
function alignTributaryConfluences(
  rivers: RiverData[],
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number
): void {
  const riverMap = new Map<string, RiverData>();
  for (const r of rivers) {
    riverMap.set(r.id, r);
  }

  for (const trib of rivers) {
    if (trib.terminatesAt !== 'river' || !trib.connectedRiverId) continue;
    const mainRiver = riverMap.get(trib.connectedRiverId);
    if (!mainRiver || mainRiver.points.length < 2 || trib.points.length < 3) continue;

    const n = trib.points.length;
    const pEnd = trib.points[n - 1];

    let bestDist = Infinity;
    let bestProj: [number, number] = pEnd;
    let bestTangent: [number, number] = [1, 0];

    for (let s = 0; s < mainRiver.points.length - 1; s++) {
      const A = mainRiver.points[s];
      const B = mainRiver.points[s + 1];
      const ABx = B[0] - A[0];
      const ABy = B[1] - A[1];
      const len2 = ABx * ABx + ABy * ABy;
      if (len2 < 1e-8) continue;

      const t = Math.max(0, Math.min(1, ((pEnd[0] - A[0]) * ABx + (pEnd[1] - A[1]) * ABy) / len2));
      const proj: [number, number] = [A[0] + t * ABx, A[1] + t * ABy];
      const d = Math.hypot(pEnd[0] - proj[0], pEnd[1] - proj[1]);

      if (d < bestDist) {
        bestDist = d;
        bestProj = proj;
        const segLen = Math.hypot(ABx, ABy) || 1;
        bestTangent = [ABx / segLen, ABy / segLen];
      }
    }

    // Clamp tributary mouth width so it does not exceed the main river's width
    trib.widthEnd = Math.min(trib.widthEnd, mainRiver.widthEnd);

    // Save backup in case alignment induces an invalid self-intersection
    const originalPoints = trib.points.map((p) => [p[0], p[1]] as [number, number]);

    // 1. Place final point precisely onto main river's segment
    trib.points[n - 1] = bestProj;

    // 2. Blend incoming tangent towards main river tangent by 60%
    const pPrevOrig = trib.points[n - 2];
    const inDx = bestProj[0] - pPrevOrig[0];
    const inDy = bestProj[1] - pPrevOrig[1];
    const inLen = Math.hypot(inDx, inDy) || 1;
    const inNormX = inDx / inLen;
    const inNormY = inDy / inLen;

    let blendX = inNormX * 0.4 + bestTangent[0] * 0.6;
    let blendY = inNormY * 0.4 + bestTangent[1] * 0.6;
    const bLen = Math.hypot(blendX, blendY) || 1;
    blendX /= bLen;
    blendY /= bLen;

    const candPrev: [number, number] = [
      bestProj[0] - blendX * inLen,
      bestProj[1] - blendY * inLen,
    ];

    const pPrev2 = trib.points[n - 3];
    const eBefore = sampleElev(elevationGrid, cols, rows, mapW, mapH, pPrev2[0], pPrev2[1]);
    const eProj = sampleElev(elevationGrid, cols, rows, mapW, mapH, bestProj[0], bestProj[1]);

    let acceptedPrev = pPrevOrig;
    for (const alpha of [1.0, 0.75, 0.5, 0.25, 0.0]) {
      const testX = pPrevOrig[0] * (1 - alpha) + candPrev[0] * alpha;
      const testY = pPrevOrig[1] * (1 - alpha) + candPrev[1] * alpha;

      // Check elevation monotonicity
      const eTest = sampleElev(elevationGrid, cols, rows, mapW, mapH, testX, testY);
      if (eTest > eBefore + 0.3 || eProj > eTest + 0.3) continue;

      // Check for sharp angle between (pPrev2 -> test) and (test -> bestProj)
      const v1x = testX - pPrev2[0];
      const v1y = testY - pPrev2[1];
      const v2x = bestProj[0] - testX;
      const v2y = bestProj[1] - testY;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 > 1e-4 && l2 > 1e-4) {
        const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
        if (dot < 0) continue; // Acute angle (< 90 deg turn), reject
      }

      acceptedPrev = [testX, testY];
      break;
    }
    trib.points[n - 2] = acceptedPrev;

    // Ensure no accidental acute angles near confluence
    trib.points = clampSharpCorners(trib.points);

    // If confluence adjustment caused self-intersection, restore original points (keeping snapped endpoint if safe)
    if (hasSelfIntersection(trib.points)) {
      trib.points = originalPoints;
      trib.points[n - 1] = bestProj;
      if (hasSelfIntersection(trib.points)) {
        trib.points = originalPoints;
      }
    }
  }
}

/**
 * Standard cubic smoothstep between a and b.
 */
function smoothstep(a: number, b: number, x: number): number {
  if (x <= a) return 0;
  if (x >= b) return 1;
  const t = (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/**
 * Applies natural, continuous meandering:
 * - Distance-based taper (6 cells from source, 4 cells from ocean mouth or 6 from lake/confluence)
 * - Plain factor based on terrain slope (slope < 0.25 -> 1.5, steep -> 0.4)
 * - Dynamic wavelength lambda = max(16 * w, 24 * cellSize)
 * - Curvature limit |off| <= 0.4 / kappa
 * - Rate-of-change limit |doff/ds| <= 0.5
 * - Elevation monotonicity preservation
 * - Spatial hash self-intersection check with retry fallbacks (K = 1.2 -> 0.6 -> 0.3 -> 0)
 */
function applyNaturalMeander(
  points: [number, number][],
  filledGrid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  cellSize: number,
  meanderFactor: number,
  widthStart: number,
  widthEnd: number,
  terminatesAt: 'ocean' | 'lake' | 'river',
  seed: number,
  rIdx: number
): [number, number][] {
  const n = points.length;
  if (n < 4 || meanderFactor <= 0) return points;

  // Cumulative distance along points
  const cumDists: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    cumDists.push(cumDists[i] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]));
  }
  const L = cumDists[cumDists.length - 1];
  if (L < 1e-4) return points;

  const T0 = 6 * cellSize;
  const T1 = terminatesAt === 'ocean' ? 4 * cellSize : 6 * cellSize;

  // Width w(s), slope, plain factor, tangents, and normals
  const widths: number[] = new Array(n);
  const plains: number[] = new Array(n);
  const tangents: [number, number][] = new Array(n);
  const normals: [number, number][] = new Array(n);
  const curvatures: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const s = cumDists[i];
    const rawW = widthStart + (widthEnd - widthStart) * (s / L);
    widths[i] = Math.max(rawW, rawW * cellSize);

    // Tangents and normals
    const pPrev = points[Math.max(0, i - 1)];
    const pNext = points[Math.min(n - 1, i + 1)];
    const tx = pNext[0] - pPrev[0];
    const ty = pNext[1] - pPrev[1];
    const tLen = Math.hypot(tx, ty) || 1;
    tangents[i] = [tx / tLen, ty / tLen];
    normals[i] = [-ty / tLen, tx / tLen];

    // Plain factor: slope over 3 points back and 3 points forward
    const i1 = Math.max(0, i - 3);
    const i2 = Math.min(n - 1, i + 3);
    const distSpan = cumDists[i2] - cumDists[i1];
    const distInCells = Math.max(0.5, distSpan / cellSize);
    const e1 = sampleElev(filledGrid, cols, rows, mapW, mapH, points[i1][0], points[i1][1]);
    const e2 = sampleElev(filledGrid, cols, rows, mapW, mapH, points[i2][0], points[i2][1]);
    const slope = Math.abs(e1 - e2) / distInCells;
    plains[i] = Math.max(0.4, Math.min(1.5, 1.5 - slope / 1.2));
  }

  // Local curvature kappa
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) {
      curvatures[i] = 0;
    } else {
      const dtX = tangents[i + 1][0] - tangents[i - 1][0];
      const dtY = tangents[i + 1][1] - tangents[i - 1][1];
      const ds = Math.max(1e-4, 0.5 * (cumDists[i + 1] - cumDists[i - 1]));
      curvatures[i] = Math.hypot(dtX, dtY) / ds;
    }
  }

  // Phase accumulation
  const phases: number[] = new Array(n);
  const seedRnd = Math.abs(Math.sin(seed * 71.3 + rIdx * 137.9) * 10000);
  phases[0] = (seedRnd % 1) * (2 * Math.PI);

  for (let i = 1; i < n; i++) {
    const ds = cumDists[i] - cumDists[i - 1];
    const w = widths[i];
    const lambda = Math.max(16 * w, 24 * cellSize);
    phases[i] = phases[i - 1] + (ds / lambda) * (2 * Math.PI);
  }

  // Try K values: 1.2, 0.6, 0.3, 0 (fallback to relaxed)
  const kValues = [1.2, 0.6, 0.3, 0];

  for (const K of kValues) {
    if (K === 0) {
      return points;
    }

    const offsets: number[] = new Array(n);

    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) {
        offsets[i] = 0;
        continue;
      }

      const s = cumDists[i];
      const taper = smoothstep(0, T0, s) * smoothstep(0, T1, L - s);
      const wob = 1 + 0.3 * Math.sin(phases[i] * 0.41 + 1.3);

      let off = meanderFactor * K * widths[i] * plains[i] * taper * wob * Math.sin(phases[i]);

      // Curvature limit: |off| <= 0.4 / kappa
      const kappa = curvatures[i];
      if (kappa > 1e-4) {
        const maxOff = 0.4 / kappa;
        off = Math.max(-maxOff, Math.min(maxOff, off));
      }

      offsets[i] = off;
    }

    // Rate-of-change Limit: |doff/ds| <= 0.5 (forward and backward passes)
    for (let i = 1; i < n; i++) {
      const ds = cumDists[i] - cumDists[i - 1];
      const maxDelta = 0.5 * ds;
      offsets[i] = Math.max(offsets[i - 1] - maxDelta, Math.min(offsets[i - 1] + maxDelta, offsets[i]));
    }
    for (let i = n - 2; i >= 0; i--) {
      const ds = cumDists[i + 1] - cumDists[i];
      const maxDelta = 0.5 * ds;
      offsets[i] = Math.max(offsets[i + 1] - maxDelta, Math.min(offsets[i + 1] + maxDelta, offsets[i]));
    }

    // Compute candidate points with monotonicity check
    const candPts: [number, number][] = [[points[0][0], points[0][1]]];

    for (let i = 1; i < n; i++) {
      if (i === n - 1) {
        candPts.push([points[n - 1][0], points[n - 1][1]]);
        continue;
      }

      const norm = normals[i];
      let curOff = offsets[i];
      const prevElev = sampleElev(filledGrid, cols, rows, mapW, mapH, candPts[i - 1][0], candPts[i - 1][1]);

      let candX = points[i][0] + norm[0] * curOff;
      let candY = points[i][1] + norm[1] * curOff;
      let candElev = sampleElev(filledGrid, cols, rows, mapW, mapH, candX, candY);

      let accepted = candElev <= prevElev + 0.3;
      if (!accepted) {
        for (let h = 1; h <= 5; h++) {
          curOff *= 0.5;
          candX = points[i][0] + norm[0] * curOff;
          candY = points[i][1] + norm[1] * curOff;
          candElev = sampleElev(filledGrid, cols, rows, mapW, mapH, candX, candY);
          if (candElev <= prevElev + 0.3) {
            accepted = true;
            break;
          }
        }
      }

      if (!accepted) {
        candX = points[i][0];
        candY = points[i][1];
      }

      candPts.push([candX, candY]);
    }

    if (!hasSelfIntersection(candPts)) {
      return candPts;
    }
  }

  return points;
}

/**
 * Extracts topologically sound rivers from hydrology accumulation and flow receivers.
 */
export function extractRivers(
  hydro: HydrologyResult,
  elevationGrid: Float32Array,
  lakes: LakeData[],
  params: RiverExtractionParams
): RiverData[] {
  const {
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    seed = 42,
    worldWidthKm = 40000,
    riverDensity = 40,
    meander = 0.6,
    headExtension = 0.8,
    maxMainRivers = 14,
    minLengthCells = 8,
  } = params;

  const totalCells = cols * rows;
  const { receiver, filled, accumulation } = hydro;

  const cellDx = mapWidth / (cols - 1);
  const cellDy = mapHeight / (rows - 1);
  const cellSize = (cellDx + cellDy) * 0.5;

  // 1. Calculate river threshold T based on land cell count & riverDensity
  let landCellCount = 0;
  for (let i = 0; i < totalCells; i++) {
    if (elevationGrid[i] >= seaLevel) {
      landCellCount++;
    }
  }

  const dRatio = Math.max(0, Math.min(100, riverDensity)) / 100;
  const densityCoeff = 0.012 + (0.0006 - 0.012) * dRatio;
  const T = Math.max(6, Math.floor(landCellCount * densityCoeff));

  // Minimum accumulation for headwater extension: minHeadAcc = lerp(T, 2, headExtension)
  const headExtClamped = Math.max(0, Math.min(1, headExtension > 1 ? headExtension / 100 : headExtension));
  const minHeadAcc = Math.max(2, Math.round(T + (2 - T) * headExtClamped));

  // Find max accumulation on land for width scaling
  let maxA = T;
  for (let i = 0; i < totalCells; i++) {
    if (elevationGrid[i] >= seaLevel && accumulation[i] > maxA) {
      maxA = accumulation[i];
    }
  }
  if (maxA <= T) maxA = T + 1;

  // 2. Identify lake cells and lake spillway outflow starts
  const cellToLakeId = new Map<number, string>();
  const lakeSpillCells = new Map<number, string>();

  for (const lake of lakes) {
    const dep = hydro.depressions.find((d) => d.spillElevation === lake.elevation);
    if (dep) {
      for (const c of dep.cells) {
        cellToLakeId.set(c, lake.id);
      }
      lakeSpillCells.set(dep.spillCell, lake.id);
    }
  }

  // 3. Mark river cells: land cell, accumulation >= T, and NOT inside any lake
  const isRiverCell = new Uint8Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    if (elevationGrid[i] >= seaLevel && !cellToLakeId.has(i) && accumulation[i] >= T) {
      isRiverCell[i] = 1;
    }
  }

  // Include immediate receiver of lake spillways so lake outflows begin cleanly
  for (const [spillIdx] of lakeSpillCells.entries()) {
    const spillRec = receiver[spillIdx];
    if (spillRec >= 0 && elevationGrid[spillRec] >= seaLevel && !cellToLakeId.has(spillRec)) {
      isRiverCell[spillRec] = 1;
    }
  }

  // 4. Build upstream river graph
  const upstreamRiverNeighbors: number[][] = Array.from({ length: totalCells }, () => []);
  for (let i = 0; i < totalCells; i++) {
    if (isRiverCell[i] === 1) {
      const rec = receiver[i];
      if (rec >= 0 && isRiverCell[rec] === 1) {
        upstreamRiverNeighbors[rec].push(i);
      }
    }
  }

  for (let i = 0; i < totalCells; i++) {
    if (upstreamRiverNeighbors[i].length > 1) {
      upstreamRiverNeighbors[i].sort((a, b) => accumulation[b] - accumulation[a]);
    }
  }

  // 5. Find River Mouths and trace raw branches
  interface RawRiverSegment {
    id: string;
    mouthCell: number;
    sourceCell: number;
    cells: number[]; // From source to mouth
    terminatesAt: 'ocean' | 'lake' | 'river';
    targetLakeId?: string;
    sourceType: 'spring' | 'lake';
    sourceLakeId?: string;
    connectedRiverId?: string;
    mouthAcc: number;
    sourceAcc: number;
  }

  const rawRivers: RawRiverSegment[] = [];
  let riverSeq = 1;

  for (let i = 0; i < totalCells; i++) {
    if (isRiverCell[i] === 1) {
      const rec = receiver[i];
      const isOcean = rec < 0 || elevationGrid[rec] < seaLevel;
      const isBorder =
        rec >= 0 &&
        (rec % cols === 0 ||
          rec % cols === cols - 1 ||
          Math.floor(rec / cols) === 0 ||
          Math.floor(rec / cols) === rows - 1);
      const lakeId = rec >= 0 ? cellToLakeId.get(rec) : undefined;

      if (isOcean || isBorder || lakeId) {
        traceBranches(i, isOcean || isBorder ? 'ocean' : 'lake', lakeId);
      }
    }
  }

  function traceBranches(
    mouthIdx: number,
    terminatesAt: 'ocean' | 'lake' | 'river',
    targetLakeId?: string,
    connectedRiverId?: string
  ): void {
    const cells: number[] = [mouthIdx];
    let curr = mouthIdx;

    while (upstreamRiverNeighbors[curr].length > 0) {
      const bestUpstream = upstreamRiverNeighbors[curr][0];
      cells.push(bestUpstream);
      curr = bestUpstream;
    }

    const sourceCell = curr;
    cells.reverse();

    let sourceType: 'spring' | 'lake' = 'spring';
    let sourceLakeId: string | undefined = undefined;

    for (const [spillIdx, lId] of lakeSpillCells.entries()) {
      if (receiver[spillIdx] === sourceCell || spillIdx === sourceCell) {
        sourceType = 'lake';
        sourceLakeId = lId;
        break;
      }
    }

    const rId = `river_${seed}_${riverSeq++}`;
    rawRivers.push({
      id: rId,
      mouthCell: mouthIdx,
      sourceCell,
      cells,
      terminatesAt,
      targetLakeId,
      sourceType,
      sourceLakeId,
      connectedRiverId,
      mouthAcc: accumulation[mouthIdx],
      sourceAcc: accumulation[sourceCell],
    });

    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
      const cell = cells[cIdx];
      const neighbors = upstreamRiverNeighbors[cell];
      for (let k = 1; k < neighbors.length; k++) {
        traceBranches(neighbors[k], 'river', undefined, rId);
      }
    }
  }

  // 5.5. Headwaters Extension toward drainage divide
  const visitedInAnyRiver = new Set<number>();
  for (const raw of rawRivers) {
    for (const c of raw.cells) {
      visitedInAnyRiver.add(c);
    }
  }

  if (headExtClamped > 0 && minHeadAcc < T) {
    const maxExtendCells = Math.floor(cols * 0.35);

    // Extend main rivers first, then tributaries
    const sortedRaw = [...rawRivers].sort((a, b) => {
      const aIsMain = a.terminatesAt !== 'river' ? 1 : 0;
      const bIsMain = b.terminatesAt !== 'river' ? 1 : 0;
      if (aIsMain !== bIsMain) return bIsMain - aIsMain;
      return b.mouthAcc - a.mouthAcc;
    });

    for (const raw of sortedRaw) {
      if (raw.sourceType === 'lake') continue;

      const extension: number[] = [];
      let extCurr = raw.sourceCell;

      for (let step = 0; step < maxExtendCells; step++) {
        const c = extCurr % cols;
        const r = Math.floor(extCurr / cols);

        let bestDonor = -1;
        let bestAcc = -1;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = r + dy;
          if (ny < 0 || ny >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = c + dx;
            if (nx < 0 || nx >= cols) continue;

            const neighbor = ny * cols + nx;
            // Donor definition: flows into extCurr
            if (receiver[neighbor] === extCurr) {
              if (
                elevationGrid[neighbor] >= seaLevel &&
                !cellToLakeId.has(neighbor) &&
                !visitedInAnyRiver.has(neighbor) &&
                accumulation[neighbor] >= minHeadAcc
              ) {
                if (accumulation[neighbor] > bestAcc) {
                  bestAcc = accumulation[neighbor];
                  bestDonor = neighbor;
                }
              }
            }
          }
        }

        if (bestDonor < 0) {
          break;
        }

        extension.push(bestDonor);
        visitedInAnyRiver.add(bestDonor);
        extCurr = bestDonor;
      }

      if (extension.length > 0) {
        extension.reverse();
        raw.cells = [...extension, ...raw.cells];
        raw.sourceCell = raw.cells[0];
        raw.sourceAcc = accumulation[raw.sourceCell];
      }
    }
  }

  // 6. Filter by minLengthCells (based on extended length) and maxMainRivers
  const mainRivers = rawRivers.filter((r) => r.terminatesAt !== 'river');
  mainRivers.sort((a, b) => b.mouthAcc - a.mouthAcc);

  const keptMainRivers = mainRivers.slice(0, maxMainRivers);
  const keptIds = new Set<string>(keptMainRivers.map((r) => r.id));

  let addedAny = true;
  while (addedAny) {
    addedAny = false;
    for (const r of rawRivers) {
      if (!keptIds.has(r.id) && r.connectedRiverId && keptIds.has(r.connectedRiverId)) {
        if (r.cells.length >= minLengthCells) {
          keptIds.add(r.id);
          addedAny = true;
        }
      }
    }
  }

  const filteredRawRivers = rawRivers.filter((r) => keptIds.has(r.id));

  // Determine river hierarchy order (main stem = 3, tributary = 2, sub-tributary = 1)
  const riverOrderMap = new Map<string, number>();
  for (const r of filteredRawRivers) {
    if (r.terminatesAt !== 'river') {
      riverOrderMap.set(r.id, 3);
    }
  }

  let orderIter = 0;
  while (riverOrderMap.size < filteredRawRivers.length && orderIter < 10) {
    orderIter++;
    for (const r of filteredRawRivers) {
      if (!riverOrderMap.has(r.id) && r.connectedRiverId) {
        const parentOrder = riverOrderMap.get(r.connectedRiverId);
        if (parentOrder !== undefined) {
          riverOrderMap.set(r.id, Math.max(1, parentOrder - 1));
        }
      }
    }
  }
  for (const r of filteredRawRivers) {
    if (!riverOrderMap.has(r.id)) riverOrderMap.set(r.id, 1);
  }

  // 7. Vectorize, smooth with Chaikin, apply relaxation, meander, straight-run break, and check monotonicity
  const meanderNoiseLow = new Noise2D(seed + 7721);
  const meanderNoiseHigh = new Noise2D(seed + 9832);
  const meanderFactor = typeof meander === 'number' ? Math.max(0, Math.min(1, meander > 1 ? meander / 100 : meander)) : 0.6;
  const kmPerUnit = Math.max(0.001, worldWidthKm / mapWidth);
  const wMin = kmPerUnit >= 3.0 ? 0.75 : 1.2;
  const wMax = kmPerUnit >= 3.0 ? 4.5 : 6.5;

  const filledF32 = new Float32Array(filled.length);
  for (let i = 0; i < filled.length; i++) filledF32[i] = filled[i];

  const resultRivers: RiverData[] = [];
  let mainNameIndex = 0;

  for (let rIdx = 0; rIdx < filteredRawRivers.length; rIdx++) {
    const raw = filteredRawRivers[rIdx];

    const pts: [number, number][] = raw.cells.map((cell) => {
      const c = cell % cols;
      const r = Math.floor(cell / cols);
      return [
        (c / (cols - 1)) * mapWidth,
        (r / (rows - 1)) * mapHeight,
      ];
    });

    if (pts.length < 2) continue;

    // Headwaters Hook Cleanup: RDP simplification + remove angles > 110 deg
    const headCount = Math.min(20, pts.length);
    const headPts = pts.slice(0, headCount);
    const simplifiedHead = ramerDouglasPeucker(headPts, 0.5 * cellSize);
    const cleanHead = cleanAcuteHooks(simplifiedHead, 110);
    const riverPts: [number, number][] = [...cleanHead, ...pts.slice(headCount)];

    // 1. Chaikin smoothing (3 iterations unless points would exceed 4000)
    const iters = (8 * riverPts.length - 7 > 4000) ? 2 : 3;
    const smoothed = chaikinOpen(riverPts, iters);

    // 2. Valley relaxation (Laplacian smoothing, 3 iterations, displacement <= 0.8 * cellSize)
    const relaxed = relaxRiverValley(
      smoothed,
      filledF32,
      cols,
      rows,
      mapWidth,
      mapHeight,
      cellSize * 0.8,
      3
    );

    // 3. Resample at ~0.5 * cellSize spacing
    const resampled = resamplePolyline(relaxed, 0.5 * cellSize);

    // 4. Calculate river widths (tapering down to 0.5 * wMin at extended headwaters, 1.25 * widthEnd at estuary)
    let widthStart: number;
    if (raw.sourceAcc < T) {
      const tRatio = Math.max(0, Math.min(1, (raw.sourceAcc - 2) / Math.max(1, T - 2)));
      widthStart = Number((0.5 * wMin + 0.5 * wMin * tRatio).toFixed(2));
    } else {
      const sourceAccRatio = Math.max(0, Math.min(1, Math.log(Math.max(1, raw.sourceAcc / T)) / Math.log(Math.max(1.1, maxA / T))));
      widthStart = Number((wMin + (wMax - wMin) * Math.pow(sourceAccRatio, 0.7)).toFixed(2));
    }
    widthStart = Math.max(0.5 * wMin, widthStart);

    const mouthAccRatio = Math.max(0, Math.min(1, Math.log(Math.max(1, raw.mouthAcc / T)) / Math.log(Math.max(1.1, maxA / T))));
    let widthEnd = Number(Math.max(widthStart, wMin + (wMax - wMin) * Math.pow(mouthAccRatio, 0.7)).toFixed(2));

    if (raw.terminatesAt === 'ocean') {
      widthEnd = Number((widthEnd * 1.25).toFixed(2));
    }

    // 5. Natural Meandering
    const meandered = applyNaturalMeander(
      resampled,
      filledF32,
      cols,
      rows,
      mapWidth,
      mapHeight,
      cellSize,
      meanderFactor,
      widthStart,
      widthEnd,
      raw.terminatesAt,
      seed,
      rIdx
    );

    // 6. Break straight runs
    const straightBroken = breakStraightRuns(
      meandered,
      filledF32,
      cols,
      rows,
      mapWidth,
      mapHeight,
      cellSize,
      seed + rIdx * 19
    );

    // 7. Headwaters Hook check: if any angle in first 12 points has direction change > 100 deg, revert headwater
    let processedPoints = straightBroken;
    if (hasHeadwaterHook(processedPoints, 12, 100) && cleanHead.length >= 2) {
      const pLast = cleanHead[cleanHead.length - 1];
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 1; i < processedPoints.length; i++) {
        const d = Math.hypot(processedPoints[i][0] - pLast[0], processedPoints[i][1] - pLast[1]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      processedPoints = [...cleanHead, ...processedPoints.slice(bestIdx + 1)];
      processedPoints = clampSharpCorners(processedPoints);
    }

    // 8. Ensure corners are smooth
    processedPoints = clampSharpCorners(processedPoints);

    // 9. Connect source to lake perimeter if applicable
    if (raw.sourceType === 'lake' && raw.sourceLakeId) {
      const srcLake = lakes.find((l) => l.id === raw.sourceLakeId);
      if (srcLake) {
        processedPoints[0] = findNearestLakePerimeterPoint(srcLake.polygon, processedPoints[0]);
      }
    }

    // 10. Connect mouth to target lake perimeter if applicable
    if (raw.terminatesAt === 'lake' && raw.targetLakeId) {
      const tgtLake = lakes.find((l) => l.id === raw.targetLakeId);
      if (tgtLake) {
        processedPoints[processedPoints.length - 1] = findNearestLakePerimeterPoint(tgtLake.polygon, processedPoints[processedPoints.length - 1]);
      }
    }

    // 11. Place ocean river mouth precisely onto the coastline (seaLevel contour)
    if (raw.terminatesAt === 'ocean') {
      processedPoints = adjustRiverMouthToCoastline(
        processedPoints,
        filledF32,
        cols,
        rows,
        mapWidth,
        mapHeight,
        seaLevel
      );
    }

    // 12. If meandering ever caused self-intersection, revert to relaxed path
    if (hasSelfIntersection(processedPoints)) {
      processedPoints = relaxed;
      if (raw.terminatesAt === 'ocean') {
        processedPoints = adjustRiverMouthToCoastline(
          processedPoints,
          filledF32,
          cols,
          rows,
          mapWidth,
          mapHeight,
          seaLevel
        );
      }
    }

    const isMain = raw.terminatesAt !== 'river';
    const name = isMain ? FANTASY_RIVER_NAMES[mainNameIndex++ % FANTASY_RIVER_NAMES.length] : undefined;

    const riverObj: RiverData = {
      id: raw.id,
      name,
      points: processedPoints,
      widthStart,
      widthEnd,
      sourceType: raw.sourceType,
      sourceLakeId: raw.sourceLakeId,
      terminatesAt: raw.terminatesAt,
      targetLakeId: raw.targetLakeId,
      connectedRiverId: raw.connectedRiverId,
    };

    resultRivers.push(riverObj);
  }

  // 11. Confluence alignment: place tributary end on main river segment & blend incoming tangent 60%
  alignTributaryConfluences(resultRivers, elevationGrid, cols, rows, mapWidth, mapHeight);

  // 12. If river terminates into a lake, clamp river path so it doesn't cross inside the lake
  for (const riverObj of resultRivers) {
    if (riverObj.terminatesAt === 'lake' && riverObj.targetLakeId) {
      const tgtLake = lakes.find((l) => l.id === riverObj.targetLakeId);
      if (tgtLake) {
        clampRiverToLakePerimeter(riverObj, tgtLake);
      }
    }
  }

  return resultRivers;
}
