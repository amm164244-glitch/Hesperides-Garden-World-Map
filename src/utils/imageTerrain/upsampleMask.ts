import { STANDARD_SEA_LEVEL } from '../tectonicGenerator';

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
      const nx = (k % width + width) % width;
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
 * Bilinearly upsamples a binary or grayscale mask from (srcWidth x srcHeight)
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
      outGrid[dstRow + dx] = top * (1 - fy) + btm * fy;
    }
  }
}

/**
 * Builds a smooth elevation grid at (dstWidth x dstHeight) from an analysis mask at (srcWidth x srcHeight).
 *
 * Method:
 * 1. Bilinear upsampling to destination resolution (with continuous fractional values in 0..1)
 * 2. 3 passes of 1D horizontal (periodic wrap) + 1D vertical (clamp) running-sum box blur.
 *    By the Central Limit Theorem, 3 box blur passes accurately approximate Gaussian smoothing
 *    in O(N) time with no memory bloat.
 * 3. Mapping continuous [0, 1] values to elevation:
 *    elevation = (seaLevel - 12.0) + m * 24.0 (sea interior ~seaLevel-12, land interior ~seaLevel+12)
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
  const dstSize = dstWidth * dstHeight;
  const elevationGrid = new Float32Array(dstSize);

  // If same resolution and no upsample needed, perform direct smoothing
  const scale = dstWidth / srcWidth;
  const baseRadius = options.blurRadius ?? 2.5;
  // Scaled box blur radius: 3 passes of radius r approximates Gaussian with sigma ~ sqrt(r*(r+1))
  // For baseRadius=2.5, r=2 gives sigma~2.45. Scaling r proportionally with scale preserves coastal width.
  const r = Math.max(1, Math.round(baseRadius * scale * 0.8));

  onProgress?.(5, '解像度の拡大（バイリニア補間）中...');

  // Step 1: Bilinear upsample into elevationGrid
  if (srcWidth === dstWidth && srcHeight === dstHeight) {
    for (let i = 0; i < dstSize; i++) {
      elevationGrid[i] = sourceMask[i];
    }
  } else {
    bilinearUpsample(sourceMask, srcWidth, srcHeight, dstWidth, dstHeight, elevationGrid, (ratio) => {
      onProgress?.(Math.round(5 + ratio * 30), '解像度の拡大（バイリニア補間）中...');
    });
  }

  onProgress?.(40, '滑らかな海岸線の生成（平滑化パス 1/3）中...');

  // Ping-pong buffer for 3-pass box blur
  const temp = new Float32Array(dstSize);

  // Pass 1: Horizontal & Vertical
  boxBlurHorizontalWrap(elevationGrid, temp, dstWidth, dstHeight, r);
  boxBlurVerticalClamp(temp, elevationGrid, dstWidth, dstHeight, r);

  onProgress?.(60, '滑らかな海岸線の生成（平滑化パス 2/3）中...');

  // Pass 2: Horizontal & Vertical
  boxBlurHorizontalWrap(elevationGrid, temp, dstWidth, dstHeight, r);
  boxBlurVerticalClamp(temp, elevationGrid, dstWidth, dstHeight, r);

  onProgress?.(80, '滑らかな海岸線の生成（平滑化パス 3/3）中...');

  // Pass 3: Horizontal & Vertical
  boxBlurHorizontalWrap(elevationGrid, temp, dstWidth, dstHeight, r);
  boxBlurVerticalClamp(temp, elevationGrid, dstWidth, dstHeight, r);

  onProgress?.(92, '標高値マッピング中...');

  // Step 3: Elevation lerp mapping
  // m in [0, 1] -> elevation in [seaLevel - 12, seaLevel + 12]
  const minElev = seaLevel - 12.0;
  const elevRange = 24.0;

  for (let i = 0; i < dstSize; i++) {
    const m = Math.max(0.0, Math.min(1.0, elevationGrid[i]));
    elevationGrid[i] = minElev + m * elevRange;
  }

  onProgress?.(100, '標高生成完了');
  return elevationGrid;
}
