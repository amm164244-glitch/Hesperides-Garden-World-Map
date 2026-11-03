export interface LabColor {
  L: number;
  a: number;
  b: number;
}

export interface ColorSample {
  id: string;
  r: number;
  g: number;
  b: number;
  lab: LabColor;
  type: 'sea' | 'land';
}

export interface SegmentationOptions {
  medianRadius?: number; // 0 to 6 (window size 2r+1)
  tolerance?: number; // Lab deltaE tolerance (5 to 50, default 18)
  seaSamples?: ColorSample[];
  landSamples?: ColorSample[];
  minIslandAreaRatio?: number; // 0.0005 to 0.02 (e.g. 0.002 = 0.2%)
  smoothingIterations?: number; // 0 to 4
  marginPx?: number; // Legacy pixel margin
  marginPercent?: number; // 0 to 8% (default 3%)
  fillHoles?: boolean;
}

export interface SeedCounts {
  seaSeedCount: number;
  landSeedCount: number;
  seaSeedPercent: number;
  landSeedPercent: number;
  isSufficient: boolean;
  errorMessage?: string;
}

export class InsufficientSeedsError extends Error {
  seedCounts: SeedCounts;
  seedMask?: Uint8Array;

  constructor(message: string, seedCounts: SeedCounts, seedMask?: Uint8Array) {
    super(message);
    this.name = 'InsufficientSeedsError';
    this.seedCounts = seedCounts;
    this.seedMask = seedMask;
  }
}

export interface ColorCluster {
  id: string;
  r: number;
  g: number;
  b: number;
  hex: string;
  lab: LabColor;
  pixelCount: number;
  ratioPercent: number; // 0..100 (%)
}

export interface SegmentationStats {
  landRatio: number; // 0 to 100 (%)
  islandCount: number;
  seaCellCount: number;
  landCellCount: number;
  width: number;
  height: number;
}

export interface SegmentationResult {
  mask: Uint8Array; // 1 = land, 0 = sea
  stats: SegmentationStats;
  boundaryMask: Uint8Array; // 1 = coastline outline pixel, 0 = inner
  seedMask: Uint8Array; // 1 = sea, 2 = land, 0 = none
  seedCounts: SeedCounts;
}

export interface SegmentationMemoryEstimate {
  bytes: number;
  mb: number;
  formatted: string;
  isTooLarge: boolean;
}

/**
 * Estimates peak memory usage during land/sea segmentation for a given resolution.
 * Blocks processing if peak memory exceeds 1.2 GB.
 */
export function estimateSegmentationMemory(cols: number, rows: number): SegmentationMemoryEstimate {
  const pixels = cols * rows;
  // Breakdown of peak memory consumption:
  // - Input image RGBA: 4 bytes/pixel
  // - Filtered RGBA: 4 bytes/pixel
  // - Quantized Lab (uL, ua, ub): 3 bytes/pixel
  // - Gradient map: 1 byte/pixel
  // - Seed markers: 1 byte/pixel
  // - Watershed labels & queue tracking: 2 bytes/pixel
  // - Morphology & island filter buffer: 2 bytes/pixel
  // - Result masks (final mask, boundary mask): 2 bytes/pixel
  // Peak memory: ~19 bytes/pixel + 8MB runtime baseline
  const bytes = Math.round(pixels * 19 + 8 * 1024 * 1024);
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  const formatted = mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
  const isTooLarge = bytes > 1.2 * 1024 * 1024 * 1024; // > 1.2 GB limit

  return { bytes, mb, formatted, isTooLarge };
}

/**
 * Convert standard sRGB (0..255) to CIELAB (L*: 0..100, a*: -128..127, b*: -128..127)
 */
export function rgbToLab(r: number, g: number, b: number): LabColor {
  // sRGB to linear RGB
  let lr = r / 255;
  let lg = g / 255;
  let lb = b / 255;

  lr = lr > 0.04045 ? Math.pow((lr + 0.055) / 1.055, 2.4) : lr / 12.92;
  lg = lg > 0.04045 ? Math.pow((lg + 0.055) / 1.055, 2.4) : lg / 12.92;
  lb = lb > 0.04045 ? Math.pow((lb + 0.055) / 1.055, 2.4) : lb / 12.92;

  // D65 standard illuminant
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / 1.0;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;

  const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  const L = Math.max(0, Math.min(100, 116 * fy - 16));
  const a = Math.max(-128, Math.min(127, 500 * (fx - fy)));
  const bVal = Math.max(-128, Math.min(127, 200 * (fy - fz)));

  return { L, a, b: bVal };
}

/**
 * Calculate Euclidean Delta E between two Lab colors
 */
