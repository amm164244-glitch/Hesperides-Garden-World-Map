/**
 * Procedural Hydrological Water Generator (Rivers & Lakes)
 * Simulates realistic drainage basins, mountain spring sources, downhill flow,
 * meanders, tributary confluence, natural lake-to-lake drainage chains,
 * and seamless ocean estuaries.
 */

import { RiverData, LakeData } from '../types/water';
import { Mulberry32, Noise2D } from './prng';

const FANTASY_RIVER_NAMES = [
  '大河アンドゥイン',
  '銀流河',
  '白銀川',
  'アイゼン川',
  'エント川',
  'ミセルセイル川',
  'セルデュイン川',
  'ブランディワイン川',
  '霧降川',
  '翡翠川',
  '碧流河',
  '紅蓮川',
  '疾風川',
  '静水河',
  '深緑川',
  '蒼穹川',
  '清流シルヴァ',
  '月影河',
  '白樺川',
  '黄金河',
  '青龍川',
  '星雫川',
  '双子河',
  '黎明川',
];

const FANTASY_LAKE_NAMES = [
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

export interface WaterGenOptions {
  riverCount?: number;
  lakeCount?: number;
  enableRivers?: boolean;
  enableLakes?: boolean;
  worldWidthKm?: number;
}

/**
 * Bilinear elevation sample from Float32Array grid.
 */
export function sampleElev(
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  x: number,
  y: number
): number {
  const gx = (x / mapW) * (cols - 1);
  const gy = (y / mapH) * (rows - 1);
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, gx - c0));
  const ty = Math.max(0, Math.min(1, gy - r0));

  const e00 = grid[r0 * cols + c0];
  const e10 = grid[r0 * cols + c1];
  const e01 = grid[r1 * cols + c0];
  const e11 = grid[r1 * cols + c1];

  const top = e00 * (1 - tx) + e10 * tx;
  const bot = e01 * (1 - tx) + e11 * tx;
  return top * (1 - ty) + bot * ty;
}

/**
 * Computes elevation gradient vector (dE/dx, dE/dy) using central differences.
 */
export function sampleGradient(
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  x: number,
  y: number
): { gx: number; gy: number } {
  const stepX = Math.max(1, mapW / cols);
  const stepY = Math.max(1, mapH / rows);

  const eLeft = sampleElev(grid, cols, rows, mapW, mapH, x - stepX, y);
  const eRight = sampleElev(grid, cols, rows, mapW, mapH, x + stepX, y);
  const eTop = sampleElev(grid, cols, rows, mapW, mapH, x, y - stepY);
  const eBottom = sampleElev(grid, cols, rows, mapW, mapH, x, y + stepY);

  return {
    gx: (eRight - eLeft) / (2 * stepX),
    gy: (eBottom - eTop) / (2 * stepY),
  };
}

/**
 * Creates an organic closed lake polygon deformed by multi-octave noise.
 * Includes gentle elongation along a valley angle for natural geography.
 */
export function createOrganicLake(
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  numPoints: number = 24
): [number, number][] {
  const noise = new Noise2D(seed);
  const rng = new Mulberry32(seed + 314);
  const poly: [number, number][] = [];

  // Natural valley elongation (1.1 ~ 1.5 aspect ratio)
  const valleyAngle = rng.next() * Math.PI;
  const elongation = 1.15 + rng.next() * 0.35;
  const cosV = Math.cos(valleyAngle);
  const sinV = Math.sin(valleyAngle);

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);

    // Multi-frequency radial deformation for natural bays and coves
    const warp1 = noise.sample(nx * 1.5 + 12.3, ny * 1.5 + 45.6) * 0.22;
    const warp2 = noise.sample(nx * 3.2 + 78.9, ny * 3.2 + 23.4) * 0.09;
    let r = radius * (1.0 + warp1 + warp2);

    // Apply valley axis elongation (aspect ratio 1.1 ~ 1.35)
    const alongValley = nx * cosV + ny * sinV;
    const acrossValley = -nx * sinV + ny * cosV;
    const shapeScale = Math.hypot(alongValley * elongation, acrossValley / elongation);
    const clampedR = Math.min(radius * 1.22, r * shapeScale);

    poly.push([cx + nx * clampedR, cy + ny * clampedR]);
  }

  // Smooth polygon with Catmull-Rom
  return smoothPolygonCatmullRom(poly, 2);
}

