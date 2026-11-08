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
  cellSize?: number;
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
 * The vertices form a semicircle centered at mouthPt with radius halfWidth.
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
 * Strokes a river bank with the last portion fading alpha from 1.0 to 0.0.
 */
function strokeFadingBank(
  ctx: CanvasRenderingContext2D,
  bankPts: [number, number][],
  fadeDist: number,
  borderColor: string
): void {
  const n = bankPts.length;
  if (n < 2) return;

  const cumDists: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    cumDists.push(cumDists[i] + Math.hypot(bankPts[i + 1][0] - bankPts[i][0], bankPts[i + 1][1] - bankPts[i][1]));
  }
  const totalLen = cumDists[n - 1];
  const targetFadeStart = Math.max(0, totalLen - fadeDist);

  let splitIdx = n - 2;
  while (splitIdx > 0 && cumDists[splitIdx] > targetFadeStart) {
    splitIdx--;
  }

  const d0 = cumDists[splitIdx];
  const d1 = cumDists[splitIdx + 1];
  const segLen = d1 - d0;
  const frac = segLen > 1e-6 ? Math.max(0, Math.min(1, (targetFadeStart - d0) / segLen)) : 0;

  const pFadeStart: [number, number] = [
    bankPts[splitIdx][0] + frac * (bankPts[splitIdx + 1][0] - bankPts[splitIdx][0]),
    bankPts[splitIdx][1] + frac * (bankPts[splitIdx + 1][1] - bankPts[splitIdx][1]),
  ];

  // 1. Solid bank stroke up to fade start
  if (targetFadeStart > 0) {
    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(bankPts[0][0], bankPts[0][1]);
    for (let i = 1; i <= splitIdx; i++) {
      ctx.lineTo(bankPts[i][0], bankPts[i][1]);
    }
    ctx.lineTo(pFadeStart[0], pFadeStart[1]);
    ctx.stroke();
  }

  // 2. Fading bank stroke from fade start to mouth point
  const grad = ctx.createLinearGradient(pFadeStart[0], pFadeStart[1], bankPts[n - 1][0], bankPts[n - 1][1]);
  grad.addColorStop(0, colorWithAlpha(borderColor, 1.0));
  grad.addColorStop(1, colorWithAlpha(borderColor, 0.0));

  ctx.strokeStyle = grad;
  ctx.beginPath();
  ctx.moveTo(pFadeStart[0], pFadeStart[1]);
  for (let i = splitIdx + 1; i < n; i++) {
    ctx.lineTo(bankPts[i][0], bankPts[i][1]);
  }
  ctx.stroke();
}

