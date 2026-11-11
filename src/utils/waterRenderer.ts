/**
 * Cartographic Water Renderer (Rivers & Lakes)
 * Renders variable-width rivers with natural casing outlines, organic lake shorelines,
 * seamless confluences, antique fantasy water fills, and interactive vector handles.
 */

import { RiverData, LakeData } from '../types/water';
import { pointInLake, sampleElev } from './waterGenerator';

export interface DrawWaterOptions {
  zoom: number;
  dpr?: number;
  cellSize?: number;
  selectedId?: string | null;
  hoveredId?: string | null;
  selectedVertexIndex?: number | null;
  showLabels?: boolean;
  viewBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  elevationGrid?: Float32Array;
  gridCols?: number;
  gridRows?: number;
  seaLevel?: number;
  mapWidth?: number;
  mapHeight?: number;
  carvedIntoTerrain?: boolean;
}

export const WATER_STYLE = {
  // Rich antique fantasy teal matching planetary sea / ocean
  waterFill: '#4d7a82',
  // Luminous turquoise shallows matching ocean paleShallow (#7bc5c5)
  waterShallow: '#7bc4c4',
  // Deeper core channel teal
  waterDeep: '#3a666e',
  // Soft antique sand / parchment wash bordering riverbanks and lake shores
  bankSand: '#d9c9a6',
  // Dark drawing ink border
  ink: '#1e1a14',
  selectedGlow: '#f59e0b',
  hoverGlow: '#38bdf8',
  vertexHandle: '#fbbf24',
};

/**
 * Parses RGB or Hex CSS color string into numeric RGB components.
 */
export function parseRgb(color: string): { r: number; g: number; b: number } {
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  } else if (color.startsWith('rgb')) {
    const match = color.match(/\d+/g);
    if (match && match.length >= 3) {
      return {
        r: parseInt(match[0], 10),
        g: parseInt(match[1], 10),
        b: parseInt(match[2], 10),
      };
    }
  }
  return { r: 77, g: 122, b: 130 };
}

/**
 * Linearly interpolates between two RGB or Hex colors.
 */
export function interpolateRgb(c1: string, c2: string, t: number): string {
  const p1 = parseRgb(c1);
  const p2 = parseRgb(c2);
  const clampT = Math.max(0, Math.min(1, t));
  const r = Math.round(p1.r + (p2.r - p1.r) * clampT);
  const g = Math.round(p1.g + (p2.g - p1.g) * clampT);
  const b = Math.round(p1.b + (p2.b - p1.b) * clampT);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Computes the river shallow water color at fractional position t along the river (0 = source, 1 = mouth).
 * Matches the sea's bright coastal shallow aura (#7bc5c5 / rgb(123, 196, 196)):
 * - Source (t = 0): Luminous highland mountain stream shallows (rgb(142, 216, 214))
 * - Mouth (t = 1): Matches coastal ocean / paleShallow (rgb(123, 196, 196))
 */
export function getRiverShallowColorAtFrac(t: number, customColor?: string): string {
  const clampT = Math.max(0, Math.min(1, t));
  if (customColor && customColor !== WATER_STYLE.waterFill) {
    const base = parseRgb(customColor);
    const r = Math.round(base.r * 0.40 + 123 * 0.60);
    const g = Math.round(base.g * 0.40 + 196 * 0.60);
    const b = Math.round(base.b * 0.40 + 196 * 0.60);
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Source: luminous, clear highland stream shallows
  const sR = 142, sG = 216, sB = 214;
  // Mouth: ocean paleShallow / waterShallow (rgb(123, 196, 196))
  const mR = 123, mG = 196, mB = 196;

  const r = Math.round(sR + (mR - sR) * clampT);
  const g = Math.round(sG + (mG - sG) * clampT);
  const b = Math.round(sB + (mB - sB) * clampT);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Converts a hex or rgb CSS color string to rgba with specified alpha opacity.
 */
export function colorWithAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  } else if (color.startsWith('rgb')) {
    const match = color.match(/\d+(\.\d+)?/g);
    if (match && match.length >= 3) {
      return `rgba(${match[0]}, ${match[1]}, ${match[2]}, ${alpha})`;
    }
  }
  return `rgba(77, 122, 130, ${alpha})`;
}

/**
 * Generates a semicircle cap at the river mouth protruding downstream.
 * Maintained for backward compatibility.
 */
export function createRiverMouthCap(
  mouthPt: [number, number],
  tangent: [number, number],
  halfWidth: number,
  numSegments: number = 12
): [number, number][] {
  const theta = Math.atan2(tangent[1], tangent[0]);
  const cap: [number, number][] = [];

  for (let k = 0; k <= numSegments; k++) {
    const a = (theta + Math.PI * 0.5) - (k / numSegments) * Math.PI;
    cap.push([
      mouthPt[0] + halfWidth * Math.cos(a),
      mouthPt[1] + halfWidth * Math.sin(a),
    ]);
  }

  return cap;
}

/**
 * Computes spacing-independent, distance-based river widths along polyline points.
 * For ocean estuaries, applies smoothstep flare up to 1.4x over max(6 * widthEnd, 6 * cellSize),
 * and a smoothstep tip taper down to 0.7x over the final 1.5 * widthEnd.
 */
export function computeRiverPointWidths(
  points: [number, number][],
  widthStart: number,
  widthEnd: number,
  isEstuary: boolean = false,
  cellSize: number = 1.0
): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [widthStart];

  const cumDists: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    cumDists.push(cumDists[i] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]));
  }
  const totalLength = cumDists[n - 1];

  const flareLength = Math.max(widthEnd * 6, cellSize * 6);
  const taperLength = widthEnd * 1.5;

  const widths: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = totalLength > 1e-6 ? cumDists[i] / totalLength : i / (n - 1);
    const baseW = widthStart + (widthEnd - widthStart) * t;

    if (!isEstuary) {
      widths.push(baseW);
      continue;
    }

    const distFromMouth = totalLength - cumDists[i];

    // Flare: smoothstep up to 1.4x
    let flareMult = 1.0;
    if (distFromMouth < flareLength && flareLength > 0) {
      const u = Math.max(0, Math.min(1, 1 - (distFromMouth / flareLength)));
      const sFlare = u * u * (3 - 2 * u);
      flareMult = 1.0 + sFlare * 0.40;
    }

    // Tip taper: smoothstep down from 1.0 to 0.7x over final 1.5 * widthEnd
    let taperMult = 1.0;
    if (distFromMouth < taperLength && taperLength > 0) {
      const v = Math.max(0, Math.min(1, 1 - (distFromMouth / taperLength)));
      const sTaper = v * v * (3 - 2 * v);
      taperMult = 1.0 - sTaper * 0.30;
    }

    widths.push(baseW * flareMult * taperMult);
  }

  return widths;
}

