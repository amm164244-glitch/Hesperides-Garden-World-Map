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
  if (n < 8) return points;

  const pts = points.map((p) => [p[0], p[1]] as [number, number]);
  const threeDegRad = (3 * Math.PI) / 180;

  let i = 0;
  while (i < n - 8) {
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

    const count = runEnd + 1 - i;
    if (count >= 8) {
      const runStart = i;
      const runEndIdx = runEnd;
      let applied = false;
      const saved: [number, number][] = [];
      for (let k = runStart; k <= runEndIdx; k++) saved.push([pts[k][0], pts[k][1]]);

      const baseDx = pts[runEndIdx][0] - pts[runStart][0];
      const baseDy = pts[runEndIdx][1] - pts[runStart][1];
      const baseLen = Math.hypot(baseDx, baseDy) || 1;
      const normal: [number, number] = [-baseDy / baseLen, baseDx / baseLen];

      for (const ampScale of [1.0, 0.6, 0.3]) {
        for (const side of [1, -1]) {
          let valid = true;
          const candidate: [number, number][] = [];
          for (let k = runStart; k <= runEndIdx; k++) {
            const t = (k - runStart) / (runEndIdx - runStart);
            const win = Math.sin(t * Math.PI) * Math.sin(t * Math.PI);
            const wave = count >= 16 ? Math.sin(t * 2 * Math.PI) * win : win;
            const amp = Math.min(0.5 * cellSize, 0.15 * baseLen) * ampScale;
            const disp = amp * wave * side;
            const candX = saved[k - runStart][0] + normal[0] * disp;
            const candY = saved[k - runStart][1] + normal[1] * disp;
            candidate.push([candX, candY]);
          }

          for (let k = 1; k < candidate.length; k++) {
            const ePrev = sampleElev(filledGrid, cols, rows, mapW, mapH, candidate[k - 1][0], candidate[k - 1][1]);
            const eCurr = sampleElev(filledGrid, cols, rows, mapW, mapH, candidate[k][0], candidate[k][1]);
            if (eCurr > ePrev + 0.3) {
              valid = false;
              break;
            }
          }
          if (!valid) continue;

          for (let k = runStart; k <= runEndIdx; k++) pts[k] = candidate[k - runStart];
          let causesIntersect = false;
          const sMin = Math.max(0, runStart - 1);
          const sMax = Math.min(n - 2, runEndIdx);
          for (let s = sMin; s <= sMax && !causesIntersect; s++) {
            const p1 = pts[s];
            const p2 = pts[s + 1];
            const segMinX = p1[0] < p2[0] ? p1[0] : p2[0];
            const segMaxX = p1[0] > p2[0] ? p1[0] : p2[0];
            const segMinY = p1[1] < p2[1] ? p1[1] : p2[1];
            const segMaxY = p1[1] > p2[1] ? p1[1] : p2[1];
            for (let j = 0; j < n - 1; j++) {
              if (Math.abs(s - j) <= 1) continue;
              const p3 = pts[j];
              const p4 = pts[j + 1];
              if (segMaxX < (p3[0] < p4[0] ? p3[0] : p4[0]) || segMinX > (p3[0] > p4[0] ? p3[0] : p4[0])) continue;
              if (segMaxY < (p3[1] < p4[1] ? p3[1] : p4[1]) || segMinY > (p3[1] > p4[1] ? p3[1] : p4[1])) continue;
              if (segsIntersect(p1, p2, p3, p4)) {
                causesIntersect = true;
                break;
              }
            }
          }
          if (causesIntersect) {
            for (let k = runStart; k <= runEndIdx; k++) pts[k] = saved[k - runStart];
            continue;
          }

          applied = true;
          break;
        }
        if (applied) break;
      }

      if (!applied) {
        for (let k = runStart; k <= runEndIdx; k++) pts[k] = saved[k - runStart];
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
 * CCW test for 2D points.
 */
export const ccw = (
  p1: [number, number],
  p2: [number, number],
  p3: [number, number]
): boolean => (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);

/**
 * Checks whether two 2D line segments intersect.
 */
export const segsIntersect = (
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

/**
 * Checks if 2D polyline self-intersects using bounding boxes and spatial hashing.
 */
export function hasSelfIntersection(points: [number, number][]): boolean {
  const n = points.length;
  if (n < 4) return false;

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
  const grid = new Map<number, number[]>();

  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const minX = Math.floor(Math.min(p1[0], p2[0]) / hashCellSize);
    const maxX = Math.floor(Math.max(p1[0], p2[0]) / hashCellSize);
    const minY = Math.floor(Math.min(p1[1], p2[1]) / hashCellSize);
    const maxY = Math.floor(Math.max(p1[1], p2[1]) / hashCellSize);

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        const key = ((gx + 32768) & 0xffff) * 65536 + ((gy + 32768) & 0xffff);
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
 * Checks whether moving vertex i of polyline pts to cand causes any self-intersection.
 */
export function movingPointCausesSelfIntersection(
  pts: [number, number][],
  i: number,
  cand: [number, number],
  segBoxes?: Float32Array
): boolean {
  const n = pts.length;
  const pPrev = pts[i - 1];
  const pNext = pts[i + 1];

  const minX = Math.min(pPrev[0], cand[0], pNext[0]);
  const maxX = Math.max(pPrev[0], cand[0], pNext[0]);
  const minY = Math.min(pPrev[1], cand[1], pNext[1]);
  const maxY = Math.max(pPrev[1], cand[1], pNext[1]);

  if (segBoxes) {
    for (let j = 0; j < n - 1; j++) {
      if (j >= i - 2 && j <= i + 1) continue;
      const bIdx = j * 4;
      if (maxX < segBoxes[bIdx] || minX > segBoxes[bIdx + 1]) continue;
      if (maxY < segBoxes[bIdx + 2] || minY > segBoxes[bIdx + 3]) continue;

      if (segsIntersect(pPrev, cand, pts[j], pts[j + 1]) || segsIntersect(cand, pNext, pts[j], pts[j + 1])) {
        return true;
      }
    }
    return false;
  }

  for (let j = 0; j < n - 1; j++) {
    if (j >= i - 2 && j <= i + 1) continue;
    const pA = pts[j];
    const pB = pts[j + 1];

    const sjMinX = pA[0] < pB[0] ? pA[0] : pB[0];
    if (maxX < sjMinX) continue;
    const sjMaxX = pA[0] > pB[0] ? pA[0] : pB[0];
    if (minX > sjMaxX) continue;

    const sjMinY = pA[1] < pB[1] ? pA[1] : pB[1];
    if (maxY < sjMinY) continue;
    const sjMaxY = pA[1] > pB[1] ? pA[1] : pB[1];
    if (minY > sjMaxY) continue;

    if (segsIntersect(pPrev, cand, pA, pB) || segsIntersect(cand, pNext, pA, pB)) {
      return true;
    }
  }
  return false;
}

/**
 * Calculates circumcircle radius of three consecutive points.
 * Returns Infinity if collinear.
 */
export function computeCircumcircleRadius(
  pPrev: [number, number],
  pCurr: [number, number],
  pNext: [number, number]
): number {
  const a = Math.hypot(pCurr[0] - pPrev[0], pCurr[1] - pPrev[1]);
  const b = Math.hypot(pNext[0] - pCurr[0], pNext[1] - pCurr[1]);
  const c = Math.hypot(pNext[0] - pPrev[0], pNext[1] - pPrev[1]);
  if (a < 1e-6 || b < 1e-6) return 0;
  const cross = Math.abs(
    (pCurr[0] - pPrev[0]) * (pNext[1] - pPrev[1]) -
    (pCurr[1] - pPrev[1]) * (pNext[0] - pPrev[0])
  );
  if (cross < 1e-7) return Infinity;
  return (a * b * c) / (2 * cross);
}

/**
 * Computes per-point river width via distance-based linear interpolation,
 * bounded below by minHeadWidth.
 */
export function computeRiverPointWidthsForExtraction(
  points: [number, number][],
  widthStart: number,
  widthEnd: number,
  wMin: number
): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [widthStart];

  let totalDist = 0;
  const dists: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    totalDist += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    dists.push(totalDist);
  }

  const widths: number[] = [];
  const minHeadWidth = wMin * 0.6;
  for (let i = 0; i < n; i++) {
    const frac = totalDist > 0 ? dists[i] / totalDist : 0;
    const w = widthStart + (widthEnd - widthStart) * frac;
    widths.push(Math.max(w, minHeadWidth));
  }
  return widths;
}

/**
 * Limits river curvature according to river width:
 * When circumcircle radius R(i) < 0.75 * w(i), relaxes point towards midpoint of neighbors.
 * Preserves endpoints and checks elevation monotonicity and self-intersection.
 */
export function limitRiverCurvature(
  points: [number, number][],
  widths: number[],
  filledGrid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  maxIterations: number = 8
): [number, number][] {
  const n = points.length;
  if (n < 3) return points;

  let totalDist0 = 0;
  for (let i = 0; i < n - 1; i++) {
    totalDist0 += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  const minAllowedLen = totalDist0 * 0.85;
  let curLen = totalDist0;

  const pts: [number, number][] = points.map((p) => [p[0], p[1]]);

  // Precompute segment bounding boxes: [minX, maxX, minY, maxY] for each segment j in 0..n-2
  const segBoxes = new Float32Array((n - 1) * 4);
  for (let s = 0; s < n - 1; s++) {
    const x1 = pts[s][0];
    const y1 = pts[s][1];
    const x2 = pts[s + 1][0];
    const y2 = pts[s + 1][1];
    const b = s * 4;
    segBoxes[b] = x1 < x2 ? x1 : x2;
    segBoxes[b + 1] = x1 > x2 ? x1 : x2;
    segBoxes[b + 2] = y1 < y2 ? y1 : y2;
    segBoxes[b + 3] = y1 > y2 ? y1 : y2;
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    let movedAny = false;

    for (let i = 1; i < n - 1; i++) {
      const w = widths[i] ?? widths[widths.length - 1] ?? 2.0;
      const R = computeCircumcircleRadius(pts[i - 1], pts[i], pts[i + 1]);
      if (R >= 0.75 * w) continue;

      const pPrev = pts[i - 1];
      const pCurr = pts[i];
      const pNext = pts[i + 1];
      const midX = (pPrev[0] + pNext[0]) * 0.5;
      const midY = (pPrev[1] + pNext[1]) * 0.5;

      const ePrev = sampleElev(filledGrid, cols, rows, mapW, mapH, pPrev[0], pPrev[1]);

      for (const alpha of [0.8, 0.4]) {
        const candX = pCurr[0] * (1 - alpha) + midX * alpha;
        const candY = pCurr[1] * (1 - alpha) + midY * alpha;
        const cand: [number, number] = [candX, candY];

        // Elevation monotonicity check
        const eCand = sampleElev(filledGrid, cols, rows, mapW, mapH, candX, candY);
        if (eCand > ePrev + 0.3) continue;

        // Self-intersection check using precomputed segment bounding boxes
        if (movingPointCausesSelfIntersection(pts, i, cand, segBoxes)) continue;

        // Length preservation check (at least 85% of original length)
        const oldSegs =
          Math.hypot(pCurr[0] - pPrev[0], pCurr[1] - pPrev[1]) +
          Math.hypot(pNext[0] - pCurr[0], pNext[1] - pCurr[1]);
        const newSegs =
          Math.hypot(candX - pPrev[0], candY - pPrev[1]) +
          Math.hypot(pNext[0] - candX, pNext[1] - candY);
        const lenDelta = newSegs - oldSegs;
        if (curLen + lenDelta < minAllowedLen) continue;

        pts[i] = cand;
        curLen += lenDelta;
        movedAny = true;

        // Update segment bounding boxes for segment i - 1 and segment i
        const sA = i - 1;
        const bA = sA * 4;
        const xA1 = pts[sA][0];
        const yA1 = pts[sA][1];
        segBoxes[bA] = xA1 < candX ? xA1 : candX;
        segBoxes[bA + 1] = xA1 > candX ? xA1 : candX;
        segBoxes[bA + 2] = yA1 < candY ? yA1 : candY;
        segBoxes[bA + 3] = yA1 > candY ? yA1 : candY;

        const sB = i;
        const bB = sB * 4;
        const xB2 = pts[sB + 1][0];
        const yB2 = pts[sB + 1][1];
        segBoxes[bB] = candX < xB2 ? candX : xB2;
        segBoxes[bB + 1] = candX > xB2 ? candX : xB2;
        segBoxes[bB + 2] = candY < yB2 ? candY : yB2;
        segBoxes[bB + 3] = candY > yB2 ? candY : yB2;
        break;
      }
    }

    if (!movedAny) break;
  }

  return pts;
}

/**
 * Distance-based Gaussian smoothing to eliminate fine jaggedness.
 * sigma = max(w(i) * 1.0, cellSize * 1.5), window radius = 2.5 * sigma.
 * Endpoints pinned; weights smoothly tapered to 0 within half-window of ends.
 * Monotonicity (uphill <= 1%) and self-intersection verified, otherwise reverted.
 */
export function smoothRiverGaussian(
  points: [number, number][],
  widths: number[],
  cellSize: number,
  filledGrid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number
): [number, number][] {
  const n = points.length;
  if (n < 4) return points;

  const s: number[] = [0];
  let totalL = 0;
  for (let i = 0; i < n - 1; i++) {
    totalL += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    s.push(totalL);
  }
  if (totalL <= 1e-4) return points;

  const smoothedPts: [number, number][] = points.map((p) => [p[0], p[1]]);

  for (let i = 1; i < n - 1; i++) {
    const w = widths[i] ?? widths[widths.length - 1] ?? 2.0;
    // sigma = max(w * 1.0, cellSize * 1.5) per specification
    const sigma = Math.max(w * 1.0, cellSize * 1.5);
    const windowR = 2.5 * sigma;
    const halfWin = 0.5 * windowR;

    const distFromEnd = Math.min(s[i], totalL - s[i]);
    const taper = distFromEnd < halfWin ? distFromEnd / Math.max(1e-4, halfWin) : 1.0;
    if (taper <= 0) continue;

    let sumW = 0;
    let sumX = 0;
    let sumY = 0;
    const twoSigma2 = 2 * sigma * sigma;

    // Accumulate backwards
    for (let j = i; j >= 0; j--) {
      const ds = s[i] - s[j];
      if (ds > windowR) break;
      const kw = Math.exp(-(ds * ds) / twoSigma2);
      sumW += kw;
      sumX += kw * points[j][0];
      sumY += kw * points[j][1];
    }
    // Accumulate forwards
    for (let j = i + 1; j < n; j++) {
      const ds = s[j] - s[i];
      if (ds > windowR) break;
      const kw = Math.exp(-(ds * ds) / twoSigma2);
      sumW += kw;
      sumX += kw * points[j][0];
      sumY += kw * points[j][1];
    }

    if (sumW > 0) {
      const gx = sumX / sumW;
      const gy = sumY / sumW;
      smoothedPts[i] = [
        points[i][0] * (1 - taper) + gx * taper,
        points[i][1] * (1 - taper) + gy * taper,
      ];
    }
  }

  // Verification 1: Self-intersection
  if (hasSelfIntersection(smoothedPts)) {
    return points;
  }

  // Verification 2: Monotonicity (uphill segments <= 1%)
  let uphillCount = 0;
  for (let i = 0; i < n - 1; i++) {
    const e1 = sampleElev(filledGrid, cols, rows, mapW, mapH, smoothedPts[i][0], smoothedPts[i][1]);
    const e2 = sampleElev(filledGrid, cols, rows, mapW, mapH, smoothedPts[i + 1][0], smoothedPts[i + 1][1]);
    if (e2 - e1 > 0.3) {
      uphillCount++;
    }
  }
  if (uphillCount / (n - 1) > 0.01) {
    return points;
  }

  // Verification 3: Straight runs check (do not flatten meanders into straight runs >= 8 points with < 3 deg change)
  let straightRunPts = 0;
  const threeDegRad = (3 * Math.PI) / 180;
  let k = 0;
  while (k < n - 8) {
    let runEnd = k + 1;
    const vBaseX = smoothedPts[k + 1][0] - smoothedPts[k][0];
    const vBaseY = smoothedPts[k + 1][1] - smoothedPts[k][1];
    const lenBase = Math.hypot(vBaseX, vBaseY);
    if (lenBase < 1e-6) {
      k++;
      continue;
    }
    while (runEnd < n - 1) {
      const vCurrX = smoothedPts[runEnd + 1][0] - smoothedPts[runEnd][0];
      const vCurrY = smoothedPts[runEnd + 1][1] - smoothedPts[runEnd][1];
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
    const count = runEnd + 1 - k;
    if (count >= 8) {
      straightRunPts += count;
      k = runEnd;
    } else {
      k++;
    }
  }
  if (straightRunPts / n > 0.15) {
    return points;
  }

  return smoothedPts;
}

/**
 * Projects a point onto a polyline and returns the closest point, tangent vector, and distance.
 */
export function projectPointToPolyline(
  p: [number, number],
  poly: [number, number][]
): { point: [number, number]; tangent: [number, number]; dist: number; segIndex: number } {
  let bestDist = Infinity;
  let bestPt: [number, number] = p;
  let bestTangent: [number, number] = [1, 0];
  let bestSeg = 0;

  for (let s = 0; s < poly.length - 1; s++) {
    const A = poly[s];
    const B = poly[s + 1];
    const ABx = B[0] - A[0];
    const ABy = B[1] - A[1];
    const len2 = ABx * ABx + ABy * ABy;
    if (len2 < 1e-8) continue;

    const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * ABx + (p[1] - A[1]) * ABy) / len2));
    const proj: [number, number] = [A[0] + t * ABx, A[1] + t * ABy];
    const d = Math.hypot(p[0] - proj[0], p[1] - proj[1]);

    if (d < bestDist) {
      bestDist = d;
      bestPt = proj;
      bestSeg = s;
      const segLen = Math.hypot(ABx, ABy) || 1;
      bestTangent = [ABx / segLen, ABy / segLen];
    }
  }

  return { point: bestPt, tangent: bestTangent, dist: bestDist, segIndex: bestSeg };
}

/**
 * Computes minimum distance from a point to any segment of a polyline.
 */
function distToPolyline(p: [number, number], poly: [number, number][]): number {
  let minD = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const A = poly[i];
    const B = poly[i + 1];
    const ABx = B[0] - A[0];
    const ABy = B[1] - A[1];
    const len2 = ABx * ABx + ABy * ABy;
    if (len2 < 1e-8) {
      const d = Math.hypot(p[0] - A[0], p[1] - A[1]);
      if (d < minD) minD = d;
      continue;
    }
    const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * ABx + (p[1] - A[1]) * ABy) / len2));
    const d = Math.hypot(p[0] - (A[0] + t * ABx), p[1] - (A[1] + t * ABy));
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Aligns tributary confluences cleanly onto their main river stems:
 * - Clamps mouth width <= main river width.
 * - Trims tributary points within W_main * 1.5 of main river centerline to eliminate folding.
 * - Snaps final point onto main river.
 * - Realigns approach angle if > 80 deg.
 * - Cleans acute kinks in last 3 points.
 * - Main river remains unchanged.
 */
