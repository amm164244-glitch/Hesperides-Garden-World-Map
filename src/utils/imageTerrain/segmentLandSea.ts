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
  medianRadius?: number; // 0 to 4 (window size 2r+1)
  tolerance?: number; // Lab deltaE tolerance (5 to 50, default 18)
  seaSamples?: ColorSample[];
  landSamples?: ColorSample[];
  minIslandAreaRatio?: number; // 0.0005 to 0.02 (e.g. 0.002 = 0.2%)
  smoothingIterations?: number; // 0 to 4
  marginPx?: number; // 0 to 20 px (default 6)
  fillHoles?: boolean;
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
 * 2D Median filter to remove fine grid lines, text labels, and small paper specks
 */
export function applyMedianFilter(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  radius: number = 2
): Uint8ClampedArray {
  if (radius <= 0) {
    return new Uint8ClampedArray(data);
  }

  const output = new Uint8ClampedArray(data.length);
  const winSize = (2 * radius + 1) * (2 * radius + 1);
  const midIdx = Math.floor(winSize / 2);

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

      // Sort buffers up to count
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

/**
 * Convert filtered RGB image into pre-calculated Lab arrays
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
 * Compute Sobel gradient magnitude on L, a, b channels and quantize into 0..255 boundary strength
 */
export function computeSobelGradient(
  lab: { L: Float32Array; a: Float32Array; b: Float32Array },
  width: number,
  height: number
): Uint8Array {
  const size = width * height;
  const gradient = new Uint8Array(size);
  const { L, a, b } = lab;

  let maxMag = 0;
  const magRaw = new Float32Array(size);

  for (let y = 1; y < height - 1; y++) {
    const ym1 = (y - 1) * width;
    const y0 = y * width;
    const yp1 = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const xm1 = x - 1;
      const xp1 = x + 1;

      // Sobel kernel X:
      // -1  0  1
      // -2  0  2
      // -1  0  1
      // Sobel kernel Y:
      // -1 -2 -1
      //  0  0  0
      //  1  2  1

      // Channel L
      const gxL =
        -L[ym1 + xm1] + L[ym1 + xp1] - 2 * L[y0 + xm1] + 2 * L[y0 + xp1] - L[yp1 + xm1] + L[yp1 + xp1];
      const gyL =
        -L[ym1 + xm1] - 2 * L[ym1 + x] - L[ym1 + xp1] + L[yp1 + xm1] + 2 * L[yp1 + x] + L[yp1 + xp1];

      // Channel a
      const gxa =
        -a[ym1 + xm1] + a[ym1 + xp1] - 2 * a[y0 + xm1] + 2 * a[y0 + xp1] - a[yp1 + xm1] + a[yp1 + xp1];
      const gya =
        -a[ym1 + xm1] - 2 * a[ym1 + x] - a[ym1 + xp1] + a[yp1 + xm1] + 2 * a[yp1 + x] + a[yp1 + xp1];

      // Channel b
      const gxb =
        -b[ym1 + xm1] + b[ym1 + xp1] - 2 * b[y0 + xm1] + 2 * b[y0 + xp1] - b[yp1 + xm1] + b[yp1 + xp1];
      const gyb =
        -b[ym1 + xm1] - 2 * b[ym1 + x] - b[ym1 + xp1] + b[yp1 + xm1] + 2 * b[yp1 + x] + b[yp1 + xp1];

      const magL = Math.sqrt(gxL * gxL + gyL * gyL);
      const maga = Math.sqrt(gxa * gxa + gya * gya);
      const magb = Math.sqrt(gxb * gxb + gyb * gyb);

      const totalMag = magL * 1.0 + maga * 1.5 + magb * 1.5;
      const idx = y0 + x;
      magRaw[idx] = totalMag;
      if (totalMag > maxMag) maxMag = totalMag;
    }
  }

  const scale = maxMag > 0 ? 255 / maxMag : 1;
  for (let i = 0; i < size; i++) {
    gradient[i] = Math.min(255, Math.round(magRaw[i] * scale));
  }

  return gradient;
}

