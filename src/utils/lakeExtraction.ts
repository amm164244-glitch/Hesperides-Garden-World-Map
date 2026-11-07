/**
 * Lake Extraction and Boundary Vectorization from Hydrological Depressions
 * Converts depression cell components into organic, smoothed closed polygons
 * strictly constrained to depression basins and clear of oceans.
 */

import { LakeData, RiverData } from '../types/water';
import { Depression, HydrologyResult } from './hydrology';
import { simplifyPolyline, pointInPolygon } from './regionShape';

export const FANTASY_LAKE_NAMES = [
  'エヴディン湖',
  '鏡面湖',
  '霧の湖',
  '星影の湖',
  'ルーン湖',
  '白鳥の湖',
  '黒碧湖',
  '氷晶湖',
  '静寂湖',
  '翠玉湖',
  '風鳴り湖',
  '三日月湖',
  '神緑湖',
  '薄明の湖',
  '白銀湖',
  '竜眠湖',
  '月詠湖',
  '碧水湖',
  '静謐湖',
  '精霊湖',
];

export interface LakeExtractionParams {
  cols: number;
  rows: number;
  mapWidth: number;
  mapHeight: number;
  seaLevel: number;
  seed?: number;
  lakeCount?: number;
  minLakeCells?: number;
  minDepth?: number;
}

/**
 * Traces the boundary contour of a connected set of grid cells.
 */
function traceDepressionBoundary(
  cells: number[],
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number
): [number, number][] {
  const cellSet = new Set(cells);
  const cellW = mapWidth / (cols - 1);
  const cellH = mapHeight / (rows - 1);

  // Each directed edge has a start and end key
  // Directed clockwise around filled cells
  interface DirectedEdge {
    p1: [number, number];
    p2: [number, number];
  }
  const edges: DirectedEdge[] = [];

  for (const idx of cells) {
    const c = idx % cols;
    const r = Math.floor(idx / cols);

    // Grid cell corners in map coordinates
    const x0 = Math.max(0, (c - 0.5) * cellW);
    const x1 = Math.min(mapWidth, (c + 0.5) * cellW);
    const y0 = Math.max(0, (r - 0.5) * cellH);
    const y1 = Math.min(mapHeight, (r + 0.5) * cellH);

    // Top neighbor (r - 1)
    if (r === 0 || !cellSet.has((r - 1) * cols + c)) {
      edges.push({ p1: [x0, y0], p2: [x1, y0] });
    }
    // Right neighbor (c + 1)
    if (c === cols - 1 || !cellSet.has(r * cols + (c + 1))) {
      edges.push({ p1: [x1, y0], p2: [x1, y1] });
    }
    // Bottom neighbor (r + 1)
    if (r === rows - 1 || !cellSet.has((r + 1) * cols + c)) {
      edges.push({ p1: [x1, y1], p2: [x0, y1] });
    }
    // Left neighbor (c - 1)
    if (c === 0 || !cellSet.has(r * cols + (c - 1))) {
      edges.push({ p1: [x0, y1], p2: [x0, y0] });
    }
  }

  if (edges.length === 0) return [];

  // Chain directed edges into rings
  const keyOf = (p: [number, number]) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const outgoing = new Map<string, DirectedEdge>();

  for (const e of edges) {
    outgoing.set(keyOf(e.p1), e);
  }

  // Find all closed loops
  const visited = new Set<string>();
  const loops: [number, number][][] = [];

  for (const startEdge of edges) {
    const startKey = keyOf(startEdge.p1);
    if (visited.has(startKey)) continue;

    const ring: [number, number][] = [];
    let currEdge: DirectedEdge | undefined = startEdge;

    while (currEdge) {
      const k1 = keyOf(currEdge.p1);
      if (visited.has(k1)) break;
      visited.add(k1);
      ring.push(currEdge.p1);

      const k2 = keyOf(currEdge.p2);
      currEdge = outgoing.get(k2);
      if (k2 === startKey) break;
    }

    if (ring.length >= 3) {
      loops.push(ring);
    }
  }

  if (loops.length === 0) return [];

  // Pick the loop with the largest bounding area (the outer perimeter)
  let bestLoop = loops[0];
  let maxArea = -1;
  for (const loop of loops) {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const j = (i + 1) % loop.length;
      a += loop[i][0] * loop[j][1] - loop[j][0] * loop[i][1];
    }
    const absArea = Math.abs(a * 0.5);
    if (absArea > maxArea) {
      maxArea = absArea;
      bestLoop = loop;
    }
  }

  return bestLoop;
}

/**
 * Chaikin smoothing for closed polygon.
 */
