/**
 * Town Vector Cartography 2D Renderer
 * Renders districts, roads, piers, buildings, and fortified walls onto the 2D map overlay canvas.
 * Implements Tolkien & historical antique map styling with viewport culling, LOD optimizations,
 * and customizable architectural roof themes (terracotta, thatch, slate, stone).
 */

import {
  Pt,
  TownBuilding,
  TownDistrict,
  TownObject,
  TownObjectBounds,
  TownPier,
  TownRoad,
  TownRoofTheme,
  TownStyle,
  TownTextureSlot,
  TownWall,
} from '../../types/town';
import { hatchPoly, makeRng, roughen } from '../penSymbols';
import {
  isBoundsVisible,
  metersToUnits,
  objectBounds,
  offsetPolyline,
  polygonCentroid,
  sampleCatmullRom,
} from './townGeometry';
import {
  getBuildingOutlineMultiplier,
  getBuildingShadowColor,
  getRoofColor,
  TOWN_STYLE,
} from './townStyle';
import { ResolvedFill } from './townTextures';

export interface DrawTownOptions {
  metersPerUnit: number;
  zoomPx: number; // viewport.zoom * dpr
  viewBounds: TownObjectBounds;
  selectedId?: string | null;
  selectedIds?: string[];
  roofTheme?: TownRoofTheme;
  textures?: TownStyle['textures'];
  textureResolver?: (
    slot: TownTextureSlot,
    extra?: {
      centroid?: Pt;
      firstEdgeAngleRad?: number;
      wUnits?: number;
      hUnits?: number;
    }
  ) => ResolvedFill | null;
}

// In-memory cache for roughened polygon/polyline coordinates to ensure deterministic, zero-jitter rendering.
// Key: `${id}_${hash}`
const geometryCache = new Map<string, Pt[]>();
const MAX_CACHE_ENTRIES = 5000;

/**
 * Computes a fast hash of coordinate points for cache invalidation when vertices change.
 */
