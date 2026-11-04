/**
 * Cartographic Water Renderer (Rivers & Lakes)
 * Renders variable-width rivers with natural bank outlines, organic lake shorelines,
 * antique fantasy water fill, and interactive selection handles.
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
  waterFill: '#2d636e',
  waterShallow: '#68b5b5',
  // Dark drawing ink border
  ink: '#192422',
  selectedGlow: '#f59e0b',
  hoverGlow: '#38bdf8',
  vertexHandle: '#fbbf24',
};

/**
 * Computes normal offsets for variable-width polyline.
 */
function computeVariableWidthPolyline(
  points: [number, number][],
  widthStart: number,
  widthEnd: number
): { left: [number, number][]; right: [number, number][] } {
  const n = points.length;
  if (n < 2) return { left: points, right: points };

  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const halfW = (widthStart + (widthEnd - widthStart) * t) * 0.5;

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

/**
 * Renders all rivers and lakes onto a 2D canvas context.
 */
export function drawWaterBodies(
  ctx: CanvasRenderingContext2D,
  rivers: RiverData[] = [],
  lakes: LakeData[] = [],
  options: DrawWaterOptions
): void {
  const zoom = options.zoom || 1;
  const zoomPx = zoom * (options.dpr || 1);
  const selectedId = options.selectedId;
  const hoveredId = options.hoveredId;

  ctx.save();

  // ==========================================
  // 1. Draw Lakes
  // ==========================================
  for (const lake of lakes) {
    const poly = lake.polygon;
    if (!poly || poly.length < 3) continue;

    const isSelected = selectedId === lake.id;
    const isHovered = hoveredId === lake.id;

    // Lake body fill
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();

    ctx.fillStyle = lake.color || WATER_STYLE.waterFill;
    ctx.fill();

    // Subtle inner shallows glow / ripple contour
    ctx.strokeStyle = WATER_STYLE.waterShallow;
    ctx.lineWidth = 2.0 / zoomPx;
    ctx.globalAlpha = 0.35;
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Crisp ink shoreline
    ctx.strokeStyle = lake.borderColor || WATER_STYLE.ink;
    ctx.lineWidth = 1.6 / zoomPx;
    ctx.stroke();

    // Selection highlight
    if (isSelected || isHovered) {
      ctx.save();
      ctx.strokeStyle = isSelected ? WATER_STYLE.selectedGlow : WATER_STYLE.hoverGlow;
      ctx.lineWidth = (isSelected ? 2.8 : 2.0) / zoomPx;
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
          ctx.arc(pt[0], pt[1], (isAct ? 6 : 4) / zoomPx, 0, Math.PI * 2);
          ctx.fillStyle = isAct ? '#ec4899' : WATER_STYLE.vertexHandle;
          ctx.fill();
          ctx.strokeStyle = '#18181b';
          ctx.lineWidth = 1.2 / zoomPx;
          ctx.stroke();
        }
      }
    }

    // Lake label
    if (options.showLabels && lake.name) {
      let cx = 0;
      let cy = 0;
      for (const p of poly) {
        cx += p[0];
        cy += p[1];
      }
      cx /= poly.length;
      cy /= poly.length;

      ctx.save();
      ctx.font = `italic bold ${Math.max(10, 11 / zoom)}px "Palatino Linotype", "Book Antiqua", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fef3c7';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 4 / zoom;
      ctx.fillText(lake.name, cx, cy);
      ctx.restore();
    }
  }

  // ==========================================
  // 2. Draw Rivers
  // ==========================================
  for (const river of rivers) {
    const pts = river.points;
    if (!pts || pts.length < 2) continue;

    const isSelected = selectedId === river.id;
    const isHovered = hoveredId === river.id;

    const wStart = river.widthStart ?? 2.5;
    const wEnd = river.widthEnd ?? 8.0;

    const { left, right } = computeVariableWidthPolyline(pts, wStart, wEnd);

    // Build closed river boundary polygon: left forwards, then right backwards
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) {
      ctx.lineTo(left[i][0], left[i][1]);
    }
    for (let i = right.length - 1; i >= 0; i--) {
      ctx.lineTo(right[i][0], right[i][1]);
    }
    ctx.closePath();

    // River water fill
    ctx.fillStyle = river.color || WATER_STYLE.waterFill;
    ctx.fill();

    // River banks ink stroke
    ctx.strokeStyle = river.borderColor || WATER_STYLE.ink;
    ctx.lineWidth = 1.2 / zoomPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Left bank
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) {
      ctx.lineTo(left[i][0], left[i][1]);
    }
    ctx.stroke();

    // Right bank
    ctx.beginPath();
    ctx.moveTo(right[0][0], right[0][1]);
    for (let i = 1; i < right.length; i++) {
      ctx.lineTo(right[i][0], right[i][1]);
    }
    ctx.stroke();

    // Source spring cap
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], (wStart * 0.5), 0, Math.PI * 2);
    ctx.fillStyle = river.color || WATER_STYLE.waterFill;
    ctx.fill();
    ctx.strokeStyle = river.borderColor || WATER_STYLE.ink;
    ctx.stroke();

    // Selection or hover highlight
    if (isSelected || isHovered) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = isSelected ? WATER_STYLE.selectedGlow : WATER_STYLE.hoverGlow;
      ctx.lineWidth = (isSelected ? 2.5 : 1.8) / zoomPx;
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
          ctx.arc(pt[0], pt[1], (isAct ? 6 : isSource || isMouth ? 5 : 3.5) / zoomPx, 0, Math.PI * 2);
          ctx.fillStyle = isAct ? '#ec4899' : isSource ? '#34d399' : isMouth ? '#38bdf8' : WATER_STYLE.vertexHandle;
          ctx.fill();
          ctx.strokeStyle = '#18181b';
          ctx.lineWidth = 1.0 / zoomPx;
          ctx.stroke();
        }
      }
    }

    // River label along midpoint
    if (options.showLabels && river.name && pts.length >= 4) {
      const midIdx = Math.floor(pts.length / 2);
      const midPt = pts[midIdx];
      const nextPt = pts[Math.min(pts.length - 1, midIdx + 1)];
      const angle = Math.atan2(nextPt[1] - midPt[1], nextPt[0] - midPt[0]);
      // Normalize angle so text is never upside down
      const normAngle = angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle;

      ctx.save();
      ctx.translate(midPt[0], midPt[1]);
      ctx.rotate(normAngle);
      ctx.font = `italic bold ${Math.max(9, 10 / zoom)}px "Palatino Linotype", "Book Antiqua", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#fef3c7';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 4 / zoom;
      ctx.fillText(river.name, 0, -4 / zoom);
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

    // Factor in variable river width at this segment
    const segFrac = (i + t) / (pts.length - 1);
    const riverW = (river.widthStart ?? 2.5) + ((river.widthEnd ?? 8.0) - (river.widthStart ?? 2.5)) * segFrac;
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
  // Check lakes first (polygon contains or near edge)
  for (const lake of lakes) {
    if (pointInLake(px, py, lake.polygon)) {
      return { type: 'lake', id: lake.id };
    }
    // Check near boundary
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
