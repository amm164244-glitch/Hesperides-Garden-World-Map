/**
 * Browser-side pipeline: image File -> CustomMapAsset
 * (background removal, trim, downscale, ground-contact origin, default on-map size).
 */

import { CustomMapAsset } from '../types/symbols';
import {
  RgbaImage,
  alphaBounds,
  computeOrigin,
  cropImage,
  defaultDisplayWidth,
  hasTransparency,
  removeEdgeBackground,
} from './illustrationAsset';

export interface IllustrationImportOptions {
  /** Category id stored on the asset (what the symbol palette filters by). */
  category: string;
  /** What kind of thing this is; decides the default on-map size and stored resolution
   *  ('tree' | 'mountain' | 'village' | 'town' | 'tower' | 'dungeon' | other). Default: 'other'. */
  sizeKind?: string;
  name?: string;
  /** Longest side of the stored image in px. Default: 384 for mountains, 256 otherwise. */
  maxSize?: number;
  /** Remove the plain background if the image has no transparency. Default true. */
  removeBackground?: boolean;
  /** Background colour tolerance (0-255 per channel). Default 14. */
  tolerance?: number;
  /** Multiplies the automatically chosen on-map size. Default 1. */
  sizeMultiplier?: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`画像を読み込めませんでした: ${file.name}`));
    };
    img.src = url;
  });
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * High-quality downscale by repeated halving, then one final step.
 * Canvas works on premultiplied alpha, so transparent edges do not bleed dark or white halos.
 */
export function downscaleCanvas(src: HTMLCanvasElement, targetW: number, targetH: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= targetW && cur.height / 2 >= targetH) {
    const next = makeCanvas(cur.width / 2, cur.height / 2);
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  if (cur.width !== Math.round(targetW) || cur.height !== Math.round(targetH)) {
    const last = makeCanvas(targetW, targetH);
    const ctx = last.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, last.width, last.height);
    cur = last;
  }
  return cur;
}

export function fileBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '無題';
}

export async function importIllustrationFile(
  file: File,
  opts: IllustrationImportOptions
): Promise<CustomMapAsset> {
  const img = await loadImage(file);
  const srcCanvas = makeCanvas(img.naturalWidth, img.naturalHeight);
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(img, 0, 0);

  const imageData = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const rgba: RgbaImage = { data: imageData.data, width: imageData.width, height: imageData.height };

  if (opts.removeBackground !== false && !hasTransparency(rgba)) {
    removeEdgeBackground(rgba, opts.tolerance ?? 14);
    sctx.putImageData(imageData, 0, 0);
  }

  const box = alphaBounds(rgba);
  if (!box) throw new Error(`絵が見つかりませんでした(全面が透明): ${file.name}`);

  const pad = Math.max(2, Math.round(Math.max(box.x1 - box.x0, box.y1 - box.y0) * 0.004));
  const cropped = cropImage(rgba, box, pad);
  const origin = computeOrigin(cropped);

  const cropCanvas = makeCanvas(cropped.width, cropped.height);
  cropCanvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(cropped.data), cropped.width, cropped.height), 0, 0);

  const kind = opts.sizeKind ?? 'other';
  const maxSize = opts.maxSize ?? (kind === 'mountain' ? 384 : 256);
  const longest = Math.max(cropped.width, cropped.height);
  const k = Math.min(1, maxSize / longest);
  const outW = Math.max(1, Math.round(cropped.width * k));
  const outH = Math.max(1, Math.round(cropped.height * k));
  const outCanvas = k < 1 ? downscaleCanvas(cropCanvas, outW, outH) : cropCanvas;

  const displayWidth =
    defaultDisplayWidth(kind, outW, outH) * (opts.sizeMultiplier ?? 1);

  return {
    id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: (opts.name ?? fileBaseName(file.name)).slice(0, 40),
    category: opts.category,
    dataUrl: outCanvas.toDataURL('image/png'),
    width: outCanvas.width,
    height: outCanvas.height,
    originX: Math.round(origin.originX * 1000) / 1000,
    originY: Math.round(origin.originY * 1000) / 1000,
    displayWidth: Math.round(displayWidth * 10) / 10,
    createdAt: Date.now(),
  };
}
