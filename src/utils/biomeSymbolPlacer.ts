import { BiomeType } from '../types/biome';
import { CustomMapAsset, MapSymbolInstance } from '../types/symbols';
import { resolveSymbolRule } from './biomeTypes';
import { Mulberry32 } from './prng';

export interface PlaceBiomeSymbolsParams {
  biomeGrid?: Uint8Array;
  gridCols: number;
  gridRows: number;
  mapWidth: number;
  mapHeight: number;
  elevationGrid?: Float32Array;
  seaLevel: number;
  biomeTypes: BiomeType[];
  customAssets?: CustomMapAsset[];
  targetSlots?: number[];
  region?: { minX: number; minY: number; maxX: number; maxY: number };
  existingSymbols?: MapSymbolInstance[];
  mode?: 'replace' | 'append';
  seed?: number;
  edgeFade?: number;
  maxCount?: number;
  dryRun?: boolean;
  onProgress?: (progress: number, message: string, slot?: number) => void;
}

export interface PlaceBiomeSymbolsStats {
  placedPerSlot: Record<number, number>;
  skippedReasons: Record<number, string>;
  totalPlaced: number;
  truncated: boolean;
}

export interface PlaceBiomeSymbolsResult {
  symbols: MapSymbolInstance[];
  stats: PlaceBiomeSymbolsStats;
}

/**
 * Standard GLSL smoothstep implementation.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 >= edge1) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Spatial hash grid for fast 2D distance queries.
 */
class SpatialHashGrid {
  private cellSize: number;
  private cells: Map<string, Array<{ x: number; y: number; slot?: number }>> = new Map();

  constructor(cellSize: number = 32) {
    this.cellSize = cellSize;
  }

  insert(x: number, y: number, slot?: number): void {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const key = `${cx},${cy}`;
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    list.push({ x, y, slot });
  }

  isClear(x: number, y: number, currentSlot: number, minDistSame: number, minDistOther: number): boolean {
    const maxDist = Math.max(minDistSame, minDistOther);
    const minCx = Math.floor((x - maxDist) / this.cellSize);
    const maxCx = Math.floor((x + maxDist) / this.cellSize);
    const minCy = Math.floor((y - maxDist) / this.cellSize);
    const maxCy = Math.floor((y + maxDist) / this.cellSize);

    const sameSq = minDistSame * minDistSame;
    const otherSq = minDistOther * minDistOther;

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const list = this.cells.get(`${cx},${cy}`);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          const reqSq = item.slot === currentSlot ? sameSq : otherSq;
          const dx = x - item.x;
          const dy = y - item.y;
          if (dx * dx + dy * dy < reqSq) {
            return false;
          }
        }
      }
    }
    return true;
  }
}

/**
 * Computes a 2-pass Chamfer distance transform on a boolean mask.
 * Returns distance in world map coordinates to the nearest non-placeable cell.
 */
export function computeChamferDistance(
  mask: Uint8Array,
  gridCols: number,
  gridRows: number,
  mapWidth: number,
  mapHeight: number
): Float32Array {
  const cellW = mapWidth / gridCols;
  const cellH = mapHeight / gridRows;
  const diag = Math.hypot(cellW, cellH);
  const dist = new Float32Array(gridCols * gridRows);

  for (let i = 0; i < dist.length; i++) {
    dist[i] = mask[i] ? 1e9 : 0;
  }

  // Pass 1: Top-Left to Bottom-Right
  for (let r = 0; r < gridRows; r++) {
    const rowOff = r * gridCols;
    for (let c = 0; c < gridCols; c++) {
      const idx = rowOff + c;
      if (!mask[idx]) continue;
      let d = dist[idx];
      if (r > 0) d = Math.min(d, dist[(r - 1) * gridCols + c] + cellH);
      if (c > 0) d = Math.min(d, dist[idx - 1] + cellW);
      if (r > 0 && c > 0) d = Math.min(d, dist[(r - 1) * gridCols + (c - 1)] + diag);
      if (r > 0 && c < gridCols - 1) d = Math.min(d, dist[(r - 1) * gridCols + (c + 1)] + diag);
      dist[idx] = d;
    }
  }

  // Pass 2: Bottom-Right to Top-Left
  for (let r = gridRows - 1; r >= 0; r--) {
    const rowOff = r * gridCols;
    for (let c = gridCols - 1; c >= 0; c--) {
      const idx = rowOff + c;
      if (!mask[idx]) continue;
      let d = dist[idx];
      if (r < gridRows - 1) d = Math.min(d, dist[(r + 1) * gridCols + c] + cellH);
      if (c < gridCols - 1) d = Math.min(d, dist[idx + 1] + cellW);
      if (r < gridRows - 1 && c > 0) d = Math.min(d, dist[(r + 1) * gridCols + (c - 1)] + diag);
      if (r < gridRows - 1 && c < gridCols - 1) d = Math.min(d, dist[(r + 1) * gridCols + (c + 1)] + diag);
      dist[idx] = d;
    }
  }

  return dist;
}

