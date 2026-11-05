/**
 * Town Template Data Structures, Pure Helpers, Transformations & Serialization
 * Manages saving, instantiating, transforming, validating, and sharing town templates.
 * Completely decoupled from React, DOM, and Canvas contexts.
 */

import { Pt, TownObject } from '../../types/town';
import {
  clipboardToObjects,
  flipObject,
  objectsToClipboard,
  rotateObject,
} from './townBuild';

export interface TownTemplate {
  id: string;
  name: string;
  createdAt: number;
  objects: TownObject[]; // Stored in relative meters centered around [0, 0]
  sizeM: { width: number; height: number };
}

export interface TownTemplatePlacement {
  template: TownTemplate;
  angleDeg: number;
  flipX: boolean;
}

export interface TemplateLibraryFile {
  format: 'hg-town-templates';
  version: 1;
  templates: TownTemplate[];
}

/**
 * Computes bounding box and dimensions in relative meters for a collection of relative objects.
 */
function computeRelativeBoundsM(objects: TownObject[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const obj of objects) {
    const pts = obj.kind === 'district' || obj.kind === 'building' ? obj.polygon : obj.points;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

/**
 * Creates a new TownTemplate from selected TownObjects.
 * Converts map-space coordinates into relative meters centered at the centroid.
 */
export function createTemplate(
  name: string,
  selectedObjects: TownObject[],
  metersPerUnit: number,
  id?: string,
  createdAt?: number
): TownTemplate {
  if (selectedObjects.length === 0) {
    throw new Error('Cannot create template from 0 objects');
  }

  const trimmed = name.trim();
  const validName = trimmed.length > 0 ? trimmed.slice(0, 60) : 'テンプレート';

  // Convert to relative meters centered at centroid
  const clip = objectsToClipboard(selectedObjects, metersPerUnit);
  const bounds = computeRelativeBoundsM(clip.objects);

  const finalId = id || `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const finalCreatedAt = typeof createdAt === 'number' && !isNaN(createdAt) ? createdAt : Date.now();

  return {
    id: finalId,
    name: validName,
    createdAt: finalCreatedAt,
    objects: clip.objects,
    sizeM: {
      width: Math.round(bounds.width * 10) / 10,
      height: Math.round(bounds.height * 10) / 10,
    },
  };
}

/**
 * Computes the transformed bounding box in meters when rotating/flipping a template.
 */
export function templateBoundsM(
  template: TownTemplate,
  angleDeg: number = 0,
  flipX: boolean = false
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  let transformed = template.objects;

  if (flipX) {
    transformed = transformed.map((obj) => flipObject(obj, [0, 0], 'x'));
  }

  if (angleDeg !== 0) {
    const rad = (angleDeg * Math.PI) / 180;
    transformed = transformed.map((obj) => rotateObject(obj, [0, 0], rad));
  }

  return computeRelativeBoundsM(transformed);
}

/**
 * Instantiates a template at a target map anchor point, applying optional rotation and horizontal flip.
 * Generates unique IDs that do not clash with existingIds.
 */
export function instantiateTemplate(
  template: TownTemplate,
  anchor: Pt,
  metersPerUnit: number,
  opts?: {
    angleDeg?: number;
    flipX?: boolean;
    existingIds?: Set<string>;
  }
): TownObject[] {
  let relativeObjs = template.objects;

  if (opts?.flipX) {
    relativeObjs = relativeObjs.map((obj) => flipObject(obj, [0, 0], 'x'));
  }

  const angleDeg = opts?.angleDeg || 0;
  if (angleDeg !== 0) {
    const rad = (angleDeg * Math.PI) / 180;
    relativeObjs = relativeObjs.map((obj) => rotateObject(obj, [0, 0], rad));
  }

  const existingIds = opts?.existingIds || new Set<string>();
  const now = Date.now();
  const generatedIds: string[] = [];

  for (let i = 0; i < relativeObjs.length; i++) {
    const kind = relativeObjs[i].kind;
    let candidate = `${kind}_${now}_${Math.random().toString(36).substring(2, 7)}`;
    while (existingIds.has(candidate) || generatedIds.includes(candidate)) {
      candidate = `${kind}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }
    generatedIds.push(candidate);
  }

  return clipboardToObjects(
    {
      metersPerUnit,
      objects: relativeObjs,
    },
    anchor,
    metersPerUnit,
    generatedIds
  );
}

