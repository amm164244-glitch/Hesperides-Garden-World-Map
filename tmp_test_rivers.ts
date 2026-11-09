import { generateTectonicWorld, GeneratorConfig } from './src/utils/tectonicGenerator';
import { sampleElev } from './src/utils/waterGenerator';

export function computeCircumcircleRadius(
  pPrev: [number, number],
  pCurr: [number, number],
  pNext: [number, number]
): number {
  const ax = pCurr[0] - pPrev[0];
  const ay = pCurr[1] - pPrev[1];
  const bx = pNext[0] - pCurr[0];
  const by = pNext[1] - pCurr[1];
  const cx = pNext[0] - pPrev[0];
  const cy = pNext[1] - pPrev[1];

  const a = Math.hypot(ax, ay);
  const b = Math.hypot(bx, by);
  const c = Math.hypot(cx, cy);

  if (a < 1e-6 || b < 1e-6 || c < 1e-6) return Infinity;

  const cross = Math.abs(ax * cy - ay * cx);
  if (cross < 1e-6) return Infinity;

  return (a * b * c) / (2 * cross);
}

function ccw(p1: [number, number], p2: [number, number], p3: [number, number]): boolean {
  return (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

function segsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): boolean {
  if (
    Math.max(p1[0], p2[0]) < Math.min(p3[0], p4[0]) ||
    Math.min(p1[0], p2[0]) > Math.max(p3[0], p4[0]) ||
    Math.max(p1[1], p2[1]) < Math.min(p3[1], p4[1]) ||
    Math.min(p1[1], p2[1]) > Math.max(p3[1], p4[1])
  ) {
    return false;
  }
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

function movingPointCausesSelfIntersection(
  pts: [number, number][],
  i: number,
  cand: [number, number]
): boolean {
  const n = pts.length;
  const pPrev = pts[i - 1];
  const pNext = pts[i + 1];

  for (let j = 0; j < n - 1; j++) {
    if (j === i - 2 || j === i - 1 || j === i) continue;
    if (segsIntersect(pPrev, cand, pts[j], pts[j + 1])) return true;
  }
  for (let j = 0; j < n - 1; j++) {
    if (j === i - 1 || j === i || j === i + 1) continue;
    if (segsIntersect(cand, pNext, pts[j], pts[j + 1])) return true;
  }
  return false;
}

export function hasSelfIntersection(points: [number, number][]): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (segsIntersect(points[i], points[i + 1], points[j], points[j + 1])) return true;
    }
  }
  return false;
}

export function computeRiverPointWidthsForExtraction(
  points: [number, number][],
  widthStart: number,
  widthEnd: number,
  wMin: number
): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [Math.max(widthStart, wMin * 0.6)];

  const cumDists: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    cumDists.push(cumDists[i] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]));
  }
  const L = cumDists[n - 1];
  const minW = wMin * 0.6;

  const widths: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = L > 1e-6 ? cumDists[i] / L : i / (n - 1);
    const rawW = widthStart + (widthEnd - widthStart) * t;
    widths[i] = Math.max(rawW, minW);
  }
  return widths;
}

