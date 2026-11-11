/**
 * Water Grid Rasterizer
 * Converts vector rivers and lake polygons into a high-performance R8 texture grid (0..255)
 * for the WebGL map renderer, enabling water to exist at ANY elevation on the planet.
 */

import { RiverData, LakeData } from '../types/water';
import { pointToSegmentDistance, isPointInsidePolygon, distanceToPolygonPerimeter } from './terrainCarver';

/**
 * Builds an 8-bit water mask grid (cols * rows).
 * Values:
 *   0: Land
 *   1..254: Water edge / bank antialiasing
 *   255: Core water body (river channel / lake surface)
 */
export function buildWaterGrid(
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
  rivers: RiverData[],
  lakes: LakeData[],
  elevationGrid?: Float32Array,
  seaLevel?: number
): Uint8Array {
  const totalCells = cols * rows;
  const grid = new Uint8Array(totalCells);

  if ((!rivers || rivers.length === 0) && (!lakes || lakes.length === 0)) {
    return grid;
  }

  const cellW = mapWidth / Math.max(1, cols);
  const cellH = mapHeight / Math.max(1, rows);
  const avgCell = (cellW + cellH) * 0.5;

  // 1. Rasterize Lakes
  if (lakes && lakes.length > 0) {
    for (const lake of lakes) {
      const poly = lake.polygon;
      if (!poly || poly.length < 3) continue;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const x = poly[i][0];
        const y = poly[i][1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const minC = Math.max(0, Math.floor((minX - cellW * 2) / cellW));
      const maxC = Math.min(cols - 1, Math.ceil((maxX + cellW * 2) / cellW));
      const minR = Math.max(0, Math.floor((minY - cellH * 2) / cellH));
      const maxR = Math.min(rows - 1, Math.ceil((maxY + cellH * 2) / cellH));

      for (let r = minR; r <= maxR; r++) {
        const gy = (r + 0.5) * cellH;
        const rowOffset = r * cols;
        for (let c = minC; c <= maxC; c++) {
          const gx = (c + 0.5) * cellW;
          const inside = isPointInsidePolygon(gx, gy, poly);
          const idx = rowOffset + c;

          if (inside) {
            grid[idx] = 255;
          } else {
            // Anti-aliasing around lake perimeter
            const dist = distanceToPolygonPerimeter(gx, gy, poly);
            if (dist < avgCell) {
              const alpha = Math.max(0, Math.min(1, 1.0 - dist / avgCell));
              const val = Math.round(alpha * 200);
              if (val > grid[idx]) grid[idx] = val;
            }
          }
        }
      }
    }
  }

  // 2. Rasterize Rivers
  if (rivers && rivers.length > 0) {
    for (const river of rivers) {
      const pts = river.points;
      if (!pts || pts.length < 2) continue;

      const numSegments = pts.length - 1;
      const wStart = river.widthStart ?? 1.5;
      const wEnd = river.widthEnd ?? 4.5;

      for (let sIdx = 0; sIdx < numSegments; sIdx++) {
        const pA = pts[sIdx];
        const pB = pts[sIdx + 1];

        const fracA = sIdx / numSegments;
        const fracB = (sIdx + 1) / numSegments;
        const rawWA = wStart + (wEnd - wStart) * fracA;
        const rawWB = wStart + (wEnd - wStart) * fracB;

        // Half width in world coordinates, ensuring at least ~0.8 cell radius for visibility
        const rA = Math.max(rawWA * 0.5, avgCell * 0.75);
        const rB = Math.max(rawWB * 0.5, avgCell * 0.75);
        const maxR = Math.max(rA, rB);
        const searchMargin = maxR + avgCell;

        const minX = Math.min(pA[0], pB[0]) - searchMargin;
        const maxX = Math.max(pA[0], pB[0]) + searchMargin;
        const minY = Math.min(pA[1], pB[1]) - searchMargin;
        const maxY = Math.max(pA[1], pB[1]) + searchMargin;

        const minC = Math.max(0, Math.floor(minX / cellW));
        const maxC = Math.min(cols - 1, Math.ceil(maxX / cellW));
        const minR = Math.max(0, Math.floor(minY / cellH));
        const maxR_box = Math.min(rows - 1, Math.ceil(maxY / cellH));

        for (let r = minR; r <= maxR_box; r++) {
          const gy = (r + 0.5) * cellH;
          const rowOffset = r * cols;
          for (let c = minC; c <= maxC; c++) {
            const gx = (c + 0.5) * cellW;
            const { distance, t } = pointToSegmentDistance(gx, gy, pA[0], pA[1], pB[0], pB[1]);
            const localR = rA + (rB - rA) * t;

            const idx = rowOffset + c;
            if (distance <= localR) {
              grid[idx] = 255;
            } else if (distance < localR + avgCell) {
              // Antialiased edge
              const edgeDist = distance - localR;
              const alpha = Math.max(0, Math.min(1, 1.0 - edgeDist / avgCell));
              const val = Math.round(alpha * 220);
              if (val > grid[idx]) {
                grid[idx] = val;
              }
            }
          }
        }
      }
    }
  }

  return grid;
}
