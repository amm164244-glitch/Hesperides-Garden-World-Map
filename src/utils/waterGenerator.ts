/**
 * Procedural Hydrological Water Generator (Rivers & Lakes)
 * Driven by rigorous topographic hydrology (Priority-Flood + epsilon, flow accumulation)
 * guaranteeing strictly downhill rivers that never terminate inland, and natural lake footprints.
 */

import { RiverData, LakeData } from '../types/water';
import { Mulberry32, Noise2D } from './prng';
import { computeHydrology, downsampleForHydrology } from './hydrology';
import { extractLakes, FANTASY_LAKE_NAMES } from './lakeExtraction';
import { extractRivers, FANTASY_RIVER_NAMES } from './riverExtraction';

export { FANTASY_RIVER_NAMES, FANTASY_LAKE_NAMES };

export interface WaterGenStats {
  riverCount: number;
  lakeCount: number;
  totalRiverLength?: number;
  longestRiverKm?: number;
  avgRiverLengthKm?: number;
  computationTimeMs?: number;
}

export interface WaterGenOptions {
  riverCount?: number;
  lakeCount?: number;
  enableRivers?: boolean;
  enableLakes?: boolean;
  worldWidthKm?: number;
  riverDensity?: number; // 0 ~ 100, default 40
  meander?: number;      // 0 ~ 1.0 (or 0 ~ 100%), default 0.6
  headExtension?: number;// 0 ~ 1.0 (or 0 ~ 100%), default 0.8
  onProgress?: (percent: number, message: string) => void;
}

/**
 * Bilinear elevation sample from Float32Array grid.
 */
export function sampleElev(
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  x: number,
  y: number
): number {
  const gx = (x / mapW) * (cols - 1);
  const gy = (y / mapH) * (rows - 1);
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, gx - c0));
  const ty = Math.max(0, Math.min(1, gy - r0));

  const e00 = grid[r0 * cols + c0];
  const e10 = grid[r0 * cols + c1];
  const e01 = grid[r1 * cols + c0];
  const e11 = grid[r1 * cols + c1];

  const top = e00 * (1 - tx) + e10 * tx;
  const bot = e01 * (1 - tx) + e11 * tx;
  return top * (1 - ty) + bot * ty;
}

/**
 * Computes elevation gradient vector (dE/dx, dE/dy) using central differences.
 */
export function sampleGradient(
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  x: number,
  y: number
): { gx: number; gy: number } {
  const stepX = Math.max(1, mapW / cols);
  const stepY = Math.max(1, mapH / rows);

  const eLeft = sampleElev(grid, cols, rows, mapW, mapH, x - stepX, y);
  const eRight = sampleElev(grid, cols, rows, mapW, mapH, x + stepX, y);
  const eTop = sampleElev(grid, cols, rows, mapW, mapH, x, y - stepY);
  const eBottom = sampleElev(grid, cols, rows, mapW, mapH, x, y + stepY);

  return {
    gx: (eRight - eLeft) / (2 * stepX),
    gy: (eBottom - eTop) / (2 * stepY),
  };
}

/**
 * Creates an organic closed lake polygon deformed by multi-octave noise.
 * Retained for backward-compatibility with manual editing tools and tests.
 */
export function createOrganicLake(
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  numPoints: number = 24
): [number, number][] {
  const noise = new Noise2D(seed);
  const rng = new Mulberry32(seed + 314);
  const poly: [number, number][] = [];

  const valleyAngle = rng.next() * Math.PI;
  const elongation = 1.15 + rng.next() * 0.35;
  const cosV = Math.cos(valleyAngle);
  const sinV = Math.sin(valleyAngle);

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);

    const warp1 = noise.sample(nx * 1.5 + 12.3, ny * 1.5 + 45.6) * 0.22;
    const warp2 = noise.sample(nx * 3.2 + 78.9, ny * 3.2 + 23.4) * 0.09;
    const r = radius * (1.0 + warp1 + warp2);

    const alongValley = nx * cosV + ny * sinV;
    const acrossValley = -nx * sinV + ny * cosV;
    const shapeScale = Math.hypot(alongValley * elongation, acrossValley / elongation);
    const clampedR = Math.min(radius * 1.22, r * shapeScale);

    poly.push([cx + nx * clampedR, cy + ny * clampedR]);
  }

  return smoothPolygonCatmullRom(poly, 2);
}

/**
 * Centripetal Catmull-Rom spline interpolation for closed polygon.
 */
function smoothPolygonCatmullRom(poly: [number, number][], subdivisions: number = 2): [number, number][] {
  const n = poly.length;
  if (n < 3) return poly;

  const result: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const p3 = poly[(i + 2) % n];

    for (let s = 0; s < subdivisions; s++) {
      const t = s / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

      result.push([x, y]);
    }
  }

  return result;
}