export function deltaE(c1: LabColor, c2: LabColor): number {
  const dL = c1.L - c2.L;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Convert CIELAB to standard sRGB (0..255)
 */
export function labToRgb(lab: LabColor): { r: number; g: number; b: number } {
  const y = (lab.L + 16) / 116;
  const x = lab.a / 500 + y;
  const z = y - lab.b / 200;

  const x3 = x * x * x;
  const z3 = z * z * z;
  const xr = x3 > 0.008856 ? x3 : (x - 16 / 116) / 7.787;
  const yr = lab.L > 0.008856 * 903.3 ? Math.pow((lab.L + 16) / 116, 3) : lab.L / 903.3;
  const zr = z3 > 0.008856 ? z3 : (z - 16 / 116) / 7.787;

  // D65 reference illuminant
  const X = xr * 0.95047;
  const Y = yr * 1.0;
  const Z = zr * 1.08883;

  // Linear sRGB
  const lr = X * 3.2404542 - Y * 1.5371385 - Z * 0.4985314;
  const lg = -X * 0.969266 + Y * 1.8760108 + Z * 0.041556;
  const lb = X * 0.0556434 - Y * 0.2040259 + Z * 1.0572252;

  const toGamma = (c: number) => {
    const clamped = Math.max(0, Math.min(1, c));
    return clamped > 0.0031308 ? 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055 : 12.92 * clamped;
  };

  const r = Math.round(Math.max(0, Math.min(255, toGamma(lr) * 255)));
  const g = Math.round(Math.max(0, Math.min(255, toGamma(lg) * 255)));
  const b = Math.round(Math.max(0, Math.min(255, toGamma(lb) * 255)));

  return { r, g, b };
}

/**
 * Format RGB numbers to 6-character hex string #rrggbb
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Propose color palette candidates using Lab k-means (k=6) with deterministic PRNG
 */
export function runLabKMeans(
  image: ImageData | { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  k: number = 6
): ColorCluster[] {
  const { width, height, data } = image;
  const targetW = Math.min(width, 256);
  const targetH = Math.min(height, 128);

  const stepX = width / targetW;
  const stepY = height / targetH;

  const sampleCount = targetW * targetH;
  const labSamples: LabColor[] = new Array(sampleCount);
  const rgbSamples: { r: number; g: number; b: number }[] = new Array(sampleCount);

  for (let sy = 0; sy < targetH; sy++) {
    const srcY = Math.min(height - 1, Math.floor((sy + 0.5) * stepY));
    const srcRow = srcY * width * 4;
    for (let sx = 0; sx < targetW; sx++) {
      const srcX = Math.min(width - 1, Math.floor((sx + 0.5) * stepX));
      const idx = srcRow + srcX * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const sampleIdx = sy * targetW + sx;
      labSamples[sampleIdx] = rgbToLab(r, g, b);
      rgbSamples[sampleIdx] = { r, g, b };
    }
  }

  let seed = 123456789;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return (seed >>> 0) / 4294967296;
  };

  const centroids: LabColor[] = [];
  const firstIdx = Math.floor(rand() * sampleCount);
  centroids.push({ ...labSamples[firstIdx] });

  for (let c = 1; c < k; c++) {
    let sumD2 = 0;
    const d2Arr = new Float64Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      let minDist = Infinity;
      for (let j = 0; j < centroids.length; j++) {
        const d = deltaE(labSamples[i], centroids[j]);
        if (d < minDist) minDist = d;
      }
      const d2 = minDist * minDist;
      d2Arr[i] = d2;
      sumD2 += d2;
    }

    if (sumD2 <= 0) {
      centroids.push({ ...labSamples[Math.floor(rand() * sampleCount)] });
      continue;
    }

    let target = rand() * sumD2;
    let selected = sampleCount - 1;
    for (let i = 0; i < sampleCount; i++) {
      target -= d2Arr[i];
      if (target <= 0) {
        selected = i;
        break;
      }
    }
    centroids.push({ ...labSamples[selected] });
  }

  const assignments = new Int32Array(sampleCount);
  const clusterCounts = new Int32Array(k);
  const sumL = new Float64Array(k);
  const suma = new Float64Array(k);
  const sumb = new Float64Array(k);
  const sumR = new Float64Array(k);
  const sumG = new Float64Array(k);
  const sumB = new Float64Array(k);

  const MAX_ITER = 15;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    clusterCounts.fill(0);
    sumL.fill(0);
    suma.fill(0);
    sumb.fill(0);
    sumR.fill(0);
    sumG.fill(0);
    sumB.fill(0);

    for (let i = 0; i < sampleCount; i++) {
      const p = labSamples[i];
      let bestCluster = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = deltaE(p, centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          bestCluster = c;
        }
      }
      assignments[i] = bestCluster;
      clusterCounts[bestCluster]++;
      sumL[bestCluster] += p.L;
      suma[bestCluster] += p.a;
      sumb[bestCluster] += p.b;
      sumR[bestCluster] += rgbSamples[i].r;
      sumG[bestCluster] += rgbSamples[i].g;
      sumB[bestCluster] += rgbSamples[i].b;
    }

    let maxShift = 0;
    for (let c = 0; c < k; c++) {
      const count = clusterCounts[c];
      if (count > 0) {
        const newL = sumL[c] / count;
        const newa = suma[c] / count;
        const newb = sumb[c] / count;
        const shift =
          Math.abs(centroids[c].L - newL) +
          Math.abs(centroids[c].a - newa) +
          Math.abs(centroids[c].b - newb);
        if (shift > maxShift) maxShift = shift;
        centroids[c] = { L: newL, a: newa, b: newb };
      }
    }
    if (maxShift < 0.2) break;
  }

  const clusters: ColorCluster[] = [];
  for (let c = 0; c < k; c++) {
    const count = clusterCounts[c];
    if (count === 0) continue;
    const avgR = Math.round(sumR[c] / count);
    const avgG = Math.round(sumG[c] / count);
    const avgB = Math.round(sumB[c] / count);
    const lab = centroids[c];
    const hex = rgbToHex(avgR, avgG, avgB);
    const ratioPercent = Number(((count / sampleCount) * 100).toFixed(1));

    clusters.push({
      id: `cluster_${c}_${hex.slice(1)}`,
      r: avgR,
      g: avgG,
      b: avgB,
      hex,
      lab,
      pixelCount: count,
      ratioPercent,
    });
  }

  clusters.sort((a, b) => b.ratioPercent - a.ratioPercent);
  return clusters;
}

