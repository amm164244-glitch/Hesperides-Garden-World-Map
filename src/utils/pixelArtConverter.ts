/**
 * High-Density Image-to-Pixel-Art Converter
 * Converts photos, landscapes, and drawings into authentic 16-bit / 32-bit pixel art
 * Supports:
 * - High resolution pixel grids (64px up to 512px width)
 * - Median-Cut adaptive color quantization (8 to 64 colors) & curated retro palettes
 * - Floyd-Steinberg, Atkinson, and Bayer 4x4 / 8x8 ordered dithering
 * - Sobel edge enhancement for pixel line-work (stone bricks, contours, outlines)
 * - Contrast, saturation, brightness pre-processing
 * - Background color keying / transparency for symbols
 */

export type DitherMode = 'floyd-steinberg' | 'atkinson' | 'bayer4' | 'bayer8' | 'none';

export type PalettePresetKey =
  | 'adaptive'
  | 'catacombs'
  | 'fantasy'
  | 'parchment'
  | 'snes'
  | 'cyberpunk'
  | 'pico8'
  | 'gameboy';

export interface ConverterOptions {
  targetWidth: number;          // e.g. 64, 128, 192, 256, 320, 384, 512
  targetHeight?: number;         // If undefined, calculated from aspect ratio
  colorCount: number;           // 4, 8, 12, 16, 24, 32, 48, 64 (0 = continuous)
  palettePreset: PalettePresetKey;
  customPalette?: string[];     // Array of #rrggbb colors
  ditherMode: DitherMode;
  ditherStrength: number;       // 0.0 to 1.0
  contrast: number;             // -50 to +50
  saturation: number;           // -50 to +50
  brightness: number;           // -50 to +50
  edgeEnhance: number;          // 0 to 100 (Sobel outline darkening)
  transparentBackground: boolean;
  transparencyTolerance: number; // 0 to 100
  transparencySamplePos?: 'top-left' | 'top-right' | 'white' | 'black';
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ConvertResult {
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  dataUrl: string;
  gridData: string[][];         // [y][x] hex or ''
  palette: string[];            // Unique hex colors used
  processingTimeMs: number;
}

// Bayer 4x4 matrix normalized 0..1
const BAYER_4X4 = [
  [0 / 16, 8 / 16, 2 / 16, 10 / 16],
  [12 / 16, 4 / 16, 14 / 16, 6 / 16],
  [3 / 16, 11 / 16, 1 / 16, 9 / 16],
  [15 / 16, 7 / 16, 13 / 16, 5 / 16],
];

// Bayer 8x8 matrix normalized 0..1
const BAYER_8X8 = [
  [ 0/64, 32/64,  8/64, 40/64,  2/64, 34/64, 10/64, 42/64],
  [48/64, 16/64, 56/64, 24/64, 50/64, 18/64, 58/64, 26/64],
  [12/64, 44/64,  4/64, 36/64, 14/64, 46/64,  6/64, 38/64],
  [60/64, 28/64, 52/64, 20/64, 62/64, 30/64, 54/64, 22/64],
  [ 3/64, 35/64, 11/64, 43/64,  1/64, 33/64,  9/64, 41/64],
  [51/64, 19/64, 59/64, 27/64, 49/64, 17/64, 57/64, 25/64],
  [15/64, 47/64,  7/64, 39/64, 13/64, 45/64,  5/64, 37/64],
  [63/64, 31/64, 55/64, 23/64, 61/64, 29/64, 53/64, 21/64],
];

// Curated Retro & Scene Palettes
export const PALETTE_PRESETS: Record<PalettePresetKey, { name: string; description: string; colors: string[] }> = {
  adaptive: {
    name: '画像から自動抽出 (推奨)',
    description: '元の画像から最も映える代表色を自動計算（風景・キャラクター両対応）',
    colors: [],
  },
  catacombs: {
    name: '地下迷宮・灯火 (Catacombs)',
    description: '石造りの遺跡・篝火の暖光と深い影（ユーザー参考画像スタイル）',
    colors: [
      '#0f0b12', '#1b1424', '#2a1e35', '#382845',
      '#241f2a', '#393344', '#554d60', '#7a7088',
      '#231610', '#412918', '#663e20', '#8f5727',
      '#ba732c', '#de8f2f', '#f2b33d', '#ffdf6d',
      '#fffaad', '#451b14', '#78261e', '#ac3d28',
      '#0f2231', '#17364b', '#26546e', '#3c7a9c',
      '#5ca5c5', '#88cce0', '#d8f1f8', '#111111',
    ],
  },
  fantasy: {
    name: '16-bit 王道ファンタジーRPG',
    description: 'スーパーファミコン・PlayStation初期風の温かみのある鮮明なパレット',
    colors: [
      '#100c14', '#241b2e', '#3e2e4f', '#61487b',
      '#1e140d', '#3b2518', '#5e3c25', '#8a5937',
      '#b87c4c', '#dfa66d', '#f3d19e', '#faebd0',
      '#631d23', '#9c2f35', '#cf4a40', '#e87e58',
      '#234a26', '#3b7538', '#5ca84e', '#8fd468',
      '#14304e', '#235384', '#3c7ebf', '#6fb7e8',
      '#997321', '#c79c2e', '#eec643', '#fff085',
    ],
  },
  parchment: {
    name: '中世羊皮紙・古地図',
    description: 'セピアインク・茶褐色・古紙風トーン',
    colors: [
      '#110e0a', '#241c14', '#3d2f21', '#5c4632',
      '#7f6246', '#a6825e', '#caa880', '#e3cbb0',
      '#f5e8d7', '#5c221a', '#8a3a2d', '#2b422f',
      '#47664c', '#293e54', '#47637d', '#b08333',
    ],
  },
  snes: {
    name: '90s レトロゲーム機 (SNES 32色)',
    description: '発色の良いドット絵グラフィックス',
    colors: [
      '#000000', '#1c1c1c', '#383838', '#555555',
      '#717171', '#8e8e8e', '#aaaaaa', '#ffffff',
      '#3b0000', '#770000', '#b20000', '#ee0000',
      '#ff5555', '#ffaaaa', '#003b00', '#007700',
      '#00b200', '#00ee00', '#55ff55', '#aaffaa',
      '#00003b', '#000077', '#0000b2', '#0000ee',
      '#5555ff', '#aaaaff', '#773b00', '#b27700',
      '#eeaa00', '#ffff00', '#ff00ff', '#00ffff',
    ],
  },
  cyberpunk: {
    name: 'サイバーパンク・ネオン',
    description: '深い漆黒とエレクトリックネオンのハイコントラスト',
    colors: [
      '#0a0814', '#15102a', '#221947', '#352269',
      '#ff0055', '#ff3388', '#ff77bb', '#ffccee',
      '#00e5ff', '#33eeff', '#80f5ff', '#d9fbff',
      '#ffe600', '#fff066', '#00ff88', '#88ffa8',
    ],
  },
  pico8: {
    name: 'PICO-8 (16色レトロ)',
    description: '初代コンソール風のアイコニックな16色',
    colors: [
      '#000000', '#1D2B53', '#7E2553', '#008751',
      '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
      '#FF004D', '#FFA300', '#FFEC27', '#00E436',
      '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
    ],
  },
  gameboy: {
    name: 'ゲームボーイ (緑液晶4色)',
    description: '初期ポータブル機のドット液晶',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
};

/**
 * Converts Hex string to RGB
 */
export function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  const val = parseInt(clean, 16);
  return {
    r: (val >> 16) & 255,
    g: (val >> 8) & 255,
    b: val & 255,
  };
}

/**
 * Converts RGB to Hex string
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const clampR = Math.max(0, Math.min(255, Math.round(r)));
  const clampG = Math.max(0, Math.min(255, Math.round(g)));
  const clampB = Math.max(0, Math.min(255, Math.round(b)));
  return (
    '#' +
    [clampR, clampG, clampB]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Perceptual weighted color distance (human eye is more sensitive to green and red)
 */
function colorDistanceSq(c1: RGB, c2: RGB): number {
  const rmean = (c1.r + c2.r) / 2;
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return (
    (((512 + rmean) * dr * dr) >> 8) +
    4 * dg * dg +
    (((767 - rmean) * db * db) >> 8)
  );
}

/**
 * Finds the nearest palette color to target RGB
 */
function findNearestPaletteIndex(color: RGB, palette: RGB[]): number {
  let minIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = colorDistanceSq(color, palette[i]);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  return minIdx;
}

/**
 * Adaptive Median-Cut color quantization algorithm
 */
function extractAdaptivePalette(pixels: Uint8ClampedArray, maxColors: number): RGB[] {
  // Collect unique pixel colors
  const colorMap = new Map<number, number>();
  const step = Math.max(1, Math.floor(pixels.length / (4 * 10000))); // sample up to 10k pixels

  for (let i = 0; i < pixels.length; i += 4 * step) {
    const a = pixels[i + 3];
    if (a < 64) continue; // ignore transparent
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    // Quantize 5 bits per channel for fast grouping
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }

  const sampleColors: { r: number; g: number; b: number; count: number }[] = [];
  colorMap.forEach((count, key) => {
    sampleColors.push({
      r: ((key >> 10) & 31) << 3,
      g: ((key >> 5) & 31) << 3,
      b: (key & 31) << 3,
      count,
    });
  });

  if (sampleColors.length <= maxColors) {
    return sampleColors.map((c) => ({ r: c.r, g: c.g, b: c.b }));
  }

  interface ColorBox {
    colors: typeof sampleColors;
  }

  function getRange(box: ColorBox) {
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (const c of box.colors) {
      if (c.r < minR) minR = c.r;
      if (c.r > maxR) maxR = c.r;
      if (c.g < minG) minG = c.g;
      if (c.g > maxG) maxG = c.g;
      if (c.b < minB) minB = c.b;
      if (c.b > maxB) maxB = c.b;
    }
    const rRange = maxR - minR;
    const gRange = maxG - minG;
    const bRange = maxB - minB;
    const maxRange = Math.max(rRange, gRange, bRange);
    const channel: 'r' | 'g' | 'b' =
      maxRange === rRange ? 'r' : maxRange === gRange ? 'g' : 'b';
    return { channel, maxRange };
  }

  const boxes: ColorBox[] = [{ colors: sampleColors }];

  while (boxes.length < maxColors) {
    let bestBoxIdx = -1;
    let maxRange = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].colors.length > 1) {
        const { maxRange: r } = getRange(boxes[i]);
        if (r > maxRange) {
          maxRange = r;
          bestBoxIdx = i;
        }
      }
    }
    if (bestBoxIdx === -1) break;

    const boxToSplit = boxes.splice(bestBoxIdx, 1)[0];
    const { channel } = getRange(boxToSplit);

    boxToSplit.colors.sort((a, b) => a[channel] - b[channel]);
    const median = Math.floor(boxToSplit.colors.length / 2);
    boxes.push({ colors: boxToSplit.colors.slice(0, median) });
    boxes.push({ colors: boxToSplit.colors.slice(median) });
  }

  return boxes.map((box) => {
    let totalWeight = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (const c of box.colors) {
      sumR += c.r * c.count;
      sumG += c.g * c.count;
      sumB += c.b * c.count;
      totalWeight += c.count;
    }
    return {
      r: Math.round(sumR / (totalWeight || 1)),
      g: Math.round(sumG / (totalWeight || 1)),
      b: Math.round(sumB / (totalWeight || 1)),
    };
  });
}

