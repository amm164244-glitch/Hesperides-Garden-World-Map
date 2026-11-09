/**
 * Cartographic Water Renderer (Rivers & Lakes)
 * Renders variable-width rivers with natural casing outlines, organic lake shorelines,
 * seamless confluences, antique fantasy water fills, and interactive vector handles.
 */

import { RiverData, LakeData } from '../types/water';
import { pointInLake } from './waterGenerator';

export interface DrawWaterOptions {
  zoom: number;
  dpr?: number;
  cellSize?: number;
  selectedId?: string | null;
  hoveredId?: string | null;
  selectedVertexIndex?: number | null;
  showLabels?: boolean;
  viewBounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

export const WATER_STYLE = {
  // Rich antique fantasy teal matching planetary shallows
  waterFill: '#2a5b67',
  waterShallow: '#6db8b8',
  // Dark drawing ink border
  ink: '#192422',
  selectedGlow: '#f59e0b',
  hoverGlow: '#38bdf8',
  vertexHandle: '#fbbf24',
};

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
  return `rgba(42, 91, 103, ${alpha})`;
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
}

/**
 * Quantizes river segments into width buckets (default 12), grouping continuous segments
 * of the same bucket so they can be stroked in a single canvas pass.
 * Boundary vertices are shared between adjacent groups to prevent gaps or dropped vertices.
 */
export function buildRiverStrokeGroups(
  points: [number, number][],
  widths: number[],
  bucketCount: number = 12
): RiverStrokeGroup[] {
  const n = points.length;
  if (n < 2) {
    if (n === 1) return [{ points: [[points[0][0], points[0][1]]], width: widths[0] ?? 1.5 }];
    return [];
  }

  if (n === 2) {
    const w = ((widths[0] ?? 1.5) + (widths[1] ?? widths[0] ?? 1.5)) * 0.5;
    return [{ points: [points[0], points[1]], width: w }];
  }

  // Calculate segment widths (average of endpoints)
  const segWidths: number[] = new Array(n - 1);
  let minW = Infinity;
  let maxW = -Infinity;

  for (let j = 0; j < n - 1; j++) {
    const sw = ((widths[j] ?? 1.5) + (widths[j + 1] ?? widths[j] ?? 1.5)) * 0.5;
    segWidths[j] = sw;
    if (sw < minW) minW = sw;
    if (sw > maxW) maxW = sw;
  }

  // If width is uniform across all segments, return 1 group
  if (maxW - minW < 1e-6) {
    return [{ points: points.slice(), width: (minW + maxW) * 0.5 }];
  }

  const B = Math.max(1, Math.min(32, Math.floor(bucketCount || 12)));
  const step = (maxW - minW) / B;

  const getBucket = (w: number): number => {
    return Math.min(B - 1, Math.max(0, Math.floor((w - minW) / step)));
  };

  const getRepWidth = (bucket: number): number => {
    return minW + (bucket + 0.5) * step;
  };

  const groups: RiverStrokeGroup[] = [];
  let currentBucket = getBucket(segWidths[0]);
  let currentPoints: [number, number][] = [points[0], points[1]];

  for (let j = 1; j < n - 1; j++) {
    const b = getBucket(segWidths[j]);
    if (b === currentBucket) {
      currentPoints.push(points[j + 1]);
    } else {
      groups.push({
        points: currentPoints,
        width: getRepWidth(currentBucket),
      });
      // Share endpoint points[j] with next group to prevent gaps
      currentPoints = [points[j], points[j + 1]];
      currentBucket = b;
    }
  }

  groups.push({
    points: currentPoints,
    width: getRepWidth(currentBucket),
  });

  return groups;
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

interface PreparedRiver {
  river: RiverData;
  strokeGroups: RiverStrokeGroup[];
  isSelected: boolean;
  isHovered: boolean;
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
  const zoomPx = options.zoom || 1;
  const selectedId = options.selectedId;
  const hoveredId = options.hoveredId;
  const viewBounds = options.viewBounds;

  ctx.save();

  // ==========================================
  // Pass 0: Lake Fills
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
    const pts = river.points;
    if (!pts || pts.length < 2) continue;

    const wStart = river.widthStart ?? 1.5;
    const wEnd = river.widthEnd ?? 4.5;
    const isEstuary = river.terminatesAt === 'ocean';

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
    const strokeGroups = buildRiverStrokeGroups(pts, widths, 12);

    preparedRivers.push({
      river,
      strokeGroups,
      isSelected: selectedId === river.id,
      isHovered: hoveredId === river.id,
    });
  }

  // Common stroke settings for casing and fill
  const minWidthWorld = 1.0 / zoomPx;
  const borderWidth = 1.1 / zoomPx;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // ==========================================
  // Pass 1: River Casing (Outlines / Borders)
  // All rivers' casings drawn first so confluences blend seamlessly in Pass 2
  // ==========================================
  for (const prep of preparedRivers) {
    const borderColor = prep.river.borderColor || WATER_STYLE.ink;
    ctx.strokeStyle = borderColor;

    for (const group of prep.strokeGroups) {
      const gPts = group.points;
      if (gPts.length < 2) continue;

      const effW = Math.max(group.width, minWidthWorld);
      ctx.lineWidth = effW + 2 * borderWidth;

      ctx.beginPath();
      ctx.moveTo(gPts[0][0], gPts[0][1]);
      for (let i = 1; i < gPts.length; i++) {
        ctx.lineTo(gPts[i][0], gPts[i][1]);
      }
      ctx.stroke();
    }
  }

  // ==========================================
  // Pass 2: River Fills (Water Core)
  // Drawn on top of all casings, creating continuous river surfaces and junction blending
  // ==========================================
  for (const prep of preparedRivers) {
    const fillColor = prep.river.color || WATER_STYLE.waterFill;
    ctx.strokeStyle = fillColor;

    for (const group of prep.strokeGroups) {
      const gPts = group.points;
      if (gPts.length < 2) continue;

      const effW = Math.max(group.width, minWidthWorld);
      ctx.lineWidth = effW;

      ctx.beginPath();
      ctx.moveTo(gPts[0][0], gPts[0][1]);
      for (let i = 1; i < gPts.length; i++) {
        ctx.lineTo(gPts[i][0], gPts[i][1]);
      }
      ctx.stroke();
    }
  }

  // ==========================================
  // Pass 3: Lake Shorelines (with open gateways at river junctions)
  // ==========================================
  for (const lake of lakes) {
    const poly = lake.polygon;
    if (!poly || poly.length < 3) continue;

    const isSelected = selectedId === lake.id;
    const isHovered = hoveredId === lake.id;
    const junctions = getLakeJunctions(lake, rivers);

    // Subtle inner shallows glow
    ctx.strokeStyle = WATER_STYLE.waterShallow;
    ctx.lineWidth = 1.8 / zoomPx;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
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
    const pts = prep.river.points;

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