/**
 * 2D Median filter to remove fine grid lines, text labels, and small paper specks
 */
export function applyMedianFilter(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  radius: number = 2
): Uint8ClampedArray {
  if (radius <= 0) {
    return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
  }

  if (width > 1024 && height > 512) {
    const halfW = Math.floor(width / 2);
    const halfH = Math.floor(height / 2);
    const halfData = new Uint8ClampedArray(halfW * halfH * 4);

    for (let hy = 0; hy < halfH; hy++) {
      const srcY = hy * 2;
      const hRow = hy * halfW * 4;
      const sRow = srcY * width * 4;
      for (let hx = 0; hx < halfW; hx++) {
        const srcX = hx * 2;
        const sIdx = sRow + srcX * 4;
        const hIdx = hRow + hx * 4;
        halfData[hIdx] = data[sIdx];
        halfData[hIdx + 1] = data[sIdx + 1];
        halfData[hIdx + 2] = data[sIdx + 2];
        halfData[hIdx + 3] = data[sIdx + 3];
      }
    }

    const halfRadius = Math.max(1, Math.round(radius / 2));
    const filteredHalf = applyMedianFilter(halfData, halfW, halfH, halfRadius);

    const output = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      const hy = Math.min(halfH - 1, Math.floor(y / 2));
      const hRow = hy * halfW * 4;
      const outRow = y * width * 4;
      for (let x = 0; x < width; x++) {
        const hx = Math.min(halfW - 1, Math.floor(x / 2));
        const hIdx = hRow + hx * 4;
        const oIdx = outRow + x * 4;
        output[oIdx] = filteredHalf[hIdx];
        output[oIdx + 1] = filteredHalf[hIdx + 1];
        output[oIdx + 2] = filteredHalf[hIdx + 2];
        output[oIdx + 3] = data[oIdx + 3];
      }
    }
    return output;
  }

  const output = new Uint8ClampedArray(data.length);
  const winSize = (2 * radius + 1) * (2 * radius + 1);

  const rBuf = new Uint8Array(winSize);
  const gBuf = new Uint8Array(winSize);
  const bBuf = new Uint8Array(winSize);

  for (let y = 0; y < height; y++) {
    const yMin = Math.max(0, y - radius);
    const yMax = Math.min(height - 1, y + radius);

    for (let x = 0; x < width; x++) {
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(width - 1, x + radius);

      let count = 0;
      for (let py = yMin; py <= yMax; py++) {
        const rowOffset = py * width * 4;
        for (let px = xMin; px <= xMax; px++) {
          const idx = rowOffset + px * 4;
          rBuf[count] = data[idx];
          gBuf[count] = data[idx + 1];
          bBuf[count] = data[idx + 2];
          count++;
        }
      }

      rBuf.subarray(0, count).sort();
      gBuf.subarray(0, count).sort();
      bBuf.subarray(0, count).sort();

      const mid = Math.floor(count / 2);
      const outIdx = (y * width + x) * 4;
      output[outIdx] = rBuf[mid];
      output[outIdx + 1] = gBuf[mid];
      output[outIdx + 2] = bBuf[mid];
      output[outIdx + 3] = data[outIdx + 3];
    }
  }

  return output;
}

export interface QuantizedLabArray {
  uL: Uint8Array;
  ua: Uint8Array;
  ub: Uint8Array;
}

/**
 * Convert filtered RGB image into compact quantized 8-bit Lab arrays.
 * Uses 3 bytes per pixel instead of 12 bytes (75% memory reduction).
 * - uL: 0..255 (maps 0..100)
 * - ua: 0..255 (maps -128..127 with offset 128)
 * - ub: 0..255 (maps -128..127 with offset 128)
 */
