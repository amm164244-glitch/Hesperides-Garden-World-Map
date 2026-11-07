/**
 * River Extraction and Topological Flow Tracing
 * Traces strictly downhill rivers from flow accumulation fields,
 * organizes main stems and tributaries, applies constrained meandering,
 * and enforces elevation monotonicity.
 */

import { RiverData, LakeData } from '../types/water';
import { HydrologyResult } from './hydrology';
import { Noise2D } from './prng';
import { findNearestLakePerimeterPoint, clampRiverToLakePerimeter } from './lakeExtraction';
import { sampleElev } from './waterGenerator';

export const FANTASY_RIVER_NAMES = [
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

export interface RiverExtractionParams {
  cols: number;
  rows: number;
  mapWidth: number;
  mapHeight: number;
  seaLevel: number;
  seed?: number;
  worldWidthKm?: number;
  riverDensity?: number; // 0 ~ 100, default 40
  meander?: number;      // 0 ~ 1.0 (or 0~100%), default 0.6
  maxMainRivers?: number;// default 14
  minLengthCells?: number;// default 8
}

/**
 * Open polyline Chaikin smoothing with pinned endpoints.
 */
function chaikinOpen(points: [number, number][], iterations: number = 2): [number, number][] {
  if (points.length < 3) return points;

  let current = points;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [];
    next.push(current[0]);

    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];

      next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
      next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
    }

    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/**
 * Extracts topologically sound rivers from hydrology accumulation and flow receivers.
 */
