import { GeneratorConfig, MapCell, MapData } from '../../types/map';
import { STANDARD_SEA_LEVEL } from '../tectonicGenerator';

export interface MaskPatch {
  minX: number;
  minY: number;
  width: number;
  height: number;
  before: Uint8Array;
  after: Uint8Array;
}

/**
 * Converts a binary land/sea mask (1 = land, 0 = sea) into an elevation grid
 * using a separable Gaussian blur so land interior is ~seaLevel+12, sea interior is ~seaLevel-12,
 * and the coast smoothly transitions across the boundary.
 */
export function maskToElevationGrid(
  mask: Uint8Array,
  width: number,
  height: number,
  seaLevel: number = STANDARD_SEA_LEVEL,
  blurRadius: number = 2.5
): Float32Array {
  const size = width * height;
  const elevationGrid = new Float32Array(size);

  if (blurRadius <= 0) {
    for (let i = 0; i < size; i++) {
      elevationGrid[i] = mask[i] === 1 ? seaLevel + 12.0 : seaLevel - 12.0;
    }
    return elevationGrid;
  }

  // Generate 1D Gaussian kernel
  const r = Math.min(Math.floor(Math.min(width, height) / 4), Math.max(1, Math.ceil(blurRadius)));
  const sigma = blurRadius * 0.55;
  const twoSigmaSq = 2.0 * sigma * sigma;
  const kernelSize = 2 * r + 1;
  const weights = new Float32Array(kernelSize);
  let weightSum = 0;

  for (let d = -r; d <= r; d++) {
    const w = Math.exp(-(d * d) / twoSigmaSq);
    weights[d + r] = w;
    weightSum += w;
  }
  for (let i = 0; i < kernelSize; i++) {
    weights[i] /= weightSum;
  }

  // Pass 1: Horizontal Gaussian blur (periodic x-wrap for planetary 360° continuity)
  const temp = new Float32Array(size);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const nx = (x + k + width * 10) % width;
        sum += mask[rowOffset + nx] * weights[k + r];
      }
      temp[rowOffset + x] = sum;
    }
  }

  // Pass 2: Vertical Gaussian blur (clamp y at north/south poles)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const ny = Math.max(0, Math.min(height - 1, y + k));
        sum += temp[ny * width + x] * weights[k + r];
      }
      const m = Math.max(0.0, Math.min(1.0, sum));
      // Lerp seaLevel - 12 to seaLevel + 12
      elevationGrid[rowOffset + x] = (seaLevel - 12.0) + m * 24.0;
    }
  }

  return elevationGrid;
}

/**
 * Flood fill connected pixels with matching value to the opposite value.
 * Returns a patch containing the before and after states for undo/redo.
 */
export function floodFillMask(
  mask: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number
): { patch: MaskPatch; updatedCount: number } | null {
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return null;

  const startIdx = sy * width + sx;
  const targetVal = mask[startIdx];
  const fillVal = targetVal === 1 ? 0 : 1;

  const queue: number[] = [startIdx];
  const visited = new Uint8Array(width * height);
  visited[startIdx] = 1;

  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;
  const filledIndices: number[] = [];

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const cx = curr % width;
    const cy = Math.floor(curr / width);

    filledIndices.push(curr);
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;

    // 4-neighbors
    const neighbors = [
      cx > 0 ? curr - 1 : -1,
      cx < width - 1 ? curr + 1 : -1,
      cy > 0 ? curr - width : -1,
      cy < height - 1 ? curr + width : -1,
    ];

    for (const n of neighbors) {
      if (n !== -1 && visited[n] === 0 && mask[n] === targetVal) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }

  if (filledIndices.length === 0) return null;

  const patchW = maxX - minX + 1;
  const patchH = maxY - minY + 1;
  const before = new Uint8Array(patchW * patchH);
  const after = new Uint8Array(patchW * patchH);

  // Copy before patch
  for (let py = 0; py < patchH; py++) {
    const srcRow = (minY + py) * width + minX;
    const patchRow = py * patchW;
    for (let px = 0; px < patchW; px++) {
      before[patchRow + px] = mask[srcRow + px];
    }
  }

  after.set(before);

  // Apply changes to mask and after patch
  for (const idx of filledIndices) {
    mask[idx] = fillVal;
    const px = (idx % width) - minX;
    const py = Math.floor(idx / width) - minY;
    after[py * patchW + px] = fillVal;
  }

  const patch: MaskPatch = {
    minX,
    minY,
    width: patchW,
    height: patchH,
    before,
    after,
  };

  return { patch, updatedCount: filledIndices.length };
}