export function convertToLabQuantized(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): QuantizedLabArray {
  const size = width * height;
  const uL = new Uint8Array(size);
  const ua = new Uint8Array(size);
  const ub = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const idx = i * 4;
    const lab = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
    uL[i] = Math.round(lab.L * 2.55);
    ua[i] = Math.max(0, Math.min(255, Math.round(lab.a + 128)));
    ub[i] = Math.max(0, Math.min(255, Math.round(lab.b + 128)));
  }

  return { uL, ua, ub };
}

/**
 * Legacy float Lab array converter for backward compatibility.
 */
export function convertToLabArray(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): { L: Float32Array; a: Float32Array; b: Float32Array } {
  const size = width * height;
  const L = new Float32Array(size);
  const a = new Float32Array(size);
  const b = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    const idx = i * 4;
    const lab = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
    L[i] = lab.L;
    a[i] = lab.a;
    b[i] = lab.b;
  }

  return { L, a, b };
}

/**
 * Memory-optimized Sobel gradient magnitude calculation.
 * Supports both Float32Array and QuantizedLabArray inputs.
 * Uses a single row buffer instead of allocating full-screen magRaw (saves 4 bytes/pixel).
 */
export function computeSobelGradient(
  lab: { L: Float32Array; a: Float32Array; b: Float32Array } | QuantizedLabArray,
  width: number,
  height: number
): Uint8Array {
  const size = width * height;
  const gradient = new Uint8Array(size);

  const isQuantized = 'uL' in lab;
  const L = isQuantized ? (lab as QuantizedLabArray).uL : (lab as { L: Float32Array }).L;
  const a = isQuantized ? (lab as QuantizedLabArray).ua : (lab as { a: Float32Array }).a;
  const b = isQuantized ? (lab as QuantizedLabArray).ub : (lab as { b: Float32Array }).b;

  // Scaling factor for L when quantized (since L was scaled * 2.55)
  const lScale = isQuantized ? 1.0 / 2.55 : 1.0;

  // Pass 1: compute row-by-row to find maxMag without allocating full Float32Array(size)
  let maxMag = 0;
  const rowBuffer = new Float32Array(width);

  for (let y = 1; y < height - 1; y++) {
    const ym1 = (y - 1) * width;
    const y0 = y * width;
    const yp1 = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const xm1 = x - 1;
      const xp1 = x + 1;

      // Sobel L
      const gxL =
        (-L[ym1 + xm1] + L[ym1 + xp1] - 2 * L[y0 + xm1] + 2 * L[y0 + xp1] - L[yp1 + xm1] + L[yp1 + xp1]) *
        lScale;
      const gyL =
        (-L[ym1 + xm1] - 2 * L[ym1 + x] - L[ym1 + xp1] + L[yp1 + xm1] + 2 * L[yp1 + x] + L[yp1 + xp1]) *
        lScale;

      // Sobel a
      const gxa =
        -a[ym1 + xm1] + a[ym1 + xp1] - 2 * a[y0 + xm1] + 2 * a[y0 + xp1] - a[yp1 + xm1] + a[yp1 + xp1];
      const gya =
        -a[ym1 + xm1] - 2 * a[ym1 + x] - a[ym1 + xp1] + a[yp1 + xm1] + 2 * a[yp1 + x] + a[yp1 + xp1];

      // Sobel b
      const gxb =
        -b[ym1 + xm1] + b[ym1 + xp1] - 2 * b[y0 + xm1] + 2 * b[y0 + xp1] - b[yp1 + xm1] + b[yp1 + xp1];
      const gyb =
        -b[ym1 + xm1] - 2 * b[ym1 + x] - b[ym1 + xp1] + b[yp1 + xm1] + 2 * b[yp1 + x] + b[yp1 + xp1];

      const magL = Math.sqrt(gxL * gxL + gyL * gyL);
      const maga = Math.sqrt(gxa * gxa + gya * gya);
      const magb = Math.sqrt(gxb * gxb + gyb * gyb);

      const totalMag = magL * 1.0 + maga * 1.5 + magb * 1.5;
      if (totalMag > maxMag) maxMag = totalMag;
    }
  }

  // Pass 2: scale and write directly to gradient Uint8Array
  const scale = maxMag > 0 ? 255 / maxMag : 1;

  for (let y = 1; y < height - 1; y++) {
    const ym1 = (y - 1) * width;
    const y0 = y * width;
    const yp1 = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const xm1 = x - 1;
      const xp1 = x + 1;

      const gxL =
        (-L[ym1 + xm1] + L[ym1 + xp1] - 2 * L[y0 + xm1] + 2 * L[y0 + xp1] - L[yp1 + xm1] + L[yp1 + xp1]) *
        lScale;
      const gyL =
        (-L[ym1 + xm1] - 2 * L[ym1 + x] - L[ym1 + xp1] + L[yp1 + xm1] + 2 * L[yp1 + x] + L[yp1 + xp1]) *
        lScale;

      const gxa =
        -a[ym1 + xm1] + a[ym1 + xp1] - 2 * a[y0 + xm1] + 2 * a[y0 + xp1] - a[yp1 + xm1] + a[yp1 + xp1];
      const gya =
        -a[ym1 + xm1] - 2 * a[ym1 + x] - a[ym1 + xp1] + a[yp1 + xm1] + 2 * a[yp1 + x] + a[yp1 + xp1];

      const gxb =
        -b[ym1 + xm1] + b[ym1 + xp1] - 2 * b[y0 + xm1] + 2 * b[y0 + xp1] - b[yp1 + xm1] + b[yp1 + xp1];
      const gyb =
        -b[ym1 + xm1] - 2 * b[ym1 + x] - b[ym1 + xp1] + b[yp1 + xm1] + 2 * b[yp1 + x] + b[yp1 + xp1];

      const magL = Math.sqrt(gxL * gxL + gyL * gyL);
      const maga = Math.sqrt(gxa * gxa + gya * gya);
      const magb = Math.sqrt(gxb * gxb + gyb * gyb);

      const totalMag = magL * 1.0 + maga * 1.5 + magb * 1.5;
      gradient[y0 + x] = Math.min(255, Math.round(totalMag * scale));
    }
  }

  return gradient;
}

