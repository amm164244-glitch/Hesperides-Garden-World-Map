import { STANDARD_SEA_LEVEL } from '../tectonicGenerator';
import { maskToElevationGrid } from './maskEditor';

export interface UpsampleOptions {
  blurRadius?: number; // Base blur radius at source resolution (default: 2.5)
  seaLevel?: number; // Sea level threshold (default: STANDARD_SEA_LEVEL = 18.0)
  onProgress?: (percent: number, step: string) => void;
}

/**
 * 1D running-sum box blur along rows (horizontal) with periodic x-wrapping.
 * Runs in O(width * height) time independent of radius r.
 * Periodic wrapping provides 360-degree planetary continuity across the dateline.
 */
export function boxBlurHorizontalWrap(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number
): void {
  if (radius <= 0) {
    dst.set(src);
    return;
  }

  const r = Math.min(radius, Math.floor(width / 2) - 1);
  const windowSize = 2 * r + 1;
  const invWindow = 1.0 / windowSize;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let sum = 0;

    // Initialize running sum for x = 0 (from -r to r with periodic wrap)
    for (let k = -r; k <= r; k++) {
      const nx = ((k % width) + width) % width;
      sum += src[rowOffset + nx];
    }
    dst[rowOffset] = sum * invWindow;

    // Slide window across row
    for (let x = 1; x < width; x++) {
      const addX = (x + r) % width;
      const subX = (x - r - 1 + width) % width;
      sum += src[rowOffset + addX] - src[rowOffset + subX];
      dst[rowOffset + x] = sum * invWindow;
    }
  }
}

/**
 * 1D running-sum box blur along columns (vertical) with clamping at north/south poles.
 * Runs in O(width * height) time independent of radius r.
 */
export function boxBlurVerticalClamp(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number
): void {
  if (radius <= 0) {
    dst.set(src);
    return;
  }

  const r = Math.min(radius, Math.floor(height / 2) - 1);
  const windowSize = 2 * r + 1;
  const invWindow = 1.0 / windowSize;

  for (let x = 0; x < width; x++) {
    let sum = 0;

    // Initialize running sum for y = 0 (from -r to r clamped at borders)
    for (let k = -r; k <= r; k++) {
      const ny = Math.max(0, Math.min(height - 1, k));
      sum += src[ny * width + x];
    }
    dst[x] = sum * invWindow;

    // Slide window down column
    for (let y = 1; y < height; y++) {
      const addY = Math.max(0, Math.min(height - 1, y + r));
      const subY = Math.max(0, Math.min(height - 1, y - r - 1));
      sum += src[addY * width + x] - src[subY * width + x];
      dst[y * width + x] = sum * invWindow;
    }
  }
}

/**
 * Bilinearly upsamples a mask/grid from (srcWidth x srcHeight)
 * to (dstWidth x dstHeight) with periodic x-wrapping and clamped y poles.
 */
export function bilinearUpsample(
  srcMask: Uint8Array | Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  outGrid: Float32Array,
  onRowProgress?: (ratio: number) => void
): void {
  const scaleX = srcWidth / dstWidth;
  const scaleY = srcHeight / dstHeight;
  const reportStep = Math.max(1, Math.floor(dstHeight / 20));

  for (let dy = 0; dy < dstHeight; dy++) {
    if (onRowProgress && dy % reportStep === 0) {
      onRowProgress(dy / dstHeight);
    }

    const sy = (dy + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.min(srcHeight - 1, Math.floor(sy)));
    const y1 = Math.max(0, Math.min(srcHeight - 1, y0 + 1));
    const fy = Math.max(0, Math.min(1, sy - y0));

    const row0 = y0 * srcWidth;
    const row1 = y1 * srcWidth;
    const dstRow = dy * dstWidth;

    for (let dx = 0; dx < dstWidth; dx++) {
      const sx = (dx + 0.5) * scaleX - 0.5;
      const baseFloorX = Math.floor(sx);
      const x0 = ((baseFloorX % srcWidth) + srcWidth) % srcWidth;
      const x1 = (x0 + 1) % srcWidth;
      const fx = Math.max(0, Math.min(1, sx - baseFloorX));

      const v00 = srcMask[row0 + x0];
      const v10 = srcMask[row0 + x1];
      const v01 = srcMask[row1 + x0];
      const v11 = srcMask[row1 + x1];

      const top = v00 * (1 - fx) + v10 * fx;
      const btm = v01 * (1 - fx) + v11 * fx;
      const val = top * (1 - fy) + btm * fy;
      outGrid[dstRow + dx] = Math.max(0, Math.min(1, val));
    }
  }
}

/**
 * Builds a smooth elevation grid at (dstWidth x dstHeight) from an analysis mask at (srcWidth x srcHeight).
 *
 * Method:
 * 1. If dst === src, skip upsampling and produce the exact same result as legacy maskToElevationGrid.
 * 2. Blur source mask in source resolution (using separable Gaussian blur).
 * 3. Bilinear upsample into dst-sized elevationGrid.
 * 4. Apply 3 passes of running-sum box blur at destination resolution with radius scaled proportionally.
 * 5. Lerp continuous [0, 1] values to elevation: elevation = (seaLevel - 12) + m * 24.
 *
 * Memory optimization:
 * Only allocates elevationGrid (output) and a single temporary buffer at destination resolution.
 * Never keeps 3 or more destination-sized arrays alive concurrently.
 */