/**
 * Validates and sanitizes a raw template object.
 * Returns null if the structure is fundamentally invalid.
 */
export function sanitizeTemplate(raw: unknown): TownTemplate | null {
  if (!raw || typeof raw !== 'object') return null;

  const data = raw as Record<string, unknown>;

  if (typeof data.id !== 'string' || !data.id.trim()) return null;
  const id = data.id.trim();

  let name = typeof data.name === 'string' ? data.name.trim() : 'テンプレート';
  if (!name) name = 'テンプレート';
  if (name.length > 60) name = name.slice(0, 60);

  const createdAt = typeof data.createdAt === 'number' && !isNaN(data.createdAt) ? data.createdAt : Date.now();

  if (!Array.isArray(data.objects) || data.objects.length === 0 || data.objects.length > 1000) {
    return null;
  }

  const sanitizedObjects: TownObject[] = [];

  for (const item of data.objects) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;

    if (typeof obj.kind !== 'string') continue;
    const kind = obj.kind;
    const objId = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : `${kind}_${Date.now()}`;

    if (kind === 'district' || kind === 'building') {
      if (!Array.isArray(obj.polygon) || obj.polygon.length < 3) continue;
      const validPoly: Pt[] = [];
      let hasNan = false;
      for (const p of obj.polygon) {
        if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' || isNaN(p[0]) || isNaN(p[1])) {
          hasNan = true;
          break;
        }
        validPoly.push([p[0], p[1]]);
      }
      if (hasNan || validPoly.length < 3) continue;

      if (kind === 'district') {
        const districtKind = typeof obj.districtKind === 'string' ? obj.districtKind : 'residential';
        sanitizedObjects.push({
          id: objId,
          kind: 'district',
          polygon: validPoly,
          districtKind: districtKind as any,
        });
      } else {
        const buildingKind = typeof obj.buildingKind === 'string' ? obj.buildingKind : 'house';
        const heightM = typeof obj.heightM === 'number' && !isNaN(obj.heightM) ? Math.max(1, obj.heightM) : 6;
        const tone = typeof obj.tone === 'number' && !isNaN(obj.tone) ? Math.max(0, Math.min(1, obj.tone)) : 0.5;
        sanitizedObjects.push({
          id: objId,
          kind: 'building',
          polygon: validPoly,
          buildingKind: buildingKind as any,
          heightM,
          tone,
        });
      }
    } else if (kind === 'road' || kind === 'pier' || kind === 'wall') {
      if (!Array.isArray(obj.points) || obj.points.length < 2) continue;
      const validPoints: Pt[] = [];
      let hasNan = false;
      for (const p of obj.points) {
        if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' || isNaN(p[0]) || isNaN(p[1])) {
          hasNan = true;
          break;
        }
        validPoints.push([p[0], p[1]]);
      }
      if (hasNan || validPoints.length < 2) continue;

      if (kind === 'road') {
        const style = (typeof obj.style === 'string' && ['main', 'street', 'path'].includes(obj.style))
          ? (obj.style as any)
          : 'street';
        const widthM = typeof obj.widthM === 'number' && !isNaN(obj.widthM) ? Math.max(0.5, obj.widthM) : 4;
        const smooth = Boolean(obj.smooth);
        sanitizedObjects.push({
          id: objId,
          kind: 'road',
          points: validPoints,
          style,
          widthM,
          smooth,
        });
      } else if (kind === 'pier') {
        const variant = obj.variant === 'bridge' ? 'bridge' : 'pier';
        const widthM = typeof obj.widthM === 'number' && !isNaN(obj.widthM) ? Math.max(0.5, obj.widthM) : 3;
        sanitizedObjects.push({
          id: objId,
          kind: 'pier',
          points: validPoints,
          variant,
          widthM,
        });
      } else {
        // wall
        const thicknessM = typeof obj.thicknessM === 'number' && !isNaN(obj.thicknessM)
          ? Math.max(0.5, obj.thicknessM)
          : (typeof obj.widthM === 'number' && !isNaN(obj.widthM) ? Math.max(0.5, obj.widthM) : 3);
        const closed = Boolean(obj.closed);
        const towers = obj.towers !== undefined ? Boolean(obj.towers) : true;
        const towerRadiusM = typeof obj.towerRadiusM === 'number' && !isNaN(obj.towerRadiusM) ? Math.max(1, obj.towerRadiusM) : 3;
        const gates: import('../../types/town').TownWallGate[] = [];
        if (Array.isArray(obj.gates)) {
          for (const g of obj.gates) {
            if (!g || typeof g !== 'object') continue;
            const gate = g as Record<string, unknown>;
            const segIdx = typeof gate.segmentIndex === 'number' ? Math.floor(gate.segmentIndex) : 0;
            const t = typeof gate.t === 'number' && !isNaN(gate.t) ? Math.max(0, Math.min(1, gate.t)) : 0.5;
            const gateWidthM = typeof gate.widthM === 'number' && !isNaN(gate.widthM) ? Math.max(1, gate.widthM) : 4;
            gates.push({
              segmentIndex: segIdx,
              t,
              widthM: gateWidthM,
            });
          }
        }
        sanitizedObjects.push({
          id: objId,
          kind: 'wall',
          points: validPoints,
          closed,
          thicknessM,
          towers,
          towerRadiusM,
          gates,
        });
      }
    }
  }

  if (sanitizedObjects.length === 0) return null;

  const bounds = computeRelativeBoundsM(sanitizedObjects);

  return {
    id,
    name,
    createdAt,
    objects: sanitizedObjects,
    sizeM: {
      width: Math.round(bounds.width * 10) / 10,
      height: Math.round(bounds.height * 10) / 10,
    },
  };
}