export function getEffectiveMarginPx(
  width: number,
  options: { marginPercent?: number; marginPx?: number }
): number {
  if (options.marginPercent !== undefined) {
    const clampedPercent = Math.max(0, Math.min(8, options.marginPercent));
    return Math.round(width * (clampedPercent / 100));
  }
  if (options.marginPx !== undefined) {
    return Math.max(0, options.marginPx);
  }
  return Math.round(width * 0.03);
}

/**
 * Generate seeds with support for QuantizedLabArray and standard float Lab.
 */
export function generateSeeds(
  rgbData: Uint8ClampedArray | Uint8Array,
  lab: { L: Float32Array; a: Float32Array; b: Float32Array } | QuantizedLabArray,
  width: number,
  height: number,
  options: {
    seaSamples?: ColorSample[];
    landSamples?: ColorSample[];
    tolerance: number;
    marginPx?: number;
    marginPercent?: number;
  }
): Uint8Array {
  const size = width * height;
  const markers = new Uint8Array(size);
  const { seaSamples = [], landSamples = [], tolerance } = options;
  const marginPx = getEffectiveMarginPx(width, options);

  const hasManualSea = seaSamples.length > 0;
  const hasManualLand = landSamples.length > 0;

  const isQuantized = 'uL' in lab;
  const L = isQuantized ? (lab as QuantizedLabArray).uL : (lab as { L: Float32Array }).L;
  const a = isQuantized ? (lab as QuantizedLabArray).ua : (lab as { a: Float32Array }).a;
  const b = isQuantized ? (lab as QuantizedLabArray).ub : (lab as { b: Float32Array }).b;

  if (hasManualSea || hasManualLand) {
    for (let i = 0; i < size; i++) {
      const curL = isQuantized ? L[i] / 2.55 : L[i];
      const curA = isQuantized ? a[i] - 128 : a[i];
      const curB = isQuantized ? b[i] - 128 : b[i];

      let minSeaDist = Infinity;
      if (hasManualSea) {
        for (const s of seaSamples) {
          const dL = curL - s.lab.L;
          const da = curA - s.lab.a;
          const db = curB - s.lab.b;
          const d = Math.sqrt(dL * dL + da * da + db * db);
          if (d < minSeaDist) minSeaDist = d;
        }
      }

      let minLandDist = Infinity;
      if (hasManualLand) {
        for (const l of landSamples) {
          const dL = curL - l.lab.L;
          const da = curA - l.lab.a;
          const db = curB - l.lab.b;
          const d = Math.sqrt(dL * dL + da * da + db * db);
          if (d < minLandDist) minLandDist = d;
        }
      }

      if (hasManualSea && minSeaDist <= tolerance && minSeaDist <= minLandDist) {
        markers[i] = 1; // Sea
      } else if (hasManualLand && minLandDist <= tolerance && minLandDist <= minSeaDist) {
        markers[i] = 2; // Land
      }
    }
  } else {
    for (let i = 0; i < size; i++) {
      const LVal = isQuantized ? L[i] / 2.55 : L[i];
      const aVal = isQuantized ? a[i] - 128 : a[i];
      const bVal = isQuantized ? b[i] - 128 : b[i];

      const chroma = Math.sqrt(aVal * aVal + bVal * bVal);

      if (LVal > 68 && chroma < 22) {
        markers[i] = 1;
      } else if (LVal < 55 || (chroma > 22 && (aVal > 2 || bVal > 15 || aVal < -5))) {
        markers[i] = 2;
      }
    }
  }

  // Morphological erosion on seeds (radius 1)
  const erodedMarkers = new Uint8Array(size);
  let hasErodedSea = false;
  let hasErodedLand = false;

  for (let y = 1; y < height - 1; y++) {
    const ym1 = (y - 1) * width;
    const y0 = y * width;
    const yp1 = (y + 1) * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = y0 + x;
      const m = markers[idx];
      if (m === 0) continue;

      if (
        markers[ym1 + x] === m &&
        markers[yp1 + x] === m &&
        markers[y0 + x - 1] === m &&
        markers[y0 + x + 1] === m
      ) {
        erodedMarkers[idx] = m;
        if (m === 1) hasErodedSea = true;
        if (m === 2) hasErodedLand = true;
      }
    }
  }

  if (!hasErodedSea) {
    for (let i = 0; i < size; i++) {
      if (markers[i] === 1) erodedMarkers[i] = 1;
    }
  }
  if (!hasErodedLand) {
    for (let i = 0; i < size; i++) {
      if (markers[i] === 2) erodedMarkers[i] = 2;
    }
  }

  if (marginPx > 0) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const isTopBottom = y < marginPx || y >= height - marginPx;
      if (isTopBottom) {
        for (let x = 0; x < width; x++) {
          erodedMarkers[row + x] = 1;
        }
      } else {
        for (let x = 0; x < marginPx; x++) {
          erodedMarkers[row + x] = 1;
        }
        for (let x = width - marginPx; x < width; x++) {
          erodedMarkers[row + x] = 1;
        }
      }
    }
  }

  return erodedMarkers;
}