/**
 * Generate seeds for Sea and Land based on user sample points or auto heuristics
 * Marker codes: 1 = Sea, 2 = Land, 0 = Unmarked
 */
export function generateSeeds(
  rgbData: Uint8ClampedArray | Uint8Array,
  lab: { L: Float32Array; a: Float32Array; b: Float32Array },
  width: number,
  height: number,
  options: {
    seaSamples?: ColorSample[];
    landSamples?: ColorSample[];
    tolerance: number;
    marginPx: number;
  }
): Uint8Array {
  const size = width * height;
  const markers = new Uint8Array(size);
  const { seaSamples = [], landSamples = [], tolerance, marginPx } = options;

  const hasManualSea = seaSamples.length > 0;
  const hasManualLand = landSamples.length > 0;

  // If user provided manual samples for sea or land
  if (hasManualSea || hasManualLand) {
    for (let i = 0; i < size; i++) {
      const curLab: LabColor = { L: lab.L[i], a: lab.a[i], b: lab.b[i] };

      let minSeaDist = Infinity;
      if (hasManualSea) {
        for (const s of seaSamples) {
          const d = deltaE(curLab, s.lab);
          if (d < minSeaDist) minSeaDist = d;
        }
      }

      let minLandDist = Infinity;
      if (hasManualLand) {
        for (const l of landSamples) {
          const d = deltaE(curLab, l.lab);
          if (d < minLandDist) minLandDist = d;
        }
      }

      if (hasManualSea && minSeaDist <= tolerance && minSeaDist < minLandDist) {
        markers[i] = 1; // Sea
      } else if (hasManualLand && minLandDist <= tolerance && minLandDist < minSeaDist) {
        markers[i] = 2; // Land
      }
    }
  } else {
    // Automatic Heuristic for parchment/antique maps:
    // Sea in antique maps is typically light, pale/parchment color, or blue, low-to-medium saturation.
    // Land is typically darker or has distinct green/brown coloration.
    for (let i = 0; i < size; i++) {
      const LVal = lab.L[i];
      const aVal = lab.a[i];
      const bVal = lab.b[i];

      // Chroma in Lab
      const chroma = Math.sqrt(aVal * aVal + bVal * bVal);

      // Antique parchment sea: high luminance, moderate warmth, low chroma
      // Land: darker OR strongly chromatic (forest green, mountain brown)
      if (LVal > 72 && chroma < 22) {
        markers[i] = 1; // Sea candidate
      } else if (LVal < 55 || (chroma > 26 && LVal < 70)) {
        markers[i] = 2; // Land candidate
      }
    }
  }

  // Morphological erosion on seeds (radius 1) so seed regions don't bleed across true edges
  const erodedMarkers = new Uint8Array(size);
  for (let y = 1; y < height - 1; y++) {
    const ym1 = (y - 1) * width;
    const y0 = y * width;
    const yp1 = (y + 1) * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = y0 + x;
      const m = markers[idx];
      if (m === 0) continue;

      // 4-neighbors must have same marker
      if (
        markers[ym1 + x] === m &&
        markers[yp1 + x] === m &&
        markers[y0 + x - 1] === m &&
        markers[y0 + x + 1] === m
      ) {
        erodedMarkers[idx] = m;
      }
    }
  }

  // Enforce outer border margin as sea seeds
  const effectiveMargin = Math.max(1, marginPx);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x < effectiveMargin ||
        x >= width - effectiveMargin ||
        y < effectiveMargin ||
        y >= height - effectiveMargin
      ) {
        erodedMarkers[y * width + x] = 1; // Definite sea seed
      }
    }
  }

  return erodedMarkers;
}

/**
 * Marker-based Watershed segmentation using a 256-level bucket priority queue.
 * Zero external libraries!
 * Seeds: 1 = Sea, 2 = Land. Unlabeled pixels: 0.
 * Output: Uint8Array where 0 = Sea, 1 = Land.
 */
