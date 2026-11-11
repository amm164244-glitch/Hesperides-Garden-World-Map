/**
 * Topographic Water Carver
 * Carves hydrological features (rivers, lakes, and channels) into the
 * high-resolution Float32 elevation grid as authentic physical terrain (river valleys and lake basins).
 *
 * Rather than destructively plunging high mountain / plateau terrain down below sea level (seaLevel - depth),
 * this carver operates at the authentic local water surface elevation of each feature:
 * - High-altitude rivers carve a natural U-shaped fluvial valley and downhill sloping bed at their local elevation.
 * - High-altitude lakes carve an authentic bathymetric lake basin at their rim/spillway surface elevation.
 * - Coastal rivers and estuaries naturally connect below sea level where they reach the ocean.
 * - Smooth Hermite valley margins blend banks into adjacent mountain slopes and highlands without sheer cliffs.
 */

import { RiverData, LakeData } from '../types/water';
import { analyzeRiverElevation, evaluateLakeElevation } from './waterElevation';

export interface CarveWaterOptions {
  depthFactor?: number;       // Depth scale multiplier (default 1.0)
  widthFactor?: number;       // Width scale multiplier (default 1.2)
  valleyMarginCells?: number; // Smooth valley slope width in grid cells (default 3.0)
  minDepth?: number;          // Minimum channel/basin depth in meters (default 0.8)
  maxDepth?: number;          // Maximum channel/basin depth in meters (default 2.4)
  preserveHighlandElevation?: boolean; // When true (default), carves at local elevation rather than plunging to sea level
}

export interface ElevationChange {
  gridIndex: number;
  prevElevation: number;
  newElevation: number;
}

export interface CarveResult {
  changes: ElevationChange[];
  affectedBounds: {
    minC: number;
    minR: number;
    maxC: number;
    maxR: number;
  };
}

/**
 * Computes shortest distance from point (px, py) to line segment (ax, ay)-(bx, by),
 * returning the distance and projection parameter t in [0, 1].
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { distance: number; t: number; projX: number; projY: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    const d = Math.hypot(px - ax, py - ay);
    return { distance: d, t: 0, projX: ax, projY: ay };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const distance = Math.hypot(px - projX, py - projY);
  return { distance, t, projX, projY };
}

/**
 * Tests if point (px, py) is inside polygon using ray casting.
 */
export function isPointInsidePolygon(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-8) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Computes distance from point (px, py) to polygon perimeter.
 */
export function distanceToPolygonPerimeter(px: number, py: number, poly: [number, number][]): number {
  let minDist = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    const { distance } = pointToSegmentDistance(
      px,
      py,
      poly[i][0],
      poly[i][1],
      poly[nextIdx][0],
      poly[nextIdx][1]
    );
    if (distance < minDist) {
      minDist = distance;
    }
  }
  return minDist;
}

/**
 * Carves rivers and lakes into the elevation grid at their authentic local elevations
 * as natural fluvial valleys and lacustrine basins, with smooth cosine cross-sections
 * and gentle valley slopes on adjacent land.
 */