export interface RiverStrokeGroup {
  points: [number, number][];
  width: number;
  startIndex?: number;
  endIndex?: number;
}

/**
 * Computes the river water fill color at fractional position t along the river (0 = source, 1 = mouth).
 * Creates a subtle, natural cartographic gradient:
 * - Source (t = 0): Clear, fresh highland mountain stream tint (rgb(90, 142, 150))
 * - Mouth (t = 1): Matches coastal ocean / sea color (rgb(77, 122, 130))
 */
export function getRiverColorAtFrac(t: number, customColor?: string): string {
  const clampT = Math.max(0, Math.min(1, t));
  if (customColor && customColor !== WATER_STYLE.waterFill) {
    return customColor;
  }

  // Source: clear, fresh mountain stream
  const sR = 90, sG = 142, sB = 150;
  // Mouth: coastal ocean / sea
  const mR = 77, mG = 122, mB = 130;

  const r = Math.round(sR + (mR - sR) * clampT);
  const g = Math.round(sG + (mG - sG) * clampT);
  const b = Math.round(sB + (mB - sB) * clampT);

  return `rgb(${r}, ${g}, ${b})`;
}

export interface StrokeBucketOptions {
  step?: number;
  zoomPx?: number;
  maxBuckets?: number;
  bucketCount?: number;
}

/**
 * Quantizes river width to the nearest step.
 * quantizeWidth(w, step) = round(w ÷ step) × step
 */
export function quantizeWidth(w: number, step: number): number {
  if (step <= 0) return w;
  return Math.round(w / step) * step;
}

/**
 * Quantizes river segments into width buckets, grouping continuous segments
 * of the same bucket so they can be stroked in a single canvas pass.
 * Boundary vertices are shared between adjacent groups to prevent gaps.
 * When screen width is < 2 pixels, draws using a single average width.
 */
export function partitionRiverStrokeBuckets(
  points: [number, number][],
  widths: number[],
  options?: number | StrokeBucketOptions
): RiverStrokeGroup[] {
  const n = points.length;
  if (n < 2) {
    if (n === 1) return [{ points: [[points[0][0], points[0][1]]], width: widths[0] ?? 1.5 }];
    return [];
  }

  // Calculate segment widths (average of endpoints)
  const segWidths: number[] = new Array(n - 1);
  let minW = Infinity;
  let maxW = -Infinity;
  let sumW = 0;

  for (let j = 0; j < n - 1; j++) {
    const sw = ((widths[j] ?? 1.5) + (widths[j + 1] ?? widths[j] ?? 1.5)) * 0.5;
    segWidths[j] = sw;
    sumW += sw;
    if (sw < minW) minW = sw;
    if (sw > maxW) maxW = sw;
  }
  const avgW = sumW / (n - 1);

  if (n === 2) {
    return [{ points: [points[0], points[1]], width: segWidths[0], startIndex: 0, endIndex: 1 }];
  }

  // If width is uniform across all segments, return 1 group
  if (maxW - minW < 1e-6) {
    return [{ points: points.slice(), width: (minW + maxW) * 0.5, startIndex: 0, endIndex: n - 1 }];
  }

  let zoomPx: number | undefined;
  let explicitStep: number | undefined;
  let maxBuckets = 128;
  let legacyBucketCount: number | undefined;

  if (typeof options === 'number') {
    legacyBucketCount = options;
  } else if (options) {
    zoomPx = options.zoomPx;
    explicitStep = options.step;
    if (options.maxBuckets !== undefined) maxBuckets = options.maxBuckets;
    if (options.bucketCount !== undefined) legacyBucketCount = options.bucketCount;
  }

  // Screen width < 2 pixels: draw using single average width
  if (zoomPx !== undefined && zoomPx > 0) {
    const maxScreenW = maxW * zoomPx;
    if (maxScreenW < 2.0) {
      return [{ points: points.slice(), width: avgW, startIndex: 0, endIndex: n - 1 }];
    }
  }

  // Determine step
  let step: number;
  if (explicitStep !== undefined && explicitStep > 0) {
    step = explicitStep;
    const neededBuckets = (maxW - minW) / step;
    if (neededBuckets > maxBuckets) {
      step = (maxW - minW) / maxBuckets;
    }
  } else if (legacyBucketCount !== undefined && legacyBucketCount > 0) {
    const B = Math.max(1, Math.min(maxBuckets, Math.floor(legacyBucketCount)));
    step = (maxW - minW) / B;
  } else {
    const z = zoomPx && zoomPx > 0 ? zoomPx : 1.0;
    const targetStep = 0.6 / z;
    const neededBuckets = (maxW - minW) / targetStep;
    if (neededBuckets > maxBuckets) {
      step = (maxW - minW) / maxBuckets;
    } else {
      step = targetStep;
    }
  }

  if (step <= 0) {
    return [{ points: points.slice(), width: avgW, startIndex: 0, endIndex: n - 1 }];
  }

  const groups: RiverStrokeGroup[] = [];
  let currentQuantizedW = quantizeWidth(segWidths[0], step);
  let currentPoints: [number, number][] = [points[0], points[1]];
  let currentStartIdx = 0;

  for (let j = 1; j < n - 1; j++) {
    const qw = quantizeWidth(segWidths[j], step);
    if (Math.abs(qw - currentQuantizedW) < 1e-6) {
      currentPoints.push(points[j + 1]);
    } else {
      groups.push({
        points: currentPoints,
        width: currentQuantizedW,
        startIndex: currentStartIdx,
        endIndex: j,
      });
      // Share endpoint points[j] with next group to prevent gaps
      currentPoints = [points[j], points[j + 1]];
      currentQuantizedW = qw;
      currentStartIdx = j;
    }
  }

  groups.push({
    points: currentPoints,
    width: currentQuantizedW,
    startIndex: currentStartIdx,
    endIndex: n - 1,
  });

  return groups;
}