/**
 * Apply a circular brush stroke to the mask.
 */
export function applyBrushToMask(
  mask: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  value: 0 | 1
): MaskPatch | null {
  return applyBrushStrokeToMask(mask, width, height, [[cx, cy]], radius, value);
}

/**
 * Apply a continuous stroke (list of points) to the mask with interpolation.
 */
export function applyBrushStrokeToMask(
  mask: Uint8Array,
  width: number,
  height: number,
  points: [number, number][],
  radius: number,
  value: 0 | 1
): MaskPatch | null {
  if (points.length === 0) return null;

  const rInt = Math.max(1, Math.round(radius));
  const rSq = rInt * rInt;

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  // Determine overall bounding box
  for (const [px, py] of points) {
    const x0 = Math.max(0, Math.floor(px - rInt));
    const x1 = Math.min(width - 1, Math.ceil(px + rInt));
    const y0 = Math.max(0, Math.floor(py - rInt));
    const y1 = Math.min(height - 1, Math.ceil(py + rInt));

    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
    if (y0 < minY) minY = y0;
    if (y1 > maxY) maxY = y1;
  }

  if (maxX < minX || maxY < minY) return null;

  const patchW = maxX - minX + 1;
  const patchH = maxY - minY + 1;
  const before = new Uint8Array(patchW * patchH);

  // Capture before patch
  for (let py = 0; py < patchH; py++) {
    const srcRow = (minY + py) * width + minX;
    const patchRow = py * patchW;
    for (let px = 0; px < patchW; px++) {
      before[patchRow + px] = mask[srcRow + px];
    }
  }

  let modified = false;

  // Render brush circles along path
  for (let i = 0; i < points.length; i++) {
    const [p1x, p1y] = points[i];
    const p0x = i > 0 ? points[i - 1][0] : p1x;
    const p0y = i > 0 ? points[i - 1][1] : p1y;

    const dist = Math.hypot(p1x - p0x, p1y - p0y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.4)));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const curX = p0x + (p1x - p0x) * t;
      const curY = p0y + (p1y - p0y) * t;

      const bx0 = Math.max(0, Math.floor(curX - rInt));
      const bx1 = Math.min(width - 1, Math.ceil(curX + rInt));
      const by0 = Math.max(0, Math.floor(curY - rInt));
      const by1 = Math.min(height - 1, Math.ceil(curY + rInt));

      for (let y = by0; y <= by1; y++) {
        const dy = y - curY;
        const dySq = dy * dy;
        const row = y * width;
        for (let x = bx0; x <= bx1; x++) {
          const dx = x - curX;
          if (dx * dx + dySq <= rSq) {
            const idx = row + x;
            if (mask[idx] !== value) {
              mask[idx] = value;
              modified = true;
            }
          }
        }
      }
    }
  }

  if (!modified) return null;

  // Capture after patch
  const after = new Uint8Array(patchW * patchH);
  for (let py = 0; py < patchH; py++) {
    const srcRow = (minY + py) * width + minX;
    const patchRow = py * patchW;
    for (let px = 0; px < patchW; px++) {
      after[patchRow + px] = mask[srcRow + px];
    }
  }

  return {
    minX,
    minY,
    width: patchW,
    height: patchH,
    before,
    after,
  };
}

/**
 * Fill polygon interior with target value.
 */
