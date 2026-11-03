import { STANDARD_SEA_LEVEL } from '../tectonicGenerator';
import { maskToElevationGrid } from './maskEditor';
import { Noise2D } from '../prng';

export interface UpsampleOptions {
  blurRadius?: number; // Base blur radius at source resolution (default: 2.5)
  seaLevel?: number; // Sea level threshold (default: STANDARD_SEA_LEVEL = 18.0)
  riaRoughness?: number; // 0 to 10 (Ria coastline fractal irregularity, default: 7)
  seed?: number; // Deterministic PRNG seed for fractal rias
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

  // Step 1: If source and destination resolutions are identical, use direct blur with ria synthesis
  if (srcWidth === dstWidth && srcHeight === dstHeight) {
    onProgress?.(10, 'リアス海岸標高を作成中...');
    const result = maskToElevationGrid(
      sourceMask,
      srcWidth,
      srcHeight,
      seaLevel,
      baseRadius,
      options.riaRoughness ?? 7,
      options.seed ?? 88913
    );
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

  // Step 4: 1-pass running-sum box blur on destination resolution (Array #2 of dstSize)
  // Uses a lighter radius to prevent obliterating the user's natural capes, bays, and coastlines
  onProgress?.(55, 'ぼかし中');
  const scale = dstWidth / srcWidth;
  const rDst = Math.max(1, Math.round(baseRadius * scale * 0.28));

  let temp: Float32Array | null = new Float32Array(dstSize);

  boxBlurHorizontalWrap(elevationGrid, temp, dstWidth, dstHeight, rDst);
  boxBlurVerticalClamp(temp, elevationGrid, dstWidth, dstHeight, rDst);

  // Free temporary destination buffer immediately
  temp = null;

  // Step 5: Map continuous values to elevation with authentic Ria Coastline fractal synthesis
  // Uses coordinate domain warping + dendritic ridged carving + micro-fractal serrations + coastal skerries
  onProgress?.(80, 'リアス海岸・ギザギザ海岸線を合成中...');
  const riaRoughness = options.riaRoughness ?? 8;
  const intensity = Math.max(0.0, Math.min(1.0, riaRoughness / 10.0));
  const seed = options.seed ?? 88913;
  const riaNoise = new Noise2D(seed + 9821);
  const riaWarp = new Noise2D(seed + 2047);
  const riaDetail = new Noise2D(seed + 4019);

  // Copy blurred grid so we can perform domain-warped coordinate sampling
  const blurredGrid = new Float32Array(elevationGrid);

  for (let y = 0; y < dstHeight; y++) {
    const rowOffset = y * dstWidth;
    const ny = y / dstHeight;

    for (let x = 0; x < dstWidth; x++) {
      const idx = rowOffset + x;
      const nx = x / dstWidth;

      if (intensity <= 0) {
        const m = Math.max(0.0, Math.min(1.0, blurredGrid[idx]));
        elevationGrid[idx] = (seaLevel - 12.0) + m * 24.0;
        continue;
      }

      // 1. Domain warping of coordinates along the coastline:
      // Warps the sampling position so smooth curves turn into jagged, meandering rias
      const warpAng = riaWarp.sample(nx * 14.0, ny * 14.0) * Math.PI * 4;
      const warpMag =
        (riaWarp.sample(nx * 26.0 + 13.7, ny * 26.0 + 47.1) * 0.65 +
          riaDetail.sample(nx * 65.0, ny * 65.0) * 0.35) *
        (0.018 * intensity);

      const wx = nx + Math.cos(warpAng) * warpMag;
      const wy = ny + Math.sin(warpAng) * warpMag;

      // Sample blurredGrid at (wx * dstWidth, wy * dstHeight) with periodic x-wrapping
      const sx = ((wx * dstWidth) % dstWidth + dstWidth) % dstWidth;
      const sy = Math.max(0, Math.min(dstHeight - 1, wy * dstHeight));
      const x0 = Math.floor(sx);
      const x1 = (x0 + 1) % dstWidth;
      const fx = sx - x0;
      const y0 = Math.floor(sy);
      const y1 = Math.max(0, Math.min(dstHeight - 1, y0 + 1));
      const fy = sy - y0;

      const m00 = blurredGrid[y0 * dstWidth + x0];
      const m10 = blurredGrid[y0 * dstWidth + x1];
      const m01 = blurredGrid[y1 * dstWidth + x0];
      const m11 = blurredGrid[y1 * dstWidth + x1];
      const m = Math.max(
        0.0,
        Math.min(1.0, (m00 * (1 - fx) + m10 * fx) * (1 - fy) + (m01 * (1 - fx) + m11 * fx) * fy)
      );

      // Coastal envelope factor: peaks at coastline (m = 0.5)
      const coastWeight = Math.pow(Math.max(0.0, 1.0 - Math.abs(m - 0.5) / 0.45), 1.15);

      // 2. Meso bays and rugged peninsulas
      const bayNoise = (riaNoise.fbm(wx * 28.0, wy * 28.0, 3, 0.52, 2.1) - 0.5) * 0.28;

      // 3. Dendritic ria fjords (drowned river valleys) and rocky mountain spurs
      const fjordRidge = riaNoise.ridged(wx * 68.0, wy * 68.0, 3, 0.56, 2.2);
      const dendriticCarving = (fjordRidge - 0.44) * 0.36;

      // 4. High-frequency serrated shoreline crinkles (岩肌・鋸歯状フラクタル)
      const s1 = riaDetail.sample(wx * 140.0, wy * 140.0);
      const s2 = riaDetail.sample(wx * 320.0, wy * 320.0);
      const s3 = riaDetail.sample(wx * 640.0, wy * 640.0);
      const fineSerration = (s1 * 0.5 + s2 * 0.35 + s3 * 0.15 - 0.5) * 0.26;

      // 5. Coastal barrier skerries (沿岸の岩礁・小島群)
      const skerryNoise = riaDetail.sample(wx * 80.0, wy * 80.0);
      const isShallow = m < 0.5 && m > 0.28;
      const skerryBoost = (isShallow && skerryNoise > 0.58)
        ? ((skerryNoise - 0.58) * 0.75 + 0.12)
        : 0.0;

      const riaPerturbation =
        (bayNoise + dendriticCarving + fineSerration + skerryBoost) * coastWeight * intensity;

      const perturbedM = Math.max(0.0, Math.min(1.0, m + riaPerturbation));

      if (perturbedM > 0.5) {
        // Land: smooth rise towards interior hills/highlands
        const landFactor = (perturbedM - 0.5) / 0.5;
        const inlandHills =
          (riaNoise.fbm(wx * 18.0, wy * 18.0, 3) * 0.5 + 0.5) *
          Math.pow(landFactor, 0.8) *
          15.0;
        elevationGrid[idx] = seaLevel + landFactor * 13.0 + inlandHills;
      } else {
        // Ocean: shelf sloping down into deeper ocean
        const oceanFactor = (0.5 - perturbedM) / 0.5;
        elevationGrid[idx] = seaLevel - oceanFactor * 15.0;
      }
    }
  }

  onProgress?.(100, '標高を作成完了');
  return elevationGrid;
}
