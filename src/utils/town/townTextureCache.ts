/**
 * Town Texture In-Memory Image & CanvasPattern Cache
 * Manages asynchronous image loading, average color computation,
 * pattern creation, and change subscriptions for canvas redraws.
 */

import { TownTexture } from '../../types/town';
import {
  averageColorFromRgba,
  fitTextureSize,
  TextureCacheReader,
  validateTextureFile,
} from './townTextures';

export interface TextureCacheEntry {
  image: HTMLImageElement;
  width: number;
  height: number;
  averageColor: string;
  pixelated: boolean;
}

/**
 * Reads an uploaded image file, resizes it if it exceeds 1024px, and returns a TownTexture object.
 */
export async function importTextureFile(file: File): Promise<TownTexture> {
  const validation = validateTextureFile({
    name: file.name,
    type: file.type,
    size: file.size,
  });
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  // Load image to determine dimensions and resize if necessary
  const dataUrlOriginal = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('画像のデコードに失敗しました。'));
    el.src = dataUrlOriginal;
  });

  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  const fitted = fitTextureSize(naturalWidth, naturalHeight, 1024);

  let finalDataUrl = dataUrlOriginal;
  let finalWidth = naturalWidth;
  let finalHeight = naturalHeight;

  // If resizing is needed or format conversion is beneficial
  if (fitted.width !== naturalWidth || fitted.height !== naturalHeight) {
    const canvas = document.createElement('canvas');
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvasコンテキストの生成に失敗しました。');
    }

    ctx.drawImage(img, 0, 0, fitted.width, fitted.height);

    const exportMime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const quality = file.type === 'image/jpeg' ? 0.92 : undefined;
    finalDataUrl = canvas.toDataURL(exportMime, quality);
    finalWidth = fitted.width;
    finalHeight = fitted.height;
  }

  // Check data URL size (~3MB limit: 3 * 1024 * 1024 bytes)
  if (finalDataUrl.length > 3 * 1024 * 1024) {
    throw new Error('画像の保存サイズが上限(約3MB)を超えています。');
  }

  const baseName = file.name.replace(/\.[^/.]+$/, '').trim();
  const name = (baseName || 'テクスチャ').slice(0, 60);
  const mime: TownTexture['mime'] =
    file.type === 'image/jpeg'
      ? 'image/jpeg'
      : file.type === 'image/webp'
      ? 'image/webp'
      : 'image/png';

  const id = `tex_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    id,
    name,
    mime,
    width: finalWidth,
    height: finalHeight,
    dataUrl: finalDataUrl,
    pixelated: false,
    createdAt: Date.now(),
  };
}

class TownTextureCache implements TextureCacheReader {
  private entries = new Map<string, TextureCacheEntry>();
  private rawTextures = new Map<string, TownTexture>();
  private listeners = new Set<() => void>();
  private patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

  /**
   * Subscribes a listener to be notified whenever texture images finish loading.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[townTextureCache] Listener error:', err);
      }
    }
  }

  /**
   * Updates the cache with the current texture list from the library.
   * Loads any missing images and purges removed textures.
   */
  setTextures(list: TownTexture[]): void {
    const nextMap = new Map<string, TownTexture>();
    for (const t of list) {
      nextMap.set(t.id, t);
    }

    // Remove deleted entries
    for (const id of this.entries.keys()) {
      if (!nextMap.has(id)) {
        this.entries.delete(id);
      }
    }

    // Check for updates or new entries
    for (const t of list) {
      const existing = this.entries.get(t.id);
      const prevRaw = this.rawTextures.get(t.id);

      if (existing && prevRaw && prevRaw.dataUrl === t.dataUrl) {
        // Just update pixelated status if changed
        existing.pixelated = t.pixelated;
        continue;
      }

      // Load new or updated image asynchronously
      if (typeof window !== 'undefined') {
        const img = new Image();
        img.onload = () => {
          const avgColor = this.computeAverageColor(img);
          this.entries.set(t.id, {
            image: img,
            width: t.width || img.naturalWidth || 64,
            height: t.height || img.naturalHeight || 64,
            averageColor: avgColor,
            pixelated: t.pixelated,
          });
          this.notify();
        };
        img.src = t.dataUrl;
      }
    }

    this.rawTextures = nextMap;
  }

  private computeAverageColor(img: HTMLImageElement): string {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(16, img.naturalWidth || 16);
      canvas.height = Math.min(16, img.naturalHeight || 16);
      const ctx = canvas.getContext('2d');
      if (!ctx) return '#808080';

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return averageColorFromRgba(imgData.data);
    } catch {
      return '#808080';
    }
  }

  /**
   * Retrieves cache entry for a given textureId.
   */
  getEntry(textureId: string): TextureCacheEntry | null {
    return this.entries.get(textureId) || null;
  }

  /**
   * Creates or reuses a CanvasPattern for the given context and textureId.
   */
  getPattern(ctx: CanvasRenderingContext2D, textureId: string): CanvasPattern | null {
    const entry = this.entries.get(textureId);
    if (!entry) return null;

    let ctxMap = this.patternCache.get(ctx);
    if (!ctxMap) {
      ctxMap = new Map<string, CanvasPattern>();
      this.patternCache.set(ctx, ctxMap);
    }

    let pattern = ctxMap.get(textureId);
    if (!pattern) {
      try {
        pattern = ctx.createPattern(entry.image, 'repeat') || undefined;
        if (pattern) {
          ctxMap.set(textureId, pattern);
        }
      } catch (err) {
        console.warn('[townTextureCache] Failed to create pattern:', err);
        return null;
      }
    }

    return pattern || null;
  }
}

export const townTextureCache = new TownTextureCache();
