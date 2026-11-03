import { RegionalBounds } from '../types/map';

export interface RegionLayout {
  width: number;
  height: number;
  gridCols: number;
  gridRows: number;
}

export interface FitBoundsResult {
  bounds: RegionalBounds;
  adjusted: boolean;
}

export const MIN_ASPECT_RATIO = 1 / 8; // 0.125
export const MAX_ASPECT_RATIO = 8;     // 8.0
export const STANDARD_REGION_AREA = 2000000; // 2000 * 1000 = 2,000,000
export const MAX_GRID_DIMENSION = 4096;

/**
 * Computes non-distorted map coordinates dimensions and grid resolution
 * for a child regional map given its parent bounds and zoom scale.
 * 
 * - Aspect ratio a = boundsWidth / boundsHeight, clamped to [1/8, 8].
 * - width = sqrt(2,000,000 * a), height = sqrt(2,000,000 / a) (constant 2M area, identical to 2000x1000 at a=2).
 * - Uniform geographical scale: (width / boundsWidth) === (height / boundsHeight).
 * - Grid dimension max capped at 4096.
 */
export function computeRegionLayout(
  bounds: RegionalBounds,
  zoomScale: 4 | 16 = 4
): RegionLayout {
  const boundsW = Math.max(1e-4, bounds.maxX - bounds.minX);
  const boundsH = Math.max(1e-4, bounds.maxY - bounds.minY);

  const rawAspect = boundsW / boundsH;
  const a = Math.max(MIN_ASPECT_RATIO, Math.min(MAX_ASPECT_RATIO, rawAspect));

  const width = Math.sqrt(STANDARD_REGION_AREA * a);
  const height = Math.sqrt(STANDARD_REGION_AREA / a);

  let cellsPerUnit = zoomScale === 16 ? 1.024 : 0.512;
  const maxDim = Math.max(width, height);

  if (maxDim * cellsPerUnit > MAX_GRID_DIMENSION) {
    cellsPerUnit = MAX_GRID_DIMENSION / maxDim;
  }

  const gridCols = Math.max(2, Math.round(width * cellsPerUnit));
  const gridRows = Math.max(2, Math.round(height * cellsPerUnit));

  return {
    width,
    height,
    gridCols,
    gridRows,
  };
}

export { formatDistance } from './distanceFormat';

export interface FitBoundsOptions {
  minWidthRatio?: number;
  minAbsolute?: number;
}

/**
 * Computes non-distorted parent bounds for a compact Town Map (e.g. 100m to 5000m)
 * centered at (centerX, centerY) on the parent map, respecting the given aspect ratio
 * and staying fully contained within the parent map borders.
 */
export function computeTownBounds(
  parent: { width: number; height: number; widthKm?: number; worldWidthKm?: number },
  centerX: number,
  centerY: number,
  realWidthM: number,
  aspect: number = 4 / 3
): RegionalBounds {
  const parentWidthKm = parent.widthKm ?? parent.worldWidthKm ?? 40000;
  const safeWidthKm = Math.max(1e-4, parentWidthKm);
  const realWidthKm = realWidthM / 1000;
  // boundsW in parent coordinate space:
  const boundsW = parent.width * (realWidthKm / safeWidthKm);
  const safeAspect = Math.max(MIN_ASPECT_RATIO, Math.min(MAX_ASPECT_RATIO, aspect));
  const boundsH = boundsW / safeAspect;

  let minX = centerX - boundsW / 2;
  let maxX = centerX + boundsW / 2;
  let minY = centerY - boundsH / 2;
  let maxY = centerY + boundsH / 2;

  // If bounds exceeds parent size (unlikely for towns), uniformly scale down
  if (boundsW > parent.width || boundsH > parent.height) {
    const scaleFactor = Math.min(parent.width / boundsW, parent.height / boundsH);
    const w = boundsW * scaleFactor;
    const h = boundsH * scaleFactor;
    minX = centerX - w / 2;
    maxX = centerX + w / 2;
    minY = centerY - h / 2;
    maxY = centerY + h / 2;
  }

  // Translate into parent [0, parent.width] and [0, parent.height]
  if (minX < 0) {
    const shift = -minX;
    minX += shift;
    maxX += shift;
  } else if (maxX > parent.width) {
    const shift = maxX - parent.width;
    minX -= shift;
    maxX -= shift;
  }

  if (minY < 0) {
    const shift = -minY;
    minY += shift;
    maxY += shift;
  } else if (maxY > parent.height) {
    const shift = maxY - parent.height;
    minY -= shift;
    maxY -= shift;
  }

  minX = Math.max(0, Math.min(parent.width, minX));
  maxX = Math.max(0, Math.min(parent.width, maxX));
  minY = Math.max(0, Math.min(parent.height, minY));
  maxY = Math.max(0, Math.min(parent.height, maxY));

  return { minX, minY, maxX, maxY };
}