export function limitRiverCurvature(
  points: [number, number][],
  widths: number[],
  filledGrid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  maxIterations: number = 60
): [number, number][] {
  const n = points.length;
  if (n < 3) return points;

  let initialLen = 0;
  for (let i = 0; i < n - 1; i++) {
    initialLen += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  const minAllowedLen = initialLen * 0.85;

  const current: [number, number][] = points.map((p) => [p[0], p[1]]);

  for (let it = 0; it < maxIterations; it++) {
    let hadViolation = false;
    let anyMoved = false;

    for (let i = 1; i < n - 1; i++) {
      const pPrev = current[i - 1];
      const pCurr = current[i];
      const pNext = current[i + 1];

      const R = computeCircumcircleRadius(pPrev, pCurr, pNext);
      const w = widths[i] ?? 1.5;

      if (R < 0.75 * w) {
        hadViolation = true;

        const midX = 0.5 * (pPrev[0] + pNext[0]);
        const midY = 0.5 * (pPrev[1] + pNext[1]);
        const candX = pCurr[0] * 0.4 + midX * 0.6;
        const candY = pCurr[1] * 0.4 + midY * 0.6;
        const cand: [number, number] = [candX, candY];

        const ePrev = sampleElev(filledGrid, cols, rows, mapW, mapH, pPrev[0], pPrev[1]);
        const eCand = sampleElev(filledGrid, cols, rows, mapW, mapH, candX, candY);
        if (eCand > ePrev + 0.3) {
          continue;
        }

        if (movingPointCausesSelfIntersection(current, i, cand)) {
          continue;
        }

        current[i] = cand;
        anyMoved = true;
      }
    }

    if (!hadViolation || !anyMoved) {
      break;
    }
  }

  let currentLen = 0;
  for (let i = 0; i < n - 1; i++) {
    currentLen += Math.hypot(current[i + 1][0] - current[i][0], current[i + 1][1] - current[i][1]);
  }
  if (currentLen < minAllowedLen) {
    return points;
  }

  return current;
}

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

  const cumDists: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    cumDists.push(cumDists[i] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]));
  }
  const L = cumDists[n - 1];
  if (L < 1e-4) return points;

  const smoothed: [number, number][] = new Array(n);
  smoothed[0] = [points[0][0], points[0][1]];
  smoothed[n - 1] = [points[n - 1][0], points[n - 1][1]];

  for (let i = 1; i < n - 1; i++) {
    const s_i = cumDists[i];
    const w = widths[i] ?? 1.5;
    const sigma = Math.max(w * 1.0, cellSize * 1.5);
    const windowHalf = 2.5 * sigma;
    const taperHalf = 0.5 * windowHalf;

    const distFromEnd = Math.min(s_i, L - s_i);
    let blend = 1.0;
    if (distFromEnd < taperHalf && taperHalf > 0) {
      const u = Math.max(0, Math.min(1, distFromEnd / taperHalf));
      blend = u * u * (3 - 2 * u);
    }

    if (blend < 1e-4) {
      smoothed[i] = [points[i][0], points[i][1]];
      continue;
    }

    let jMin = i;
    while (jMin > 0 && s_i - cumDists[jMin - 1] <= windowHalf) {
      jMin--;
    }
    let jMax = i;
    while (jMax < n - 1 && cumDists[jMax + 1] - s_i <= windowHalf) {
      jMax++;
    }

    const twoSigma2 = 2 * sigma * sigma;
    let sumW = 0;
    let sumX = 0;
    let sumY = 0;

    for (let j = jMin; j <= jMax; j++) {
      const ds = cumDists[j] - s_i;
      const wt = Math.exp(-(ds * ds) / twoSigma2);
      sumW += wt;
      sumX += wt * points[j][0];
      sumY += wt * points[j][1];
    }

    const gX = sumW > 0 ? sumX / sumW : points[i][0];
    const gY = sumW > 0 ? sumY / sumW : points[i][1];

    smoothed[i] = [
      points[i][0] * (1 - blend) + gX * blend,
      points[i][1] * (1 - blend) + gY * blend,
    ];
  }

  if (hasSelfIntersection(smoothed)) {
    return points;
  }

  let uphill = 0;
  for (let i = 0; i < n - 1; i++) {
    const e1 = sampleElev(filledGrid, cols, rows, mapW, mapH, smoothed[i][0], smoothed[i][1]);
    const e2 = sampleElev(filledGrid, cols, rows, mapW, mapH, smoothed[i + 1][0], smoothed[i + 1][1]);
    if (e2 > e1 + 0.3) {
      uphill++;
    }
  }
  if (uphill > Math.max(1, (n - 1) * 0.01)) {
    return points;
  }

  return smoothed;
}

import { generateRiversAndLakes } from './src/utils/waterGenerator';

