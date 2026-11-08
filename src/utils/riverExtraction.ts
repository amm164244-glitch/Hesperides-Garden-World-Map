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
 * Breaks long 45-degree straight runs (>= 5 consecutive points with < 3 deg direction change)
 * by displacing the midpoint perpendicularly by 0.3 * cellSize if monotonicity allows.
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
  if (points.length < 5) return points;

  const pts = points.map((p) => [p[0], p[1]] as [number, number]);
  const n = pts.length;
  const threeDegRad = (3 * Math.PI) / 180;

  let i = 0;
  while (i < n - 4) {
    let runEnd = i;
    while (runEnd < n - 2) {
      const pA = pts[runEnd];
      const pB = pts[runEnd + 1];
      const pC = pts[runEnd + 2];

      const v1x = pB[0] - pA[0];
      const v1y = pB[1] - pA[1];
      const v2x = pC[0] - pB[0];
      const v2y = pC[1] - pB[1];

      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      if (len1 < 1e-6 || len2 < 1e-6) {
        runEnd++;
        continue;
      }

      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

      if (angle < threeDegRad) {
        runEnd++;
      } else {
        break;
      }
    }

    if (runEnd - i >= 3) {
      const startPtIdx = i;
      const endPtIdx = runEnd + 1;
      const midIdx = Math.floor((startPtIdx + endPtIdx) / 2);

      if (midIdx > 0 && midIdx < n - 1) {
        const pPrev = pts[midIdx - 1];
        const pNext = pts[midIdx + 1];
        const pMid = pts[midIdx];

        const tx = pNext[0] - pPrev[0];
        const ty = pNext[1] - pPrev[1];
        const tLen = Math.hypot(tx, ty) || 1;
        const nx = -ty / tLen;
        const ny = tx / tLen;

        const rVal = Math.sin(seed * 71.3 + midIdx * 133.7) * 43758.5453;
        const side = (rVal - Math.floor(rVal)) < 0.5 ? -1 : 1;
        const shift = cellSize * 0.3 * side;

        const candX = pMid[0] + nx * shift;
        const candY = pMid[1] + ny * shift;

        const prevElev = sampleElev(filledGrid, cols, rows, mapW, mapH, pPrev[0], pPrev[1]);
        const candElev = sampleElev(filledGrid, cols, rows, mapW, mapH, candX, candY);
        const nextElev = sampleElev(filledGrid, cols, rows, mapW, mapH, pNext[0], pNext[1]);

        if (candElev <= prevElev + 0.3 && nextElev <= candElev + 0.3) {
          pts[midIdx] = [candX, candY];
        }
      }

      i = endPtIdx;
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
 * Checks if 2D polyline self-intersects.
 */
export function hasSelfIntersection(points: [number, number][]): boolean {
  const n = points.length;
  if (n < 4) return false;

  const ccw = (p1: [number, number], p2: [number, number], p3: [number, number]) =>
    (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);

  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      const a = points[i];
      const b = points[i + 1];
      const c = points[j];
      const d = points[j + 1];
      if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) {
        return true;
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

    // 1. Chaikin smoothing (3 iterations unless points would exceed 4000)
    const iters = (8 * pts.length - 7 > 4000) ? 2 : 3;
    const smoothed = chaikinOpen(pts, iters);

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

    // 3. Meandering with dual-frequency noise and amplitude scaled by river order
    const order = riverOrderMap.get(raw.id) ?? 2;
    const n = relaxed.length;
    const meandered: [number, number][] = [];

    const lambdaLow = cellSize * 16;
    const lambdaHigh = cellSize * 5.5;
    const maxMeanderAmp = meanderFactor * 0.9 * cellSize * (1 + 0.5 * Math.min(3, order));

    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1 || meanderFactor <= 0) {
        meandered.push(relaxed[i]);
        continue;
      }

      const pPrev = relaxed[i - 1];
      const pCurr = relaxed[i];
      const pNext = relaxed[i + 1];

      const tx = pNext[0] - pPrev[0];
      const ty = pNext[1] - pPrev[1];
      const tLen = Math.hypot(tx, ty) || 1;
      const nx = -ty / tLen;
      const ny = tx / tLen;

      const progress = i / (n - 1);
      const taper = Math.sin(progress * Math.PI);

      const nLow = meanderNoiseLow.sample(pCurr[0] / lambdaLow, pCurr[1] / lambdaLow);
      const nHigh = meanderNoiseHigh.sample(pCurr[0] / lambdaHigh, pCurr[1] / lambdaHigh);
      const noiseVal = nLow + 0.35 * nHigh;

      const amp = maxMeanderAmp * taper * noiseVal;

      let candX = pCurr[0] + nx * amp;
      let candY = pCurr[1] + ny * amp;

      const prevElev = sampleElev(filledF32, cols, rows, mapWidth, mapHeight, meandered[i - 1][0], meandered[i - 1][1]);
      let candElev = sampleElev(filledF32, cols, rows, mapWidth, mapHeight, candX, candY);

      if (candElev > prevElev + 0.3) {
        candX = pCurr[0] + nx * (amp * 0.25);
        candY = pCurr[1] + ny * (amp * 0.25);
        candElev = sampleElev(filledF32, cols, rows, mapWidth, mapHeight, candX, candY);
        if (candElev > prevElev + 0.3) {
          candX = pCurr[0];
          candY = pCurr[1];
        }
      }

      meandered.push([candX, candY]);
    }

    // 4. Break straight 45-degree runs (>= 5 consecutive points with < 3 deg angle change)
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

    // 5. Ensure direction change between any 3 adjacent points is <= 90 degrees
    let processedPoints = clampSharpCorners(straightBroken);

    // 6. Connect source to lake perimeter if applicable
    if (raw.sourceType === 'lake' && raw.sourceLakeId) {
      const srcLake = lakes.find((l) => l.id === raw.sourceLakeId);
      if (srcLake) {
        processedPoints[0] = findNearestLakePerimeterPoint(srcLake.polygon, processedPoints[0]);
      }
    }

    // 7. Connect mouth to target lake perimeter if applicable
    if (raw.terminatesAt === 'lake' && raw.targetLakeId) {
      const tgtLake = lakes.find((l) => l.id === raw.targetLakeId);
      if (tgtLake) {
        processedPoints[processedPoints.length - 1] = findNearestLakePerimeterPoint(tgtLake.polygon, processedPoints[processedPoints.length - 1]);
      }
    }

    // 8. Place ocean river mouth precisely onto the coastline (seaLevel contour)
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

    // 9. If meandering ever caused self-intersection, revert to relaxed path
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

    // 10. Calculate river widths (tapering down to 0.5 * wMin at extended headwaters, 1.25 * widthEnd at estuary)
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
