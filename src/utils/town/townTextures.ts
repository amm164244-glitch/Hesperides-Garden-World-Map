/**
 * Town Textures: Data Structures, Slot Definitions, Pure Helpers & Fill Resolver
 * Decoupled from DOM wherever possible so it can run in test and headless environments.
 */

import {
  Pt,
  TownBuildingKind,
  TownDistrictKind,
  TownRoadStyle,
  TownStyle,
  TownTexture,
  TownTextureAssignment,
  TownTextureSlot,
} from '../../types/town';
import { metersToUnits } from './townGeometry';
import {
  VALID_BUILDING_KINDS,
  VALID_DISTRICT_KINDS,
  uniqueTemplateName,
} from './townTemplate';

export const VALID_ROAD_STYLES: readonly TownRoadStyle[] = [
  'main',
  'street',
  'path',
] as const;

export const TOWN_TEXTURE_SLOTS: readonly TownTextureSlot[] = [
  ...VALID_BUILDING_KINDS.map((k) => `roof:${k}` as const),
  ...VALID_ROAD_STYLES.map((s) => `road:${s}` as const),
  'wall' as const,
  ...VALID_DISTRICT_KINDS.map((d) => `ground:${d}` as const),
] as const;

const SLOT_LABELS: Record<TownTextureSlot, string> = {
  'roof:house': '屋根: 民家',
  'roof:shop': '屋根: 商家・工房',
  'roof:hall': '屋根: 会堂・大殿',
  'roof:church': '屋根: 教会・寺院',
  'roof:keep': '屋根: 天守・本丸',
  'roof:tower': '屋根: 見張り塔',
  'roof:barn': '屋根: 納屋・小屋',
  'road:main': '道: 大通り',
  'road:street': '道: 小路・街路',
  'road:path': '道: 獣道・小道',
  wall: '城壁: 壁面と塔',
  'ground:residential': '地面: 住宅街区',
  'ground:market': '地面: 市場区画',
  'ground:noble': '地面: 貴族街区',
  'ground:poor': '地面: 庶民街区',
  'ground:park': '地面: 緑地・広場',
  'ground:farmland': '地面: 農地・畑',
};

/**
 * Returns the Japanese human-readable display label for a texture slot.
 */
export function getSlotLabel(slot: TownTextureSlot): string {
  return SLOT_LABELS[slot] || slot;
}

/**
 * Sanitizes and validates a single texture assignment.
 * Returns null if textureId is missing or empty.
 */
export function sanitizeTextureAssignment(raw: unknown): TownTextureAssignment | null {
  if (!raw || typeof raw !== 'object') return null;

  const data = raw as Record<string, unknown>;

  if (typeof data.textureId !== 'string' || !data.textureId.trim()) {
    return null;
  }
  const textureId = data.textureId.trim();

  // tileSizeM: 0.5〜100, default 8
  let tileSizeM = 8;
  if (typeof data.tileSizeM === 'number' && Number.isFinite(data.tileSizeM)) {
    tileSizeM = Math.max(0.5, Math.min(100, data.tileSizeM));
  }

  // tintStrength: 0〜1, default 0.25
  let tintStrength = 0.25;
  if (typeof data.tintStrength === 'number' && Number.isFinite(data.tintStrength)) {
    tintStrength = Math.max(0, Math.min(1, data.tintStrength));
  }

  // opacity: 0.1〜1, default 0.55
  let opacity = 0.55;
  if (typeof data.opacity === 'number' && Number.isFinite(data.opacity)) {
    opacity = Math.max(0.1, Math.min(1, data.opacity));
  }

  // alignToObject: boolean, default true
  const alignToObject =
    typeof data.alignToObject === 'boolean' ? data.alignToObject : true;

  return {
    textureId,
    tileSizeM,
    tintStrength,
    opacity,
    alignToObject,
  };
}

/**
 * Sanitizes and cleans the textures map on a TownStyle object.
 * Discards unrecognized slot keys and invalid assignments.
 * Returns undefined if no valid entries remain.
 */
export function sanitizeTownTextures(raw: unknown): TownStyle['textures'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const data = raw as Record<string, unknown>;
  const validMap: Partial<Record<TownTextureSlot, TownTextureAssignment>> = {};
  let count = 0;

  for (const slot of TOWN_TEXTURE_SLOTS) {
    if (slot in data) {
      const sanitized = sanitizeTextureAssignment(data[slot]);
      if (sanitized) {
        validMap[slot] = sanitized;
        count++;
      }
    }
  }

  return count > 0 ? validMap : undefined;
}