function chaikinClosed(polygon: [number, number][], iterations: number = 2): [number, number][] {
  let current = polygon;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [];
    const n = current.length;
    for (let i = 0; i < n; i++) {
      const p0 = current[i];
      const p1 = current[(i + 1) % n];

      next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
      next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
    }
    current = next;
  }
  return current;
}

/**
 * Extracts qualified lakes from hydrological depressions.
 */
export function extractLakes(
  hydro: HydrologyResult,
  elevationGrid: Float32Array,
  params: LakeExtractionParams
): LakeData[] {
  const {
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    seed = 42,
    lakeCount = 6,
    minLakeCells = Math.max(8, Math.floor(cols * rows * 0.00004)),
    minDepth = 1.0,
  } = params;

  if (lakeCount <= 0 || !hydro.depressions || hydro.depressions.length === 0) {
    return [];
  }

  // 1. Filter depressions:
  // Must satisfy minLakeCells, minDepth, and not touch map borders or ocean
  const validDepressions: Depression[] = [];

  for (const dep of hydro.depressions) {
    if (dep.area < minLakeCells) continue;
    if (dep.maxDepth < minDepth) continue;

    // Check if any cell touches the border or is below sea level
    let touchesBorderOrOcean = false;
    for (const cellIdx of dep.cells) {
      const c = cellIdx % cols;
      const r = Math.floor(cellIdx / cols);
      if (c === 0 || c === cols - 1 || r === 0 || r === rows - 1) {
        touchesBorderOrOcean = true;
        break;
      }
      if (elevationGrid[cellIdx] < seaLevel) {
        touchesBorderOrOcean = true;
        break;
      }
    }

    if (!touchesBorderOrOcean) {
      validDepressions.push(dep);
    }
  }

  // 2. Sort by depression area descending and select top lakeCount
  validDepressions.sort((a, b) => b.area - a.area);
  const selectedDepressions = validDepressions.slice(0, lakeCount);

  const cellW = mapWidth / (cols - 1);
  const lakes: LakeData[] = [];

  for (let idx = 0; idx < selectedDepressions.length; idx++) {
    const dep = selectedDepressions[idx];
    const rawRing = traceDepressionBoundary(dep.cells, cols, rows, mapWidth, mapHeight);
    if (rawRing.length < 3) continue;

    // Chaikin smoothing (2 passes)
    const smoothed = chaikinClosed(rawRing, 2);

    // RDP simplification with tolerance ~ 0.3 * cellW
    const simplified = simplifyPolyline(smoothed, Math.max(0.5, cellW * 0.3));

    // Ensure valid non-degenerate polygon
    if (simplified.length < 3) continue;

    const lakeId = `lake_${seed}_${idx + 1}`;
    const name = FANTASY_LAKE_NAMES[idx % FANTASY_LAKE_NAMES.length];

    lakes.push({
      id: lakeId,
      name,
      polygon: simplified,
      elevation: dep.spillElevation,
      depth: Math.round(dep.maxDepth * 80 + 30),
    });
  }

  return lakes;
}

/**
 * Finds the nearest point on a lake polygon perimeter to a given query point.
 */
export function findNearestLakePerimeterPoint(
  polygon: [number, number][],
  queryPt: [number, number]
): [number, number] {
  if (polygon.length === 0) return queryPt;

  let bestPt: [number, number] = polygon[0];
  let bestDistSq = Infinity;

  const [qx, qy] = queryPt;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];

    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const lenSq = dx * dx + dy * dy;

    let proj: [number, number];
    if (lenSq < 1e-8) {
      proj = p1;
    } else {
      const t = Math.max(0, Math.min(1, ((qx - p1[0]) * dx + (qy - p1[1]) * dy) / lenSq));
      proj = [p1[0] + t * dx, p1[1] + t * dy];
    }

    const dSq = (qx - proj[0]) ** 2 + (qy - proj[1]) ** 2;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestPt = proj;
    }
  }

  return bestPt;
}

/**
 * Clamps a river terminating into a lake to the outer perimeter of that lake,
 * preventing river lines from drawing inside the lake body.
 */
export function clampRiverToLakePerimeter(river: RiverData, lake: LakeData): void {
  if (river.points.length < 2) return;

  // Trim any points that fall inside the lake polygon from the end
  let lastOutsideIndex = river.points.length - 1;
  while (lastOutsideIndex > 0 && pointInPolygon(river.points[lastOutsideIndex], lake.polygon)) {
    lastOutsideIndex--;
  }

  const trimmed = river.points.slice(0, lastOutsideIndex + 1);
  const snapPt = findNearestLakePerimeterPoint(lake.polygon, trimmed[trimmed.length - 1]);
  trimmed.push(snapPt);
  river.points = trimmed;
}
