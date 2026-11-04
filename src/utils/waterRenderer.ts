/**
 * Cartographic Water Renderer (Rivers & Lakes)
 * Renders variable-width rivers with natural bank outlines, organic lake shorelines,
 * seamless lake-to-lake and ocean connections, antique fantasy water fills, and interactive vector handles.
 */

import { RiverData, LakeData } from '../types/water';
import { pointInLake } from './waterGenerator';

export interface DrawWaterOptions {
  zoom: number;
  dpr?: number;
  selectedId?: string | null;
  hoveredId?: string | null;
  selectedVertexIndex?: number | null;
  showLabels?: boolean;
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
 * Computes normal offsets for variable-width polyline with estuary flare support.
 */
function computeVariableWidthPolyline(
  points: [number, number][],
  widthStart: number,
  widthEnd: number,
  isEstuary: boolean = false
): { left: [number, number][]; right: [number, number][] } {
  const n = points.length;
  if (n < 2) return { left: points, right: points };

  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let halfW = (widthStart + (widthEnd - widthStart) * t) * 0.5;

    // Gracefully flare estuary at river mouth
    if (isEstuary && i >= n - 3) {
      const mouthT = (i - (n - 3)) / 2; // 0 to 1
      halfW *= 1.0 + mouthT * 0.35;
    }

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
    // Normal vector (-dy, dx)
    const nx = -dy / len;
    const ny = dx / len;

    left.push([points[i][0] + nx * halfW, points[i][1] + ny * halfW]);
    right.push([points[i][0] - nx * halfW, points[i][1] - ny * halfW]);
  }

  return { left, right };
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

/**
 * Renders all rivers and lakes onto a 2D canvas context with seamless connections.
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

  ctx.save();

  // ==========================================
  // 1. Water Body Fills (Seamless shared water surface)
  // ==========================================

  // A. Lakes Fill
  for (const lake of lakes) {
    const poly = lake.polygon;
    if (!poly || poly.length < 3) continue;

    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = lake.color || WATER_STYLE.waterFill;
    ctx.fill();
  }

  // B. Rivers Fill
  for (const river of rivers) {
    const pts = river.points;
    if (!pts || pts.length < 2) continue;

    const wStart = river.widthStart ?? 1.5;
    const wEnd = river.widthEnd ?? 4.5;
    const isEstuary = river.terminatesAt === 'ocean';

    const { left, right } = computeVariableWidthPolyline(pts, wStart, wEnd, isEstuary);

    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) {
      ctx.lineTo(left[i][0], left[i][1]);
    }
    for (let i = right.length - 1; i >= 0; i--) {
      ctx.lineTo(right[i][0], right[i][1]);
    }
    ctx.closePath();

    ctx.fillStyle = river.color || WATER_STYLE.waterFill;
    ctx.fill();

    // Spring source cap (only if purely inland spring, not from a lake)
    if (river.sourceType !== 'lake') {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], wStart * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = river.color || WATER_STYLE.waterFill;
      ctx.fill();
    }
  }

  // ==========================================
  // 2. Ink Shorelines and River Banks Strokes
  // ==========================================

  // A. River Banks
  for (const river of rivers) {
    const pts = river.points;
    if (!pts || pts.length < 2) continue;

    const isSelected = selectedId === river.id;
    const isHovered = hoveredId === river.id;
    const wStart = river.widthStart ?? 1.5;
    const wEnd = river.widthEnd ?? 4.5;
    const isEstuary = river.terminatesAt === 'ocean';

    const { left, right } = computeVariableWidthPolyline(pts, wStart, wEnd, isEstuary);

    ctx.strokeStyle = river.borderColor || WATER_STYLE.ink;
    ctx.lineWidth = 1.1 / zoomPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Left bank stroke
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) {
      ctx.lineTo(left[i][0], left[i][1]);
    }
    ctx.stroke();

    // Right bank stroke
    ctx.beginPath();
    ctx.moveTo(right[0][0], right[0][1]);
    for (let i = 1; i < right.length; i++) {
      ctx.lineTo(right[i][0], right[i][1]);
    }
    ctx.stroke();

    // Mountain Spring source cap stroke (if not lake outlet)
    if (river.sourceType !== 'lake') {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], wStart * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = river.borderColor || WATER_STYLE.ink;
      ctx.lineWidth = 1.0 / zoomPx;
      ctx.stroke();
    }

    // Selection or hover highlight
    if (isSelected || isHovered) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = isSelected ? WATER_STYLE.selectedGlow : WATER_STYLE.hoverGlow;
      ctx.lineWidth = (isSelected ? 2.4 : 1.8) / zoomPx;
      ctx.setLineDash([4 / zoomPx, 3 / zoomPx]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Vertex handles along the river if selected
      if (isSelected) {
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
  }

  // B. Lake Shorelines (with open gateways at river junctions)
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

    // Selection highlight
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
  // 3. Cartographic Typography Labels
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