export function buildElevationFromMask(
  sourceMask: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  seaLevel: number = STANDARD_SEA_LEVEL,
  options: UpsampleOptions = {}
): Float32Array {
  const onProgress = options.onProgress;
  const baseRadius = options.blurRadius ?? 2.5;

  // Step 1: If source and destination resolutions are identical, use direct blur to ensure 100% equivalence
  if (srcWidth === dstWidth && srcHeight === dstHeight) {
    onProgress?.(10, '標高を作成中...');
    const result = maskToElevationGrid(sourceMask, srcWidth, srcHeight, seaLevel, baseRadius);
    onProgress?.(100, '標高を作成完了');
    return result;
  }

  // Step 2: Blur at source resolution
  onProgress?.(5, 'マスクを平滑化中...');
  const srcSize = srcWidth * srcHeight;
  let srcFloat: Float32Array | null = new Float32Array(srcSize);
  let srcTemp: Float32Array | null = new Float32Array(srcSize);

  // Gaussian weights for source blur
  const rSrc = Math.min(Math.floor(Math.min(srcWidth, srcHeight) / 4), Math.max(1, Math.ceil(baseRadius)));
  const sigmaSrc = baseRadius * 0.55;
  const twoSigmaSq = 2.0 * sigmaSrc * sigmaSrc;
  const kSize = 2 * rSrc + 1;
  const weights = new Float32Array(kSize);
  let weightSum = 0;
  for (let d = -rSrc; d <= rSrc; d++) {
    const w = Math.exp(-(d * d) / twoSigmaSq);
    weights[d + rSrc] = w;
    weightSum += w;
  }
  for (let i = 0; i < kSize; i++) {
    weights[i] /= weightSum;
  }

  // Horizontal blur on source
  for (let y = 0; y < srcHeight; y++) {
    const rowOffset = y * srcWidth;
    for (let x = 0; x < srcWidth; x++) {
      let sum = 0;
      for (let k = -rSrc; k <= rSrc; k++) {
        const nx = ((x + k) % srcWidth + srcWidth) % srcWidth;
        sum += sourceMask[rowOffset + nx] * weights[k + rSrc];
      }
      srcTemp[rowOffset + x] = sum;
    }
  }

  // Vertical blur on source
  for (let x = 0; x < srcWidth; x++) {
    for (let y = 0; y < srcHeight; y++) {
      let sum = 0;
      for (let k = -rSrc; k <= rSrc; k++) {
        const ny = Math.max(0, Math.min(srcHeight - 1, y + k));
        sum += srcTemp[ny * srcWidth + x] * weights[k + rSrc];
      }
      srcFloat[y * srcWidth + x] = Math.max(0, Math.min(1, sum));
    }
  }
  // Free temporary source buffer
  srcTemp = null;

  // Step 3: Bilinear upsample into destination grid (Array #1 of dstSize)
  onProgress?.(25, 'マスクを拡大中');
  const dstSize = dstWidth * dstHeight;
  const elevationGrid = new Float32Array(dstSize);

  bilinearUpsample(srcFloat, srcWidth, srcHeight, dstWidth, dstHeight, elevationGrid, (ratio) => {
    onProgress?.(Math.round(25 + ratio * 20), 'マスクを拡大中');
  });

  // Free source float array now that upsample is complete
  srcFloat = null;

  // Step 4: 3-pass running-sum box blur on destination resolution (Array #2 of dstSize)
  onProgress?.(50, 'ぼかし中');
  const scale = dstWidth / srcWidth;
  // Box blur radius proportional to scale to keep coastal transition identical across zoom levels
  const rDst = Math.max(1, Math.round(baseRadius * scale * 0.55));

  let temp: Float32Array | null = new Float32Array(dstSize);

  // Pass 1
  boxBlurHorizontalWrap(elevationGrid, temp, dstWidth, dstHeight, rDst);
  boxBlurVerticalClamp(temp, elevationGrid, dstWidth, dstHeight, rDst);

  onProgress?.(65, 'ぼかし中');

  // Pass 2
  boxBlurHorizontalWrap(elevationGrid, temp, dstWidth, dstHeight, rDst);
  boxBlurVerticalClamp(temp, elevationGrid, dstWidth, dstHeight, rDst);

  onProgress?.(80, 'ぼかし中');

  // Pass 3
  boxBlurHorizontalWrap(elevationGrid, temp, dstWidth, dstHeight, rDst);
  boxBlurVerticalClamp(temp, elevationGrid, dstWidth, dstHeight, rDst);

  // Free temporary destination buffer immediately
  temp = null;

  // Step 5: Map continuous values to elevation [seaLevel - 12, seaLevel + 12]
  onProgress?.(92, '標高を作成中');
  const minElev = seaLevel - 12.0;
  const range = 24.0;

  for (let i = 0; i < dstSize; i++) {
    const m = Math.max(0.0, Math.min(1.0, elevationGrid[i]));
    elevationGrid[i] = minElev + m * range;
  }

  onProgress?.(100, '標高を作成完了');
  return elevationGrid;
}