export function applyPolygonToMask(
  mask: Uint8Array,
  width: number,
  height: number,
  polygon: [number, number][],
  value: 0 | 1
): MaskPatch | null {
  if (polygon.length < 3) return null;

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (const [px, py] of polygon) {
    if (px < minX) minX = Math.max(0, Math.floor(px));
    if (px > maxX) maxX = Math.min(width - 1, Math.ceil(px));
    if (py < minY) minY = Math.max(0, Math.floor(py));
    if (py > maxY) maxY = Math.min(height - 1, Math.ceil(py));
  }

  if (maxX < minX || maxY < minY) return null;

  const patchW = maxX - minX + 1;
  const patchH = maxY - minY + 1;
  const before = new Uint8Array(patchW * patchH);

  for (let py = 0; py < patchH; py++) {
    const srcRow = (minY + py) * width + minX;
    const patchRow = py * patchW;
    for (let px = 0; px < patchW; px++) {
      before[patchRow + px] = mask[srcRow + px];
    }
  }

  let modified = false;

  // Point in polygon scanline fill
  const polyLen = polygon.length;
  for (let y = minY; y <= maxY; y++) {
    const scanY = y + 0.5;
    const intersections: number[] = [];

    for (let i = 0; i < polyLen; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polyLen];

      if ((p1[1] <= scanY && p2[1] > scanY) || (p2[1] <= scanY && p1[1] > scanY)) {
        const t = (scanY - p1[1]) / (p2[1] - p1[1]);
        const ix = p1[0] + t * (p2[0] - p1[0]);
        intersections.push(ix);
      }
    }

    intersections.sort((a, b) => a - b);

    for (let j = 0; j < intersections.length - 1; j += 2) {
      const xStart = Math.max(minX, Math.ceil(intersections[j]));
      const xEnd = Math.min(maxX, Math.floor(intersections[j + 1]));

      const row = y * width;
      for (let x = xStart; x <= xEnd; x++) {
        const idx = row + x;
        if (mask[idx] !== value) {
          mask[idx] = value;
          modified = true;
        }
      }
    }
  }

  if (!modified) return null;

  const after = new Uint8Array(patchW * patchH);
  for (let py = 0; py < patchH; py++) {
    const srcRow = (minY + py) * width + minX;
    const patchRow = py * patchW;
    for (let px = 0; px < patchW; px++) {
      after[patchRow + px] = mask[srcRow + px];
    }
  }

  return {
    minX,
    minY,
    width: patchW,
    height: patchH,
    before,
    after,
  };
}

/**
 * Apply an undo/redo patch to the mask.
 */
export function applyPatchToMask(
  mask: Uint8Array,
  width: number,
  patch: MaskPatch,
  direction: 'before' | 'after'
): void {
  const source = direction === 'before' ? patch.before : patch.after;
  const { minX, minY, width: patchW, height: patchH } = patch;

  for (let py = 0; py < patchH; py++) {
    const targetRow = (minY + py) * width + minX;
    const patchRow = py * patchW;
    for (let px = 0; px < patchW; px++) {
      mask[targetRow + px] = source[patchRow + px];
    }
  }
}

/**
 * Constructs a fully valid MapData object ready for the world map
 * from the confirmed segmentation mask.
 */
export function createMapDataFromMask(
  mask: Uint8Array,
  gridCols: number,
  gridRows: number,
  config: Partial<GeneratorConfig> = {},
  existingElevationGrid?: Float32Array
): MapData {
  const width = 2000;
  const height = 1000;
  const seaLevel = STANDARD_SEA_LEVEL;

  // 1. Generate smoothed elevation grid (or reuse provided high-res grid)
  const elevationGrid = existingElevationGrid || maskToElevationGrid(mask, gridCols, gridRows, seaLevel, 2.5);

  // 2. Sample cells for inspector telemetry (100x50 cells)
  const sampleCols = 100;
  const sampleRows = 50;
  const cells: MapCell[] = [];
  const sW = width / sampleCols;
  const sH = height / sampleRows;

  let cellId = 0;
  for (let sr = 0; sr < sampleRows; sr++) {
    for (let sc = 0; sc < sampleCols; sc++) {
      const cx = (sc + 0.5) * sW;
      const cy = (sr + 0.5) * sH;

      const gc = Math.round((cx / width) * (gridCols - 1));
      const gr = Math.round((cy / height) * (gridRows - 1));
      const idx = gr * gridCols + gc;

      const elev = elevationGrid[idx];
      const isWater = elev <= seaLevel;

      cells.push({
        id: cellId++,
        x: cx,
        y: cy,
        elevation: elev,
        isWater,
        isOcean: isWater,
        neighbors: [],
      });
    }
  }

  const fullConfig: GeneratorConfig = {
    seed: config.seed || Math.floor(Math.random() * 900000 + 100000),
    gridResolution: `${gridCols}x${gridRows}` as any,
    worldWidthKm: config.worldWidthKm || 40000,
    plateCount: 12,
    seaRatio: 60,
    continentCount: 3,
    continentSize: 6,
    mountainStrength: 6,
    islandDensity: 5,
    minIslandArea: 15,
    erosionIterations: 0,
    erosionStrength: 0,
    ...config,
  };

  return {
    width,
    height,
    gridCols,
    gridRows,
    cellCount: cells.length,
    seed: fullConfig.seed,
    seaLevel,
    worldWidthKm: fullConfig.worldWidthKm,
    config: fullConfig,
    createdAt: new Date().toISOString(),
    elevationGrid,
    plates: [],
    cells,
    regionalMaps: {},
    symbols: [],
  };
}