/**
 * Centripetal Catmull-Rom spline interpolation for closed polygon.
 */
function smoothPolygonCatmullRom(poly: [number, number][], subdivisions: number = 2): [number, number][] {
  const n = poly.length;
  if (n < 3) return poly;

  const result: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const p3 = poly[(i + 2) % n];

    for (let s = 0; s < subdivisions; s++) {
      const t = s / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

      result.push([x, y]);
    }
  }

  return result;
}

/**
 * Checks if a point [px, py] is inside a polygon using ray casting.
 */
export function pointInLake(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Catmull-Rom smoothing for open polyline (river path).
 */
export function smoothRiverPath(points: [number, number][], subdivisions: number = 2): [number, number][] {
  const n = points.length;
  if (n < 3) return points;

  const result: [number, number][] = [];
  result.push(points[0]);

  for (let i = 0; i < n - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < n ? points[i + 2] : points[i + 1];

    for (let s = 1; s <= subdivisions; s++) {
      const t = s / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

      result.push([x, y]);
    }
  }

  return result;
}

/**
 * Main Procedural River & Lake Generator.
 * Given an elevation field:
 * 1. Places inland lake basins strictly clear of the ocean coast, scaled to realistic geographical dimensions
 *    (preventing oversized >100km blobs).
 * 2. Connects higher lakes down to lower lakes via natural outflow rivers.
 * 3. Traces downhill river paths that flare cleanly into ocean estuaries or enter lakes without border crossbars.
 */
export function generateRiversAndLakes(
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
  seaLevel: number,
  seed: number,
  options: WaterGenOptions = {}
): { rivers: RiverData[]; lakes: LakeData[] } {
  const enableRivers = options.enableRivers ?? true;
  const enableLakes = options.enableLakes ?? true;
  const targetRiverCount = options.riverCount ?? 14;
  const targetLakeCount = options.lakeCount ?? 6;
  const worldWidthKm = options.worldWidthKm || 40000;

  if (!enableRivers && !enableLakes) {
    return { rivers: [], lakes: [] };
  }

  const rng = new Mulberry32(seed + 8819);
  const meanderNoise = new Noise2D(seed + 4417);

  const kmPerUnit = Math.max(0.001, worldWidthKm / mapWidth);

  const lakes: LakeData[] = [];
  const rivers: RiverData[] = [];

  // ==========================================
  // 1. Procedural Lake Generation (Inland Basins)
  // ==========================================
  if (enableLakes && targetLakeCount > 0) {
    const candidateBasins: { x: number; y: number; depth: number; elev: number }[] = [];
    const stepC = Math.max(2, Math.floor(cols / 70));
    const stepR = Math.max(2, Math.floor(rows / 35));

    for (let r = stepR * 2; r < rows - stepR * 2; r += stepR) {
      const wy = (r / (rows - 1)) * mapHeight;
      for (let c = stepC * 2; c < cols - stepC * 2; c += stepC) {
        const wx = (c / (cols - 1)) * mapWidth;
        const elev = elevationGrid[r * cols + c];

        // Only on land and comfortably above sea level (must not be directly on coast)
        if (elev < seaLevel + 3.5 || elev > 80.0) continue;

        // Check surrounding 8 neighbors for local valley / depression
        let isLocalBasin = true;
        let avgSurrounding = 0;
        let neighborCount = 0;

        for (let dr = -stepR; dr <= stepR; dr += stepR) {
          for (let dc = -stepC; dc <= stepC; dc += stepC) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            const ne = elevationGrid[nr * cols + nc];
            if (ne < elev - 0.5) {
              isLocalBasin = false;
              break;
            }
            avgSurrounding += ne;
            neighborCount++;
          }
          if (!isLocalBasin) break;
        }

        if (isLocalBasin && neighborCount > 0) {
          const depth = avgSurrounding / neighborCount - elev;
          candidateBasins.push({ x: wx, y: wy, depth, elev });
        }
      }
    }

    // Sort basins by depression depth and elevation
    candidateBasins.sort((a, b) => b.depth - a.depth);

    for (const basin of candidateBasins) {
      if (lakes.length >= targetLakeCount) break;

      // Realistic Geographic Lake Sizing:
      // Real-world lake diameter: mostly 18 km to 48 km (radius 9 to 24 km).
      // Max diameter strictly capped to avoid >100km monsters as requested.
      const targetDiameterKm = 18 + rng.next() * 26; // 18 km to 44 km
      const targetRadiusKm = targetDiameterKm * 0.5;
      let baseRadius = targetRadiusKm / kmPerUnit;

      // On planetary world map, ensure baseRadius is at least 1.4 units for visibility
      baseRadius = Math.max(1.4, Math.min(mapWidth * 0.012, baseRadius));
      if (baseRadius * 1.25 * kmPerUnit > 36) {
        baseRadius = 28.8 / kmPerUnit;
      }

      // Strict Coastline Clearance:
      // Verify that NO part of the lake will touch or overlap the ocean.
      // Check 12 radial points around the basin at 0.8 * R, 1.2 * R, and 1.8 * R.
      let touchesCoast = false;
      const testRadius = baseRadius * 1.8;
      for (let a = 0; a < 12; a++) {
        const rad = (a / 12) * Math.PI * 2;
        const tx = basin.x + Math.cos(rad) * testRadius;
        const ty = basin.y + Math.sin(rad) * testRadius;
        if (tx < 10 || tx > mapWidth - 10 || ty < 10 || ty > mapHeight - 10) {
          touchesCoast = true;
          break;
        }
        const samp = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, tx, ty);
        if (samp <= seaLevel + 1.8) {
          touchesCoast = true;
          break;
        }
      }
      if (touchesCoast) continue;

      // Minimum spacing between lakes to prevent awkward clustering
      const minLakeDist = Math.max(25, baseRadius * 3.2);
      const tooClose = lakes.some((lake) => {
        const [lx, ly] = lake.polygon[0];
        return Math.hypot(basin.x - lx, basin.y - ly) < minLakeDist;
      });
      if (tooClose) continue;

      const lakeId = `lake_${lakes.length + 1}_${Math.floor(rng.next() * 10000)}`;
      const name = FANTASY_LAKE_NAMES[lakes.length % FANTASY_LAKE_NAMES.length];
      const polygon = createOrganicLake(basin.x, basin.y, baseRadius, seed + lakes.length * 101);

      // Verify every vertex of polygon is strictly inland
      const allLand = polygon.every(([px, py]) => {
        const e = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, px, py);
        return e > seaLevel + 1.0;
      });
      if (!allLand) continue;

      lakes.push({
        id: lakeId,
        name,
        polygon,
        elevation: basin.elev,
        depth: Math.round(basin.depth * 80 + 30),
      });
    }
  }

  // ==========================================
  // 2. Procedural River Generation & Lake Connections
  // ==========================================
  if (enableRivers && targetRiverCount > 0) {
    const stepSize = Math.max(3.0, (mapWidth / cols) * 1.8);
    const maxSteps = 400;

    // A. Lake-to-Lake and Lake-to-Sea Drainage Connections (Outflows)
    // Sort lakes by elevation descending (highest lakes first)
    const sortedLakes = [...lakes].sort((a, b) => (b.elevation || 0) - (a.elevation || 0));

    for (const sourceLake of sortedLakes) {
      if (rivers.length >= targetRiverCount) break;

      // Find lowest shoreline point on this lake as the natural outflow spillway
      let lowestP = sourceLake.polygon[0];
      let lowestE = Infinity;
      for (const p of sourceLake.polygon) {
        const e = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, p[0], p[1]);
        if (e < lowestE) {
          lowestE = e;
          lowestP = p;
        }
      }

      // Trace downhill from this lake outlet
      const outflowRiver = traceDownhillPath({
        startX: lowestP[0],
        startY: lowestP[1],
        sourceType: 'lake',
        sourceLakeId: sourceLake.id,
        elevationGrid,
        cols,
        rows,
        mapWidth,
        mapHeight,
        seaLevel,
        stepSize,
        maxSteps,
        lakes,
        existingRivers: rivers,
        meanderNoise,
        rng,
        kmPerUnit,
      });

      if (outflowRiver) {
        rivers.push(outflowRiver);
      }
    }

    // B. Mountain Springs and Highland Sources
    const candidateSources: { x: number; y: number; elevation: number }[] = [];
    const stepC = Math.max(3, Math.floor(cols / 55));
    const stepR = Math.max(3, Math.floor(rows / 28));

    for (let r = stepR * 2; r < rows - stepR * 2; r += stepR) {
      const wy = (r / (rows - 1)) * mapHeight;
      for (let c = stepC * 2; c < cols - stepC * 2; c += stepC) {
        const wx = (c / (cols - 1)) * mapWidth;
        const elev = elevationGrid[r * cols + c];

        // Highlands & mountain ridges (elevation seaLevel + 12 ~ 88)
        if (elev >= seaLevel + 12.0 && elev <= 88.0) {
          candidateSources.push({ x: wx, y: wy, elevation: elev });
        }
      }
    }

    // Shuffle mountain sources
    for (let i = candidateSources.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const temp = candidateSources[i];
      candidateSources[i] = candidateSources[j];
      candidateSources[j] = temp;
    }

    const minSourceDist = Math.min(mapWidth, mapHeight) * 0.07;

    for (const src of candidateSources) {
      if (rivers.length >= targetRiverCount) break;

      const isTooClose = rivers.some((r) => {
        const sp = r.points[0];
        return Math.hypot(src.x - sp[0], src.y - sp[1]) < minSourceDist;
      });
      if (isTooClose) continue;

      const mountainRiver = traceDownhillPath({
        startX: src.x,
        startY: src.y,
        sourceType: 'spring',
        elevationGrid,
        cols,
        rows,
        mapWidth,
        mapHeight,
        seaLevel,
        stepSize,
        maxSteps,
        lakes,
        existingRivers: rivers,
        meanderNoise,
        rng,
        kmPerUnit,
      });

      if (mountainRiver) {
        rivers.push(mountainRiver);
      }
    }
  }

  return { rivers, lakes };
}