/**
 * Computes normal offsets for variable-width polyline with smooth distance-based estuary flare support.
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
    const hw = [widthStart * 0.5];
    return { left: points, right: points, halfWidths: hw };
  }

  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const halfWidths: number[] = [];

  if (!isEstuary) {
    // Non-estuary (lake or tributary river): identical to baseline behavior
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const halfW = (widthStart + (widthEnd - widthStart) * t) * 0.5;
      halfWidths.push(halfW);

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

    return { left, right, halfWidths };
  }

  // Estuary: distance-based smoothstep flare over max(6 * widthEnd, 6 * cellSize) up to 1.6x at mouth
  const cumDists: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    cumDists.push(cumDists[i] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]));
  }
  const totalLength = cumDists[n - 1];
  const flareLength = Math.max(widthEnd * 6, cellSize * 6);

  for (let i = 0; i < n; i++) {
    const t = totalLength > 1e-6 ? cumDists[i] / totalLength : i / (n - 1);
    let halfW = (widthStart + (widthEnd - widthStart) * t) * 0.5;

    const distFromMouth = totalLength - cumDists[i];
    if (distFromMouth < flareLength) {
      const u = Math.max(0, Math.min(1, 1 - (distFromMouth / flareLength)));
      const s = u * u * (3 - 2 * u); // smoothstep
      halfW *= 1.0 + s * 0.60;
    }

    halfWidths.push(halfW);

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

  // Generate semicircle cap at the river mouth
  const lastDx = points[n - 1][0] - points[n - 2][0];
  const lastDy = points[n - 1][1] - points[n - 2][1];
  const lastLen = Math.hypot(lastDx, lastDy) || 1;
  const tangent: [number, number] = [lastDx / lastLen, lastDy / lastLen];
  const mouthHW = halfWidths[n - 1];
  const mouthCap = createRiverMouthCap(points[n - 1], tangent, mouthHW, 12);

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
    const baseColor = river.color || WATER_STYLE.waterFill;

    const { left, right, halfWidths, mouthCap } = computeVariableWidthPolyline(
      pts,
      wStart,
      wEnd,
      isEstuary,
      options.cellSize ?? 1.0
    );

    if (!isEstuary) {
      // Standard inland / lake river fill (unchanged)
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      for (let i = 1; i < left.length; i++) {
        ctx.lineTo(left[i][0], left[i][1]);
      }
      for (let i = right.length - 1; i >= 0; i--) {
        ctx.lineTo(right[i][0], right[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = baseColor;
      ctx.fill();

      // Spring source cap (only if purely inland spring, not from a lake)
      if (river.sourceType !== 'lake') {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], wStart * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = baseColor;
        ctx.fill();
      }
    } else {
      // Ocean estuary river fill:
      // Last 2x river width length blends opacity from 1.0 -> 0.35
      const mouthWidth = halfWidths[halfWidths.length - 1] * 2;
      const blendDist = 2 * mouthWidth;

      const n = pts.length;
      const cumDists: number[] = [0];
      for (let i = 0; i < n - 1; i++) {
        cumDists.push(cumDists[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
      }
      const totalLen = cumDists[n - 1];
      const targetBlendDist = Math.max(0, totalLen - blendDist);

      let splitIdx = n - 2;
      while (splitIdx > 0 && cumDists[splitIdx] > targetBlendDist) {
        splitIdx--;
      }

      const d0 = cumDists[splitIdx];
      const d1 = cumDists[splitIdx + 1];
      const segLen = d1 - d0;
      const frac = segLen > 1e-6 ? Math.max(0, Math.min(1, (targetBlendDist - d0) / segLen)) : 0;

      const splitLeft: [number, number] = [
        left[splitIdx][0] + frac * (left[splitIdx + 1][0] - left[splitIdx][0]),
        left[splitIdx][1] + frac * (left[splitIdx + 1][1] - left[splitIdx][1]),
      ];
      const splitRight: [number, number] = [
        right[splitIdx][0] + frac * (right[splitIdx + 1][0] - right[splitIdx][0]),
        right[splitIdx][1] + frac * (right[splitIdx + 1][1] - right[splitIdx][1]),
      ];
      const splitCenter: [number, number] = [
        pts[splitIdx][0] + frac * (pts[splitIdx + 1][0] - pts[splitIdx][0]),
        pts[splitIdx][1] + frac * (pts[splitIdx + 1][1] - pts[splitIdx][1]),
      ];

      // 1. Upstream solid river fill (from source to split point)
      if (targetBlendDist > 0) {
        ctx.beginPath();
        ctx.moveTo(left[0][0], left[0][1]);
        for (let i = 1; i <= splitIdx; i++) {
          ctx.lineTo(left[i][0], left[i][1]);
        }
        ctx.lineTo(splitLeft[0], splitLeft[1]);
        ctx.lineTo(splitRight[0], splitRight[1]);
        for (let i = splitIdx; i >= 0; i--) {
          ctx.lineTo(right[i][0], right[i][1]);
        }
        ctx.closePath();
        ctx.fillStyle = baseColor;
        ctx.fill();

        // Spring source cap
        if (river.sourceType !== 'lake') {
          ctx.beginPath();
          ctx.arc(pts[0][0], pts[0][1], wStart * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = baseColor;
          ctx.fill();
        }
      }

      // 2. Estuary mouth blend path (from split point through mouth and semicircle cap)
      ctx.beginPath();
      ctx.moveTo(splitLeft[0], splitLeft[1]);
      for (let i = splitIdx + 1; i < n; i++) {
        ctx.lineTo(left[i][0], left[i][1]);
      }
      if (mouthCap && mouthCap.length > 2) {
        for (let k = 1; k < mouthCap.length - 1; k++) {
          ctx.lineTo(mouthCap[k][0], mouthCap[k][1]);
        }
      }
      for (let i = n - 1; i > splitIdx; i--) {
        ctx.lineTo(right[i][0], right[i][1]);
      }
      ctx.lineTo(splitRight[0], splitRight[1]);
      ctx.closePath();

      const pMouth = pts[n - 1];
      const grad = ctx.createLinearGradient(splitCenter[0], splitCenter[1], pMouth[0], pMouth[1]);
      grad.addColorStop(0, colorWithAlpha(baseColor, 1.0));
      grad.addColorStop(1, colorWithAlpha(baseColor, 0.35));
      ctx.fillStyle = grad;
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

    const { left, right, halfWidths } = computeVariableWidthPolyline(
      pts,
      wStart,
      wEnd,
      isEstuary,
      options.cellSize ?? 1.0
    );

    if (!isEstuary) {
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
    } else {
      const mouthHW = halfWidths[halfWidths.length - 1];
      const borderColor = river.borderColor || WATER_STYLE.ink;
      ctx.lineWidth = 1.1 / zoomPx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Left bank (fading over last half-width)
      strokeFadingBank(ctx, left, mouthHW, borderColor);
      // Right bank (fading over last half-width)
      strokeFadingBank(ctx, right, mouthHW, borderColor);

      // Mountain Spring source cap stroke (if not lake outlet)
      if (river.sourceType !== 'lake') {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], wStart * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = river.borderColor || WATER_STYLE.ink;
        ctx.lineWidth = 1.0 / zoomPx;
        ctx.stroke();
      }
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