export function computeSeedCounts(
  markers: Uint8Array,
  width: number,
  height: number
): SeedCounts {
  const size = width * height;
  let seaSeedCount = 0;
  let landSeedCount = 0;

  for (let i = 0; i < size; i++) {
    if (markers[i] === 1) seaSeedCount++;
    else if (markers[i] === 2) landSeedCount++;
  }

  const threshold = Math.ceil(size * 0.005);
  const seaSeedPercent = Number(((seaSeedCount / size) * 100).toFixed(2));
  const landSeedPercent = Number(((landSeedCount / size) * 100).toFixed(2));

  const isSeaSufficient = seaSeedCount >= threshold;
  const isLandSufficient = landSeedCount >= threshold;
  const isSufficient = isSeaSufficient && isLandSufficient;

  let errorMessage: string | undefined;
  if (!isSufficient) {
    if (!isSeaSufficient && !isLandSufficient) {
      errorMessage = '海と陸の目印が足りません。スポイトで色を指定してください';
    } else if (!isSeaSufficient) {
      errorMessage = '海の目印が足りません。スポイトで色を指定してください';
    } else {
      errorMessage = '陸の目印が足りません。スポイトで色を指定してください';
    }
  }

  return {
    seaSeedCount,
    landSeedCount,
    seaSeedPercent,
    landSeedPercent,
    isSufficient,
    errorMessage,
  };
}

export function analyzeSeeds(
  imageData: ImageData | { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  options: SegmentationOptions = {}
): { seedMask: Uint8Array; seedCounts: SeedCounts } {
  const { width, height, data } = imageData;
  const medianRadius = options.medianRadius ?? 2;
  const tolerance = options.tolerance ?? 18;
  const filteredData = applyMedianFilter(data, width, height, Math.min(medianRadius, 2));
  const labQuantized = convertToLabQuantized(filteredData, width, height);
  const seedMask = generateSeeds(filteredData, labQuantized, width, height, {
    seaSamples: options.seaSamples,
    landSamples: options.landSamples,
    tolerance,
    marginPx: options.marginPx,
    marginPercent: options.marginPercent,
  });
  const seedCounts = computeSeedCounts(seedMask, width, height);
  return { seedMask, seedCounts };
}

/**
 * 256-level bucket priority queue watershed segmentation.
 * In-place modifies labels to binary mask (1 = Land, 0 = Sea) saving extra allocation.
 */
export function runBucketWatershed(
  gradientMap: Uint8Array,
  initialMarkers: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const size = width * height;
  const labels = new Uint8Array(initialMarkers);

  // 256 priority queue buckets
  const buckets: number[][] = Array.from({ length: 256 }, () => []);
  const inQueue = new Uint8Array(size);

  for (let y = 0; y < height; y++) {
    const y0 = y * width;
    for (let x = 0; x < width; x++) {
      const idx = y0 + x;
      if (labels[idx] !== 0) {
        const neighbors = [
          x > 0 ? idx - 1 : -1,
          x < width - 1 ? idx + 1 : -1,
          y > 0 ? idx - width : -1,
          y < height - 1 ? idx + width : -1,
        ];

        for (const nIdx of neighbors) {
          if (nIdx !== -1 && labels[nIdx] === 0 && inQueue[nIdx] === 0) {
            const cost = gradientMap[nIdx];
            buckets[cost].push(nIdx);
            inQueue[nIdx] = 1;
          }
        }
      }
    }
  }

  let curBucket = 0;
  while (curBucket < 256) {
    if (buckets[curBucket].length === 0) {
      curBucket++;
      continue;
    }

    const idx = buckets[curBucket].pop()!;
    inQueue[idx] = 0;

    const x = idx % width;
    const y = Math.floor(idx / width);

    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
    ];

    let assignedLabel = 0;
    let minNeighborGradient = 256;

    for (const nIdx of neighbors) {
      if (nIdx !== -1 && labels[nIdx] !== 0) {
        const nGrad = gradientMap[nIdx];
        if (nGrad < minNeighborGradient) {
          minNeighborGradient = nGrad;
          assignedLabel = labels[nIdx];
        }
      }
    }

    if (assignedLabel !== 0) {
      labels[idx] = assignedLabel;

      for (const nIdx of neighbors) {
        if (nIdx !== -1 && labels[nIdx] === 0 && inQueue[nIdx] === 0) {
          const cost = gradientMap[nIdx];
          buckets[cost].push(nIdx);
          inQueue[nIdx] = 1;
          if (cost < curBucket) {
            curBucket = cost;
          }
        }
      }
    }
  }

  // Convert in-place: label 2 (Land) -> 1, all others -> 0 (Sea)
  for (let i = 0; i < size; i++) {
    labels[i] = labels[i] === 2 ? 1 : 0;
  }

  return labels;
}