/**
 * Quantizes river segments into width buckets, grouping continuous segments
 * of the same bucket so they can be stroked in a single canvas pass.
 * Boundary vertices are shared between adjacent groups to prevent gaps or dropped vertices.
 */
export function buildRiverStrokeGroups(
  points: [number, number][],
  widths: number[],
  options?: number | StrokeBucketOptions
): RiverStrokeGroup[] {
  return partitionRiverStrokeBuckets(points, widths, options);
}

/**
 * Computes normal offsets for variable-width polyline.
 * Maintained for backwards compatibility; uses computeRiverPointWidths internally.
 */
export function computeVariableWidthPolyline(
  points: [number, number][],
  widthStart: number,
  widthEnd: number,
  isEstuary: boolean = false,
  cellSize: number = 1.0
): {
  left: [number, number][];
  right: [number, number][];
  halfWidths: number[];
  mouthCap?: [number, number][];
} {
  const n = points.length;
  if (n < 2) {
    const hw = [(widthStart ?? 1.5) * 0.5];
    return { left: points, right: points, halfWidths: hw };
  }

  const fullWidths = computeRiverPointWidths(points, widthStart, widthEnd, isEstuary, cellSize);
  const halfWidths = fullWidths.map((w) => w * 0.5);

  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const halfW = halfWidths[i];
    let dx = 0;
    let dy = 0;

    if (i === 0) {
      dx = points[1][0] - points[0][0];
      dy = points[1][1] - points[0][1];
    } else if (i === n - 1) {
      dx = points[n - 1][0] - points[n - 2][0];
      dy = points[n - 1][1] - points[n - 2][1];
    } else {
      dx = points[i + 1][0] - points[i - 1][0];
      dy = points[i + 1][1] - points[i - 1][1];
    }

    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    left.push([points[i][0] + nx * halfW, points[i][1] + ny * halfW]);
    right.push([points[i][0] - nx * halfW, points[i][1] - ny * halfW]);
  }

  let mouthCap: [number, number][] | undefined;
  if (isEstuary) {
    const lastDx = points[n - 1][0] - points[n - 2][0];
    const lastDy = points[n - 1][1] - points[n - 2][1];
    const lastLen = Math.hypot(lastDx, lastDy) || 1;
    const tangent: [number, number] = [lastDx / lastLen, lastDy / lastLen];
    const mouthHW = halfWidths[n - 1];
    mouthCap = createRiverMouthCap(points[n - 1], tangent, mouthHW, 12);
  }

  return { left, right, halfWidths, mouthCap };
}

interface LakeRiverJunction {
  pt: [number, number];
  width: number;
}

/**
 * Finds all river junctions (inflow and outflow) connected to a lake.
 */
function getLakeJunctions(lake: LakeData, rivers: RiverData[]): LakeRiverJunction[] {
  const junctions: LakeRiverJunction[] = [];

  for (const r of rivers) {
    if (!r.points || r.points.length < 2) continue;

    // Check outflow (river starts at or near this lake)
    const isOutflow = r.sourceLakeId === lake.id || pointInLake(r.points[0][0], r.points[0][1], lake.polygon);
    if (isOutflow) {
      junctions.push({
        pt: r.points[0],
        width: r.widthStart || 2.0,
      });
      continue;
    }

    // Check inflow (river ends at or near this lake)
    const lastP = r.points[r.points.length - 1];
    const isInflow = r.targetLakeId === lake.id || pointInLake(lastP[0], lastP[1], lake.polygon);
    if (isInflow) {
      junctions.push({
        pt: lastP,
        width: r.widthEnd || 4.0,
      });
    }
  }

  return junctions;
}

export interface OceanPlumeData {
  pCoast: [number, number];
  dir: [number, number];
  mouthWidth: number;
}

/**
 * Detects whether a river terminates at or near the coastline, and locates the exact
 * coastline crossing point (pCoast) and outflow direction vector (dir).
 */
export function findRiverCoastline(
  pts: [number, number][],
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  seaLevel: number,
  mouthWidth: number
): { pCoast: [number, number]; dir: [number, number] } | null {
  const n = pts.length;
  if (n < 2) return null;

  const pLast = pts[n - 1];
  const pPrev = pts[n - 2];
  const dx = pLast[0] - pPrev[0];
  const dy = pLast[1] - pPrev[1];
  const len = Math.hypot(dx, dy) || 1;
  const dir: [number, number] = [dx / len, dy / len];

  const eLast = sampleElev(elevationGrid, cols, rows, mapW, mapH, pLast[0], pLast[1]);

  // Case 1: pLast is already in the sea or right on the shoreline
  if (eLast <= seaLevel) {
    for (let i = n - 2; i >= 0; i--) {
      const eA = sampleElev(elevationGrid, cols, rows, mapW, mapH, pts[i][0], pts[i][1]);
      const eB = sampleElev(elevationGrid, cols, rows, mapW, mapH, pts[i + 1][0], pts[i + 1][1]);
      if (eA >= seaLevel && eB <= seaLevel) {
        const t = eA === eB ? 0.5 : Math.max(0, Math.min(1, (seaLevel - eA) / (eB - eA)));
        return {
          pCoast: [
            pts[i][0] + t * (pts[i + 1][0] - pts[i][0]),
            pts[i][1] + t * (pts[i + 1][1] - pts[i][1]),
          ],
          dir,
        };
      }
    }
    return { pCoast: [pLast[0], pLast[1]], dir };
  }

  // Case 2: pLast is on land (e.g. beach) heading towards the sea.
  // Search downstream along dir up to searchDist for the coastline.
  const searchDist = Math.max(40, mouthWidth * 4.0);
  const steps = 16;
  let prevPt = pLast;
  let prevElev = eLast;

  for (let s = 1; s <= steps; s++) {
    const dist = (s / steps) * searchDist;
    const candPt: [number, number] = [pLast[0] + dir[0] * dist, pLast[1] + dir[1] * dist];
    const candElev = sampleElev(elevationGrid, cols, rows, mapW, mapH, candPt[0], candPt[1]);

    if (candElev <= seaLevel) {
      const t = prevElev === candElev ? 0.5 : Math.max(0, Math.min(1, (seaLevel - prevElev) / (candElev - prevElev)));
      return {
        pCoast: [
          prevPt[0] + t * (candPt[0] - prevPt[0]),
          prevPt[1] + t * (candPt[1] - prevPt[1]),
        ],
        dir,
      };
    }
    prevPt = candPt;
    prevElev = candElev;
  }

  return null;
}