export function carveWaterIntoElevationGrid(
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
  seaLevel: number,
  rivers: RiverData[] = [],
  lakes: LakeData[] = [],
  options: CarveWaterOptions = {}
): CarveResult {
  const depthFactor = options.depthFactor ?? 1.0;
  const widthFactor = options.widthFactor ?? 1.1;
  const valleyMarginCells = options.valleyMarginCells ?? 3.5;

  const cellW = mapWidth / Math.max(1, cols - 1);
  const cellH = mapHeight / Math.max(1, rows - 1);
  const cellSize = (cellW + cellH) * 0.5;
  const valleyMargin = valleyMarginCells * cellSize;

  // We maintain best (lowest) target elevation for affected grid cells
  const targetElevMap = new Map<number, number>();

  let globalMinC = cols - 1;
  let globalMaxC = 0;
  let globalMinR = rows - 1;
  let globalMaxR = 0;

  // -------------------------------------------------------------
  // 1. Carve Rivers (河谷・河床の地形彫り込み)
  // -------------------------------------------------------------
  for (const river of rivers) {
    const pts = river.points;
    if (!pts || pts.length < 2) continue;

    const n = pts.length;
    const cumDists = new Float32Array(n);
    cumDists[0] = 0;
    for (let i = 0; i < n - 1; i++) {
      cumDists[i + 1] = cumDists[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    const totalLen = cumDists[n - 1] || 1;

    // Evaluate river elevation profile (monotonic downhill water surface)
    const profile = analyzeRiverElevation(
      river.points,
      elevationGrid,
      cols,
      rows,
      mapWidth,
      mapHeight,
      seaLevel,
      0.35,
      river.terminatesAt
    );
    const surfElevs = profile.waterSurfaceProfile;

    const wStart = river.widthStart ?? 1.5;
    const wEnd = river.widthEnd ?? 4.5;

    // Process each segment
    for (let sIdx = 0; sIdx < n - 1; sIdx++) {
      const pA = pts[sIdx];
      const pB = pts[sIdx + 1];

      const fracA = cumDists[sIdx] / totalLen;
      const fracB = cumDists[sIdx + 1] / totalLen;

      const rawWA = wStart + (wEnd - wStart) * fracA;
      const rawWB = wStart + (wEnd - wStart) * fracB;

      // Effective radius ensuring clear visibility on heightmap
      const rA = Math.max(rawWA * 0.5 * widthFactor, cellSize * 1.0);
      const rB = Math.max(rawWB * 0.5 * widthFactor, cellSize * 1.0);
      const maxR = Math.max(rA, rB);

      const searchRadius = maxR + valleyMargin;

      // Segment bounding box
      const minX = Math.min(pA[0], pB[0]) - searchRadius;
      const maxX = Math.max(pA[0], pB[0]) + searchRadius;
      const minY = Math.min(pA[1], pB[1]) - searchRadius;
      const maxY = Math.max(pA[1], pB[1]) + searchRadius;

      const minC = Math.max(0, Math.floor(minX / cellW));
      const maxC = Math.min(cols - 1, Math.ceil(maxX / cellW));
      const minR = Math.max(0, Math.floor(minY / cellH));
      const maxR_box = Math.min(rows - 1, Math.ceil(maxY / cellH));

      if (minC <= maxC && minR <= maxR_box) {
        if (minC < globalMinC) globalMinC = minC;
        if (maxC > globalMaxC) globalMaxC = maxC;
        if (minR < globalMinR) globalMinR = minR;
        if (maxR_box > globalMaxR) globalMaxR = maxR_box;
      }

      const elevA = surfElevs[sIdx];
      const elevB = surfElevs[sIdx + 1];

      for (let r = minR; r <= maxR_box; r++) {
        const gy = r * cellH;
        for (let c = minC; c <= maxC; c++) {
          const gx = c * cellW;
          const { distance, t } = pointToSegmentDistance(gx, gy, pA[0], pA[1], pB[0], pB[1]);

          const localR = rA + (rB - rA) * t;
          const localSearch = localR + valleyMargin;

          if (distance > localSearch) continue;

          const idx = r * cols + c;
          const currentElev = elevationGrid[idx];

          // 既に海抜面以下の海洋セルは、川の終端カプセルで円形ドーム状に窪ませない（海の自然な地形を保持）
          if (currentElev <= seaLevel) continue;

          // Interpolate local water surface elevation along segment
          const localSurfaceElev = elevA + (elevB - elevA) * t;

          // 自然な河床深度: 1.0m の掘り込み基準 (options.minDepth ?? 1.0m)
          // 例: 標高50mから20mへ流れる川で掘り込みが1mの場合、最大標高49m、最小標高19mの河床となる
          const nominalDepth = options.minDepth ?? 1.0;
          const channelDepth = nominalDepth * (river.carveDepthFactor ?? 1.0) * depthFactor;

          let targetElev: number;

          if (options.preserveHighlandElevation !== false) {
            // 自然な局所標高・下り勾配モード (既定):
            // 水源標高から河口標高へ向かって自然に下る水面標高 localSurfaceElev から、
            // 掘り込み深さ channelDepth 分だけ河床を彫り込む (例: 50m - 1m = 49m -> 20m - 1m = 19m)
            if (distance <= localR) {
              const u = distance / Math.max(0.001, localR);
              // 川床中央 (u = 0): localSurfaceElev - channelDepth
              // 川縁 (u = 1): localSurfaceElev
              let channelBed = (localSurfaceElev - channelDepth) + channelDepth * (u * u);

              // 海と接する場所（河口）は海抜面まで（または海抜面下へ）標高を下げて海に完全同化
              const isOceanRiver = river.terminatesAt === 'ocean' || (river.terminatesAt !== 'lake' && river.terminatesAt !== 'river');
              if (isOceanRiver && localSurfaceElev <= seaLevel + 1.0) {
                const mouthProximity = Math.max(0, Math.min(1, (seaLevel + 1.0 - localSurfaceElev) / 1.0));
                // 河口先端では川床全体（幅全体）を確実に海抜面下 (seaLevel - 0.2m以下) に沈める
                const mouthBedTarget = (seaLevel - channelDepth) + channelDepth * (u * u * 0.7) - 0.25 * mouthProximity;
                if (mouthBedTarget < channelBed) {
                  channelBed = mouthBedTarget;
                }
              }

              targetElev = channelBed;
            } else {
              // 岸辺・河谷の斜面: 川縁 (localSurfaceElev) から周囲の地形へ滑らかに立ち上げ
              const v = (distance - localR) / Math.max(0.001, valleyMargin);
              const w = v * v * (3 - 2 * v); // smoothstep
              const bankElev = localSurfaceElev;
              if (currentElev > bankElev) {
                targetElev = bankElev + (currentElev - bankElev) * w;
              } else {
                targetElev = currentElev;
              }
            }
          } else {
            // 海面下強制モード (preserveHighlandElevation: false が明示された場合のみ)
            const riverWaterDepth = (0.16 + Math.min(0.20, (localR / cellSize) * 0.08)) * depthFactor;
            if (distance <= localR) {
              const u = distance / Math.max(0.001, localR);
              const edgeDepth = 0.02 * depthFactor;
              const channelBed = (seaLevel - riverWaterDepth) + (riverWaterDepth - edgeDepth) * (u * u);
              targetElev = channelBed;
            } else {
              const v = (distance - localR) / Math.max(0.001, valleyMargin);
              const w = v * v * (3 - 2 * v);
              const bankElev = seaLevel + 0.04;
              if (currentElev > bankElev) {
                targetElev = bankElev + (currentElev - bankElev) * w;
              } else {
                targetElev = currentElev;
              }
            }
          }

          const existing = targetElevMap.get(idx);
          if (existing === undefined || targetElev < existing) {
            targetElevMap.set(idx, targetElev);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 2. Carve Lakes (湖盆・湖底の地形彫り込み)
  // -------------------------------------------------------------
  for (const lake of lakes) {
    const poly = lake.polygon;
    if (!poly || poly.length < 3) continue;

    // Lake bounding box
    let lMinX = Infinity;
    let lMaxX = -Infinity;
    let lMinY = Infinity;
    let lMaxY = -Infinity;
    for (const p of poly) {
      if (p[0] < lMinX) lMinX = p[0];
      if (p[0] > lMaxX) lMaxX = p[0];
      if (p[1] < lMinY) lMinY = p[1];
      if (p[1] > lMaxY) lMaxY = p[1];
    }

    const lakeW = lMaxX - lMinX;
    const lakeH = lMaxY - lMinY;
    const lakeRadius = Math.max(cellSize * 2, Math.hypot(lakeW, lakeH) * 0.25);
    const lakeValleyMargin = Math.max(valleyMargin, lakeRadius * 0.4);

    const minC = Math.max(0, Math.floor((lMinX - lakeValleyMargin) / cellW));
    const maxC = Math.min(cols - 1, Math.ceil((lMaxX + lakeValleyMargin) / cellW));
    const minR = Math.max(0, Math.floor((lMinY - lakeValleyMargin) / cellH));
    const maxR_box = Math.min(rows - 1, Math.ceil((lMaxY + lakeValleyMargin) / cellH));

    if (minC <= maxC && minR <= maxR_box) {
      if (minC < globalMinC) globalMinC = minC;
      if (maxC > globalMaxC) globalMaxC = maxC;
      if (minR < globalMinR) globalMinR = minR;
      if (maxR_box > globalMaxR) globalMaxR = maxR_box;
    }

    // Evaluate lake surface elevation and natural depth
    const lakeEval = evaluateLakeElevation(
      lake.polygon,
      elevationGrid,
      cols,
      rows,
      mapWidth,
      mapHeight,
      seaLevel
    );
    const surfaceElev = lake.elevation ?? lakeEval.surfaceElevation;
    const baseLakeDepth = lake.depth ?? Math.min(8.0, Math.max(1.8, (options.minDepth ?? 2.0) + Math.min(6.0, lakeRadius * 0.3)));
    const lakeDepth = baseLakeDepth * depthFactor;

    const innerBankMargin = Math.max(cellSize * 1.5, Math.min(14.0, lakeRadius * 0.35));

    for (let r = minR; r <= maxR_box; r++) {
      const gy = r * cellH;
      for (let c = minC; c <= maxC; c++) {
        const gx = c * cellW;
        const inside = isPointInsidePolygon(gx, gy, poly);
        const distToEdge = distanceToPolygonPerimeter(gx, gy, poly);

        const idx = r * cols + c;
        const currentElev = elevationGrid[idx];

        let targetElev: number;

        if (options.preserveHighlandElevation !== false) {
          // 自然な局所標高モード (推奨・既定):
          const effectiveLakeDepth = Math.min(2.5, Math.max(0.6, (options.minDepth ?? 0.8) + Math.min(1.5, lakeRadius * 0.08))) * depthFactor;
          if (inside) {
            if (distToEdge >= innerBankMargin) {
              targetElev = surfaceElev - effectiveLakeDepth;
            } else {
              const u = distToEdge / innerBankMargin;
              targetElev = surfaceElev - effectiveLakeDepth * 0.5 * (1 - Math.cos(Math.PI * u));
            }
          } else {
            if (distToEdge <= lakeValleyMargin) {
              const v = distToEdge / lakeValleyMargin;
              const w = v * v * (3 - 2 * v);
              const bankElev = surfaceElev;
              if (currentElev > bankElev) {
                targetElev = bankElev + (currentElev - bankElev) * w;
              } else {
                targetElev = currentElev;
              }
            } else {
              continue;
            }
          }
        } else {
          // 海面下強制モード (preserveHighlandElevation: false)
          const effectiveLakeDepth = Math.max(2.0, Math.min(6.0, lakeDepth));
          if (inside) {
            if (distToEdge >= innerBankMargin) {
              targetElev = seaLevel - effectiveLakeDepth;
            } else {
              const u = distToEdge / innerBankMargin;
              targetElev = seaLevel - 0.15 - (effectiveLakeDepth - 0.15) * 0.5 * (1 - Math.cos(Math.PI * u));
            }
          } else {
            if (distToEdge <= lakeValleyMargin) {
              const v = distToEdge / lakeValleyMargin;
              const w = v * v * (3 - 2 * v);
              const bankElev = seaLevel + 0.15;
              if (currentElev > bankElev) {
                targetElev = bankElev + (currentElev - bankElev) * w;
              } else {
                targetElev = currentElev;
              }
            } else {
              continue;
            }
          }
        }

        const existing = targetElevMap.get(idx);
        if (existing === undefined || targetElev < existing) {
          targetElevMap.set(idx, targetElev);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 3. Apply target elevations and collect delta history changes
  // -------------------------------------------------------------
  const changes: ElevationChange[] = [];

  for (const [idx, target] of targetElevMap.entries()) {
    const prevElevation = elevationGrid[idx];
    // Only lower terrain down towards target fluvial/lacustrine bed; never push down if already deeper water/depression
    if (target < prevElevation - 0.005) {
      elevationGrid[idx] = target;
      changes.push({
        gridIndex: idx,
        prevElevation,
        newElevation: target,
      });
    }
  }

  const affectedBounds = {
    minC: Math.max(0, globalMinC),
    minR: Math.max(0, globalMinR),
    maxC: Math.min(cols - 1, globalMaxC),
    maxR: Math.min(rows - 1, globalMaxR),
  };

  return { changes, affectedBounds };
}