interface TraceOptions {
  startX: number;
  startY: number;
  sourceType: 'spring' | 'lake';
  sourceLakeId?: string;
  elevationGrid: Float32Array;
  cols: number;
  rows: number;
  mapWidth: number;
  mapHeight: number;
  seaLevel: number;
  stepSize: number;
  maxSteps: number;
  lakes: LakeData[];
  existingRivers: RiverData[];
  meanderNoise: Noise2D;
  rng: Mulberry32;
  kmPerUnit: number;
}

/**
 * Traces a downhill hydrological river path following elevation gradients.
 * Detects confluence with other lakes, oceans, or parent rivers.
 */
function traceDownhillPath(opt: TraceOptions): RiverData | null {
  const {
    startX,
    startY,
    sourceType,
    sourceLakeId,
    elevationGrid,
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    stepSize,
    maxSteps,
    lakes,
    existingRivers,
    meanderNoise,
    rng,
    kmPerUnit,
  } = opt;

  let curX = startX;
  let curY = startY;
  const rawPoints: [number, number][] = [[curX, curY]];
  let prevDirX = 0;
  let prevDirY = 0;

  let terminatesAt: 'ocean' | 'lake' | 'river' | 'inland' = 'inland';
  let targetLakeId: string | undefined = undefined;
  let connectedRiverId: string | undefined = undefined;
  let reachedWater = false;

  for (let step = 0; step < maxSteps; step++) {
    const elev = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, curX, curY);

    // 1. Reached Ocean! Seamless Estuary Intersection
    if (elev <= seaLevel) {
      if (rawPoints.length >= 2) {
        const prevP = rawPoints[rawPoints.length - 2];
        const prevE = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, prevP[0], prevP[1]);
        // Linear interpolation to find precise coastline crossing point
        const tCross = prevE > seaLevel && elev !== prevE ? (prevE - seaLevel) / (prevE - elev) : 0.5;
        const coastX = prevP[0] + (curX - prevP[0]) * Math.max(0, Math.min(1, tCross));
        const coastY = prevP[1] + (curY - prevP[1]) * Math.max(0, Math.min(1, tCross));
        // Push exact coastline crossing plus subtle 0.3-step estuary point
        rawPoints[rawPoints.length - 1] = [coastX, coastY];
        if (prevDirX !== 0 || prevDirY !== 0) {
          rawPoints.push([coastX + prevDirX * stepSize * 0.3, coastY + prevDirY * stepSize * 0.3]);
        }
      }
      terminatesAt = 'ocean';
      reachedWater = true;
      break;
    }

    // 2. Reached a Lake (other than source lake) -> Natural lake connection!
    if (step > 4) {
      const hitLake = lakes.find((l) => l.id !== sourceLakeId && pointInLake(curX, curY, l.polygon));
      if (hitLake) {
        targetLakeId = hitLake.id;
        terminatesAt = 'lake';
        reachedWater = true;
        break;
      }
    }

    // 3. Merged into an existing river (tributary confluence)
    let merged = false;
    if (step > 6) {
      for (const otherRiver of existingRivers) {
        for (let pi = 0; pi < otherRiver.points.length; pi++) {
          const op = otherRiver.points[pi];
          const dist = Math.hypot(curX - op[0], curY - op[1]);
          if (dist < stepSize * 1.4) {
            rawPoints.push([op[0], op[1]]);
            connectedRiverId = otherRiver.id;
            terminatesAt = 'river';
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
    }
    if (merged) {
      reachedWater = true;
      break;
    }

    // Downhill elevation gradient
    const grad = sampleGradient(elevationGrid, cols, rows, mapWidth, mapHeight, curX, curY);
    let dirX = -grad.gx;
    let dirY = -grad.gy;
    const gradLen = Math.hypot(dirX, dirY);

    if (gradLen > 1e-5) {
      dirX /= gradLen;
      dirY /= gradLen;
    } else if (prevDirX !== 0 || prevDirY !== 0) {
      dirX = prevDirX;
      dirY = prevDirY;
    } else {
      dirX = (rng.next() - 0.5) * 2;
      dirY = (rng.next() - 0.5) * 2;
      const dlen = Math.hypot(dirX, dirY) || 1;
      dirX /= dlen;
      dirY /= dlen;
    }

    // Natural meandering: subtle low-frequency organic curvature
    const meanderScale = 0.0035;
    const meanderAngle = meanderNoise.sample(curX * meanderScale, curY * meanderScale) * 0.7;
    const cosM = Math.cos(meanderAngle);
    const sinM = Math.sin(meanderAngle);
    const rotDirX = dirX * cosM - dirY * sinM;
    const rotDirY = dirX * sinM + dirY * cosM;

    // Momentum / inertia
    const inertia = 0.68;
    const nextDirX = prevDirX === 0 ? rotDirX : prevDirX * inertia + rotDirX * (1 - inertia);
    const nextDirY = prevDirY === 0 ? rotDirY : prevDirY * inertia + rotDirY * (1 - inertia);
    const nextLen = Math.hypot(nextDirX, nextDirY) || 1;
    const finalDirX = nextDirX / nextLen;
    const finalDirY = nextDirY / nextLen;

    prevDirX = finalDirX;
    prevDirY = finalDirY;

    curX += finalDirX * stepSize;
    curY += finalDirY * stepSize;

    // Map boundary safety
    if (curX <= 6 || curX >= mapWidth - 6 || curY <= 6 || curY >= mapHeight - 6) {
      reachedWater = true;
      terminatesAt = 'ocean';
      break;
    }

    rawPoints.push([curX, curY]);
  }

  // Filter out tiny stagnant stubs
  if (rawPoints.length < 6 || (!reachedWater && rawPoints.length < 24)) {
    return null;
  }

  const smoothed = smoothRiverPath(rawPoints, 2);

  // Calibrate river widths based on scale and hierarchy:
  // On world map: widthStart ~0.8 to 1.3, widthEnd ~2.2 to 4.5
  // On regional map: widthStart ~1.2 to 1.8, widthEnd ~3.5 to 6.5
  const isScaleGlobal = kmPerUnit >= 3.0;
  const isTributary = terminatesAt === 'river';

  let widthStart: number;
  let widthEnd: number;

  if (isScaleGlobal) {
    widthStart = isTributary ? 0.75 : sourceType === 'lake' ? 1.4 : 0.9 + rng.next() * 0.4;
    widthEnd = isTributary
      ? 1.6 + rng.next() * 0.6
      : Math.min(4.5, 2.2 + (smoothed.length / 50) * 1.5);
  } else {
    widthStart = isTributary ? 1.2 : sourceType === 'lake' ? 2.2 : 1.4 + rng.next() * 0.6;
    widthEnd = isTributary
      ? 2.8 + rng.next() * 1.2
      : Math.min(6.5, 3.5 + (smoothed.length / 40) * 1.8);
  }

  const riverId = `river_${Date.now()}_${Math.floor(rng.next() * 100000)}`;
  const name = FANTASY_RIVER_NAMES[Math.floor(rng.next() * FANTASY_RIVER_NAMES.length)];

  return {
    id: riverId,
    name,
    points: smoothed,
    widthStart,
    widthEnd,
    sourceType,
    sourceLakeId,
    terminatesAt,
    targetLakeId,
    connectedRiverId,
  };
}
