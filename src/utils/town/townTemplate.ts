/**
 * Town Template Data Structures, Pure Helpers, Transformations & Serialization
 * Manages saving, instantiating, transforming, validating, and sharing town templates.
 * Completely decoupled from React, DOM, and Canvas contexts.
 */

import {
  Pt,
  TownObject,
  TownDistrictKind,
  TownBuildingKind,
} from '../../types/town';
import {
  clipboardToObjects,
  flipObject,
  objectsToClipboard,
  rotateObject,
} from './townBuild';

export const VALID_DISTRICT_KINDS: readonly TownDistrictKind[] = [
  'residential',
  'market',
  'noble',
  'poor',
  'park',
  'farmland',
] as const;

export const VALID_BUILDING_KINDS: readonly TownBuildingKind[] = [
  'house',
  'shop',
  'hall',
  'church',
  'keep',
  'tower',
  'barn',
] as const;

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

  // If id is missing, empty, or not a string, assign a new ID instead of returning null
  const id =
    typeof data.id === 'string' && data.id.trim()
      ? data.id.trim()
      : `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

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
    const objName =
      typeof obj.name === 'string' && obj.name.trim().length > 0
        ? obj.name.trim().slice(0, 100)
        : undefined;

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
        const districtKind =
          typeof obj.districtKind === 'string' && (VALID_DISTRICT_KINDS as readonly string[]).includes(obj.districtKind)
            ? (obj.districtKind as TownDistrictKind)
            : 'residential';
        sanitizedObjects.push({
          id: objId,
          kind: 'district',
          ...(objName !== undefined ? { name: objName } : {}),
          polygon: validPoly,
          districtKind,
        });
      } else {
        const buildingKind =
          typeof obj.buildingKind === 'string' && (VALID_BUILDING_KINDS as readonly string[]).includes(obj.buildingKind)
            ? (obj.buildingKind as TownBuildingKind)
            : 'house';
        const heightM = typeof obj.heightM === 'number' && !isNaN(obj.heightM) ? Math.max(1, obj.heightM) : 6;
        const tone = typeof obj.tone === 'number' && !isNaN(obj.tone) ? Math.max(0, Math.min(1, obj.tone)) : 0.5;
        sanitizedObjects.push({
          id: objId,
          kind: 'building',
          ...(objName !== undefined ? { name: objName } : {}),
          polygon: validPoly,
          buildingKind,
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
          ...(objName !== undefined ? { name: objName } : {}),
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
          ...(objName !== undefined ? { name: objName } : {}),
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
        const maxSegments = closed ? validPoints.length : validPoints.length - 1;
        if (Array.isArray(obj.gates)) {
          for (const g of obj.gates) {
            if (!g || typeof g !== 'object') continue;
            const gate = g as Record<string, unknown>;
            const segIdx =
              typeof gate.segmentIndex === 'number' && Number.isInteger(gate.segmentIndex)
                ? gate.segmentIndex
                : -1;
            if (segIdx < 0 || segIdx >= maxSegments) continue;
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
          ...(objName !== undefined ? { name: objName } : {}),
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
 * Accepts only { format: 'hg-town-templates', version: 1, templates: [...] }.
 */
export function parseTemplateLibrary(text: string): {
  templates: TownTemplate[];
  skipped: number;
  error?: string;
} {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { templates: [], skipped: 0, error: 'テンプレートファイルの形式が一致しません。' };
    }

    if (raw.format !== 'hg-town-templates' || !Array.isArray(raw.templates)) {
      return { templates: [], skipped: 0, error: 'テンプレートファイルの形式が一致しません。' };
    }

    if (typeof raw.version !== 'number' || isNaN(raw.version) || raw.version > 1) {
      return {
        templates: [],
        skipped: 0,
        error: `このテンプレートファイルは、新しい形式(version ${raw.version})のため、読み込めません。`,
      };
    }

    const valid: TownTemplate[] = [];
    let skipped = 0;

    for (const item of raw.templates) {
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
 * Generates a unique template name avoiding case-insensitive collisions with existingNames.
 * Appends " (2)", " (3)", etc. Truncates base name if resulting length exceeds 60 characters.
 */
export function uniqueTemplateName(name: string, existingNames: string[]): string {
  const lowerSet = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!lowerSet.has(name.toLowerCase())) {
    return name;
  }

  let counter = 2;
  while (true) {
    const suffix = ` (${counter})`;
    const maxBaseLen = Math.max(0, 60 - suffix.length);
    const base = name.length > maxBaseLen ? name.slice(0, maxBaseLen) : name;
    const candidate = `${base}${suffix}`;
    if (!lowerSet.has(candidate.toLowerCase())) {
      return candidate;
    }
    counter++;
  }
}

/**
 * Merges incoming templates into an existing template library.
 * - Resolves ID collisions.
 * - Deduplicates names using uniqueTemplateName.
 * - Caps maximum total templates at maxCount (default: 100).
 */
export function mergeTemplates(
  existing: TownTemplate[],
  incoming: TownTemplate[],
  maxCount: number = 100
): TownTemplate[] {
  const result: TownTemplate[] = [...existing];
  const existingIds = new Set<string>(existing.map((t) => t.id));
  const currentNames: string[] = existing.map((t) => t.name);

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
 * Places a template onto townObjects at the specified anchor point, returning the updated objects array and IDs.
 * Pure function: prevObjects is untouched; newObjects contains [...townObjects, ...placed].
 */
export function placeTemplate(
  townObjects: TownObject[],
  template: TownTemplate,
  anchor: Pt,
  metersPerUnit: number,
  opts: { angleDeg: number; flipX: boolean }
): {
  prevObjects: TownObject[];
  newObjects: TownObject[];
  placedIds: string[];
} {
  const existingIds = new Set<string>(townObjects.map((o) => o.id));
  const placed = instantiateTemplate(template, anchor, metersPerUnit, {
    angleDeg: opts.angleDeg,
    flipX: opts.flipX,
    existingIds,
  });
  const placedIds = placed.map((o) => o.id);
  const newObjects = [...townObjects, ...placed];
  return {
    prevObjects: townObjects,
    newObjects,
    placedIds,
  };
}