/**
 * Validates a texture image file before reading or uploading.
 */
export function validateTextureFile(fileInfo: {
  name: string;
  type: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  const allowedMimes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedMimes.includes(fileInfo.type)) {
    return {
      ok: false,
      error: '対応している画像形式は PNG、JPEG、WebP のみです。',
    };
  }

  const maxBytes = 4 * 1024 * 1024; // 4 MB
  if (fileInfo.size > maxBytes) {
    return {
      ok: false,
      error: 'ファイルサイズが上限(4MB)を超えています。',
    };
  }

  return { ok: true };
}

/**
 * Calculates resized dimensions keeping aspect ratio if maxSide is exceeded.
 */
export function fitTextureSize(
  width: number,
  height: number,
  maxSide: number = 1024
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }

  const currentMax = Math.max(width, height);
  if (currentMax <= maxSide) {
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
  }

  const scale = maxSide / currentMax;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { width: w, height: h };
}

/**
 * Computes an alpha-weighted average hex color from RGBA pixel buffer.
 * Fully transparent image returns '#808080'.
 */
export function averageColorFromRgba(data: Uint8ClampedArray | number[]): string {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;

  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3] / 255;

    if (a > 0) {
      sumR += r * a;
      sumG += g * a;
      sumB += b * a;
      sumA += a;
    }
  }

  if (sumA === 0) {
    return '#808080';
  }

  const avgR = Math.round(sumR / sumA);
  const avgG = Math.round(sumG / sumA);
  const avgB = Math.round(sumB / sumA);

  const hexR = avgR.toString(16).padStart(2, '0');
  const hexG = avgG.toString(16).padStart(2, '0');
  const hexB = avgB.toString(16).padStart(2, '0');

  return `#${hexR}${hexG}${hexB}`;
}

export interface TextureLibraryFile {
  format: 'hg-town-textures';
  version: 1;
  textures: TownTexture[];
}

/**
 * Serializes texture library to formatted JSON string.
 */
export function serializeTextureLibrary(textures: TownTexture[]): string {
  const file: TextureLibraryFile = {
    format: 'hg-town-textures',
    version: 1,
    textures,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Validates and sanitizes a single raw TownTexture object.
 */
export function sanitizeTownTexture(raw: unknown): TownTexture | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;

  if (typeof data.id !== 'string' || !data.id.trim()) return null;
  const id = data.id.trim();

  let name = typeof data.name === 'string' ? data.name.trim() : 'テクスチャ';
  if (!name) name = 'テクスチャ';
  if (name.length > 60) name = name.slice(0, 60);

  const allowedMimes: TownTexture['mime'][] = ['image/png', 'image/jpeg', 'image/webp'];
  const mime =
    typeof data.mime === 'string' && (allowedMimes as string[]).includes(data.mime)
      ? (data.mime as TownTexture['mime'])
      : 'image/png';

  const width = typeof data.width === 'number' && Number.isFinite(data.width) && data.width > 0
    ? Math.round(data.width)
    : 0;
  const height = typeof data.height === 'number' && Number.isFinite(data.height) && data.height > 0
    ? Math.round(data.height)
    : 0;
  if (width <= 0 || height <= 0) return null;

  if (typeof data.dataUrl !== 'string' || !data.dataUrl.startsWith('data:image/')) {
    return null;
  }
  const dataUrl = data.dataUrl;

  const pixelated = Boolean(data.pixelated);
  const createdAt =
    typeof data.createdAt === 'number' && !isNaN(data.createdAt) ? data.createdAt : Date.now();

  return {
    id,
    name,
    mime,
    width,
    height,
    dataUrl,
    pixelated,
    createdAt,
  };
}

/**
 * Parses and strictly validates a JSON string containing texture library data.
 */
export function parseTextureLibrary(text: string): {
  textures: TownTexture[];
  skipped: number;
  error?: string;
} {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { textures: [], skipped: 0, error: 'テクスチャファイルの形式が一致しません。' };
    }

    if (raw.format !== 'hg-town-textures' || !Array.isArray(raw.textures)) {
      return { textures: [], skipped: 0, error: 'テクスチャファイルの形式が一致しません。' };
    }

    if (typeof raw.version !== 'number' || isNaN(raw.version) || raw.version > 1) {
      return {
        textures: [],
        skipped: 0,
        error: `このテクスチャファイルは、新しい形式(version ${raw.version})のため、読み込めません。`,
      };
    }

    const valid: TownTexture[] = [];
    let skipped = 0;

    for (const item of raw.textures) {
      const sanitized = sanitizeTownTexture(item);
      if (sanitized) {
        valid.push(sanitized);
      } else {
        skipped++;
      }
    }

    return { textures: valid, skipped };
  } catch (err) {
    return {
      textures: [],
      skipped: 0,
      error: err instanceof Error ? err.message : 'ファイルの解析に失敗しました。',
    };
  }
}