export function filterSmallIslands(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number
): { filteredMask: Uint8Array; islandCount: number } {
  const size = width * height;
  const filteredMask = new Uint8Array(mask);
  const visited = new Uint8Array(size);

  let islandCount = 0;
  const queue: number[] = [];

  for (let i = 0; i < size; i++) {
    if (filteredMask[i] === 1 && visited[i] === 0) {
      queue.length = 0;
      queue.push(i);
      visited[i] = 1;

      const componentIndices: number[] = [i];
      let head = 0;

      while (head < queue.length) {
        const curr = queue[head++];
        const cx = curr % width;
        const cy = Math.floor(curr / width);

        const neighbors = [
          cx > 0 ? curr - 1 : -1,
          cx < width - 1 ? curr + 1 : -1,
          cy > 0 ? curr - width : -1,
          cy < height - 1 ? curr + width : -1,
        ];

        for (const n of neighbors) {
          if (n !== -1 && filteredMask[n] === 1 && visited[n] === 0) {
            visited[n] = 1;
            queue.push(n);
            componentIndices.push(n);
          }
        }
      }

      if (componentIndices.length < minArea) {
        for (const idx of componentIndices) {
          filteredMask[idx] = 0;
        }
      } else {
        islandCount++;
      }
    }
  }

  return { filteredMask, islandCount };
}

export function applyMorphologySmoothing(
  mask: Uint8Array,
  width: number,
  height: number,
  iterations: number
): Uint8Array {
  if (iterations <= 0) return new Uint8Array(mask);

  let current = new Uint8Array(mask);
  const temp = new Uint8Array(mask.length);

  for (let it = 0; it < iterations; it++) {
    // 1. Closing: Dilation then Erosion
    for (let y = 1; y < height - 1; y++) {
      const y0 = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = y0 + x;
        temp[idx] =
          current[idx] === 1 ||
          current[idx - 1] === 1 ||
          current[idx + 1] === 1 ||
          current[idx - width] === 1 ||
          current[idx + width] === 1
            ? 1
            : 0;
      }
    }

    for (let y = 1; y < height - 1; y++) {
      const y0 = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = y0 + x;
        current[idx] =
          temp[idx] === 1 &&
          temp[idx - 1] === 1 &&
          temp[idx + 1] === 1 &&
          temp[idx - width] === 1 &&
          temp[idx + width] === 1
            ? 1
            : 0;
      }
    }

    // 2. Opening: Erosion then Dilation
    for (let y = 1; y < height - 1; y++) {
      const y0 = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = y0 + x;
        temp[idx] =
          current[idx] === 1 &&
          current[idx - 1] === 1 &&
          current[idx + 1] === 1 &&
          current[idx - width] === 1 &&
          current[idx + width] === 1
            ? 1
            : 0;
      }
    }

    for (let y = 1; y < height - 1; y++) {
      const y0 = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = y0 + x;
        current[idx] =
          temp[idx] === 1 ||
          temp[idx - 1] === 1 ||
          temp[idx + 1] === 1 ||
          temp[idx - width] === 1 ||
          temp[idx + width] === 1
            ? 1
            : 0;
      }
    }
  }

  return current;
}

export function fillLandHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const size = width * height;
  const result = new Uint8Array(mask);
  const reachableOcean = new Uint8Array(size);
  const queue: number[] = [];

  for (let x = 0; x < width; x++) {
    const topIdx = x;
    const btmIdx = (height - 1) * width + x;
    if (result[topIdx] === 0 && reachableOcean[topIdx] === 0) {
      reachableOcean[topIdx] = 1;
      queue.push(topIdx);
    }
    if (result[btmIdx] === 0 && reachableOcean[btmIdx] === 0) {
      reachableOcean[btmIdx] = 1;
      queue.push(btmIdx);
    }
  }

  for (let y = 0; y < height; y++) {
    const lIdx = y * width;
    const rIdx = y * width + (width - 1);
    if (result[lIdx] === 0 && reachableOcean[lIdx] === 0) {
      reachableOcean[lIdx] = 1;
      queue.push(lIdx);
    }
    if (result[rIdx] === 0 && reachableOcean[rIdx] === 0) {
      reachableOcean[rIdx] = 1;
      queue.push(rIdx);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const cx = curr % width;
    const cy = Math.floor(curr / width);

    const neighbors = [
      cx > 0 ? curr - 1 : -1,
      cx < width - 1 ? curr + 1 : -1,
      cy > 0 ? curr - width : -1,
      cy < height - 1 ? curr + width : -1,
    ];

    for (const n of neighbors) {
      if (n !== -1 && result[n] === 0 && reachableOcean[n] === 0) {
        reachableOcean[n] = 1;
        queue.push(n);
      }
    }
  }

  for (let i = 0; i < size; i++) {
    if (result[i] === 0 && reachableOcean[i] === 0) {
      result[i] = 1;
    }
  }

  return result;
}