export function computePointsHash(pts: Pt[]): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < pts.length; i++) {
    const x = Math.round(pts[i][0] * 10);
    const y = Math.round(pts[i][1] * 10);
    h ^= x;
    h = Math.imul(h, 0x01000193);
    h ^= y;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Gets cached roughened points or generates and caches new ones.
 */
export function getCachedRoughened(
  id: string,
  pts: Pt[],
  amount: number
): Pt[] {
  const hash = computePointsHash(pts);
  const key = `${id}_${hash}`;
  const existing = geometryCache.get(key);
  if (existing) return existing;

  const rng = makeRng(id);
  const result = roughen(pts as [number, number][], amount, rng) as Pt[];

  if (geometryCache.size > MAX_CACHE_ENTRIES) {
    geometryCache.clear();
  }
  geometryCache.set(key, result);
  return result;
}

/**
 * Clears the geometry cache (useful for testing or full cleanup).
 */
export function clearTownGeometryCache(): void {
  geometryCache.clear();
}

/**
 * Checks if a specific key exists in the geometry cache (for unit testing).
 */
export function hasCachedTownGeometry(id: string, pts: Pt[]): boolean {
  const hash = computePointsHash(pts);
  return geometryCache.has(`${id}_${hash}`);
}

/**
 * Main entrance to draw all town objects on the active map.
 */
export function drawTownObjects(
  ctx: CanvasRenderingContext2D,
  objects: TownObject[] | undefined,
  opts: DrawTownOptions
): void {
  if (!objects || objects.length === 0) return;

  const {
    metersPerUnit,
    zoomPx,
    viewBounds,
    selectedId,
    selectedIds,
    roofTheme = 'terracotta',
    textureResolver,
  } = opts;

  // Filter visible objects via viewport AABB check
  const visible = objects.filter((obj) => {
    const b = objectBounds(obj);
    return isBoundsVisible(b, viewBounds);
  });

  if (visible.length === 0) return;

  // 1. Districts (ground zoning)
  ctx.save();
  for (const obj of visible) {
    if (obj.kind === 'district') {
      drawDistrict(ctx, obj, textureResolver);
    }
  }
  ctx.restore();

  // 2. Roads
  ctx.save();
  for (const obj of visible) {
    if (obj.kind === 'road') {
      drawRoad(ctx, obj, metersPerUnit, zoomPx, textureResolver);
    }
  }
  ctx.restore();

  // 3. Piers & Bridges
  ctx.save();
  for (const obj of visible) {
    if (obj.kind === 'pier') {
      drawPier(ctx, obj, metersPerUnit, zoomPx);
    }
  }
  ctx.restore();

  // 4. Buildings (sorted ascending by bottom Y for authentic isometric overlap)
  const buildings = visible.filter((obj): obj is TownBuilding => obj.kind === 'building');
  buildings.sort((a, b) => {
    const bA = objectBounds(a).maxY;
    const bB = objectBounds(b).maxY;
    return bA - bB;
  });

  ctx.save();
  for (const bld of buildings) {
    drawBuilding(ctx, bld, metersPerUnit, zoomPx, roofTheme, textureResolver);
  }
  ctx.restore();

  // 5. Fortified Walls (drawn on top of roads and buildings)
  ctx.save();
  for (const obj of visible) {
    if (obj.kind === 'wall') {
      drawWall(ctx, obj, metersPerUnit, zoomPx, textureResolver);
    }
  }
  ctx.restore();

  // 6. Selected object outline highlight (Amber #f59e0b)
  const selectedSet = new Set<string>();
  if (selectedId) selectedSet.add(selectedId);
  if (selectedIds) {
    for (const id of selectedIds) selectedSet.add(id);
  }
  if (selectedSet.size > 0) {
    for (const obj of visible) {
      if (selectedSet.has(obj.id)) {
        drawSelectionHighlight(ctx, obj, zoomPx);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Component Renderers
// -----------------------------------------------------------------------------

function drawDistrict(
  ctx: CanvasRenderingContext2D,
  district: TownDistrict,
  textureResolver?: DrawTownOptions['textureResolver']
): void {
  const pts = district.polygon;
  if (!pts || pts.length < 3) return;

  const slot: TownTextureSlot = `ground:${district.districtKind}`;
  const fill = textureResolver?.(slot);

  if (fill) {
    ctx.save();
    const opacity = fill.opacity ?? 0.55;
    ctx.globalAlpha = opacity;
    if (fill.kind === 'pattern') {
      if (fill.pixelated) ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = fill.pattern;
    } else {
      ctx.fillStyle = fill.color;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else {
    const fillColor =
      TOWN_STYLE.districtColors[district.districtKind] ||
      TOWN_STYLE.districtColors.residential;

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Subtle antique border with dashed ink
  ctx.strokeStyle = 'rgba(43, 33, 24, 0.12)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRoad(
  ctx: CanvasRenderingContext2D,
  road: TownRoad,
  metersPerUnit: number,
  zoomPx: number,
  textureResolver?: DrawTownOptions['textureResolver']
): void {
  const rawPts = road.points;
  if (!rawPts || rawPts.length < 2) return;

  const pts = road.smooth ? sampleCatmullRom(rawPts, 6, false) : rawPts;
  if (pts.length < 2) return;

  // Style multiplier
  let mult = 1.0;
  let color: string = TOWN_STYLE.roadMain;
  if (road.style === 'street') {
    mult = 0.7;
    color = TOWN_STYLE.roadStreet;
  } else if (road.style === 'path') {
    mult = 0.4;
    color = TOWN_STYLE.roadPath;
  }

  const widthM = Math.max(1.0, road.widthM * mult);
  const widthUnits = metersToUnits(widthM, metersPerUnit);
  // Ensure minimum visibility on screen: >= 0.8px
  const minWidthUnits = 0.8 / Math.max(0.001, zoomPx);
  const roadWidth = Math.max(widthUnits, minWidthUnits);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Base thick ink stroke underneath
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.strokeStyle = TOWN_STYLE.ink;
  ctx.lineWidth = roadWidth + 1.2 / Math.max(0.001, zoomPx);
  ctx.stroke();

  // Thinner lighter road surface on top
  const slot: TownTextureSlot = `road:${road.style}`;
  const fill = textureResolver?.(slot);

  if (fill) {
    ctx.save();
    if (fill.kind === 'pattern') {
      if (fill.pixelated) ctx.imageSmoothingEnabled = false;
      ctx.strokeStyle = fill.pattern;
    } else {
      ctx.strokeStyle = fill.color;
    }
    ctx.lineWidth = roadWidth;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = roadWidth;
    ctx.stroke();
  }
}

function drawPier(
  ctx: CanvasRenderingContext2D,
  pier: TownPier,
  metersPerUnit: number,
  zoomPx: number
): void {
  const pts = pier.points;
  if (!pts || pts.length < 2) return;

  const widthUnits = metersToUnits(pier.widthM, metersPerUnit);
  const minWidthUnits = 1.0 / Math.max(0.001, zoomPx);
  const pierWidth = Math.max(widthUnits, minWidthUnits);

  const halfWidth = pierWidth * 0.5;
  const { left, right } = offsetPolyline(pts, halfWidth);

  // Timber deck fill
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) {
    ctx.lineTo(left[i][0], left[i][1]);
  }
  for (let i = right.length - 1; i >= 0; i--) {
    ctx.lineTo(right[i][0], right[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = TOWN_STYLE.timberWood;
  ctx.fill();

  // Ink outline
  ctx.strokeStyle = TOWN_STYLE.ink;
  ctx.lineWidth = 1.0 / Math.max(0.001, zoomPx);
  ctx.stroke();

  // Planks cross-ticks
  const tickSpacing = Math.max(0.8, pierWidth * 0.7);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const segDist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const numTicks = Math.floor(segDist / tickSpacing);

    const dx = (p1[0] - p0[0]) / segDist;
    const dy = (p1[1] - p0[1]) / segDist;
    const nx = -dy;
    const ny = dx;

    ctx.strokeStyle = 'rgba(43, 33, 24, 0.45)';
    ctx.lineWidth = 0.6 / Math.max(0.001, zoomPx);
    ctx.beginPath();
    for (let t = 1; t <= numTicks; t++) {
      const frac = t / (numTicks + 1);
      const mx = p0[0] + (p1[0] - p0[0]) * frac;
      const my = p0[1] + (p1[1] - p0[1]) * frac;
      ctx.moveTo(mx + nx * halfWidth * 0.9, my + ny * halfWidth * 0.9);
      ctx.lineTo(mx - nx * halfWidth * 0.9, my - ny * halfWidth * 0.9);
    }
    ctx.stroke();
  }

  // Bridge railings (if variant === 'bridge')
  if (pier.variant === 'bridge') {
    const railOffset = halfWidth + 0.6 / Math.max(0.001, zoomPx);
    const { left: rLeft, right: rRight } = offsetPolyline(pts, railOffset);

    ctx.strokeStyle = TOWN_STYLE.bridgeRailing;
    ctx.lineWidth = 0.8 / Math.max(0.001, zoomPx);

    ctx.beginPath();
    ctx.moveTo(rLeft[0][0], rLeft[0][1]);
    for (let i = 1; i < rLeft.length; i++) ctx.lineTo(rLeft[i][0], rLeft[i][1]);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(rRight[0][0], rRight[0][1]);
    for (let i = 1; i < rRight.length; i++) ctx.lineTo(rRight[i][0], rRight[i][1]);
    ctx.stroke();
  }
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  bld: TownBuilding,
  metersPerUnit: number,
  zoomPx: number,
  roofTheme: TownRoofTheme = 'terracotta',
  textureResolver?: DrawTownOptions['textureResolver']
): void {
  const rawPoly = bld.polygon;
  if (!rawPoly || rawPoly.length < 3) return;

  const bounds = objectBounds(bld);
  const wUnits = bounds.maxX - bounds.minX;
  const hUnits = bounds.maxY - bounds.minY;
  const screenPx = Math.max(wUnits, hUnits) * zoomPx;

  // LOD Optimization:
  // 1. Smaller than 1.5px on screen -> do not render
  if (screenPx < 1.5) return;

  const isKeep = bld.buildingKind === 'keep';
  const isTower = bld.buildingKind === 'tower';
  const roofColor = getRoofColor(bld.buildingKind, bld.tone, roofTheme);

  // 2. Smaller than 4px on screen -> simple flat fill without outline or hatch
  if (screenPx < 4.0) {
    ctx.fillStyle = roofColor;
    ctx.beginPath();
    ctx.moveTo(rawPoly[0][0], rawPoly[0][1]);
    for (let i = 1; i < rawPoly.length; i++) {
      ctx.lineTo(rawPoly[i][0], rawPoly[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    return;
  }

  // Deterministic roughening
  const roughAmount = Math.min(0.8, Math.max(0.15, metersToUnits(0.5, metersPerUnit)));
  const poly = getCachedRoughened(bld.id, rawPoly, roughAmount);

  // Base cast shadow on South-East (shifted right and down)
  // Shadow opacity is adjusted based on theme (slightly darker on stone to stand out from ground)
  const heightUnits = metersToUnits(bld.heightM, metersPerUnit);
  const shadowDist = Math.max(0.6, heightUnits * 0.35);
  const shadowShiftX = shadowDist * 0.7;
  const shadowShiftY = shadowDist * 0.7;

  ctx.fillStyle = getBuildingShadowColor(roofTheme);
  ctx.beginPath();
  ctx.moveTo(poly[0][0] + shadowShiftX, poly[0][1] + shadowShiftY);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i][0] + shadowShiftX, poly[i][1] + shadowShiftY);
  }
  ctx.closePath();
  ctx.fill();

  // Roof Base Fill
  const slot: TownTextureSlot = `roof:${bld.buildingKind}`;
  const firstEdgeAngleRad =
    rawPoly.length >= 2
      ? Math.atan2(rawPoly[1][1] - rawPoly[0][1], rawPoly[1][0] - rawPoly[0][0])
      : 0;
  const centroid = polygonCentroid(poly);

  const fill = textureResolver?.(slot, {
    centroid,
    firstEdgeAngleRad,
    wUnits,
    hUnits,
  });

  if (fill) {
    ctx.save();
    if (fill.kind === 'pattern') {
      if (fill.pixelated) ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = fill.pattern;
    } else {
      ctx.fillStyle = fill.color;
    }
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    ctx.fill();

    const tintStrength = fill.tintStrength ?? 0.25;
    if (tintStrength > 0) {
      ctx.globalAlpha = tintStrength;
      ctx.fillStyle = roofColor;
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else {
    ctx.fillStyle = roofColor;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Shading from North-West light: South-East half hatch lines
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i][0], poly[i][1]);
  }
  ctx.closePath();
  ctx.clip();

  // Clip diagonal half-plane: NW to SE
  const diagCut = centroid[0] + centroid[1];
  const big = Math.max(wUnits, hUnits) * 3;
  ctx.beginPath();
  ctx.moveTo(centroid[0] - big, centroid[1] + big);
  ctx.lineTo(centroid[0] + big * 2, centroid[1] - big * 2);
  ctx.lineTo(centroid[0] + big * 3, centroid[1] + big * 3);
  ctx.lineTo(centroid[0] - big, centroid[1] + big * 3);
  ctx.closePath();
  ctx.clip();

  // Parallel hatch lines
  ctx.strokeStyle = TOWN_STYLE.inkHatch;
  ctx.lineWidth = 0.5 / Math.max(0.001, zoomPx);
  const hatchSpacing = Math.max(
    0.6,
    Math.min(2.5, metersToUnits(1.2, metersPerUnit))
  );
  hatchPoly(ctx, poly as [number, number][], Math.PI / 4, hatchSpacing);
  ctx.restore();

  // Ink Outline: ~1.2x strengthened, with keeps and stone theme further accented
  const outlineMult = getBuildingOutlineMultiplier(roofTheme, isKeep, isTower);
  ctx.strokeStyle = TOWN_STYLE.ink;
  ctx.lineWidth = outlineMult / Math.max(0.001, zoomPx);
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i][0], poly[i][1]);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawWall(
  ctx: CanvasRenderingContext2D,
  wall: TownWall,
  metersPerUnit: number,
  zoomPx: number,
  textureResolver?: DrawTownOptions['textureResolver']
): void {
  const pts = wall.points;
  if (!pts || pts.length < 2) return;

  const thicknessUnits = metersToUnits(wall.thicknessM, metersPerUnit);
  const wallWidth = Math.max(1.2, thicknessUnits);

  // Divide wall path into segments, cutting out gates
  const segments: { p0: Pt; p1: Pt }[] = [];
  const n = pts.length;
  const numEdges = wall.closed ? n : n - 1;

  for (let i = 0; i < numEdges; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];

    // Find any gates on this segment
    const segmentGates = (wall.gates || []).filter((g) => g.segmentIndex === i);
    if (segmentGates.length === 0) {
      segments.push({ p0, p1 });
    } else {
      segmentGates.sort((a, b) => a.t - b.t);
      const edgeLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      let lastT = 0;

      for (const gate of segmentGates) {
        const halfGateT =
          edgeLen > 0 ? (metersToUnits(gate.widthM, metersPerUnit) * 0.5) / edgeLen : 0;
        const tStart = Math.max(0, gate.t - halfGateT);
        const tEnd = Math.min(1, gate.t + halfGateT);

        if (tStart > lastT) {
          segments.push({
            p0: [p0[0] + (p1[0] - p0[0]) * lastT, p0[1] + (p1[1] - p0[1]) * lastT],
            p1: [p0[0] + (p1[0] - p0[0]) * tStart, p0[1] + (p1[1] - p0[1]) * tStart],
          });
        }

        drawGatehouse(ctx, p0, p1, tStart, tEnd, wallWidth, zoomPx);
        lastT = tEnd;
      }

      if (lastT < 1.0) {
        segments.push({
          p0: [p0[0] + (p1[0] - p0[0]) * lastT, p0[1] + (p1[1] - p0[1]) * lastT],
          p1: [p0[0] + (p1[0] - p0[0]) * 1.0, p0[1] + (p1[1] - p0[1]) * 1.0],
        });
      }
    }
  }

  // Stroke wall segments: Dark ink outline underneath, masonry fill on top
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  // 1. Ink background
  ctx.strokeStyle = TOWN_STYLE.ink;
  ctx.lineWidth = wallWidth + 1.2 / Math.max(0.001, zoomPx);
  ctx.beginPath();
  for (const seg of segments) {
    ctx.moveTo(seg.p0[0], seg.p0[1]);
    ctx.lineTo(seg.p1[0], seg.p1[1]);
  }
  ctx.stroke();

  // 2. Stone masonry surface
  const wallFill = textureResolver?.('wall');
  if (wallFill) {
    ctx.save();
    if (wallFill.kind === 'pattern') {
      if (wallFill.pixelated) ctx.imageSmoothingEnabled = false;
      ctx.strokeStyle = wallFill.pattern;
    } else {
      ctx.strokeStyle = wallFill.color;
    }
    ctx.lineWidth = wallWidth;
    ctx.beginPath();
    for (const seg of segments) {
      ctx.moveTo(seg.p0[0], seg.p0[1]);
      ctx.lineTo(seg.p1[0], seg.p1[1]);
    }
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = TOWN_STYLE.stoneWall;
    ctx.lineWidth = wallWidth;
    ctx.beginPath();
    for (const seg of segments) {
      ctx.moveTo(seg.p0[0], seg.p0[1]);
      ctx.lineTo(seg.p1[0], seg.p1[1]);
    }
    ctx.stroke();
  }

  // Corner towers
  if (wall.towers) {
    const towerRadiusUnits = metersToUnits(wall.towerRadiusM, metersPerUnit);
    const radius = Math.max(1.8, towerRadiusUnits);

    for (let i = 0; i < pts.length; i++) {
      const tp = pts[i];
      ctx.beginPath();
      ctx.arc(tp[0], tp[1], radius, 0, Math.PI * 2);

      if (wallFill) {
        ctx.save();
        if (wallFill.kind === 'pattern') {
          if (wallFill.pixelated) ctx.imageSmoothingEnabled = false;
          ctx.fillStyle = wallFill.pattern;
        } else {
          ctx.fillStyle = wallFill.color;
        }
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = TOWN_STYLE.stoneTower;
        ctx.fill();
      }

      ctx.strokeStyle = TOWN_STYLE.ink;
      ctx.lineWidth = 1.0 / Math.max(0.001, zoomPx);
      ctx.stroke();

      // Shadow crescent on SE side of tower
      ctx.save();
      ctx.beginPath();
      ctx.arc(tp[0], tp[1], radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = TOWN_STYLE.inkShadow;
      ctx.beginPath();
      ctx.arc(tp[0] + radius * 0.4, tp[1] + radius * 0.4, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawGatehouse(
  ctx: CanvasRenderingContext2D,
  p0: Pt,
  p1: Pt,
  tStart: number,
  tEnd: number,
  wallWidth: number,
  zoomPx: number
): void {
  const g1: Pt = [p0[0] + (p1[0] - p0[0]) * tStart, p0[1] + (p1[1] - p0[1]) * tStart];
  const g2: Pt = [p0[0] + (p1[0] - p0[0]) * tEnd, p0[1] + (p1[1] - p0[1]) * tEnd];

  const towerSize = wallWidth * 1.4;

  const drawSquareTower = (p: Pt) => {
    const half = towerSize * 0.5;
    ctx.fillStyle = TOWN_STYLE.stoneTower;
    ctx.fillRect(p[0] - half, p[1] - half, towerSize, towerSize);

    ctx.strokeStyle = TOWN_STYLE.ink;
    ctx.lineWidth = 1.0 / Math.max(0.001, zoomPx);
    ctx.strokeRect(p[0] - half, p[1] - half, towerSize, towerSize);
  };

  drawSquareTower(g1);
  drawSquareTower(g2);
}

function drawSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  obj: TownObject,
  zoomPx: number
): void {
  ctx.save();
  ctx.strokeStyle = TOWN_STYLE.selectionOutline;
  ctx.lineWidth = 2.5 / Math.max(0.001, zoomPx);
  ctx.setLineDash([4 / Math.max(0.001, zoomPx), 3 / Math.max(0.001, zoomPx)]);

  if (obj.kind === 'district' || obj.kind === 'building') {
    const pts = obj.polygon;
    if (pts.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.stroke();
    }
  } else if (obj.kind === 'road' || obj.kind === 'pier' || obj.kind === 'wall') {
    const pts = obj.points;
    if (pts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (obj.kind === 'wall' && obj.closed) ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();
}