function distPointToSegment(p: [number, number], A: [number, number], B: [number, number]): number {
  const ABx = B[0] - A[0];
  const ABy = B[1] - A[1];
  const len2 = ABx * ABx + ABy * ABy;
  if (len2 < 1e-8) return Math.hypot(p[0] - A[0], p[1] - A[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * ABx + (p[1] - A[1]) * ABy) / len2));
  return Math.hypot(p[0] - (A[0] + t * ABx), p[1] - (A[1] + t * ABy));
}

/**
 * Aligns tributary confluences cleanly onto their main river stems:
 * - Clamps mouth width <= main river width at confluence.
 * - Trims tributary points within W_main * 1.5 of main river centerline to eliminate folding.
 * - Snaps final point onto main river.
 * - Realigns approach angle if > 80 deg (bends last 3 points towards tangent by 60%).
 * - Cleans acute kinks in last 3 points.
 * - Main river remains unchanged.
 */
export function alignTributaryConfluences(
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

    // 1. Calculate local main river width at confluence point
    const mouthProj = projectPointToPolyline(trib.points[trib.points.length - 1], mainRiver.points);
    let mainCumDist = 0;
    for (let s = 0; s < mouthProj.segIndex; s++) {
      mainCumDist += Math.hypot(
        mainRiver.points[s + 1][0] - mainRiver.points[s][0],
        mainRiver.points[s + 1][1] - mainRiver.points[s][1]
      );
    }
    const segP0 = mainRiver.points[mouthProj.segIndex];
    mainCumDist += Math.hypot(mouthProj.point[0] - segP0[0], mouthProj.point[1] - segP0[1]);
    let mainTotalLen = 0;
    for (let s = 0; s < mainRiver.points.length - 1; s++) {
      mainTotalLen += Math.hypot(
        mainRiver.points[s + 1][0] - mainRiver.points[s][0],
        mainRiver.points[s + 1][1] - mainRiver.points[s][1]
      );
    }
    const frac = mainTotalLen > 0 ? Math.max(0, Math.min(1, mainCumDist / mainTotalLen)) : 1;
    const localMainW = mainRiver.widthStart + (mainRiver.widthEnd - mainRiver.widthStart) * frac;

    // Clamp tributary mouth width so it does not exceed the main river's width at that point
    trib.widthEnd = Math.min(trib.widthEnd, localMainW);

    // 2. Trim tributary points within W_main * 1.5 of main river centerline to eliminate folding
    const trimDist = localMainW * 1.5;
    let keepIndex = trib.points.length - 1;
    const mouthElev = sampleElev(elevationGrid, cols, rows, mapW, mapH, mouthProj.point[0], mouthProj.point[1]);
    while (
      keepIndex > 1 &&
      distToPolyline(trib.points[keepIndex], mainRiver.points) < trimDist &&
      sampleElev(elevationGrid, cols, rows, mapW, mapH, trib.points[keepIndex - 1][0], trib.points[keepIndex - 1][1]) >= mouthElev - 0.35
    ) {
      keepIndex--;
    }

    let working = trib.points.slice(0, keepIndex + 1);
    const projResult = projectPointToPolyline(working[working.length - 1], mainRiver.points);
    const dLast = Math.hypot(projResult.point[0] - working[working.length - 1][0], projResult.point[1] - working[working.length - 1][1]);
    if (dLast < 0.4 * localMainW && working.length > 2) {
      working[working.length - 1] = projResult.point;
    } else {
      working.push(projResult.point);
    }

    // 3. Helper to check if tributary intersects main river prior to confluence
    const checkIntersectsMain = (pts: [number, number][]): boolean => {
      // Prior to confluence: check segments up to pts.length - 2
      for (let i = 0; i < pts.length - 2; i++) {
        for (let j = 0; j < mainRiver.points.length - 1; j++) {
          if (segsIntersect(pts[i], pts[i + 1], mainRiver.points[j], mainRiver.points[j + 1])) {
            return true;
          }
        }
      }
      return false;
    };

    // 4. If tributary intersects main river prior to confluence or self-intersects,
    // delete last 5 points and reconnect to main river
    if (hasSelfIntersection(working) || checkIntersectsMain(working)) {
      if (working.length > 7) {
        working = working.slice(0, working.length - 5);
        const rep = projectPointToPolyline(working[working.length - 1], mainRiver.points);
        working.push(rep.point);
      } else if (working.length > 3) {
        working = working.slice(0, working.length - 2);
        const rep = projectPointToPolyline(working[working.length - 1], mainRiver.points);
        working.push(rep.point);
      }
    }

    // 5. Clean acute kinks in last 3 points & clamp sharp corners
    let m = working.length;
    if (m >= 4) {
      for (let k = m - 2; k >= m - 3 && k >= 1; k--) {
        const R = computeCircumcircleRadius(working[k - 1], working[k], working[k + 1]);
        if (R < 0.75 * localMainW) {
          const midX = (working[k - 1][0] + working[k + 1][0]) * 0.5;
          const midY = (working[k - 1][1] + working[k + 1][1]) * 0.5;
          working[k] = [working[k][0] * 0.4 + midX * 0.6, working[k][1] * 0.4 + midY * 0.6];
        }
      }
    }

    working = clampSharpCorners(working);

    // 6. Approach angle check: if incoming angle with main river tangent > 80 deg,
    // bend last 3 points towards tangent by 60%
    m = working.length;
    if (m >= 3) {
      const pEnd = working[m - 1];
      const pPrev = working[m - 2];
      const inDx = pEnd[0] - pPrev[0];
      const inDy = pEnd[1] - pPrev[1];
      const inLen = Math.hypot(inDx, inDy) || 1;
      const inDir: [number, number] = [inDx / inLen, inDy / inLen];

      const proj = projectPointToPolyline(pEnd, mainRiver.points);
      const mainTan = proj.tangent;
      const dot = inDir[0] * mainTan[0] + inDir[1] * mainTan[1];
      const cos80 = Math.cos((80 * Math.PI) / 180); // ~0.173648
      const eEnd = sampleElev(elevationGrid, cols, rows, mapW, mapH, pEnd[0], pEnd[1]);

      if (dot < cos80) {
        for (let step = 1; step <= Math.min(3, m - 1); step++) {
          const ptIdx = m - 1 - step;
          const orig = working[ptIdx];
          const distFromEnd = Math.hypot(pEnd[0] - orig[0], pEnd[1] - orig[1]);
          const targetPt: [number, number] = [
            pEnd[0] - mainTan[0] * distFromEnd,
            pEnd[1] - mainTan[1] * distFromEnd,
          ];
          const alpha = 0.60;
          working[ptIdx] = [
            orig[0] * (1 - alpha) + targetPt[0] * alpha,
            orig[1] * (1 - alpha) + targetPt[1] * alpha,
          ];
        }
      }

      working = clampSharpCorners(working);
    }

    if (working.length >= 4) {
      for (let iter = 0; iter < 3; iter++) {
        for (let k = working.length - 2; k >= Math.max(1, working.length - 5); k--) {
          const R = computeCircumcircleRadius(working[k - 1], working[k], working[k + 1]);
          if (R < 0.75 * localMainW) {
            const midX = (working[k - 1][0] + working[k + 1][0]) * 0.5;
            const midY = (working[k - 1][1] + working[k + 1][1]) * 0.5;
            working[k] = [working[k][0] * 0.3 + midX * 0.7, working[k][1] * 0.3 + midY * 0.7];
          }
        }
      }
      working = clampSharpCorners(working);
    }

    // Ensure the last point is strictly snapped onto main river polyline
    const finalSnap = projectPointToPolyline(working[working.length - 1], mainRiver.points);
    working[working.length - 1] = finalSnap.point;

    trib.points = working;
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

  const avgW = (widthStart + widthEnd) * 0.5;
  for (let i = 1; i < n; i++) {
    const ds = cumDists[i] - cumDists[i - 1];
    const w = widths[i];
    const isThin = avgW < 1.5 || w < 1.5;
    const minLambda = isThin ? 20 * cellSize : 24 * cellSize;
    const lambda = Math.max(16 * w, minLambda);
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

            const aThick = meanderFactor * K * widths[i] * plains[i] * taper * wob;
      const aThin = meanderFactor * (K / 1.2) * 0.5 * cellSize * taper * plains[i];
      const A = Math.max(aThick, aThin);
      let off = A * Math.sin(phases[i]);

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
      } else {
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

    // 12. If meandering ever caused self-intersection, revert to resampled path
    if (hasSelfIntersection(processedPoints)) {
      processedPoints = resampled;
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

    // 12.5 Collapse points crowded closer than 0.15 * cellSize to prevent artificial micro-radii
    if (processedPoints.length > 3) {
      const minSpacing = 0.15 * cellSize;
      const deduplicated: [number, number][] = [processedPoints[0]];
      for (let i = 1; i < processedPoints.length - 1; i++) {
        const last = deduplicated[deduplicated.length - 1];
        const d = Math.hypot(processedPoints[i][0] - last[0], processedPoints[i][1] - last[1]);
        if (d >= minSpacing) {
          deduplicated.push(processedPoints[i]);
        }
      }
      deduplicated.push(processedPoints[processedPoints.length - 1]);
      processedPoints = deduplicated;
    }

    // 13. Curvature limiting & Fine Gaussian smoothing
    const pointWidths = computeRiverPointWidthsForExtraction(
      processedPoints,
      widthStart,
      widthEnd,
      wMin
    );
    // Pass 1: Curvature limiting
    processedPoints = limitRiverCurvature(
      processedPoints,
      pointWidths,
      filledF32,
      cols,
      rows,
      mapWidth,
      mapHeight,
      4
    );
    // Pass 2: Fine Gaussian smoothing
    processedPoints = smoothRiverGaussian(
      processedPoints,
      pointWidths,
      cellSize,
      filledF32,
      cols,
      rows,
      mapWidth,
      mapHeight
    );
    // Pass 3: Re-run curvature limiting
    processedPoints = limitRiverCurvature(
      processedPoints,
      pointWidths,
      filledF32,
      cols,
      rows,
      mapWidth,
      mapHeight,
      4
    );
    let hasSharpCurv = false;
    for (let k = 1; k < processedPoints.length - 1; k++) {
      const wK = pointWidths[k] ?? widthStart;
      const RK = computeCircumcircleRadius(processedPoints[k - 1], processedPoints[k], processedPoints[k + 1]);
      if (Number.isFinite(RK) && RK < 0.72 * wK) {
        hasSharpCurv = true;
        break;
      }
    }
    if (hasSharpCurv) {
      processedPoints = limitRiverCurvature(
        processedPoints,
        pointWidths,
        filledF32,
        cols,
        rows,
        mapWidth,
        mapHeight,
        3
      );
    }
    processedPoints = clampSharpCorners(processedPoints);
    if (processedPoints.length > 3) {
      const deduplicated: [number, number][] = [processedPoints[0]];
      for (let i = 1; i < processedPoints.length - 1; i++) {
        const last = deduplicated[deduplicated.length - 1];
        const w = pointWidths[i] ?? widthStart;
        const minSpacing = Math.max(0.25 * cellSize, 0.18 * w);
        const d = Math.hypot(processedPoints[i][0] - last[0], processedPoints[i][1] - last[1]);
        if (d >= minSpacing) {
          deduplicated.push(processedPoints[i]);
        }
      }
      deduplicated.push(processedPoints[processedPoints.length - 1]);
      processedPoints = deduplicated;
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

  // 12. If river connects to a lake, clamp river path so it doesn't cross inside the lake
  for (const riverObj of resultRivers) {
    if (riverObj.terminatesAt === 'lake' && riverObj.targetLakeId) {
      const tgtLake = lakes.find((l) => l.id === riverObj.targetLakeId);
      if (tgtLake) {
        clampRiverToLakePerimeter(riverObj, tgtLake, cellSize);
      }
    }
    if (riverObj.sourceType === 'lake' && riverObj.sourceLakeId) {
      const srcLake = lakes.find((l) => l.id === riverObj.sourceLakeId);
      if (srcLake) {
        clampRiverToLakePerimeter(riverObj, srcLake, cellSize);
      }
    }
  }

  // Final cleanup: collapse vertices that ended up crowded closer than minSpacing
  for (const riverObj of resultRivers) {
    if (riverObj.points.length > 3) {
      const ptWidths = computeRiverPointWidthsForExtraction(
        riverObj.points,
        riverObj.widthStart,
        riverObj.widthEnd,
        wMin
      );
      const dedup: [number, number][] = [riverObj.points[0]];
      for (let i = 1; i < riverObj.points.length - 1; i++) {
        const w = ptWidths[i] ?? riverObj.widthStart;
        const minSpacing = Math.max(0.25 * cellSize, 0.18 * w);
        const d = Math.hypot(riverObj.points[i][0] - dedup[dedup.length - 1][0], riverObj.points[i][1] - dedup[dedup.length - 1][1]);
        if (d >= minSpacing) {
          dedup.push(riverObj.points[i]);
        }
      }
      dedup.push(riverObj.points[riverObj.points.length - 1]);
      riverObj.points = dedup;

      let hasSharp = false;
      for (let k = 1; k < riverObj.points.length - 1; k++) {
        const wK = ptWidths[k] ?? riverObj.widthStart;
        const RK = computeCircumcircleRadius(riverObj.points[k - 1], riverObj.points[k], riverObj.points[k + 1]);
        if (Number.isFinite(RK) && RK < 0.7 * wK) {
          hasSharp = true;
          break;
        }
      }
      if (hasSharp) {
        riverObj.points = limitRiverCurvature(
          riverObj.points,
          ptWidths,
          elevationGrid,
          cols,
          rows,
          mapWidth,
          mapHeight,
          4
        );
      }
    }

    // Attach elevation metadata
    const pts = riverObj.points;
    const n = pts.length;
    if (n >= 2) {
      const e0 = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, pts[0][0], pts[0][1]);
      const eEnd = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, pts[n - 1][0], pts[n - 1][1]);
      riverObj.elevationStart = Number(e0.toFixed(2));
      riverObj.elevationEnd = Number(eEnd.toFixed(2));

      let uphill = 0;
      let maxUp = 0;
      for (let i = 0; i < n - 1; i++) {
        const diff = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, pts[i + 1][0], pts[i + 1][1]) -
                     sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, pts[i][0], pts[i][1]);
        if (diff > 0.35) {
          uphill++;
          if (diff > maxUp) maxUp = diff;
        }
      }
      riverObj.isMonotonic = uphill === 0;
      riverObj.maxUphill = Number(maxUp.toFixed(2));
    }
  }

  return resultRivers;
}
