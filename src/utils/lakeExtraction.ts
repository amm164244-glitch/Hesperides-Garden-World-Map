/**
 * Lake Extraction and Boundary Vectorization from Hydrological Depressions
 * Converts depression cell components into organic, smoothed closed polygons
 * strictly constrained to depression basins and clear of oceans.
 */

import { LakeData, RiverData } from '../types/water';
import { Depression, HydrologyResult } from './hydrology';
import { simplifyPolyline, pointInPolygon } from './regionShape';
import { extractClosedContours } from './marchingSquares';

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
 * Calculates the signed area of a 2D closed polygon.
 */
function polygonArea(poly: [number, number][]): number {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return Math.abs(a * 0.5);
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

  interface DirectedEdge {
    p1: [number, number];
    p2: [number, number];
  }
  const edges: DirectedEdge[] = [];

  for (const idx of cells) {
    const c = idx % cols;
    const r = Math.floor(idx / cols);

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

  const keyOf = (p: [number, number]) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const outgoing = new Map<string, DirectedEdge>();

  for (const e of edges) {
    outgoing.set(keyOf(e.p1), e);
  }

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

  let bestLoop = loops[0];
  let maxArea = -1;
  for (const loop of loops) {
    const absArea = polygonArea(loop);
    if (absArea > maxArea) {
      maxArea = absArea;
      bestLoop = loop;
    }
  }

  return bestLoop;
}

/**
 * Laplacian smoothing for closed polygon ring.
 * Each point moves towards average of its neighbors by factor (default 0.5).
 */
function laplacianSmoothClosed(
  points: [number, number][],
  iterations: number = 4,
  factor: number = 0.5
): [number, number][] {
  let pts = points;
  const n = pts.length;
  if (n < 3) return pts;

  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i];
      const nextPt = pts[(i + 1) % n];
      const avgX = (prev[0] + nextPt[0]) * 0.5;
      const avgY = (prev[1] + nextPt[1]) * 0.5;
      next.push([
        curr[0] * (1 - factor) + avgX * factor,
        curr[1] * (1 - factor) + avgY * factor,
      ]);
    }
    pts = next;
  }
  return pts;
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
 * Closed-polygon RDP simplification.
 */
function simplifyClosedPolygon(
  points: [number, number][],
  tolerance: number
): [number, number][] {
  if (points.length <= 3 || tolerance <= 0) {
    return [...points];
  }
  const closed = [...points, points[0]];
  const simplified = simplifyPolyline(closed, tolerance);
  if (
    simplified.length > 3 &&
    Math.hypot(
      simplified[simplified.length - 1][0] - simplified[0][0],
      simplified[simplified.length - 1][1] - simplified[0][1]
    ) < 1e-4
  ) {
    simplified.pop();
  }
  return simplified.length >= 3 ? simplified : points;
}