export function computeCoastlineOutline(
  mask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const size = width * height;
  const outline = new Uint8Array(size);

  for (let y = 0; y < height; y++) {
    const y0 = y * width;
    for (let x = 0; x < width; x++) {
      const idx = y0 + x;
      if (mask[idx] === 1) {
        let isCoast = false;
        for (let dy = -1; dy <= 1 && !isCoast; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            isCoast = true;
            break;
          }
          const ny0 = ny * width;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) {
              isCoast = true;
              break;
            }
            if (mask[ny0 + nx] === 0) {
              isCoast = true;
              break;
            }
          }
        }
        if (isCoast) {
          outline[idx] = 1;
        }
      }
    }
  }

  return outline;
}

/**
 * Main optimized land/sea segmentation pipeline.
 * Runs in ~60MB peak for 2048x1024 and ~250MB for 4096x2048.
 */
export function segmentLandSea(
  imageData: ImageData | { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  options: SegmentationOptions = {},
  onProgress?: (step: string, percent: number) => void
): SegmentationResult {
  const { width, height, data } = imageData;
  const size = width * height;

  const medianRadius = options.medianRadius ?? 2;
  const tolerance = options.tolerance ?? 18;
  const minIslandAreaRatio = options.minIslandAreaRatio ?? 0.002;
  const smoothingIterations = options.smoothingIterations ?? 1;
  const effectiveMargin = getEffectiveMarginPx(width, options);
  const shouldFillHoles = options.fillHoles ?? true;

  onProgress?.('メディアンフィルタ適用中...', 15);
  const filteredData = applyMedianFilter(data, width, height, medianRadius);

  onProgress?.('CIELAB変換・勾配マップ計算中...', 35);
  const labQuantized = convertToLabQuantized(filteredData, width, height);
  const gradientMap = computeSobelGradient(labQuantized, width, height);

  onProgress?.('シード生成中...', 55);
  const initialMarkers = generateSeeds(filteredData, labQuantized, width, height, {
    seaSamples: options.seaSamples,
    landSamples: options.landSamples,
    tolerance,
    marginPx: effectiveMargin,
    marginPercent: options.marginPercent,
  });

  const seedCounts = computeSeedCounts(initialMarkers, width, height);

  if (!seedCounts.isSufficient) {
    throw new InsufficientSeedsError(
      seedCounts.errorMessage || '目印が足りません。スポイトで色を指定してください',
      seedCounts,
      initialMarkers
    );
  }

  onProgress?.('分水嶺（Watershed）セグメンテーション実行中...', 75);
  const rawMask = runBucketWatershed(gradientMap, initialMarkers, width, height);

  onProgress?.('モルフォロジー平滑化と穴埋め...', 88);
  const smoothedMask = applyMorphologySmoothing(rawMask, width, height, smoothingIterations);
  const filledMask = shouldFillHoles ? fillLandHoles(smoothedMask, width, height) : smoothedMask;

  onProgress?.('微小島・ノイズ除去...', 94);
  const minAreaPixels = Math.max(10, Math.round(size * minIslandAreaRatio));
  const { filteredMask, islandCount } = filterSmallIslands(filledMask, width, height, minAreaPixels);

  if (effectiveMargin > 0) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const isTopBottom = y < effectiveMargin || y >= height - effectiveMargin;
      if (isTopBottom) {
        for (let x = 0; x < width; x++) {
          filteredMask[row + x] = 0;
        }
      } else {
        for (let x = 0; x < effectiveMargin; x++) {
          filteredMask[row + x] = 0;
        }
        for (let x = width - effectiveMargin; x < width; x++) {
          filteredMask[row + x] = 0;
        }
      }
    }
  }

  const boundaryMask = computeCoastlineOutline(filteredMask, width, height);

  let landCount = 0;
  for (let i = 0; i < size; i++) {
    if (filteredMask[i] === 1) landCount++;
  }
  const seaCount = size - landCount;
  const landRatio = Number(((landCount / size) * 100).toFixed(1));

  onProgress?.('判定完了', 100);

  return {
    mask: filteredMask,
    boundaryMask,
    seedMask: initialMarkers,
    seedCounts,
    stats: {
      landRatio,
      islandCount,
      landCellCount: landCount,
      seaCellCount: seaCount,
      width,
      height,
    },
  };
}