export function extractRivers(
  hydro: HydrologyResult,
  elevationGrid: Float32Array,
  lakes: LakeData[],
  params: RiverExtractionParams
): RiverData[] {
  const {
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    seed = 42,
    worldWidthKm = 40000,
    riverDensity = 40,
    meander = 0.6,
    maxMainRivers = 14,
    minLengthCells = 8,
  } = params;

  const totalCells = cols * rows;
  const { receiver, filled, accumulation } = hydro;

  // 1. Calculate river threshold T based on land cell count & riverDensity
  let landCellCount = 0;
  for (let i = 0; i < totalCells; i++) {
    if (elevationGrid[i] >= seaLevel) {
      landCellCount++;
    }
  }

  const dRatio = Math.max(0, Math.min(100, riverDensity)) / 100;
  // lerp(0.012, 0.0006, dRatio)
  const densityCoeff = 0.012 + (0.0006 - 0.012) * dRatio;
  const T = Math.max(6, Math.floor(landCellCount * densityCoeff));

  // Find max accumulation on land for width scaling
  let maxA = T;
  for (let i = 0; i < totalCells; i++) {
    if (elevationGrid[i] >= seaLevel && accumulation[i] > maxA) {
      maxA = accumulation[i];
    }
  }
  if (maxA <= T) maxA = T + 1;

  // 2. Identify lake cells and lake spillway outflow starts
  const cellToLakeId = new Map<number, string>();
  const lakeSpillCells = new Map<number, string>();

  // Map lake depressions to cell indices
  for (const lake of lakes) {
    const dep = hydro.depressions.find((d) => d.spillElevation === lake.elevation);
    if (dep) {
      for (const c of dep.cells) {
        cellToLakeId.set(c, lake.id);
      }
      lakeSpillCells.set(dep.spillCell, lake.id);
    }
  }

  // 3. Mark river cells:
  // Land cell, accumulation >= T, and NOT inside any lake
  const isRiverCell = new Uint8Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    if (elevationGrid[i] >= seaLevel && !cellToLakeId.has(i) && accumulation[i] >= T) {
      isRiverCell[i] = 1;
    }
  }

  // Also include the immediate receiver of lake spillways so lake outflows can begin cleanly
  for (const [spillIdx, lakeId] of lakeSpillCells.entries()) {
    const spillRec = receiver[spillIdx];
    if (spillRec >= 0 && elevationGrid[spillRec] >= seaLevel && !cellToLakeId.has(spillRec)) {
      isRiverCell[spillRec] = 1;
    }
  }

  // 4. Build upstream river graph
  const upstreamRiverNeighbors: number[][] = Array.from({ length: totalCells }, () => []);
  for (let i = 0; i < totalCells; i++) {
    if (isRiverCell[i] === 1) {
      const rec = receiver[i];
      if (rec >= 0 && isRiverCell[rec] === 1) {
        upstreamRiverNeighbors[rec].push(i);
      }
    }
  }

  // Sort upstream neighbors by accumulation descending so largest branch continues the main stem
  for (let i = 0; i < totalCells; i++) {
    if (upstreamRiverNeighbors[i].length > 1) {
      upstreamRiverNeighbors[i].sort((a, b) => accumulation[b] - accumulation[a]);
    }
  }

  // 5. Find River Mouths (cells where flow leaves the river cell network)
  interface RawRiverSegment {
    id: string;
    mouthCell: number;
    sourceCell: number;
    cells: number[]; // From source to mouth
    terminatesAt: 'ocean' | 'lake' | 'river';
    targetLakeId?: string;
    sourceType: 'spring' | 'lake';
    sourceLakeId?: string;
    connectedRiverId?: string;
    mouthAcc: number;
    sourceAcc: number;
  }

  const rawRivers: RawRiverSegment[] = [];
  let riverSeq = 1;

  // Identify all river mouth cells
  for (let i = 0; i < totalCells; i++) {
    if (isRiverCell[i] === 1) {
      const rec = receiver[i];
      const isOcean = rec < 0 || elevationGrid[rec] < seaLevel;
      const isBorder =
        rec >= 0 &&
        (rec % cols === 0 ||
          rec % cols === cols - 1 ||
          Math.floor(rec / cols) === 0 ||
          Math.floor(rec / cols) === rows - 1);
      const lakeId = rec >= 0 ? cellToLakeId.get(rec) : undefined;

      if (isOcean || isBorder || lakeId) {
        // This cell 'i' is a river mouth (main exit)
        traceBranches(i, isOcean || isBorder ? 'ocean' : 'lake', lakeId);
      }
    }
  }

  function traceBranches(
    mouthIdx: number,
    terminatesAt: 'ocean' | 'lake' | 'river',
    targetLakeId?: string,
    connectedRiverId?: string
  ): void {
    const cells: number[] = [mouthIdx];
    let curr = mouthIdx;

    // Follow the primary upstream branch (highest accumulation)
    while (upstreamRiverNeighbors[curr].length > 0) {
      const bestUpstream = upstreamRiverNeighbors[curr][0];
      cells.push(bestUpstream);
      curr = bestUpstream;
    }

    // Now curr is the source cell
    const sourceCell = curr;
    // Cells array currently goes [mouth, ..., source], reverse to [source, ..., mouth]
    cells.reverse();

    // Determine sourceType: if this source cell is adjacent to a lake spillway
    let sourceType: 'spring' | 'lake' = 'spring';
    let sourceLakeId: string | undefined = undefined;

    for (const [spillIdx, lId] of lakeSpillCells.entries()) {
      if (receiver[spillIdx] === sourceCell || spillIdx === sourceCell) {
        sourceType = 'lake';
        sourceLakeId = lId;
        break;
      }
    }

    const rId = `river_${seed}_${riverSeq++}`;
    rawRivers.push({
      id: rId,
      mouthCell: mouthIdx,
      sourceCell,
      cells,
      terminatesAt,
      targetLakeId,
      sourceType,
      sourceLakeId,
      connectedRiverId,
      mouthAcc: accumulation[mouthIdx],
      sourceAcc: accumulation[sourceCell],
    });

    // Recursively trace secondary upstream branches (tributaries) along the path
    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
      const cell = cells[cIdx];
      const neighbors = upstreamRiverNeighbors[cell];
      // neighbors[0] is the main stem. neighbors[1..] are tributaries merging into this cell!
      for (let k = 1; k < neighbors.length; k++) {
        traceBranches(neighbors[k], 'river', undefined, rId);
      }
    }
  }

  // 6. Filter by minLengthCells (except main mouths) and maxMainRivers
  // Partition into main stems (terminatesAt !== 'river') and tributaries
  const mainRivers = rawRivers.filter((r) => r.terminatesAt !== 'river');
  // Sort main rivers by mouth accumulation descending
  mainRivers.sort((a, b) => b.mouthAcc - a.mouthAcc);

  const keptMainRivers = mainRivers.slice(0, maxMainRivers);
  const keptIds = new Set<string>(keptMainRivers.map((r) => r.id));

  // Add tributaries recursively if their parent is kept and their length is sufficient
  let addedAny = true;
  while (addedAny) {
    addedAny = false;
    for (const r of rawRivers) {
      if (!keptIds.has(r.id) && r.connectedRiverId && keptIds.has(r.connectedRiverId)) {
        if (r.cells.length >= minLengthCells) {
          keptIds.add(r.id);
          addedAny = true;
        }
      }
    }
  }

  const filteredRawRivers = rawRivers.filter((r) => keptIds.has(r.id));

  // 7. Vectorize, smooth with Chaikin, apply perpendicular meander, and check monotonicity
  const meanderNoise = new Noise2D(seed + 7721);
  const meanderFactor = typeof meander === 'number' ? Math.max(0, Math.min(1, meander > 1 ? meander / 100 : meander)) : 0.6;
  const kmPerUnit = Math.max(0.001, worldWidthKm / mapWidth);
  const wMin = kmPerUnit >= 3.0 ? 0.75 : 1.2;
  const wMax = kmPerUnit >= 3.0 ? 4.5 : 6.5;

  const resultRivers: RiverData[] = [];
  let mainNameIndex = 0;

  for (const raw of filteredRawRivers) {
    // Convert cells to map coordinates [x, y]
    const pts: [number, number][] = raw.cells.map((cell) => {
      const c = cell % cols;
      const r = Math.floor(cell / cols);
      return [
        (c / (cols - 1)) * mapWidth,
        (r / (rows - 1)) * mapHeight,
      ];
    });

    if (pts.length < 2) continue;

    // Chaikin smoothing (2 iterations)
    const smoothed = chaikinOpen(pts, 2);

    // Apply normal meandering with endpoint tapering
    const meandered: [number, number][] = [];
    const n = smoothed.length;

    // Convert filled Float64Array to Float32Array for bilinear sampling helper
    const filledF32 = new Float32Array(filled.length);
    for (let i = 0; i < filled.length; i++) filledF32[i] = filled[i];

    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1 || meanderFactor <= 0) {
        meandered.push(smoothed[i]);
        continue;
      }

      // Unit tangent vector from previous to next
      const pPrev = smoothed[i - 1];
      const pNext = smoothed[i + 1];
      const tx = pNext[0] - pPrev[0];
      const ty = pNext[1] - pPrev[1];
      const tLen = Math.hypot(tx, ty) || 1;
      // Perpendicular normal vector [-ty, tx]
      const nx = -ty / tLen;
      const ny = tx / tLen;

      // Endpoint taper: 0 at i=0 and i=n-1
      const progress = i / (n - 1);
      const taper = Math.sin(progress * Math.PI);

      // Width scaling for meander amplitude
      const localAcc = raw.sourceAcc + (raw.mouthAcc - raw.sourceAcc) * progress;
      const accRatio = Math.max(0, Math.min(1, Math.log(Math.max(1, localAcc / T)) / Math.log(Math.max(1.1, maxA / T))));
      const localWidth = wMin + (wMax - wMin) * Math.pow(accRatio, 0.7);

      const noiseVal = meanderNoise.sample(smoothed[i][0] * 0.0035, smoothed[i][1] * 0.0035);
      const amp = meanderFactor * taper * (localWidth * 0.8 + 1.2) * noiseVal;

      let candX = smoothed[i][0] + nx * amp;
      let candY = smoothed[i][1] + ny * amp;

      // Check elevation monotonicity (cannot climb uphill by > 0.3)
      const prevElev = sampleElev(filledF32, cols, rows, mapWidth, mapHeight, meandered[i - 1][0], meandered[i - 1][1]);
      let candElev = sampleElev(filledF32, cols, rows, mapWidth, mapHeight, candX, candY);

      if (candElev > prevElev + 0.3) {
        // Halve amplitude or revert to unmeandered point
        candX = smoothed[i][0] + nx * (amp * 0.25);
        candY = smoothed[i][1] + ny * (amp * 0.25);
        candElev = sampleElev(filledF32, cols, rows, mapWidth, mapHeight, candX, candY);
        if (candElev > prevElev + 0.3) {
          candX = smoothed[i][0];
          candY = smoothed[i][1];
        }
      }

      meandered.push([candX, candY]);
    }

    // Connect source to lake perimeter if applicable
    if (raw.sourceType === 'lake' && raw.sourceLakeId) {
      const srcLake = lakes.find((l) => l.id === raw.sourceLakeId);
      if (srcLake) {
        meandered[0] = findNearestLakePerimeterPoint(srcLake.polygon, meandered[0]);
      }
    }

    // Connect mouth to target lake perimeter if applicable
    if (raw.terminatesAt === 'lake' && raw.targetLakeId) {
      const tgtLake = lakes.find((l) => l.id === raw.targetLakeId);
      if (tgtLake) {
        meandered[meandered.length - 1] = findNearestLakePerimeterPoint(tgtLake.polygon, meandered[meandered.length - 1]);
      }
    }

    // Calculate river widths
    const sourceAccRatio = Math.max(0, Math.min(1, Math.log(Math.max(1, raw.sourceAcc / T)) / Math.log(Math.max(1.1, maxA / T))));
    const mouthAccRatio = Math.max(0, Math.min(1, Math.log(Math.max(1, raw.mouthAcc / T)) / Math.log(Math.max(1.1, maxA / T))));

    const widthStart = Number((wMin + (wMax - wMin) * Math.pow(sourceAccRatio, 0.7)).toFixed(2));
    const widthEnd = Number(Math.max(widthStart, wMin + (wMax - wMin) * Math.pow(mouthAccRatio, 0.7)).toFixed(2));

    const isMain = raw.terminatesAt !== 'river';
    const name = isMain ? FANTASY_RIVER_NAMES[mainNameIndex++ % FANTASY_RIVER_NAMES.length] : undefined;

    const riverObj: RiverData = {
      id: raw.id,
      name,
      points: meandered,
      widthStart,
      widthEnd,
      sourceType: raw.sourceType,
      sourceLakeId: raw.sourceLakeId,
      terminatesAt: raw.terminatesAt,
      targetLakeId: raw.targetLakeId,
      connectedRiverId: raw.connectedRiverId,
    };

    // If river terminates into a lake, clamp river path so it doesn't cross inside the lake
    if (riverObj.terminatesAt === 'lake' && riverObj.targetLakeId) {
      const tgtLake = lakes.find((l) => l.id === riverObj.targetLakeId);
      if (tgtLake) {
        clampRiverToLakePerimeter(riverObj, tgtLake);
      }
    }

    resultRivers.push(riverObj);
  }

  return resultRivers;
}