/**
 * Extracts qualified lakes from hydrological depressions using Marching Squares
 * on the depression's spillElevation isovalue contour, with robust fallback.
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
  const cellH = mapHeight / (rows - 1);
  const cellSize = (cellW + cellH) * 0.5;
  const cellArea = cellW * cellH;

  const lakes: LakeData[] = [];

  for (let idx = 0; idx < selectedDepressions.length; idx++) {
    const dep = selectedDepressions[idx];
    const expectedArea = dep.cells.length * cellArea;

    // Bounding box of dep.cells and find lowest cell
    let minC = cols - 1, maxC = 0, minR = rows - 1, maxR = 0;
    let lowestCell = dep.cells[0];
    let minElev = elevationGrid[lowestCell];

    for (const cellIdx of dep.cells) {
      const c = cellIdx % cols;
      const r = Math.floor(cellIdx / cols);
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;

      const elev = elevationGrid[cellIdx];
      if (elev < minElev) {
        minElev = elev;
        lowestCell = cellIdx;
      }
    }

    // 1. Region R: 8-neighborhood 3-cell dilation of dep.cells
    const inDep = new Uint8Array(cols * rows);
    for (const cellIdx of dep.cells) {
      inDep[cellIdx] = 1;
    }

    let currentR = inDep;
    for (let step = 0; step < 3; step++) {
      const nextR = new Uint8Array(currentR);
      const c0 = Math.max(0, minC - (step + 1));
      const c1 = Math.min(cols - 1, maxC + (step + 1));
      const r0 = Math.max(0, minR - (step + 1));
      const r1 = Math.min(rows - 1, maxR + (step + 1));

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = r * cols + c;
          if (currentR[cell] === 1) continue;
          let hasNeighbor = false;
          for (let dr = -1; dr <= 1 && !hasNeighbor; dr++) {
            const nr = r + dr;
            if (nr < 0 || nr >= rows) continue;
            for (let dc = -1; dc <= 1; dc++) {
              const nc = c + dc;
              if (nc < 0 || nc >= cols) continue;
              if (currentR[nr * cols + nc] === 1) {
                hasNeighbor = true;
                break;
              }
            }
          }
          if (hasNeighbor) {
            nextR[cell] = 1;
          }
        }
      }
      currentR = nextR;
    }

    // 2. Build local subgrid for Marching Squares around dilated region R
    const subMinC = Math.max(0, minC - 4);
    const subMaxC = Math.min(cols - 1, maxC + 4);
    const subMinR = Math.max(0, minR - 4);
    const subMaxR = Math.min(rows - 1, maxR + 4);
    const subCols = subMaxC - subMinC + 1;
    const subRows = subMaxR - subMinR + 1;
    const subGrid = new Float32Array(subCols * subRows);

    for (let rLocal = 0; rLocal < subRows; rLocal++) {
      const r = subMinR + rLocal;
      for (let cLocal = 0; cLocal < subCols; cLocal++) {
        const c = subMinC + cLocal;
        const cell = r * cols + c;
        if (currentR[cell] === 1) {
          subGrid[rLocal * subCols + cLocal] = dep.spillElevation - elevationGrid[cell];
        } else {
          subGrid[rLocal * subCols + cLocal] = -1;
        }
      }
    }

    // Marching squares to trace isovalue 0 contour
    const subWidth = (subCols - 1) * cellW;
    const subHeight = (subRows - 1) * cellH;
    const rawPolys = extractClosedContours(subGrid, subCols, subRows, subWidth, subHeight, 0, 0);

    const rings: [number, number][][] = rawPolys.map((poly) =>
      poly.map((p) => [p.x + subMinC * cellW, p.y + subMinR * cellH])
    );

    // 3. Pick largest outer ring containing lowestCell (ignore interior islands/holes)
    const lowC = lowestCell % cols;
    const lowR = Math.floor(lowestCell / cols);
    const lowPt: [number, number] = [lowC * cellW, lowR * cellH];

    let bestRing: [number, number][] | null = null;
    let maxRingArea = -1;

    for (const ring of rings) {
      if (pointInPolygon(lowPt, ring)) {
        const a = polygonArea(ring);
        if (a > maxRingArea) {
          maxRingArea = a;
          bestRing = ring;
        }
      }
    }

    if (!bestRing && rings.length > 0) {
      for (const ring of rings) {
        const a = polygonArea(ring);
        if (a > maxRingArea) {
          maxRingArea = a;
          bestRing = ring;
        }
      }
    }

    // 5. Verification: Area must be within 0.8x to 1.8x of expected depression cells area
    let finalPolygon: [number, number][];
    if (bestRing && maxRingArea >= 0.8 * expectedArea && maxRingArea <= 1.8 * expectedArea) {
      // 4. Chaikin smoothing (2 passes) and RDP simplification (tolerance 0.15 * cellSize)
      const smoothed = chaikinClosed(bestRing, 2);
      finalPolygon = simplifyClosedPolygon(smoothed, 0.15 * cellSize);
    } else {
      // Fallback: traditional cell boundary tracing + Laplacian smoothing (4 iterations, 0.5 factor)
      const rawBoundary = traceDepressionBoundary(dep.cells, cols, rows, mapWidth, mapHeight);
      if (rawBoundary.length < 3) continue;
      const lap = laplacianSmoothClosed(rawBoundary, 4, 0.5);
      const smoothed = chaikinClosed(lap, 2);
      finalPolygon = simplifyClosedPolygon(smoothed, 0.15 * cellSize);
    }

    if (finalPolygon.length < 3) continue;

    const lakeId = `lake_${seed}_${idx + 1}`;
    const name = FANTASY_LAKE_NAMES[idx % FANTASY_LAKE_NAMES.length];

    lakes.push({
      id: lakeId,
      name,
      polygon: finalPolygon,
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
 * Computes the intersection of line segment A->B with segment C->D.
 */
function segmentIntersection(
  A: [number, number],
  B: [number, number],
  C: [number, number],
  D: [number, number]
): { point: [number, number]; t: number; u: number } | null {
  const dx1 = B[0] - A[0];
  const dy1 = B[1] - A[1];
  const dx2 = D[0] - C[0];
  const dy2 = D[1] - C[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((C[0] - A[0]) * dy2 - (C[1] - A[1]) * dx2) / denom;
  const u = ((C[0] - A[0]) * dy1 - (C[1] - A[1]) * dx1) / denom;

  if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    const uClamped = Math.max(0, Math.min(1, u));
    return {
      point: [C[0] + uClamped * dx2, C[1] + uClamped * dy2],
      t: Math.max(0, Math.min(1, t)),
      u: uClamped,
    };
  }
  return null;
}

/**
 * Finds all intersections of a segment A->B with edges of a polygon.
 */
function findSegmentPolygonIntersections(
  A: [number, number],
  B: [number, number],
  poly: [number, number][]
): { point: [number, number]; t: number; edgeIndex: number }[] {
  const results: { point: [number, number]; t: number; edgeIndex: number }[] = [];
  const k = poly.length;
  for (let j = 0; j < k; j++) {
    const C = poly[j];
    const D = poly[(j + 1) % k];
    const hit = segmentIntersection(A, B, C, D);
    if (hit) {
      results.push({
        point: hit.point,
        t: hit.t,
        edgeIndex: j,
      });
    }
  }
  results.sort((a, b) => a.t - b.t);
  return results;
}