const seeds = [7, 21, 99];
for (const seed of seeds) {
  const config: GeneratorConfig = {
    seed,
    gridResolution: '1024x512',
    worldWidthKm: 40000,
    plateCount: 12,
    seaRatio: 60,
    continentCount: 4,
    continentSize: 5,
    mountainStrength: 5,
    islandDensity: 4,
    coastlineComplexity: 4,
    boundarySoftness: 5,
    polarSoftness: 5,
    minIslandArea: 1,
  };
  const world = generateTectonicWorld(1024, 512, config);
  const { rivers } = generateRiversAndLakes(
    world.elevationGrid,
    world.gridCols,
    world.gridRows,
    world.width,
    world.height,
    world.seaLevel,
    seed,
    { riverDensity: 40, meander: 0.6, headExtension: 0.8 }
  );

  const cellSize = world.width / (world.gridCols - 1);
  const wMin = 1.2;

  let totalInteriorPoints = 0;
  let pointsViolating075 = 0;
  let pointsViolating070 = 0;
  let minRatio = Infinity;
  let selfIntersections = 0;
  const sinuosities: number[] = [];

  for (const r of rivers) {
    const origPoints = r.points;
    const widths = computeRiverPointWidthsForExtraction(origPoints, r.widthStart, r.widthEnd, wMin);

    // Step 1: Limit curvature
    let pts = limitRiverCurvature(origPoints, widths, world.elevationGrid, world.gridCols, world.gridRows, world.width, world.height, 60);

    // Step 2: Gaussian smoothing
    pts = smoothRiverGaussian(pts, widths, cellSize, world.elevationGrid, world.gridCols, world.gridRows, world.width, world.height);

    // Step 3: Re-limit curvature
    pts = limitRiverCurvature(pts, widths, world.elevationGrid, world.gridCols, world.gridRows, world.width, world.height, 60);

    if (hasSelfIntersection(pts)) selfIntersections++;

    const n = pts.length;
    let totalLen = 0;
    const cumDists = [0];
    for (let i = 0; i < n - 1; i++) {
      const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      cumDists.push(cumDists[i] + d);
    }
    totalLen = cumDists[n - 1];

    if (totalLen >= 80 * cellSize) {
      const halfLen = totalLen * 0.5;
      let midIdx = 0;
      while (midIdx < n - 1 && cumDists[midIdx] < halfLen) midIdx++;
      const pMid = pts[midIdx];
      const pEnd = pts[n - 1];
      const directDist = Math.hypot(pEnd[0] - pMid[0], pEnd[1] - pMid[1]);
      const actualPath = totalLen - cumDists[midIdx];
      if (directDist > 1e-3) {
        sinuosities.push(actualPath / directDist);
      }
    }

    for (let i = 1; i < n - 1; i++) {
      totalInteriorPoints++;
      const R = computeCircumcircleRadius(pts[i - 1], pts[i], pts[i + 1]);
      const t = cumDists[i] / totalLen;
      const w = Math.max(r.widthStart + (r.widthEnd - r.widthStart) * t, 0.72);
      const ratio = R / w;
      if (ratio < minRatio) minRatio = ratio;
      if (ratio < 0.75) pointsViolating075++;
      if (ratio < 0.70) pointsViolating070++;
    }
  }

  sinuosities.sort((a, b) => a - b);
  const medianSin = sinuosities.length > 0 ? sinuosities[Math.floor(sinuosities.length / 2)] : 0;

  console.log(`AFTER FILTER - Seed ${seed}:`);
  console.log(`  Violating < 0.75*w: ${pointsViolating075} (${((pointsViolating075/totalInteriorPoints)*100).toFixed(2)}%)`);
  console.log(`  Violating < 0.70*w: ${pointsViolating070} (${((pointsViolating070/totalInteriorPoints)*100).toFixed(2)}%)`);
  console.log(`  Min R/w: ${minRatio.toFixed(3)}`);
  console.log(`  Median second-half sinuosity: ${medianSin.toFixed(2)}`);
  console.log(`  Self-intersections: ${selfIntersections}`);
}