interface PreparedRiver {
  river: RiverData;
  points: [number, number][];
  strokeGroups: RiverStrokeGroup[];
  isSelected: boolean;
  isHovered: boolean;
  isAtSea: boolean;
  oceanPlume?: OceanPlumeData;
}

/**
 * Renders all rivers and lakes onto a 2D canvas context with seamless casing connections.
 */
export function drawWaterBodies(
  ctx: CanvasRenderingContext2D,
  rivers: RiverData[] = [],
  lakes: LakeData[] = [],
  options: DrawWaterOptions
): void {
  const zoomPx = (options.zoom || 1) * (options.dpr || 1);
  const selectedId = options.selectedId;
  const hoveredId = options.hoveredId;
  const viewBounds = options.viewBounds;

  ctx.save();

  // ==========================================
  // Pass 0: Lake Fills (Rendered as water surface)
  // ==========================================
  for (const lake of lakes) {
    const poly = lake.polygon;
    if (!poly || poly.length < 3) continue;

    if (viewBounds) {
      let lMinX = Infinity;
      let lMinY = Infinity;
      let lMaxX = -Infinity;
      let lMaxY = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const x = poly[i][0];
        const y = poly[i][1];
        if (x < lMinX) lMinX = x;
        if (x > lMaxX) lMaxX = x;
        if (y < lMinY) lMinY = y;
        if (y > lMaxY) lMaxY = y;
      }
      if (
        lMaxX < viewBounds.minX - 10 ||
        lMinX > viewBounds.maxX + 10 ||
        lMaxY < viewBounds.minY - 10 ||
        lMinY > viewBounds.maxY + 10
      ) {
        continue;
      }
    }

    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = lake.color || WATER_STYLE.waterFill;
    ctx.fill();
  }

  // ==========================================
  // Precompute River Stroke Groups & Culling
  // ==========================================
  const preparedRivers: PreparedRiver[] = [];
  for (const river of rivers) {
    const rawPts = river.points;
    if (!rawPts || rawPts.length < 2) continue;

    const wStart = river.widthStart ?? 1.5;
    const wEnd = river.widthEnd ?? 4.5;

    // Detect if river terminates at or near the ocean/sea
    const nPts = rawPts.length;
    const pLast = rawPts[nPts - 1];
    const pPrev = rawPts[nPts - 2];
    const rawDx = pLast[0] - pPrev[0];
    const rawDy = pLast[1] - pPrev[1];
    const rawLen = Math.hypot(rawDx, rawDy) || 1;
    const rawDir: [number, number] = [rawDx / rawLen, rawDy / rawLen];

    let isAtSea = river.terminatesAt === 'ocean';
    let coastInfo: { pCoast: [number, number]; dir: [number, number] } | null = null;

    if (river.terminatesAt !== 'lake' && river.terminatesAt !== 'river') {
      if (options.elevationGrid && options.gridCols && options.gridRows && options.seaLevel !== undefined) {
        coastInfo = findRiverCoastline(
          rawPts,
          options.elevationGrid,
          options.gridCols,
          options.gridRows,
          options.mapWidth || 1000,
          options.mapHeight || 1000,
          options.seaLevel,
          wEnd
        );
        if (coastInfo) {
          isAtSea = true;
        } else if (isAtSea) {
          coastInfo = { pCoast: [pLast[0], pLast[1]], dir: rawDir };
        }
      } else if (isAtSea) {
        coastInfo = { pCoast: [pLast[0], pLast[1]], dir: rawDir };
      }
    }

    const pts: [number, number][] = rawPts.map((p) => [p[0], p[1]]);
    if (isAtSea && coastInfo) {
      pts[pts.length - 1] = [coastInfo.pCoast[0], coastInfo.pCoast[1]];
    }

    const oceanPlume: OceanPlumeData | undefined =
      isAtSea && coastInfo
        ? {
            pCoast: coastInfo.pCoast,
            dir: coastInfo.dir,
            mouthWidth: Math.max(wEnd, 3.5),
          }
        : undefined;

    const isEstuary = isAtSea;

    if (viewBounds) {
      let rMinX = Infinity;
      let rMinY = Infinity;
      let rMaxX = -Infinity;
      let rMaxY = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i][0];
        const y = pts[i][1];
        if (x < rMinX) rMinX = x;
        if (x > rMaxX) rMaxX = x;
        if (y < rMinY) rMinY = y;
        if (y > rMaxY) rMaxY = y;
      }
      const margin = Math.max(wEnd * 2.5, 20);
      if (
        rMaxX < viewBounds.minX - margin ||
        rMinX > viewBounds.maxX + margin ||
        rMaxY < viewBounds.minY - margin ||
        rMinY > viewBounds.maxY + margin
      ) {
        continue;
      }
    }

    const widths = computeRiverPointWidths(pts, wStart, wEnd, isEstuary, options.cellSize ?? 1.0);
    const strokeGroups = buildRiverStrokeGroups(pts, widths, { zoomPx });

    preparedRivers.push({
      river,
      points: pts,
      strokeGroups,
      isSelected: selectedId === river.id,
      isHovered: hoveredId === river.id,
      isAtSea,
      oceanPlume,
    });
  }

  // ==========================================
  // Pass 1 & 2: 2D Vector River Casings and Fills (Always rendered as water surface)
  // ==========================================
  // Common stroke settings for casing and fill
    const minWidthWorld = 1.0 / zoomPx;
    const borderWidth = 1.1 / zoomPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Pass 1A: River Bank Sand Wash & Sepia Halo (河岸の砂岸・明色ハロー)
  // 地形に直接彫り込まれている場合は地形自体の陰影と標高色があるため、二重の砂岸ハローはスキップして自然な河床に密着
  if (!options.carvedIntoTerrain) {
    // 1A-1: Outer antique parchment sepia halo
    ctx.strokeStyle = '#c4b882';
    ctx.fillStyle = '#c4b882';
    for (const prep of preparedRivers) {
      const numGroups = prep.strokeGroups.length;
      for (let gIdx = 0; gIdx < numGroups; gIdx++) {
        const group = prep.strokeGroups[gIdx];
        const gPts = group.points;
        if (gPts.length < 2) continue;

        const effW = Math.max(group.width, minWidthWorld);
        ctx.lineWidth = effW + 2 * borderWidth + (4.6 / zoomPx);

        const isOceanLastGroup = prep.isAtSea && gIdx === numGroups - 1;
        ctx.lineCap = isOceanLastGroup ? 'butt' : 'round';

        ctx.beginPath();
        ctx.moveTo(gPts[0][0], gPts[0][1]);
        for (let i = 1; i < gPts.length; i++) {
          ctx.lineTo(gPts[i][0], gPts[i][1]);
        }
        ctx.stroke();

        if (numGroups === 1 && prep.isAtSea) {
          ctx.beginPath();
          ctx.arc(gPts[0][0], gPts[0][1], ctx.lineWidth * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 1A-2: Inner authentic dune sand ribbon (#d9c9a6)
    ctx.strokeStyle = WATER_STYLE.bankSand;
    ctx.fillStyle = WATER_STYLE.bankSand;
    for (const prep of preparedRivers) {
      const numGroups = prep.strokeGroups.length;
      for (let gIdx = 0; gIdx < numGroups; gIdx++) {
        const group = prep.strokeGroups[gIdx];
        const gPts = group.points;
        if (gPts.length < 2) continue;

        const effW = Math.max(group.width, minWidthWorld);
        ctx.lineWidth = effW + 2 * borderWidth + (2.4 / zoomPx);

        const isOceanLastGroup = prep.isAtSea && gIdx === numGroups - 1;
        ctx.lineCap = isOceanLastGroup ? 'butt' : 'round';

        ctx.beginPath();
        ctx.moveTo(gPts[0][0], gPts[0][1]);
        for (let i = 1; i < gPts.length; i++) {
          ctx.lineTo(gPts[i][0], gPts[i][1]);
        }
        ctx.stroke();

        if (numGroups === 1 && prep.isAtSea) {
          ctx.beginPath();
          ctx.arc(gPts[0][0], gPts[0][1], ctx.lineWidth * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // ==========================================
  // Pass 1B: River Casing (墨の縁取り線)
  // All rivers' casings drawn first so confluences blend seamlessly in Pass 2.
  // For rivers terminating at ocean, the terminal stroke uses lineCap = 'butt' so
  // no rounded black cap protrudes into the sea.
  // ==========================================
  for (const prep of preparedRivers) {
    const borderColor = prep.river.borderColor || WATER_STYLE.ink;
    ctx.strokeStyle = borderColor;
    ctx.fillStyle = borderColor;
    ctx.lineJoin = 'round';

    const numGroups = prep.strokeGroups.length;
    for (let gIdx = 0; gIdx < numGroups; gIdx++) {
      const group = prep.strokeGroups[gIdx];
      const gPts = group.points;
      if (gPts.length < 2) continue;

      const effW = Math.max(group.width, minWidthWorld);
      ctx.lineWidth = effW + 2 * borderWidth;

      const isOceanLastGroup = prep.isAtSea && gIdx === numGroups - 1;
      ctx.lineCap = isOceanLastGroup ? 'butt' : 'round';

      ctx.beginPath();
      ctx.moveTo(gPts[0][0], gPts[0][1]);
      for (let i = 1; i < gPts.length; i++) {
        ctx.lineTo(gPts[i][0], gPts[i][1]);
      }
      ctx.stroke();

      if (numGroups === 1 && prep.isAtSea) {
        ctx.beginPath();
        ctx.arc(gPts[0][0], gPts[0][1], ctx.lineWidth * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ==========================================
  // Pass 2: River Fills with Delicate, Seamless Shallow-to-Deep Water
  // Completely OPAQUE layers to strictly eliminate circular bead / disc artifacts
  // and provide a delicate, refined transition like the sea's coastal shallows.
  // ==========================================
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const prep of preparedRivers) {
    const pts = prep.points;
    const n = pts.length;
    if (n < 2) continue;

    const cumDists: number[] = [0];
    for (let i = 0; i < n - 1; i++) {
      cumDists.push(cumDists[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
    }
    const totalLen = cumDists[n - 1] || 1;
    const numGroups = prep.strokeGroups.length;

    // Precalculate group metadata
    const groupInfos = prep.strokeGroups.map((group, gIdx) => {
      const gPts = group.points;
      const effW = Math.max(group.width, minWidthWorld);
      const screenW = effW * zoomPx;
      const startIdx = group.startIndex ?? 0;
      const endIdx = group.endIndex ?? (n - 1);
      const tStart = (cumDists[Math.min(startIdx, n - 1)] ?? 0) / totalLen;
      const tEnd = (cumDists[Math.min(endIdx, n - 1)] ?? totalLen) / totalLen;
      const colDeepStart = getRiverColorAtFrac(tStart, prep.river.color);
      const colDeepEnd = getRiverColorAtFrac(tEnd, prep.river.color);
      const colShallowStart = getRiverShallowColorAtFrac(tStart, prep.river.color);
      const colShallowEnd = getRiverShallowColorAtFrac(tEnd, prep.river.color);

      const isOceanLast = prep.isAtSea && gIdx === numGroups - 1;

      return {
        group,
        gPts,
        effW,
        screenW,
        colDeepStart,
        colDeepEnd,
        colShallowStart,
        colShallowEnd,
        isOceanLast,
      };
    });

    let maxScreenW = 0;
    for (const info of groupInfos) {
      if (info.screenW > maxScreenW) maxScreenW = info.screenW;
    }

    // Determine sub-pixel depth layers:
    // All layers are 100% OPAQUE to strictly eliminate circular bead / disc artifacts
    // and scale proportionally with river width to ensure luminous shallows are always visible
    type LayerSpec = {
      widthRatio: number; // multiplier on effW
      minInsetPx: number; // minimum screen inset in pixels
      colFactor: number;  // 1.0 = pure shallows, 0.0 = pure deep core
    };

    // 単一の自然で滑らかな水面ストローク (不自然な同心円状の多段ストライプ・シール感を解消)
    const layers: LayerSpec[] = [{ widthRatio: 1.0, minInsetPx: 0, colFactor: 0.0 }];

    for (const layer of layers) {
      for (let gIdx = 0; gIdx < numGroups; gIdx++) {
        const info = groupInfos[gIdx];
        const gPts = info.gPts;
        if (gPts.length < 2) continue;

        let layerW = info.effW * layer.widthRatio;
        if (layer.minInsetPx > 0) {
          const maxAllowedW = info.effW - (layer.minInsetPx * 2.0) / zoomPx;
          if (maxAllowedW <= minWidthWorld * 0.5) continue;
          layerW = Math.min(layerW, maxAllowedW);
        }
        layerW = Math.max(minWidthWorld, layerW);

        ctx.lineWidth = layerW;
        ctx.lineCap = info.isOceanLast ? 'butt' : 'round';

        const colStart =
          layer.colFactor === 1.0
            ? info.colShallowStart
            : layer.colFactor === 0.0
            ? info.colDeepStart
            : interpolateRgb(info.colDeepStart, info.colShallowStart, layer.colFactor);

        const colEnd =
          layer.colFactor === 1.0
            ? info.colShallowEnd
            : layer.colFactor === 0.0
            ? info.colDeepEnd
            : interpolateRgb(info.colDeepEnd, info.colShallowEnd, layer.colFactor);

        if (colStart === colEnd || gPts.length < 2) {
          ctx.strokeStyle = colStart;
        } else {
          const pA = gPts[0];
          const pB = gPts[gPts.length - 1];
          if (Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) < 0.1) {
            ctx.strokeStyle = colStart;
          } else {
            const grad = ctx.createLinearGradient(pA[0], pA[1], pB[0], pB[1]);
            grad.addColorStop(0, colStart);
            grad.addColorStop(1, colEnd);
            ctx.strokeStyle = grad;
          }
        }

        ctx.beginPath();
        ctx.moveTo(gPts[0][0], gPts[0][1]);
        for (let i = 1; i < gPts.length; i++) {
          ctx.lineTo(gPts[i][0], gPts[i][1]);
        }
        ctx.stroke();

        if (numGroups === 1 && prep.isAtSea) {
          ctx.fillStyle = colStart;
          ctx.beginPath();
          ctx.arc(gPts[0][0], gPts[0][1], layerW * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // ----------------------------------------------------
    // Ocean Estuary Gateway: Breaches the coastline and flows directly into the sea
    // Completely covers the beach and coastline edge with a flush, flared gateway polygon
    // matching the coastal shallows (#7bc5c5) and coastal sea (#408087).
    // NO circular dome, NO bubble arc!
    // ----------------------------------------------------
    if (prep.oceanPlume) {
      const { pCoast, dir, mouthWidth } = prep.oceanPlume;
      const effMouthW = Math.max(mouthWidth, minWidthWorld * 2.5);
      const mouthHW = effMouthW * 0.5;

      const normX = -dir[1];
      const normY = dir[0];

      // Reach just 2.8 screen pixels offshore to completely erase the WebGL 1.8px coastline bar
      const reachOffshore = 2.8 / zoomPx;
      const flareHW = mouthHW * 1.12;

      // Upstream reach on land to guarantee 100% seamless overlap with the river strokes
      const upstreamDist = Math.max(2.0 / zoomPx, mouthHW * 0.35);

      const pLeftCoast: [number, number] = [pCoast[0] + normX * mouthHW, pCoast[1] + normY * mouthHW];
      const pRightCoast: [number, number] = [pCoast[0] - normX * mouthHW, pCoast[1] - normY * mouthHW];

      const pLeftOffshore: [number, number] = [
        pCoast[0] + dir[0] * reachOffshore + normX * flareHW,
        pCoast[1] + dir[1] * reachOffshore + normY * flareHW,
      ];
      const pRightOffshore: [number, number] = [
        pCoast[0] + dir[0] * reachOffshore - normX * flareHW,
        pCoast[1] + dir[1] * reachOffshore - normY * flareHW,
      ];

      const pLeftLand: [number, number] = [
        pCoast[0] - dir[0] * upstreamDist + normX * mouthHW,
        pCoast[1] - dir[1] * upstreamDist + normY * mouthHW,
      ];
      const pRightLand: [number, number] = [
        pCoast[0] - dir[0] * upstreamDist - normX * mouthHW,
        pCoast[1] - dir[1] * upstreamDist - normY * mouthHW,
      ];

      ctx.save();

      // 1. Bank shallows wash across estuary mouth (100% OPAQUE turquoise shallows #7bc5c5)
      // Erases the dark coastline bar and beach sand across the mouth width
      ctx.fillStyle = WATER_STYLE.waterShallow;
      ctx.beginPath();
      ctx.moveTo(pLeftLand[0], pLeftLand[1]);
      ctx.lineTo(pLeftCoast[0], pLeftCoast[1]);
      ctx.lineTo(pLeftOffshore[0], pLeftOffshore[1]);
      ctx.lineTo(pRightOffshore[0], pRightOffshore[1]);
      ctx.lineTo(pRightCoast[0], pRightCoast[1]);
      ctx.lineTo(pRightLand[0], pRightLand[1]);
      ctx.closePath();
      ctx.fill();

      // 2. Core water fill across mouth (100% OPAQUE coastal sea #408087 / rgb(77, 122, 130))
      // Connects the river's deep channel directly to the coastal sea
      const coreHW = mouthHW * 0.50;
      const coreFlareHW = flareHW * 0.50;
      const colMouth = getRiverColorAtFrac(1.0, prep.river.color);
      ctx.fillStyle = colMouth;
      ctx.beginPath();
      ctx.moveTo(pCoast[0] - dir[0] * upstreamDist + normX * coreHW, pCoast[1] - dir[1] * upstreamDist + normY * coreHW);
      ctx.lineTo(pCoast[0] + normX * coreHW, pCoast[1] + normY * coreHW);
      ctx.lineTo(pCoast[0] + dir[0] * reachOffshore + normX * coreFlareHW, pCoast[1] + dir[1] * reachOffshore + normY * coreFlareHW);
      ctx.lineTo(pCoast[0] + dir[0] * reachOffshore - normX * coreFlareHW, pCoast[1] + dir[1] * reachOffshore - normY * coreFlareHW);
      ctx.lineTo(pCoast[0] - normX * coreHW, pCoast[1] - normY * coreHW);
      ctx.lineTo(pCoast[0] - dir[0] * upstreamDist - normX * coreHW, pCoast[1] - dir[1] * upstreamDist - normY * coreHW);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // ----------------------------------------------------
    // Open Junction: Eliminate black divider lines at inland connections
    // For ocean connections: FLUSH terminal at coastline with ZERO protruding bubble/arc!
    // ----------------------------------------------------
    const isLakeConn = prep.river.terminatesAt === 'lake';
    const isRiverConn = prep.river.terminatesAt === 'river';

    if (isLakeConn || isRiverConn) {
      const pPrev = pts[n - 2];
      const pMouth = pts[n - 1];
      const dx = pMouth[0] - pPrev[0];
      const dy = pMouth[1] - pPrev[1];
      const len = Math.hypot(dx, dy) || 1;
      const tx = dx / len;
      const ty = dy / len;
      const mouthTheta = Math.atan2(ty, tx);

      const mouthW = Math.max(prep.river.widthEnd ?? 4.0, minWidthWorld);
      const effHW = mouthW * 0.5;
      const mouthCol = isLakeConn ? WATER_STYLE.waterShallow : getRiverColorAtFrac(1.0, prep.river.color);

      ctx.save();
      ctx.fillStyle = mouthCol;
      ctx.beginPath();
      ctx.arc(
        pMouth[0],
        pMouth[1],
        effHW + borderWidth * 0.8,
        mouthTheta - Math.PI * 0.52,
        mouthTheta + Math.PI * 0.52
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Lake Outflow open junction:
    if (prep.river.sourceType === 'lake' || prep.river.sourceLakeId !== undefined) {
      const pSource = pts[0];
      const pNext = pts[1];
      const dx = pSource[0] - pNext[0];
      const dy = pSource[1] - pNext[1];
      const len = Math.hypot(dx, dy) || 1;
      const tx = dx / len;
      const ty = dy / len;
      const sourceTheta = Math.atan2(ty, tx);

      const sourceW = Math.max(prep.river.widthStart ?? 1.5, minWidthWorld);
      const effHW = sourceW * 0.5;
      const sourceCol = WATER_STYLE.waterShallow;

      ctx.save();
      ctx.fillStyle = sourceCol;
      ctx.beginPath();
      ctx.arc(
        pSource[0],
        pSource[1],
        effHW + borderWidth * 0.8,
        sourceTheta - Math.PI * 0.52,
        sourceTheta + Math.PI * 0.52
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ==========================================
  // Pass 3: Lake Shorelines (Skipped when carved into WebGL terrain)
  // ==========================================
  for (const lake of lakes) {
    const poly = lake.polygon;
    if (!poly || poly.length < 3) continue;

    const isSelected = selectedId === lake.id;
    const isHovered = hoveredId === lake.id;
    const junctions = getLakeJunctions(lake, rivers);

    // 1. Soft bank sand halo along lake perimeter (land side)
      ctx.strokeStyle = WATER_STYLE.bankSand;
    ctx.lineWidth = 3.2 / zoomPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    ctx.stroke();

    // 2. Luminous turquoise inner shallows ribbon (water side)
    ctx.strokeStyle = WATER_STYLE.waterShallow;
    ctx.lineWidth = 3.6 / zoomPx;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.lineWidth = 1.8 / zoomPx;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Crisp ink shoreline:
    // If there are river junctions, skip stroking across river mouth openings
    ctx.strokeStyle = lake.borderColor || WATER_STYLE.ink;
    ctx.lineWidth = 1.4 / zoomPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (junctions.length === 0) {
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      // Stroke segments, skipping vertices within junction radius
      const isNearJunction = (p: [number, number]): boolean => {
        return junctions.some((j) => Math.hypot(p[0] - j.pt[0], p[1] - j.pt[1]) < Math.max(4.0, j.width * 0.85));
      };

      ctx.beginPath();
      let isDrawing = false;
      const n = poly.length;

      for (let i = 0; i <= n; i++) {
        const pt = poly[i % n];
        const nextPt = poly[(i + 1) % n];
        const mid: [number, number] = [(pt[0] + nextPt[0]) * 0.5, (pt[1] + nextPt[1]) * 0.5];

        if (isNearJunction(mid) || isNearJunction(pt)) {
          isDrawing = false;
        } else {
          if (!isDrawing) {
            ctx.moveTo(pt[0], pt[1]);
            isDrawing = true;
          }
          ctx.lineTo(nextPt[0], nextPt[1]);
        }
      }
      ctx.stroke();
    }

    // Selection highlight for lake
    if (isSelected || isHovered) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
      }
      ctx.closePath();
      ctx.strokeStyle = isSelected ? WATER_STYLE.selectedGlow : WATER_STYLE.hoverGlow;
      ctx.lineWidth = (isSelected ? 2.5 : 1.8) / zoomPx;
      ctx.setLineDash([4 / zoomPx, 3 / zoomPx]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Vertex handles if selected
      if (isSelected) {
        for (let i = 0; i < poly.length; i++) {
          const pt = poly[i];
          const isAct = options.selectedVertexIndex === i;
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], (isAct ? 5.5 : 3.5) / zoomPx, 0, Math.PI * 2);
          ctx.fillStyle = isAct ? '#ec4899' : WATER_STYLE.vertexHandle;
          ctx.fill();
          ctx.strokeStyle = '#18181b';
          ctx.lineWidth = 1.0 / zoomPx;
          ctx.stroke();
        }
      }
    }
  }

  // ==========================================
  // Pass 4: River Selection / Hover Highlights & Vertex Handles
  // ==========================================
  for (const prep of preparedRivers) {
    if (!prep.isSelected && !prep.isHovered) continue;
    const pts = prep.points;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.strokeStyle = prep.isSelected ? WATER_STYLE.selectedGlow : WATER_STYLE.hoverGlow;
    ctx.lineWidth = (prep.isSelected ? 2.4 : 1.8) / zoomPx;
    ctx.setLineDash([4 / zoomPx, 3 / zoomPx]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Vertex handles along the river if selected
    if (prep.isSelected) {
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const isSource = i === 0;
        const isMouth = i === pts.length - 1;
        const isAct = options.selectedVertexIndex === i;

        ctx.beginPath();
        ctx.arc(pt[0], pt[1], (isAct ? 5.5 : isSource || isMouth ? 4.5 : 3.0) / zoomPx, 0, Math.PI * 2);
        ctx.fillStyle = isAct ? '#ec4899' : isSource ? '#34d399' : isMouth ? '#38bdf8' : WATER_STYLE.vertexHandle;
        ctx.fill();
        ctx.strokeStyle = '#18181b';
        ctx.lineWidth = 1.0 / zoomPx;
        ctx.stroke();
      }
    }
  }

  // ==========================================
  // Pass 5: Cartographic Typography Labels
  // ==========================================
  if (options.showLabels) {
    // Lakes Labels
    for (const lake of lakes) {
      if (!lake.name || !lake.polygon || lake.polygon.length < 3) continue;

      let cx = 0;
      let cy = 0;
      for (const p of lake.polygon) {
        cx += p[0];
        cy += p[1];
      }
      cx /= lake.polygon.length;
      cy /= lake.polygon.length;

      ctx.save();
      ctx.font = `italic 600 ${Math.max(9, Math.min(13, 11 / (zoomPx / (options.dpr || 1))))}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fef3c7';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 3 / zoomPx;
      ctx.fillText(lake.name, cx, cy);
      ctx.restore();
    }

    // Rivers Labels
    for (const river of rivers) {
      const pts = river.points;
      if (!river.name || !pts || pts.length < 5) continue;

      const midIdx = Math.floor(pts.length / 2);
      const midPt = pts[midIdx];
      const nextPt = pts[Math.min(pts.length - 1, midIdx + 1)];
      const angle = Math.atan2(nextPt[1] - midPt[1], nextPt[0] - midPt[0]);
      const normAngle = angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle;

      ctx.save();
      ctx.translate(midPt[0], midPt[1]);
      ctx.rotate(normAngle);
      ctx.font = `italic 600 ${Math.max(8.5, Math.min(12, 10 / (zoomPx / (options.dpr || 1))))}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#fef3c7';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 3 / zoomPx;
      ctx.fillText(river.name, 0, -3 / zoomPx);
      ctx.restore();
    }
  }

  ctx.restore();
}

/**
 * Hit testing for rivers. Returns distance to closest segment.
 */
export function distanceToRiver(
  px: number,
  py: number,
  river: RiverData
): { distance: number; segmentIndex: number; t: number } {
  const pts = river.points;
  let minDist = Infinity;
  let bestSeg = 0;
  let bestT = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const x1 = pts[i][0];
    const y1 = pts[i][1];
    const x2 = pts[i + 1][0];
    const y2 = pts[i + 1][1];

    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;

    let t = 0;
    if (l2 > 0) {
      t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
    }
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const d = Math.hypot(px - projX, py - projY);

    const segFrac = (i + t) / (pts.length - 1);
    const riverW = (river.widthStart ?? 1.5) + ((river.widthEnd ?? 4.5) - (river.widthStart ?? 1.5)) * segFrac;
    const effectiveDist = Math.max(0, d - riverW * 0.5);

    if (effectiveDist < minDist) {
      minDist = effectiveDist;
      bestSeg = i;
      bestT = t;
    }
  }

  return { distance: minDist, segmentIndex: bestSeg, t: bestT };
}

/**
 * Hit test a specific river vertex.
 */
export function findNearestRiverVertex(
  px: number,
  py: number,
  river: RiverData,
  tolerance: number
): number | null {
  for (let i = 0; i < river.points.length; i++) {
    const [vx, vy] = river.points[i];
    if (Math.hypot(px - vx, py - vy) <= tolerance) {
      return i;
    }
  }
  return null;
}

/**
 * Hit test a specific lake vertex.
 */
export function findNearestLakeVertex(
  px: number,
  py: number,
  lake: LakeData,
  tolerance: number
): number | null {
  for (let i = 0; i < lake.polygon.length; i++) {
    const [vx, vy] = lake.polygon[i];
    if (Math.hypot(px - vx, py - vy) <= tolerance) {
      return i;
    }
  }
  return null;
}

/**
 * Find water body (river or lake) at coordinates [px, py].
 */
export function findWaterAtPoint(
  px: number,
  py: number,
  rivers: RiverData[],
  lakes: LakeData[],
  tolerance: number
): { type: 'river' | 'lake'; id: string } | null {
  // Check lakes first
  for (const lake of lakes) {
    if (pointInLake(px, py, lake.polygon)) {
      return { type: 'lake', id: lake.id };
    }
    for (const [lx, ly] of lake.polygon) {
      if (Math.hypot(px - lx, py - ly) <= tolerance) {
        return { type: 'lake', id: lake.id };
      }
    }
  }

  // Check rivers
  for (const river of rivers) {
    const hit = distanceToRiver(px, py, river);
    if (hit.distance <= tolerance) {
      return { type: 'river', id: river.id };
    }
  }

  return null;
}