/**
 * Clamps a river to the perimeter of a lake it enters or leaves.
 * - For incoming rivers (terminatesAt === 'lake'): cuts at the first intersection with the lake perimeter.
 * - For outgoing rivers (sourceType === 'lake'): starts at the last intersection exiting the lake perimeter.
 * - If no intersection is found: connects straight to the closest perimeter point if within 3 * cellSize and <= 60 deg.
 * - Prunes all river points inside the lake body.
 */
export function clampRiverToLakePerimeter(
  river: RiverData,
  lake: LakeData,
  cellSize?: number
): void {
  if (river.points.length < 2 || lake.polygon.length < 3) return;

  const poly = lake.polygon;
  const cSize = cellSize ?? 10.0;

  if (river.sourceType === 'lake') {
    // 1. River leaving lake: search from start towards end for LAST intersection exiting the lake
    let lastHit: { segIndex: number; point: [number, number] } | null = null;
    for (let i = river.points.length - 2; i >= 0; i--) {
      const hits = findSegmentPolygonIntersections(river.points[i], river.points[i + 1], poly);
      if (hits.length > 0) {
        lastHit = { segIndex: i, point: hits[hits.length - 1].point };
        break;
      }
    }

    if (lastHit) {
      const i = lastHit.segIndex;
      const newPts: [number, number][] = [lastHit.point];
      for (let k = i + 1; k < river.points.length; k++) {
        newPts.push(river.points[k]);
      }
      river.points = newPts;
    } else {
      // No intersection found: check distance and angle
      const pFirst = river.points[0];
      const pNext = river.points[1];
      const snapPt = findNearestLakePerimeterPoint(poly, pFirst);
      const dist = Math.hypot(pFirst[0] - snapPt[0], pFirst[1] - snapPt[1]);
      if (dist <= 3 * cSize) {
        const vRiver = [pNext[0] - pFirst[0], pNext[1] - pFirst[1]];
        const vFromEdge = [pFirst[0] - snapPt[0], pFirst[1] - snapPt[1]];
        const lenRiver = Math.hypot(vRiver[0], vRiver[1]) || 1;
        const lenFromEdge = Math.hypot(vFromEdge[0], vFromEdge[1]);
        if (lenFromEdge > 1e-6) {
          const dot = (vRiver[0] * vFromEdge[0] + vRiver[1] * vFromEdge[1]) / (lenRiver * lenFromEdge);
          if (dot >= 0.5 - 1e-4) {
            river.points.unshift(snapPt);
          }
        }
      }
    }

    // Remove any remaining points inside the lake interior (except the first point on the edge)
    const cleaned: [number, number][] = [river.points[0]];
    for (let idx = 1; idx < river.points.length; idx++) {
      if (!pointInPolygon(river.points[idx], poly)) {
        cleaned.push(river.points[idx]);
      }
    }
    if (cleaned.length >= 2) {
      river.points = cleaned;
    }
  } else {
    // 2. River entering lake (terminatesAt === 'lake'):
    // Search from source (i = 0) towards end for FIRST intersection entering the lake
    let firstHit: { segIndex: number; point: [number, number] } | null = null;
    for (let i = 0; i < river.points.length - 1; i++) {
      const hits = findSegmentPolygonIntersections(river.points[i], river.points[i + 1], poly);
      if (hits.length > 0) {
        firstHit = { segIndex: i, point: hits[0].point };
        break;
      }
    }

    if (firstHit) {
      const i = firstHit.segIndex;
      const newPts = river.points.slice(0, i + 1);
      newPts.push(firstHit.point);
      river.points = newPts;
    } else {
      // No intersection found: check distance and angle
      const m = river.points.length;
      const pLast = river.points[m - 1];
      const pPrev = river.points[m - 2];
      const snapPt = findNearestLakePerimeterPoint(poly, pLast);
      const dist = Math.hypot(pLast[0] - snapPt[0], pLast[1] - snapPt[1]);
      if (dist <= 3 * cSize) {
        const vRiver = [pLast[0] - pPrev[0], pLast[1] - pPrev[1]];
        const vToEdge = [snapPt[0] - pLast[0], snapPt[1] - pLast[1]];
        const lenRiver = Math.hypot(vRiver[0], vRiver[1]) || 1;
        const lenToEdge = Math.hypot(vToEdge[0], vToEdge[1]);
        if (lenToEdge > 1e-6) {
          const dot = (vRiver[0] * vToEdge[0] + vRiver[1] * vToEdge[1]) / (lenRiver * lenToEdge);
          if (dot >= 0.5 - 1e-4) {
            river.points.push(snapPt);
          }
        }
      }
    }

    // Remove any remaining points inside the lake interior (except the last point on the edge)
    const n = river.points.length;
    const cleaned: [number, number][] = [];
    for (let idx = 0; idx < n; idx++) {
      if (idx === n - 1) {
        cleaned.push(river.points[idx]);
      } else if (!pointInPolygon(river.points[idx], poly)) {
        cleaned.push(river.points[idx]);
      }
    }
    if (cleaned.length >= 2) {
      river.points = cleaned;
    }
  }
}
