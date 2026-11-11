/**
 * Topographic Water Carver
 * Carves hydrological features (rivers, lakes, and channels) directly into the
 * high-resolution Float32 elevation grid below sea level, converting vector water
 * bodies into authentic physical terrain.
 *
 * WebGL Map Shader seamlessly renders carved water channels with:
 * - Rich deep ocean teal in channel centers
 * - Luminous turquoise shallows (#7bc5c5) along water edges
 * - Crisp ink coastline borders (#1e1a14) at water level
 * - Warm antique sandy beach ribbon (#d9c9a6) on land banks
 * - Smooth valley slopes preventing unnatural cliffs
 */

import { RiverData, LakeData } from '../types/water';

export interface CarveWaterOptions {
  depthFactor?: number;       // Depth scale multiplier (default 1.0)
  widthFactor?: number;       // Width scale multiplier (default 1.2)
  valleyMarginCells?: number; // Smooth valley slope width in grid cells (default 3.0)
  minDepth?: number;          // Minimum center depth below seaLevel (default 10.0)
  maxDepth?: number;          // Maximum center depth below seaLevel (default 22.0)
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
 * Carves rivers and lakes into the elevation grid below sea level with smooth cosine cross-sections
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
  const widthFactor = options.widthFactor ?? 1.2;
  const valleyMarginCells = options.valleyMarginCells ?? 3.0;

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
  // 1. Carve Rivers
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
      const rA = Math.max(rawWA * 0.5 * widthFactor, cellSize * 1.15);
      const rB = Math.max(rawWB * 0.5 * widthFactor, cellSize * 1.15);
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

          // Center channel depth: between 11.0 and 22.0 units below seaLevel
          const baseDepth = (options.minDepth ?? 11.0) +
            ((options.maxDepth ?? 21.0) - (options.minDepth ?? 11.0)) *
            Math.min(1.0, localR / (cellSize * 3.5));
          const depth = baseDepth * depthFactor;

          let targetElev: number;

          if (distance <= localR) {
            // Inside River Channel: Smooth cosine channel cross-section
            // At center (distance = 0): elev = seaLevel - depth
            // At banks (distance = localR): elev = seaLevel - 0.45 (just under seaLevel)
            const u = distance / Math.max(0.001, localR);
            const channelBed = seaLevel - 0.45 - (depth - 0.45) * 0.5 * (1 + Math.cos(Math.PI * u));
            targetElev = channelBed;
          } else {
            // In Valley Margin on Land: Smooth Hermite transition connecting bank to surrounding terrain
            const v = (distance - localR) / Math.max(0.001, valleyMargin);
            const w = v * v * (3 - 2 * v); // smoothstep
            const bankElev = seaLevel + 0.35; // Bank lip slightly above water
            if (currentElev > bankElev) {
              targetElev = bankElev + (currentElev - bankElev) * w;
            } else {
              targetElev = currentElev;
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
  // 2. Carve Lakes
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

    const lakeDepth = ((options.minDepth ?? 12.0) +
      Math.min(9.0, lakeRadius * 0.35)) * depthFactor;
    const innerBankMargin = Math.max(cellSize * 1.5, Math.min(14.0, lakeRadius * 0.45));

    for (let r = minR; r <= maxR_box; r++) {
      const gy = r * cellH;
      for (let c = minC; c <= maxC; c++) {
        const gx = c * cellW;
        const inside = isPointInsidePolygon(gx, gy, poly);
        const distToEdge = distanceToPolygonPerimeter(gx, gy, poly);

        const idx = r * cols + c;
        const currentElev = elevationGrid[idx];

        let targetElev: number;

        if (inside) {
          // Inside lake: depth increases towards center
          if (distToEdge >= innerBankMargin) {
            targetElev = seaLevel - lakeDepth;
          } else {
            const u = distToEdge / innerBankMargin;
            targetElev = seaLevel - 0.45 - (lakeDepth - 0.45) * 0.5 * (1 - Math.cos(Math.PI * u));
          }
        } else {
          // Outside lake: valley transition to surrounding land
          if (distToEdge <= lakeValleyMargin) {
            const v = distToEdge / lakeValleyMargin;
            const w = v * v * (3 - 2 * v);
            const bankElev = seaLevel + 0.35;
            if (currentElev > bankElev) {
              targetElev = bankElev + (currentElev - bankElev) * w;
            } else {
              targetElev = currentElev;
            }
          } else {
            continue;
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
    // Only lower land down towards target; never push down if already deeper water
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
