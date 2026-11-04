/**
 * Procedural Hydrological Water Generator (Rivers & Lakes)
 * Simulates realistic drainage basins, mountain spring sources, downhill flow,
 * meanders, tributary confluence, and natural organic lake basins.
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
];

export interface WaterGenOptions {
  riverCount?: number;
  lakeCount?: number;
  enableRivers?: boolean;
  enableLakes?: boolean;
}

/**
 * Bilinear elevation sample from Float32Array grid.
 */
function sampleElev(
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
  const tx = gx - c0;
  const ty = gy - r0;

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
function sampleGradient(
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
 */
export function createOrganicLake(
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  numPoints: number = 24
): [number, number][] {
  const noise = new Noise2D(seed);
  const poly: [number, number][] = [];

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);

    // Multi-frequency radial deformation for natural bays and coves
    const warp1 = noise.sample(nx * 1.6 + 12.3, ny * 1.6 + 45.6) * 0.28;
    const warp2 = noise.sample(nx * 3.8 + 78.9, ny * 3.8 + 23.4) * 0.12;
    const r = radius * (1.0 + warp1 + warp2);

    poly.push([cx + nx * r, cy + ny * r]);
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
 * Given an elevation field, automatically identifies natural lake basins and
 * mountain springs, then traces realistic downhill drainage river courses.
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

  if (!enableRivers && !enableLakes) {
    return { rivers: [], lakes: [] };
  }

  const rng = new Mulberry32(seed + 8819);
  const meanderNoise = new Noise2D(seed + 4417);

  const lakes: LakeData[] = [];
  const rivers: RiverData[] = [];

  // ==========================================
  // 1. Procedural Lake Generation (Inland Basins)
  // ==========================================
  if (enableLakes && targetLakeCount > 0) {
    const candidateBasins: { x: number; y: number; depth: number }[] = [];
    const stepC = Math.max(2, Math.floor(cols / 80));
    const stepR = Math.max(2, Math.floor(rows / 40));

    for (let r = stepR * 2; r < rows - stepR * 2; r += stepR) {
      const wy = (r / (rows - 1)) * mapHeight;
      for (let c = stepC * 2; c < cols - stepC * 2; c += stepC) {
        const wx = (c / (cols - 1)) * mapWidth;
        const elev = elevationGrid[r * cols + c];

        // Only on land and comfortably above sea level
        if (elev < seaLevel + 2.0 || elev > 75.0) continue;

        // Check surrounding 8 neighbors for local depression
        let isLocalBasin = true;
        let avgSurrounding = 0;
        let neighborCount = 0;

        for (let dr = -stepR; dr <= stepR; dr += stepR) {
          for (let dc = -stepC; dc <= stepC; dc += stepC) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            const ne = elevationGrid[nr * cols + nc];
            if (ne <= elev) {
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
          candidateBasins.push({ x: wx, y: wy, depth });
        }
      }
    }

    // Sort basins by depression depth
    candidateBasins.sort((a, b) => b.depth - a.depth);

    // Pick well-spaced basins
    const minLakeDistance = Math.min(mapWidth, mapHeight) * 0.12;
    for (const basin of candidateBasins) {
      if (lakes.length >= targetLakeCount) break;

      const tooClose = lakes.some((lake) => {
        const [lx, ly] = lake.polygon[0];
        return Math.hypot(basin.x - lx, basin.y - ly) < minLakeDistance;
      });

      if (!tooClose) {
        const baseRadius = (mapWidth * 0.012) * (1.2 + rng.next() * 1.4);
        const lakeId = `lake_${lakes.length + 1}_${Math.floor(rng.next() * 10000)}`;
        const name = FANTASY_LAKE_NAMES[lakes.length % FANTASY_LAKE_NAMES.length];
        const polygon = createOrganicLake(basin.x, basin.y, baseRadius, seed + lakes.length * 101);

        lakes.push({
          id: lakeId,
          name,
          polygon,
        });
      }
    }
  }

  // ==========================================
  // 2. Procedural River Generation (Downhill Flow)
  // ==========================================
  if (enableRivers && targetRiverCount > 0) {
    const candidateSources: { x: number; y: number; elevation: number }[] = [];

    // Lakes as high-priority river outflows
    for (const lake of lakes) {
      // Find lowest elevation point along the lake shore as outflow source
      let lowestP = lake.polygon[0];
      let lowestE = Infinity;
      for (const p of lake.polygon) {
        const e = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, p[0], p[1]);
        if (e < lowestE) {
          lowestE = e;
          lowestP = p;
        }
      }
      candidateSources.push({ x: lowestP[0], y: lowestP[1], elevation: lowestE });
    }

    // Mountain and highland springs
    const stepC = Math.max(3, Math.floor(cols / 60));
    const stepR = Math.max(3, Math.floor(rows / 30));
    for (let r = stepR * 2; r < rows - stepR * 2; r += stepR) {
      const wy = (r / (rows - 1)) * mapHeight;
      for (let c = stepC * 2; c < cols - stepC * 2; c += stepC) {
        const wx = (c / (cols - 1)) * mapWidth;
        const elev = elevationGrid[r * cols + c];

        // Highlands & mountain ridges (elevation 48 ~ 85)
        if (elev >= seaLevel + 14.0 && elev <= 88.0) {
          candidateSources.push({ x: wx, y: wy, elevation: elev });
        }
      }
    }

    // Shuffle and pick well-distributed sources
    for (let i = candidateSources.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const temp = candidateSources[i];
      candidateSources[i] = candidateSources[j];
      candidateSources[j] = temp;
    }

    const minSourceDist = Math.min(mapWidth, mapHeight) * 0.08;
    const usedSources: [number, number][] = [];

    const stepSize = Math.max(4.0, (mapWidth / cols) * 2.2);
    const maxSteps = 450;

    for (const src of candidateSources) {
      if (rivers.length >= targetRiverCount) break;

      const isTooClose = usedSources.some(([ux, uy]) => Math.hypot(src.x - ux, src.y - uy) < minSourceDist);
      if (isTooClose) continue;

      let curX = src.x;
      let curY = src.y;
      const rawPoints: [number, number][] = [[curX, curY]];
      let prevDirX = 0;
      let prevDirY = 0;
      let reachedWater = false;
      let connectedRiverId: string | null = null;

      for (let step = 0; step < maxSteps; step++) {
        const elev = sampleElev(elevationGrid, cols, rows, mapWidth, mapHeight, curX, curY);

        // Reached ocean!
        if (elev <= seaLevel) {
          // Push 1-2 points slightly into the ocean for river mouth estuary
          if (prevDirX !== 0 || prevDirY !== 0) {
            rawPoints.push([curX + prevDirX * stepSize * 0.6, curY + prevDirY * stepSize * 0.6]);
          }
          reachedWater = true;
          break;
        }

        // Reached a lake!
        const hitLake = lakes.find((l) => pointInLake(curX, curY, l.polygon));
        if (hitLake && step > 5) {
          reachedWater = true;
          break;
        }

        // Check if merged into an existing river (tributary)
        let merged = false;
        if (step > 8) {
          for (const otherRiver of rivers) {
            for (let pi = 0; pi < otherRiver.points.length; pi++) {
              const op = otherRiver.points[pi];
              const dist = Math.hypot(curX - op[0], curY - op[1]);
              if (dist < stepSize * 1.5) {
                rawPoints.push([op[0], op[1]]);
                connectedRiverId = otherRiver.id;
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

        // Compute downhill gradient
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
        const meanderAngle = meanderNoise.sample(curX * meanderScale, curY * meanderScale) * 0.75;
        const cosM = Math.cos(meanderAngle);
        const sinM = Math.sin(meanderAngle);
        const rotDirX = dirX * cosM - dirY * sinM;
        const rotDirY = dirX * sinM + dirY * cosM;

        // Smooth with previous direction for momentum (inertia)
        const inertia = 0.65;
        const nextDirX = prevDirX === 0 ? rotDirX : prevDirX * inertia + rotDirX * (1 - inertia);
        const nextDirY = prevDirY === 0 ? rotDirY : prevDirY * inertia + rotDirY * (1 - inertia);
        const nextLen = Math.hypot(nextDirX, nextDirY) || 1;
        const finalDirX = nextDirX / nextLen;
        const finalDirY = nextDirY / nextLen;

        prevDirX = finalDirX;
        prevDirY = finalDirY;

        curX += finalDirX * stepSize;
        curY += finalDirY * stepSize;

        // Boundary safety
        if (curX <= 5 || curX >= mapWidth - 5 || curY <= 5 || curY >= mapHeight - 5) {
          reachedWater = true;
          break;
        }

        rawPoints.push([curX, curY]);
      }

      // Keep substantial rivers (at least 7 points and reached water or traveled good distance)
      if (rawPoints.length >= 7 && (reachedWater || rawPoints.length > 25)) {
        usedSources.push([src.x, src.y]);
        const smoothed = smoothRiverPath(rawPoints, 2);

        // River width scales from source to river mouth
        const riverLen = smoothed.length;
        const isTributary = !!connectedRiverId;
        const widthStart = isTributary ? 2.0 : 2.5 + rng.next() * 1.5;
        const widthEnd = isTributary ? 5.5 + rng.next() * 3.0 : Math.min(18.0, 7.0 + (riverLen / 40) * 4.0);

        const riverId = `river_${rivers.length + 1}_${Math.floor(rng.next() * 10000)}`;
        const name = FANTASY_RIVER_NAMES[rivers.length % FANTASY_RIVER_NAMES.length];

        rivers.push({
          id: riverId,
          name,
          points: smoothed,
          widthStart,
          widthEnd,
        });
      }
    }
  }

  return { rivers, lakes };
}