export function runBucketWatershed(
  gradientMap: Uint8Array,
  initialMarkers: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const size = width * height;
  const labels = new Uint8Array(initialMarkers); // 1 = sea, 2 = land, 0 = unassigned

  // 256 buckets for priority queue
  const buckets: number[][] = Array.from({ length: 256 }, () => []);
  const inQueue = new Uint8Array(size);

  // Push unassigned neighbors of initial seeds into buckets according to gradient
  for (let y = 0; y < height; y++) {
    const y0 = y * width;
    for (let x = 0; x < width; x++) {
      const idx = y0 + x;
      if (labels[idx] !== 0) {
        // Check 4-neighbors
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

  // Process buckets from 0 to 255
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

    // Look at labeled neighbors to determine label
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

      // Add unassigned neighbors to bucket queue
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

  // Any remaining unassigned pixels (e.g. islands of isolated high gradient) receive nearest label
  for (let i = 0; i < size; i++) {
    if (labels[i] === 0) {
      labels[i] = 1; // Default to sea
    }
  }

  // Final binary mask: 1 = Land (label 2), 0 = Sea (label 1)
  const finalMask = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    finalMask[i] = labels[i] === 2 ? 1 : 0;
  }

  return finalMask;
}

/**
 * Connected Component Labeling to remove small islands / artifacts
 */
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
      // Flood fill component
      queue.length = 0;
      queue.push(i);
      visited[i] = 1;

      const componentIndices: number[] = [i];
      let head = 0;

      while (head < queue.length) {
        const curr = queue[head++];
        const cx = curr % width;
        const cy = Math.floor(curr / width);

        // 4-neighbors
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
        // Discard component (turn into sea)
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

/**
 * Morphological opening / closing for edge smoothing
 */
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
    // Dilation
    for (let y = 1; y < height - 1; y++) {
      const y0 = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = y0 + x;
        if (
          current[idx] === 1 ||
          current[idx - 1] === 1 ||
          current[idx + 1] === 1 ||
          current[idx - width] === 1 ||
          current[idx + width] === 1
        ) {
          temp[idx] = 1;
        } else {
          temp[idx] = 0;
        }
      }
    }

    // Erosion
    for (let y = 1; y < height - 1; y++) {
      const y0 = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = y0 + x;
        if (
          temp[idx] === 1 &&
          temp[idx - 1] === 1 &&
          temp[idx + 1] === 1 &&
          temp[idx - width] === 1 &&
          temp[idx + width] === 1
        ) {
          current[idx] = 1;
        } else {
          current[idx] = 0;
        }
      }
    }
  }

  return current;
}

/**
 * Generate 1-pixel red coastline outline mask
 */
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
        // If land pixel has any sea 8-neighbor or touches border, it's coastline
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
 * Main land/sea segmentation pipeline
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
  const marginPx = options.marginPx ?? 6;

  onProgress?.('メディアンフィルタ適用中...', 15);
  const filteredData = applyMedianFilter(data, width, height, medianRadius);

  onProgress?.('CIELAB変換・勾配マップ計算中...', 35);
  const labArrays = convertToLabArray(filteredData, width, height);
  const gradientMap = computeSobelGradient(labArrays, width, height);

  onProgress?.('シード生成中...', 55);
  const initialMarkers = generateSeeds(filteredData, labArrays, width, height, {
    seaSamples: options.seaSamples,
    landSamples: options.landSamples,
    tolerance,
    marginPx,
  });

  onProgress?.('分水嶺（Watershed）セグメンテーション実行中...', 75);
  const rawMask = runBucketWatershed(gradientMap, initialMarkers, width, height);

  onProgress?.('モルフォロジー平滑化と微小島除去...', 90);
  const smoothedMask = applyMorphologySmoothing(rawMask, width, height, smoothingIterations);

  const minAreaPixels = Math.max(10, Math.round(size * minIslandAreaRatio));
  const { filteredMask, islandCount } = filterSmallIslands(smoothedMask, width, height, minAreaPixels);

  // Force margin sea
  if (marginPx > 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < marginPx || x >= width - marginPx || y < marginPx || y >= height - marginPx) {
          filteredMask[y * width + x] = 0;
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