/**
 * Places fantasy symbols across painted biome areas according to biome configuration rules.
 * Pure calculation function completely independent of the React UI.
 */
export function placeBiomeSymbols(params: PlaceBiomeSymbolsParams): PlaceBiomeSymbolsResult {
  const {
    biomeGrid,
    gridCols,
    gridRows,
    mapWidth,
    mapHeight,
    elevationGrid,
    seaLevel,
    biomeTypes,
    customAssets = [],
    targetSlots = [],
    region,
    existingSymbols = [],
    mode = 'replace',
    seed = 12345,
    edgeFade = 6,
    maxCount = 20000,
    dryRun = false,
    onProgress,
  } = params;

  const stats: PlaceBiomeSymbolsStats = {
    placedPerSlot: {},
    skippedReasons: {},
    totalPlaced: 0,
    truncated: false,
  };

  // 1. Filter existing symbols if mode === 'replace'
  const isTargetSlot = (slot?: number) => {
    if (slot === undefined) return false;
    if (targetSlots.length === 0) return true;
    return targetSlots.includes(slot);
  };

  const isInsideRegion = (x: number, y: number) => {
    if (!region) return true;
    return x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
  };

  const retainedSymbols: MapSymbolInstance[] = [];
  if (mode === 'replace') {
    for (const sym of existingSymbols) {
      if (sym.autoBiomeSlot !== undefined && isTargetSlot(sym.autoBiomeSlot) && isInsideRegion(sym.x, sym.y)) {
        // Discard matching auto-placed symbols within target slots & region
        continue;
      }
      retainedSymbols.push(sym);
    }
  } else {
    retainedSymbols.push(...existingSymbols);
  }

  // Populate spatial hash with retained symbols
  const allSymbolsHash = new SpatialHashGrid(32);
  for (const sym of retainedSymbols) {
    allSymbolsHash.insert(sym.x, sym.y, sym.autoBiomeSlot);
  }

  // Determine active biome slots
  const effectiveBiomeTypes = biomeTypes.filter((b) => {
    if (targetSlots.length === 0) return true;
    return targetSlots.includes(b.slot);
  });

  const cellW = mapWidth / gridCols;
  const cellH = mapHeight / gridRows;

  // Bounding box for placement
  const bx0 = region ? Math.max(0, region.minX) : 0;
  const by0 = region ? Math.max(0, region.minY) : 0;
  const bx1 = region ? Math.min(mapWidth, region.maxX) : mapWidth;
  const by1 = region ? Math.min(mapHeight, region.maxY) : mapHeight;

  if (bx0 >= bx1 || by0 >= by1) {
    return {
      symbols: dryRun ? [] : retainedSymbols,
      stats,
    };
  }

  const newlyPlacedSymbols: MapSymbolInstance[] = [];

  for (let bIdx = 0; bIdx < effectiveBiomeTypes.length; bIdx++) {
    const b = effectiveBiomeTypes[bIdx];
    const slot = b.slot;
    stats.placedPerSlot[slot] = 0;

    const progressPct = Math.round((bIdx / effectiveBiomeTypes.length) * 100);
    onProgress?.(progressPct, `${b.name} (${bIdx + 1}/${effectiveBiomeTypes.length}) を配置中...`, slot);

    if (stats.totalPlaced >= maxCount) {
      stats.truncated = true;
      break;
    }

    // 2. Validate symbol rules
    const validRules = (b.symbols || []).filter((rule) => {
      if (rule.weight <= 0) return false;
      const res = resolveSymbolRule(rule, customAssets);
      return !res.isMissing;
    });

    if (validRules.length === 0) {
      stats.skippedReasons[slot] = '有効なルールがありません';
      continue;
    }

    if (!biomeGrid) {
      stats.skippedReasons[slot] = 'バイオームグリッドが存在しません';
      continue;
    }

    // 3. Build placeable mask
    const mask = new Uint8Array(gridCols * gridRows);
    let placeableCellCount = 0;

    for (let r = 0; r < gridRows; r++) {
      const rowOff = r * gridCols;
      for (let c = 0; c < gridCols; c++) {
        const idx = rowOff + c;
        if (biomeGrid[idx] === slot) {
          const elev = elevationGrid ? elevationGrid[idx] : 50;
          if (elev >= seaLevel) {
            mask[idx] = 1;
            placeableCellCount++;
          }
        }
      }
    }

    if (placeableCellCount === 0) {
      stats.skippedReasons[slot] = '配置可能なセルがありません';
      continue;
    }

    // 4. Distance transform for edge fade
    const distMap = edgeFade > 0
      ? computeChamferDistance(mask, gridCols, gridRows, mapWidth, mapHeight)
      : null;

    // 5. Poisson-disk Sampling (Bridson)
    const slotSeed = (seed ^ Math.imul(slot, 0x9e3779b9)) >>> 0;
    const rng = new Mulberry32(slotSeed);

    const minDist = Math.max(2, Math.min(60, b.minDistance ?? 8));
    const cellSize = minDist / Math.SQRT2;
    const bgCols = Math.ceil((bx1 - bx0) / cellSize) + 1;
    const bgRows = Math.ceil((by1 - by0) / cellSize) + 1;
    const bgGrid = new Int32Array(bgCols * bgRows).fill(-1);

    const typeCandidates: Array<{ x: number; y: number }> = [];
    const activeList: Array<{ x: number; y: number }> = [];

    const isPlaceableAt = (wx: number, wy: number): boolean => {
      if (wx < bx0 || wx > bx1 || wy < by0 || wy > by1) return false;
      const c = Math.floor((wx / mapWidth) * gridCols);
      const r = Math.floor((wy / mapHeight) * gridRows);
      if (c < 0 || c >= gridCols || r < 0 || r >= gridRows) return false;
      return mask[r * gridCols + c] === 1;
    };

    const minDistSq = minDist * minDist;
    const isFarEnoughInType = (wx: number, wy: number): boolean => {
      const gx = Math.floor((wx - bx0) / cellSize);
      const gy = Math.floor((wy - by0) / cellSize);
      const minGx = Math.max(0, gx - 2);
      const maxGx = Math.min(bgCols - 1, gx + 2);
      const minGy = Math.max(0, gy - 2);
      const maxGy = Math.min(bgRows - 1, gy + 2);

      for (let y = minGy; y <= maxGy; y++) {
        const rowOff = y * bgCols;
        for (let x = minGx; x <= maxGx; x++) {
          const ptIdx = bgGrid[rowOff + x];
          if (ptIdx !== -1) {
            const pt = typeCandidates[ptIdx];
            const dx = wx - pt.x;
            const dy = wy - pt.y;
            if (dx * dx + dy * dy < minDistSq) {
              return false;
            }
          }
        }
      }
      return true;
    };

    // Collect placeable cell centers inside region as potential seeds
    const seedCells: Array<{ x: number; y: number }> = [];
    const c0 = Math.max(0, Math.floor((bx0 / mapWidth) * gridCols));
    const c1 = Math.min(gridCols - 1, Math.floor((bx1 / mapWidth) * gridCols));
    const r0 = Math.max(0, Math.floor((by0 / mapHeight) * gridRows));
    const r1 = Math.min(gridRows - 1, Math.floor((by1 / mapHeight) * gridRows));

    for (let r = r0; r <= r1; r++) {
      const rowOff = r * gridCols;
      for (let c = c0; c <= c1; c++) {
        if (mask[rowOff + c] === 1) {
          const wx = (c + 0.5) * cellW;
          const wy = (r + 0.5) * cellH;
          if (wx >= bx0 && wx <= bx1 && wy >= by0 && wy <= by1) {
            seedCells.push({ x: wx, y: wy });
          }
        }
      }
    }

    // Shuffle seed cells deterministically
    for (let i = seedCells.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = seedCells[i];
      seedCells[i] = seedCells[j];
      seedCells[j] = tmp;
    }

    let seedIdx = 0;
    while (seedIdx < seedCells.length || activeList.length > 0) {
      if (activeList.length === 0) {
        while (seedIdx < seedCells.length) {
          const sPt = seedCells[seedIdx++];
          if (isFarEnoughInType(sPt.x, sPt.y)) {
            const idx = typeCandidates.length;
            typeCandidates.push(sPt);
            activeList.push(sPt);
            const gx = Math.floor((sPt.x - bx0) / cellSize);
            const gy = Math.floor((sPt.y - by0) / cellSize);
            bgGrid[gy * bgCols + gx] = idx;
            break;
          }
        }
        if (activeList.length === 0) break;
      }

      const activeIdx = Math.floor(rng.next() * activeList.length);
      const centerPt = activeList[activeIdx];
      let candidateFound = false;

      for (let k = 0; k < 30; k++) {
        const angle = rng.next() * 2 * Math.PI;
        const distVal = minDist + rng.next() * minDist;
        const nx = centerPt.x + distVal * Math.cos(angle);
        const ny = centerPt.y + distVal * Math.sin(angle);

        if (isPlaceableAt(nx, ny) && isFarEnoughInType(nx, ny)) {
          const npt = { x: nx, y: ny };
          const idx = typeCandidates.length;
          typeCandidates.push(npt);
          activeList.push(npt);
          const gx = Math.floor((nx - bx0) / cellSize);
          const gy = Math.floor((ny - by0) / cellSize);
          bgGrid[gy * bgCols + gx] = idx;
          candidateFound = true;
          break;
        }
      }

      if (!candidateFound) {
        activeList[activeIdx] = activeList[activeList.length - 1];
        activeList.pop();
      }
    }

    // 6. Evaluate Candidate Points for Adoption
    for (const pt of typeCandidates) {
      if (stats.totalPlaced >= maxCount) {
        stats.truncated = true;
        break;
      }

      // Density check: density / 100
      const densityProb = (b.density ?? 50) / 100;
      if (rng.next() >= densityProb) {
        continue;
      }

      // Edge fade check: smoothstep(0, edgeFade, d)
      if (edgeFade > 0 && distMap) {
        const c = Math.max(0, Math.min(gridCols - 1, Math.floor((pt.x / mapWidth) * gridCols)));
        const r = Math.max(0, Math.min(gridRows - 1, Math.floor((pt.y / mapHeight) * gridRows)));
        const d = distMap[r * gridCols + c];
        const fadeProb = smoothstep(0, edgeFade, d);
        if (rng.next() >= fadeProb) {
          continue;
        }
      }

      // Distance to other symbols:
      // Same slot: minDist (guaranteed >= minDist by Poisson-disk)
      // Different slot / retained existing: minDist * 0.6
      if (!allSymbolsHash.isClear(pt.x, pt.y, slot, minDist, minDist * 0.6)) {
        continue;
      }

      // Elevation check: match against rule elevationMin and elevationMax
      const c = Math.max(0, Math.min(gridCols - 1, Math.floor((pt.x / mapWidth) * gridCols)));
      const r = Math.max(0, Math.min(gridRows - 1, Math.floor((pt.y / mapHeight) * gridRows)));
      const cellElev = elevationGrid ? elevationGrid[r * gridCols + c] : 50;

      const matchingRules = validRules.filter((rule) => {
        if (rule.elevationMin !== undefined && cellElev < rule.elevationMin) return false;
        if (rule.elevationMax !== undefined && cellElev > rule.elevationMax) return false;
        return true;
      });

      if (matchingRules.length === 0) {
        continue;
      }

      // 7. Weighted selection of rule
      let totalWeight = 0;
      for (const rule of matchingRules) {
        totalWeight += rule.weight;
      }
      let randWeight = rng.next() * totalWeight;
      let chosenRule = matchingRules[0];
      for (const rule of matchingRules) {
        if (randWeight < rule.weight) {
          chosenRule = rule;
          break;
        }
        randWeight -= rule.weight;
      }

      const scaleMin = chosenRule.scaleMin ?? 0.8;
      const scaleMax = chosenRule.scaleMax ?? 1.2;
      const scale = scaleMin + rng.next() * (scaleMax - scaleMin);
      const flipX = b.flipRandom ? rng.next() < 0.5 : false;
      const rotation = -0.06 + rng.next() * 0.12;
      const variant = Math.floor(rng.next() * 3);

      const symId = `sym_auto_${slot}_${stats.totalPlaced}_${seed}`;
      const symbolInst: MapSymbolInstance = {
        id: symId,
        type: chosenRule.kind === 'custom' ? 'custom' : (chosenRule.symbolType || 'tree_pine'),
        customAssetId: chosenRule.kind === 'custom' ? chosenRule.customAssetId : undefined,
        x: Number(pt.x.toFixed(2)),
        y: Number(pt.y.toFixed(2)),
        scale: Number(scale.toFixed(3)),
        rotation: Number(rotation.toFixed(4)),
        flipX,
        variant,
        autoBiomeSlot: slot,
      };

      if (!dryRun) {
        newlyPlacedSymbols.push(symbolInst);
      }
      allSymbolsHash.insert(pt.x, pt.y, slot);
      stats.placedPerSlot[slot] = (stats.placedPerSlot[slot] || 0) + 1;
      stats.totalPlaced++;
    }
  }

  onProgress?.(100, '配置完了', undefined);

  return {
    symbols: dryRun ? [] : [...retainedSymbols, ...newlyPlacedSymbols],
    stats,
  };
}