/**
 * Clamps and normalizes a selected bounds rectangle so that:
 * 1. Aspect ratio is within [1/8, 8] by expanding the shorter edge around its center.
 * 2. Minimum dimension is respected (default 2% of parentWidth, or custom options).
 * 3. Does not exceed parent dimensions (translates into bounds, then scales down uniformly if needed).
 */
export function fitBoundsToLimits(
  rawBounds: RegionalBounds,
  parentWidth: number,
  parentHeight: number,
  options?: FitBoundsOptions
): FitBoundsResult {
  let minX = Math.min(rawBounds.minX, rawBounds.maxX);
  let maxX = Math.max(rawBounds.minX, rawBounds.maxX);
  let minY = Math.min(rawBounds.minY, rawBounds.maxY);
  let maxY = Math.max(rawBounds.minY, rawBounds.maxY);

  let w = maxX - minX;
  let h = maxY - minY;

  let adjusted = false;

  // 1. Minimum size: default min width is 2% of parent width, height proportional
  const minRatio = options?.minWidthRatio ?? 0.02;
  const minAbsolute = options?.minAbsolute ?? 10;
  const minW = Math.max(minAbsolute, parentWidth * minRatio);
  const minH = Math.max(minAbsolute, parentHeight * minRatio);

  if (w < minW) {
    const cx = (minX + maxX) / 2;
    minX = cx - minW / 2;
    maxX = cx + minW / 2;
    w = minW;
    adjusted = true;
  }
  if (h < minH) {
    const cy = (minY + maxY) / 2;
    minY = cy - minH / 2;
    maxY = cy + minH / 2;
    h = minH;
    adjusted = true;
  }

  // 2. Aspect ratio constraints [1/8, 8]
  const currentAspect = w / h;
  if (currentAspect < MIN_ASPECT_RATIO) {
    // Too tall / narrow: expand width around center
    const targetW = h * MIN_ASPECT_RATIO;
    const cx = (minX + maxX) / 2;
    minX = cx - targetW / 2;
    maxX = cx + targetW / 2;
    w = targetW;
    adjusted = true;
  } else if (currentAspect > MAX_ASPECT_RATIO) {
    // Too wide / flat: expand height around center
    const targetH = w / MAX_ASPECT_RATIO;
    const cy = (minY + maxY) / 2;
    minY = cy - targetH / 2;
    maxY = cy + targetH / 2;
    h = targetH;
    adjusted = true;
  }

  // 3. Containment within parent boundaries
  // 3a. If box is larger than parent in any dimension, scale down uniformly
  if (w > parentWidth || h > parentHeight) {
    const scaleFactor = Math.min(parentWidth / w, parentHeight / h);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    w *= scaleFactor;
    h *= scaleFactor;
    minX = cx - w / 2;
    maxX = cx + w / 2;
    minY = cy - h / 2;
    maxY = cy + h / 2;
    adjusted = true;
  }

  // 3b. Translate into [0, parentWidth] and [0, parentHeight]
  if (minX < 0) {
    maxX += -minX;
    minX = 0;
    adjusted = true;
  } else if (maxX > parentWidth) {
    minX -= (maxX - parentWidth);
    maxX = parentWidth;
    adjusted = true;
  }

  if (minY < 0) {
    maxY += -minY;
    minY = 0;
    adjusted = true;
  } else if (maxY > parentHeight) {
    minY -= (maxY - parentHeight);
    maxY = parentHeight;
    adjusted = true;
  }

  // Final sanity clamp within parent bounds
  minX = Math.max(0, Math.min(parentWidth, minX));
  maxX = Math.max(0, Math.min(parentWidth, maxX));
  minY = Math.max(0, Math.min(parentHeight, minY));
  maxY = Math.max(0, Math.min(parentHeight, maxY));

  return {
    bounds: { minX, minY, maxX, maxY },
    adjusted,
  };
}