/**
 * Merges incoming textures into existing library.
 * Resolves ID collisions with new unique IDs and deduplicates names with uniqueTemplateName.
 * Caps at maxCount (default 40).
 */
export function mergeTextures(
  existing: TownTexture[],
  incoming: TownTexture[],
  maxCount: number = 40
): TownTexture[] {
  const result: TownTexture[] = [...existing];
  const existingIds = new Set<string>(existing.map((t) => t.id));
  const currentNames: string[] = existing.map((t) => t.name);

  for (const item of incoming) {
    if (result.length >= maxCount) break;

    // Resolve ID collision
    let newId = item.id;
    if (existingIds.has(newId)) {
      newId = `tex_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      while (existingIds.has(newId)) {
        newId = `tex_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      }
    }
    existingIds.add(newId);

    // Resolve name collision using uniqueTemplateName
    const newName = uniqueTemplateName(item.name, currentNames);
    currentNames.push(newName);

    result.push({
      ...item,
      id: newId,
      name: newName,
    });
  }

  return result.slice(0, maxCount);
}

/**
 * Helper to construct a matrix transformation. Works in both browser DOM and mock environments.
 */
export function createMatrix(ox: number, oy: number, angleDeg: number, s: number): any {
  if (typeof DOMMatrix !== 'undefined') {
    return new DOMMatrix().translate(ox, oy).rotate(angleDeg).scale(s);
  }
  return { ox, oy, angleDeg, s };
}

export type ResolvedFill =
  | { kind: 'flat'; color: string; opacity?: number; tintStrength?: number }
  | {
      kind: 'pattern';
      pattern: CanvasPattern;
      pixelated: boolean;
      opacity?: number;
      tintStrength?: number;
    };

export interface TextureCacheReader {
  getEntry(textureId: string): {
    width: number;
    height: number;
    averageColor: string;
    pixelated: boolean;
  } | null;
  getPattern(ctx: CanvasRenderingContext2D, textureId: string): CanvasPattern | null;
}

/**
 * Resolves texture fill for a given slot, zoom level, and object geometry.
 * Returns null if no assignment exists or image is not ready.
 */
export function resolveTextureFill(
  ctx: CanvasRenderingContext2D,
  slot: TownTextureSlot,
  textures: TownStyle['textures'] | undefined,
  metersPerUnit: number,
  zoomPx: number,
  extra?: {
    centroid?: Pt;
    firstEdgeAngleRad?: number;
  },
  cacheReader?: TextureCacheReader
): ResolvedFill | null {
  if (!textures || !cacheReader) return null;

  const assignment = textures[slot];
  if (!assignment) return null;

  const entry = cacheReader.getEntry(assignment.textureId);
  if (!entry) return null;

  const tileUnits = metersToUnits(assignment.tileSizeM, metersPerUnit);
  const tilePx = tileUnits * zoomPx;

  // LOD Optimization: If tile is smaller than 6px on screen, return flat average color
  if (tilePx < 6.0) {
    return {
      kind: 'flat',
      color: entry.averageColor,
      opacity: assignment.opacity,
      tintStrength: assignment.tintStrength,
    };
  }

  const pattern = cacheReader.getPattern(ctx, assignment.textureId);
  if (!pattern) return null;

  const s = tileUnits / Math.max(1, entry.width);

  let ox = 0;
  let oy = 0;
  let angleDeg = 0;

  if (
    slot.startsWith('roof:') &&
    assignment.alignToObject !== false &&
    extra?.centroid &&
    extra.firstEdgeAngleRad !== undefined
  ) {
    ox = extra.centroid[0];
    oy = extra.centroid[1];
    angleDeg = (extra.firstEdgeAngleRad * 180) / Math.PI;
  }

  const matrix = createMatrix(ox, oy, angleDeg, s);
  if (typeof pattern.setTransform === 'function') {
    pattern.setTransform(matrix);
  }

  return {
    kind: 'pattern',
    pattern,
    pixelated: entry.pixelated,
    opacity: assignment.opacity,
    tintStrength: assignment.tintStrength,
  };
}