export interface RemoveAutoBiomeSymbolsOptions {
  targetSlot?: number;
}

/**
 * Removes auto-placed symbols (where autoBiomeSlot !== undefined).
 * If targetSlot is specified, only symbols matching that autoBiomeSlot are removed.
 * Hand-placed symbols (autoBiomeSlot === undefined) are ALWAYS preserved.
 */
export function removeAutoBiomeSymbols(
  symbols: MapSymbolInstance[],
  options?: RemoveAutoBiomeSymbolsOptions
): {
  remainingSymbols: MapSymbolInstance[];
  removedCount: number;
} {
  const targetSlot = options?.targetSlot;
  const remainingSymbols: MapSymbolInstance[] = [];
  let removedCount = 0;

  for (const sym of symbols) {
    if (sym.autoBiomeSlot !== undefined) {
      if (targetSlot === undefined || sym.autoBiomeSlot === targetSlot) {
        removedCount++;
        continue;
      }
    }
    remainingSymbols.push(sym);
  }

  return {
    remainingSymbols,
    removedCount,
  };
}

/**
 * Counts auto-placed symbols in a collection, optionally filtered by slot.
 */
export function countAutoBiomeSymbols(
  symbols: MapSymbolInstance[],
  targetSlot?: number
): number {
  let count = 0;
  for (const sym of symbols) {
    if (sym.autoBiomeSlot !== undefined) {
      if (targetSlot === undefined || sym.autoBiomeSlot === targetSlot) {
        count++;
      }
    }
  }
  return count;
}