/**
 * Serializes the template library to JSON formatted string.
 */
export function serializeTemplateLibrary(templates: TownTemplate[]): string {
  const file: TemplateLibraryFile = {
    format: 'hg-town-templates',
    version: 1,
    templates,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Parses a JSON string containing template library data.
 */
export function parseTemplateLibrary(text: string): {
  templates: TownTemplate[];
  skipped: number;
  error?: string;
} {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object') {
      return { templates: [], skipped: 0, error: 'JSON形式が不正です。' };
    }

    let items: unknown[] = [];
    if (Array.isArray(raw)) {
      items = raw;
    } else if (raw.format === 'hg-town-templates' && Array.isArray(raw.templates)) {
      items = raw.templates;
    } else if (Array.isArray(raw.templates)) {
      items = raw.templates;
    } else {
      return { templates: [], skipped: 0, error: 'テンプレートファイルの形式が一致しません。' };
    }

    const valid: TownTemplate[] = [];
    let skipped = 0;

    for (const item of items) {
      const sanitized = sanitizeTemplate(item);
      if (sanitized) {
        valid.push(sanitized);
      } else {
        skipped++;
      }
    }

    return { templates: valid, skipped };
  } catch (err) {
    return {
      templates: [],
      skipped: 0,
      error: err instanceof Error ? err.message : 'ファイルの解析に失敗しました。',
    };
  }
}

/**
 * Merges incoming templates into an existing template library.
 * - Resolves ID collisions.
 * - Deduplicates names with " (2)", " (3)", etc.
 * - Caps maximum total templates at maxCount (default: 100).
 */
export function mergeTemplates(
  existing: TownTemplate[],
  incoming: TownTemplate[],
  maxCount: number = 100
): TownTemplate[] {
  const result: TownTemplate[] = [...existing];
  const existingIds = new Set<string>(existing.map((t) => t.id));
  const existingNames = new Set<string>(existing.map((t) => t.name.toLowerCase()));

  for (const item of incoming) {
    if (result.length >= maxCount) break;

    // Resolve ID collision
    let newId = item.id;
    if (existingIds.has(newId)) {
      newId = `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      while (existingIds.has(newId)) {
        newId = `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      }
    }
    existingIds.add(newId);

    // Resolve name collision
    let newName = item.name;
    if (existingNames.has(newName.toLowerCase())) {
      let counter = 2;
      while (existingNames.has(`${newName} (${counter})`.toLowerCase())) {
        counter++;
      }
      newName = `${newName} (${counter})`;
    }
    existingNames.add(newName.toLowerCase());

    result.push({
      ...item,
      id: newId,
      name: newName,
    });
  }

  return result.slice(0, maxCount);
}