/**
 * Checks if a point [px, py] is inside a polygon using ray casting.
 */
export function pointInLake(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Catmull-Rom smoothing for open polyline (river path).
 */
export function smoothRiverPath(points: [number, number][], subdivisions: number = 2): [number, number][] {
  const n = points.length;
  if (n < 3) return points;

  const result: [number, number][] = [];
  result.push(points[0]);

  for (let i = 0; i < n - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < n ? points[i + 2] : points[i + 1];

    for (let s = 1; s <= subdivisions; s++) {
      const t = s / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

      result.push([x, y]);
    }
  }

  return result;
}

/**
 * Main Procedural River & Lake Generator based on Topographic Hydrology.
 * Implements Priority-Flood (Barnes 2014) depression filling, reverse-order
 * topological flow accumulation, depression lake extraction, and downhill river tracing.
 */
export function generateRiversAndLakes(
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
  seaLevel: number,
  seed: number,
  options: WaterGenOptions = {}
): { rivers: RiverData[]; lakes: LakeData[]; stats: WaterGenStats } {
  const startTime = performance.now();
  const enableRivers = options.enableRivers ?? true;
  const enableLakes = options.enableLakes ?? true;
  const targetRiverCount = options.riverCount ?? 14;
  const targetLakeCount = options.lakeCount ?? 6;
  const worldWidthKm = options.worldWidthKm || 40000;
  const riverDensity = options.riverDensity ?? 40;
  const meander = options.meander ?? 0.6;
  const headExtension = typeof options.headExtension === 'number'
    ? Math.max(0, Math.min(1, options.headExtension > 1 ? options.headExtension / 100 : options.headExtension))
    : 0.8;
  const onProgress = options.onProgress;

  if (!enableRivers && !enableLakes) {
    return {
      rivers: [],
      lakes: [],
      stats: { riverCount: 0, lakeCount: 0, computationTimeMs: 0 },
    };
  }

  onProgress?.(15, '水文解析中 (Priority-Flood 窪地充填)...');

  // Handle large resolution grids by downsampling if needed
  const { grid: hydroGrid, cols: hCols, rows: hRows } = downsampleForHydrology(
    elevationGrid,
    cols,
    rows,
    2048 * 1024
  );

  // 1. Hydrology: depression filling, receivers, flow accumulation
  const hydro = computeHydrology(hydroGrid, hCols, hRows, seaLevel, { seed });

  // 2. Lake Extraction
  let lakes: LakeData[] = [];
  if (enableLakes && targetLakeCount > 0) {
    onProgress?.(50, '地形窪地から湖を抽出中...');
    lakes = extractLakes(hydro, hydroGrid, {
      cols: hCols,
      rows: hRows,
      mapWidth,
      mapHeight,
      seaLevel,
      seed,
      lakeCount: targetLakeCount,
    });
  }

  // 3. River Extraction
  let rivers: RiverData[] = [];
  if (enableRivers && targetRiverCount > 0) {
    onProgress?.(80, '水流蓄積から河川網を抽出中...');
    rivers = extractRivers(hydro, hydroGrid, lakes, {
      cols: hCols,
      rows: hRows,
      mapWidth,
      mapHeight,
      seaLevel,
      seed,
      worldWidthKm,
      riverDensity,
      meander,
      headExtension,
      maxMainRivers: targetRiverCount,
    });
  }

  onProgress?.(100, '水系生成完了！');

  const elapsed = performance.now() - startTime;
  const kmPerUnit = Math.max(0.001, worldWidthKm / mapWidth);
  let totalRiverLength = 0;
  let maxRiverLength = 0;
  for (const r of rivers) {
    let rLen = 0;
    for (let i = 0; i < r.points.length - 1; i++) {
      rLen += Math.hypot(
        r.points[i + 1][0] - r.points[i][0],
        r.points[i + 1][1] - r.points[i][1]
      );
    }
    totalRiverLength += rLen;
    if (rLen > maxRiverLength) {
      maxRiverLength = rLen;
    }
  }

  const avgRiverLength = rivers.length > 0 ? totalRiverLength / rivers.length : 0;

  return {
    rivers,
    lakes,
    stats: {
      riverCount: rivers.length,
      lakeCount: lakes.length,
      totalRiverLength: Math.round(totalRiverLength),
      longestRiverKm: Number((maxRiverLength * kmPerUnit).toFixed(1)),
      avgRiverLengthKm: Number((avgRiverLength * kmPerUnit).toFixed(1)),
      computationTimeMs: Math.round(elapsed),
    },
  };
}