/**
 * Sobel Edge Filter for outlines and stone brick contours
 */
function computeSobelEdges(
  gray: Float32Array,
  width: number,
  height: number
): Float32Array {
  const edges = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // Sobel horizontal
      const gx =
        -gray[idx - width - 1] +
        gray[idx - width + 1] -
        2 * gray[idx - 1] +
        2 * gray[idx + 1] -
        gray[idx + width - 1] +
        gray[idx + width + 1];
      // Sobel vertical
      const gy =
        -gray[idx - width - 1] -
        2 * gray[idx - width] -
        gray[idx - width + 1] +
        gray[idx + width - 1] +
        2 * gray[idx + width] +
        gray[idx + width + 1];

      const mag = Math.sqrt(gx * gx + gy * gy);
      edges[idx] = Math.min(1.0, mag / 255.0);
    }
  }
  return edges;
}

/**
 * Main conversion function: takes an HTMLImageElement or Canvas and converts it to high-density Pixel Art
 */
export async function convertImageToPixelArt(
  source: HTMLImageElement | HTMLCanvasElement,
  options: ConverterOptions
): Promise<ConvertResult> {
  const startTime = performance.now();

  const srcW = source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const srcH = source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;

  const targetWidth = Math.max(16, Math.min(640, options.targetWidth));
  const targetHeight =
    options.targetHeight ||
    Math.max(16, Math.round((srcH / srcW) * targetWidth));

  // 1. Draw source into low-resolution offscreen canvas
  const lowResCanvas = document.createElement('canvas');
  lowResCanvas.width = targetWidth;
  lowResCanvas.height = targetHeight;
  const ctx = lowResCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create 2D canvas context');

  // Disable image smoothing for crisp pixel downsample or use high quality smoothing depending on downsample
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

  const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imgData.data;
  const totalPixels = targetWidth * targetHeight;

  // 2. Color adjustments: Brightness, Contrast, Saturation
  const cFactor = (259 * (options.contrast + 255)) / (255 * (259 - options.contrast));
  const satFactor = (options.saturation + 100) / 100;
  const bDelta = options.brightness * 1.5;

  // Luminance buffer for edge detection
  const grayBuf = new Float32Array(totalPixels);

  // Background key color detection if enabled
  let keyR = 255, keyG = 255, keyB = 255;
  if (options.transparentBackground) {
    if (options.transparencySamplePos === 'white') {
      keyR = 255; keyG = 255; keyB = 255;
    } else if (options.transparencySamplePos === 'black') {
      keyR = 0; keyG = 0; keyB = 0;
    } else if (options.transparencySamplePos === 'top-right') {
      const trIdx = (targetWidth - 1) * 4;
      keyR = data[trIdx]; keyG = data[trIdx + 1]; keyB = data[trIdx + 2];
    } else {
      // default top-left
      keyR = data[0]; keyG = data[1]; keyB = data[2];
    }
  }

  const isTransparent = new Uint8Array(totalPixels);
  const tolSq = (options.transparencyTolerance * 2.55) ** 2;

  for (let i = 0; i < totalPixels; i++) {
    const p = i * 4;
    let r = data[p];
    let g = data[p + 1];
    let b = data[p + 2];
    const a = data[p + 3];

    if (a < 50) {
      isTransparent[i] = 1;
      continue;
    }

    // Check transparency key
    if (options.transparentBackground) {
      const dKey = (r - keyR) ** 2 + (g - keyG) ** 2 + (b - keyB) ** 2;
      if (dKey <= tolSq) {
        isTransparent[i] = 1;
        continue;
      }
    }

    // Brightness
    r += bDelta;
    g += bDelta;
    b += bDelta;

    // Contrast
    r = cFactor * (r - 128) + 128;
    g = cFactor * (g - 128) + 128;
    b = cFactor * (b - 128) + 128;

    // Saturation
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lum + satFactor * (r - lum);
    g = lum + satFactor * (g - lum);
    b = lum + satFactor * (b - lum);

    data[p] = Math.max(0, Math.min(255, Math.round(r)));
    data[p + 1] = Math.max(0, Math.min(255, Math.round(g)));
    data[p + 2] = Math.max(0, Math.min(255, Math.round(b)));

    grayBuf[i] = lum;
  }

  // 3. Edge Enhancement (Sobel outline booster)
  if (options.edgeEnhance > 0) {
    const edges = computeSobelEdges(grayBuf, targetWidth, targetHeight);
    const edgeDarken = (options.edgeEnhance / 100) * 0.75;
    for (let i = 0; i < totalPixels; i++) {
      if (isTransparent[i]) continue;
      const mag = edges[i];
      if (mag > 0.15) {
        const factor = Math.max(0.2, 1.0 - mag * edgeDarken);
        const p = i * 4;
        data[p] = Math.round(data[p] * factor);
        data[p + 1] = Math.round(data[p + 1] * factor);
        data[p + 2] = Math.round(data[p + 2] * factor);
      }
    }
  }

  // 4. Palette Selection & Quantization
  let paletteRGB: RGB[] = [];

  if (options.palettePreset === 'adaptive' || !PALETTE_PRESETS[options.palettePreset]?.colors.length) {
    const targetColors = Math.max(4, Math.min(64, options.colorCount || 24));
    paletteRGB = extractAdaptivePalette(data, targetColors);
  } else {
    const presetColors = PALETTE_PRESETS[options.palettePreset].colors;
    paletteRGB = presetColors.map(hexToRgb);
    // If user specified custom limit smaller than preset
    if (options.colorCount > 0 && options.colorCount < paletteRGB.length) {
      paletteRGB = paletteRGB.slice(0, options.colorCount);
    }
  }

  if (options.customPalette && options.customPalette.length > 0) {
    paletteRGB = options.customPalette.map(hexToRgb);
  }

  // 5. Quantize & Dither
  // Work with floating-point errors buffer for Floyd-Steinberg / Atkinson
  const rBuf = new Float32Array(totalPixels);
  const gBuf = new Float32Array(totalPixels);
  const bBuf = new Float32Array(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const p = i * 4;
    rBuf[i] = data[p];
    gBuf[i] = data[p + 1];
    bBuf[i] = data[p + 2];
  }

  const dStrength = Math.max(0, Math.min(1.0, options.ditherStrength));
  const gridData: string[][] = Array.from({ length: targetHeight }, () =>
    Array(targetWidth).fill('')
  );
  const usedPaletteColors = new Set<string>();

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const idx = y * targetWidth + x;
      const p = idx * 4;

      if (isTransparent[idx]) {
        data[p + 3] = 0;
        gridData[y][x] = '';
        continue;
      }

      let curR = rBuf[idx];
      let curG = gBuf[idx];
      let curB = bBuf[idx];

      // Ordered Dithering (Bayer)
      if (options.ditherMode === 'bayer4' && dStrength > 0) {
        const threshold = (BAYER_4X4[y % 4][x % 4] - 0.5) * 64 * dStrength;
        curR += threshold;
        curG += threshold;
        curB += threshold;
      } else if (options.ditherMode === 'bayer8' && dStrength > 0) {
        const threshold = (BAYER_8X8[y % 8][x % 8] - 0.5) * 64 * dStrength;
        curR += threshold;
        curG += threshold;
        curB += threshold;
      }

      const clampedColor: RGB = {
        r: Math.max(0, Math.min(255, curR)),
        g: Math.max(0, Math.min(255, curG)),
        b: Math.max(0, Math.min(255, curB)),
      };

      // Find nearest color in palette
      const bestIdx = findNearestPaletteIndex(clampedColor, paletteRGB);
      const matched = paletteRGB[bestIdx];
      const matchedHex = rgbToHex(matched.r, matched.g, matched.b);

      data[p] = matched.r;
      data[p + 1] = matched.g;
      data[p + 2] = matched.b;
      data[p + 3] = 255;

      gridData[y][x] = matchedHex;
      usedPaletteColors.add(matchedHex);

      // Error diffusion (Floyd-Steinberg or Atkinson)
      if (dStrength > 0) {
        const errR = (clampedColor.r - matched.r) * dStrength;
        const errG = (clampedColor.g - matched.g) * dStrength;
        const errB = (clampedColor.b - matched.b) * dStrength;

        if (options.ditherMode === 'floyd-steinberg') {
          // Floyd-Steinberg error distribution:
          //        *   7/16
          // 3/16  5/16 1/16
          if (x + 1 < targetWidth) {
            const eIdx = idx + 1;
            rBuf[eIdx] += (errR * 7) / 16;
            gBuf[eIdx] += (errG * 7) / 16;
            bBuf[eIdx] += (errB * 7) / 16;
          }
          if (y + 1 < targetHeight) {
            if (x > 0) {
              const eIdx = idx + targetWidth - 1;
              rBuf[eIdx] += (errR * 3) / 16;
              gBuf[eIdx] += (errG * 3) / 16;
              bBuf[eIdx] += (errB * 3) / 16;
            }
            const eIdx2 = idx + targetWidth;
            rBuf[eIdx2] += (errR * 5) / 16;
            gBuf[eIdx2] += (errG * 5) / 16;
            bBuf[eIdx2] += (errB * 5) / 16;
            if (x + 1 < targetWidth) {
              const eIdx3 = idx + targetWidth + 1;
              rBuf[eIdx3] += (errR * 1) / 16;
              gBuf[eIdx3] += (errG * 1) / 16;
              bBuf[eIdx3] += (errB * 1) / 16;
            }
          }
        } else if (options.ditherMode === 'atkinson') {
          // Atkinson distributes 1/8 each to 6 neighbors (3/4 total error)
          const factor = 1 / 8;
          const neighbors = [
            [x + 1, y],
            [x + 2, y],
            [x - 1, y + 1],
            [x, y + 1],
            [x + 1, y + 1],
            [x, y + 2],
          ];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < targetWidth && ny >= 0 && ny < targetHeight) {
              const eIdx = ny * targetWidth + nx;
              rBuf[eIdx] += errR * factor;
              gBuf[eIdx] += errG * factor;
              bBuf[eIdx] += errB * factor;
            }
          }
        }
      }
    }
  }

  // Put quantized pixels back into canvas
  ctx.putImageData(imgData, 0, 0);

  const dataUrl = lowResCanvas.toDataURL('image/png');
  const processingTimeMs = Math.round(performance.now() - startTime);

  return {
    width: targetWidth,
    height: targetHeight,
    canvas: lowResCanvas,
    dataUrl,
    gridData,
    palette: Array.from(usedPaletteColors),
    processingTimeMs,
  };
}

/**
 * Creates an upscaled nearest-neighbor canvas for high-DPI display or crisp PNG download
 */
export function upscalePixelCanvas(
  sourceCanvas: HTMLCanvasElement,
  scaleFactor: number
): HTMLCanvasElement {
  const upCanvas = document.createElement('canvas');
  upCanvas.width = sourceCanvas.width * scaleFactor;
  upCanvas.height = sourceCanvas.height * scaleFactor;
  const ctx = upCanvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sourceCanvas, 0, 0, upCanvas.width, upCanvas.height);
  }
  return upCanvas;
}
