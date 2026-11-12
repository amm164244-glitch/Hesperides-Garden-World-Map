/**
 * Pure (DOM-free) helpers for turning hand-drawn illustration images
 * (AI-generated or scanned, usually on a white background) into map symbol assets.
 *
 * - removeEdgeBackground: flood-fills the background from the image border, so
 *   near-white areas *inside* the artwork (e.g. snow caps) are preserved.
 * - alphaBounds / cropImage: trim transparent margins.
 * - computeOrigin: find the ground-contact point (bottom-centre of the artwork).
 * - defaultDisplayWidth: pick a sensible on-map size from category and aspect ratio.
 * - pickMipLevel: choose which pre-scaled copy to draw at a given on-screen size.
 */

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PixelBounds {
  x0: number; // inclusive
  y0: number; // inclusive
  x1: number; // exclusive
  y1: number; // exclusive
}

/** True when the image already has meaningful transparency (so no background removal is needed). */
export function hasTransparency(img: RgbaImage, maxOpaqueAlpha = 250): boolean {
  const { data } = img;
  const total = img.width * img.height;
  // Count transparent pixels; ignore a handful of stray ones.
  let count = 0;
  const limit = Math.max(16, Math.floor(total * 0.002));
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] < maxOpaqueAlpha) {
      count++;
      if (count >= limit) return true;
    }
  }
  return false;
}

function estimateBackground(img: RgbaImage): [number, number, number] {
  const { data, width: w, height: h } = img;
  const pts: Array<[number, number]> = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [Math.floor(w / 2), 0],
    [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)],
    [w - 1, Math.floor(h / 2)],
  ];
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  }
  const med = (a: number[]) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
  return [med(rs), med(gs), med(bs)];
}

/**
 * Makes the background transparent. The background is every pixel connected to the
 * image border whose colour is within `tolerance` (max per-channel difference) of the
 * border colour. Pixels just outside that tolerance get a soft alpha ramp and are
 * "un-matted" from the background colour to avoid light fringes on dark maps.
 *
 * Mutates img.data. Returns the number of pixels made fully transparent.
 */
export function removeEdgeBackground(img: RgbaImage, tolerance = 14): number {
  const { data, width: w, height: h } = img;
  const [br, bg, bb] = estimateBackground(img);
  const dist = (i: number) =>
    Math.max(Math.abs(data[i] - br), Math.abs(data[i + 1] - bg), Math.abs(data[i + 2] - bb));

  const bgMask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;

  const tryPush = (x: number, y: number) => {
    const p = y * w + x;
    if (bgMask[p]) return;
    if (dist(p * 4) <= tolerance) {
      bgMask[p] = 1;
      stack[sp++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    tryPush(x, 0);
    tryPush(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y);
    tryPush(w - 1, y);
  }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) tryPush(x - 1, y);
    if (x < w - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < h - 1) tryPush(x, y + 1);
  }

  let removed = 0;
  for (let p = 0; p < w * h; p++) {
    if (bgMask[p]) {
      data[p * 4 + 3] = 0;
      removed++;
    }
  }

  // Soften the 2px ring around the removed region.
  const ramp = tolerance * 2.5;
  const ring: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (bgMask[p]) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (bgMask[yy * w + xx]) {
            near = true;
            break;
          }
        }
      }
      if (near) ring.push(p);
    }
  }
  for (const p of ring) {
    const i = p * 4;
    const d = dist(i);
    if (d >= ramp) continue; // clearly foreground (e.g. ink outline)
    const a = Math.max(0.05, Math.min(1, (d - tolerance * 0.5) / (ramp - tolerance * 0.5)));
    // Un-matte: observed = a*fg + (1-a)*bg  =>  fg = bg + (observed - bg)/a
    data[i] = clamp255(br + (data[i] - br) / a);
    data[i + 1] = clamp255(bg + (data[i + 1] - bg) / a);
    data[i + 2] = clamp255(bb + (data[i + 2] - bb) / a);
    data[i + 3] = Math.round(data[i + 3] * a);
  }

  return removed;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Bounding box of pixels with alpha > threshold. Returns null for an empty image. */
export function alphaBounds(img: RgbaImage, threshold = 12): PixelBounds | null {
  const { data, width: w, height: h } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Crops to the bounds, adding `pad` transparent pixels on every side. */
export function cropImage(img: RgbaImage, box: PixelBounds, pad = 0): RgbaImage {
  const cw = box.x1 - box.x0 + pad * 2;
  const ch = box.y1 - box.y0 + pad * 2;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < box.y1 - box.y0; y++) {
    const srcStart = ((box.y0 + y) * img.width + box.x0) * 4;
    const dstStart = ((y + pad) * cw + pad) * 4;
    out.set(img.data.subarray(srcStart, srcStart + (box.x1 - box.x0) * 4), dstStart);
  }
  return { data: out, width: cw, height: ch };
}

/**
 * Where the symbol touches the ground, as fractions of the (cropped) image.
 * originX = centre of the opaque pixels in the bottom band (a tree trunk, a mountain
 * foot) so lopsided artwork such as a volcano with a smoke trail still sits correctly.
 * originY = bottom of the opaque pixels.
 */
export function computeOrigin(img: RgbaImage, alphaThreshold = 40): { originX: number; originY: number } {
  const { data, width: w, height: h } = img;
  let lastRow = -1;
  for (let y = h - 1; y >= 0 && lastRow < 0; y--) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaThreshold) {
        lastRow = y;
        break;
      }
    }
  }
  if (lastRow < 0) return { originX: 0.5, originY: 1 };

  const band = Math.max(2, Math.round(h * 0.04));
  let sumX = 0;
  let n = 0;
  for (let y = Math.max(0, lastRow - band + 1); y <= lastRow; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaThreshold) {
        sumX += x + 0.5;
        n++;
      }
    }
  }
  return {
    originX: n > 0 ? sumX / n / w : 0.5,
    originY: (lastRow + 1) / h,
  };
}

/** Target "visual size" (sqrt of width*height, in world units) per symbol category. */
const CATEGORY_VISUAL_SIZE: Record<string, number> = {
  tree: 24,
  mountain: 58,
  village: 30,
  town: 40,
  port: 40,
  tower: 26,
  dungeon: 32,
  maritime: 30,
  settlement: 36,
  landmark: 36,
};

/**
 * Default on-map width (world units at scale 1) for an illustration.
 * Uses sqrt(area) so tall conifers and wide volcanoes both end up with a comparable footprint.
 */
export function defaultDisplayWidth(category: string, imgWidth: number, imgHeight: number): number {
  const visual = CATEGORY_VISUAL_SIZE[category] ?? 36;
  const aspect = imgHeight > 0 ? imgWidth / imgHeight : 1;
  return Math.round(visual * Math.sqrt(aspect) * 10) / 10;
}

/**
 * Pre-scaled copies of an asset are kept at halving widths. Returns the index of the
 * smallest level that is still at least `targetPx` wide (level 0 = original).
 */
export function pickMipLevel(originalWidth: number, targetPx: number, levelCount: number): number {
  if (levelCount <= 1) return 0;
  let best = 0;
  for (let i = 0; i < levelCount; i++) {
    const w = originalWidth / Math.pow(2, i);
    if (w >= targetPx) best = i;
    else break;
  }
  return best;
}

/** Number of halving levels worth keeping (stops once narrower than ~12px). */
export function mipLevelCount(originalWidth: number, minWidth = 12): number {
  let n = 1;
  let w = originalWidth;
  while (w / 2 >= minWidth) {
    w /= 2;
    n++;
  }
  return n;
}
