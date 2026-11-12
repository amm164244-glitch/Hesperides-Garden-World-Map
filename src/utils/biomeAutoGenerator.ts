/**
 * Biome Auto-Generator from Terrain
 * Automatically generates biomeGrid from elevation, slope, latitude, and water data.
 * Pure deterministic functions without React dependencies.
 */

import { Mulberry32, Noise2D } from './prng';
import { computeChamferDistance } from './biomeSymbolPlacer';

// ============================================================================
// Tunable Classification Constants
// ============================================================================
export const BIOME_GEN_CONSTANTS = {
  // Elevation Percentiles for Mountain & Snow
  P70_RATIO: 0.70,
  P88_RATIO: 0.88,
  P96_RATIO: 0.96,

  // Slope Thresholds
  STEEP_SLOPE_THRESHOLD: 0.20,

  // Temperature Parameters
  SNOW_TEMP_THRESHOLD: 0.18,
  TEMP_ELEV_LAPSE_RATE: 0.0050,
  CONIFER_TEMP_MAX: 0.50,
  DESERT_TEMP_MIN: 0.44,

  // Moisture Parameters
  WETLAND_LAND_H_MAX: 8.0,
  WETLAND_MOISTURE_MIN: 0.65,
  WETLAND_WATER_DIST_MAX: 45.0,
  DESERT_MOISTURE_MAX: 0.32,
  CONIFER_MOISTURE_MIN: 0.42,
  CONIFER_SUBALPINE_H_MIN: 15.0,
  BROADLEAF_MOISTURE_MIN: 0.42,

  // Noise & Jitter Scales
  MOISTURE_NOISE_SCALE: 0.002,
  PATCH_NOISE_SCALE: 0.001,
  PATCH_AMPLITUDE: 0.15,
  TEMP_NOISE_SCALE: 0.002,
  JITTER_NOISE_SCALE: 0.015,
  JITTER_AMPLITUDE: 0.04,
  WATER_DECAY_DIST: 60.0,
  WATER_BONUS_MAX: 0.10,
};

export interface GenerateBiomeGridParams {
  elevationGrid: Float32Array;
  gridCols: number;
  gridRows: number;
  seaLevel: number;
  mapWidth: number;
  mapHeight: number;
  waterGrid?: Uint8Array;
  seed: number;
  latitudeMode?: 'planet' | 'uniform';
  availableSlots?: number[];
  existingBiomeGrid?: Uint8Array;
  preservePainted?: boolean;
}

export interface LandElevPercentiles {
  p70: number;
  p88: number;
  p96: number;
}

/**
 * Calculates land elevation percentiles (p70, p88, p96) of (elev - seaLevel)
 * for all non-water land cells.
 */
export function calculateLandElevPercentiles(
  elevationGrid: Float32Array,
  seaLevel: number,
  waterGrid?: Uint8Array
): LandElevPercentiles {
  const landHeights: number[] = [];
  const total = elevationGrid.length;

  for (let i = 0; i < total; i++) {
    if (waterGrid && waterGrid[i] >= 128) continue;
    const elev = elevationGrid[i];
    if (elev >= seaLevel) {
      landHeights.push(elev - seaLevel);
    }
  }

  if (landHeights.length === 0) {
    return { p70: 25, p88: 45, p96: 60 };
  }

  landHeights.sort((a, b) => a - b);
  const n = landHeights.length;

  const idx70 = Math.min(n - 1, Math.floor(n * BIOME_GEN_CONSTANTS.P70_RATIO));
  const idx88 = Math.min(n - 1, Math.floor(n * BIOME_GEN_CONSTANTS.P88_RATIO));
  const idx96 = Math.min(n - 1, Math.floor(n * BIOME_GEN_CONSTANTS.P96_RATIO));

  return {
    p70: landHeights[idx70],
    p88: landHeights[idx88],
    p96: landHeights[idx96],
  };
}

/**
 * Maps a candidate slot to the closest available slot if it isn't enabled.
 */
export function resolveSlotWithFallback(slot: number, availableSlotsSet: Set<number>): number {
  if (availableSlotsSet.has(slot)) return slot;

  const fallbackChains: Record<number, number[]> = {
    6: [7, 1, 3], // Snow -> Rock -> Conifer -> Grassland
    7: [6, 1, 3], // Rock -> Snow -> Conifer -> Grassland
    5: [2, 3, 1], // Wetland -> Broadleaf -> Grassland -> Conifer
    4: [3, 2, 1], // Desert -> Grassland -> Broadleaf -> Conifer
    1: [2, 3, 7], // Conifer -> Broadleaf -> Grassland -> Rock
    2: [1, 3, 5], // Broadleaf -> Conifer -> Grassland -> Wetland
    3: [2, 1, 4], // Grassland -> Broadleaf -> Conifer -> Desert
  };

  const chain = fallbackChains[slot] || [3, 2, 1];
  for (const fallback of chain) {
    if (availableSlotsSet.has(fallback)) return fallback;
  }

  // Final fallback: first available slot
  const first = availableSlotsSet.values().next().value;
  return first !== undefined ? first : slot;
}

/**
 * 3x3 Majority filter applied to land cells to remove salt-and-pepper noise.
 */
export function applyMajorityFilter(
  grid: Uint8Array,
  cols: number,
  rows: number,
  passes: number = 1
): void {
  const size = cols * rows;
  const temp = new Uint8Array(size);

  for (let p = 0; p < passes; p++) {
    temp.set(grid);

    for (let r = 0; r < rows; r++) {
      const rMin = Math.max(0, r - 1);
      const rMax = Math.min(rows - 1, r + 1);

      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const currentSlot = temp[idx];
        if (currentSlot === 0) continue; // Keep water/none untouched

        const cMin = Math.max(0, c - 1);
        const cMax = Math.min(cols - 1, c + 1);

        const counts = new Map<number, number>();
        let landNeighborCount = 0;

        for (let nr = rMin; nr <= rMax; nr++) {
          const nRowOff = nr * cols;
          for (let nc = cMin; nc <= cMax; nc++) {
            const nSlot = temp[nRowOff + nc];
            if (nSlot !== 0) {
              landNeighborCount++;
              counts.set(nSlot, (counts.get(nSlot) || 0) + 1);
            }
          }
        }

        const selfCount = counts.get(currentSlot) || 0;
        let maxSlot = currentSlot;
        let maxCount = selfCount;

        for (const [slot, count] of counts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            maxSlot = slot;
          }
        }

        // Replace if current slot is an isolated minority (selfCount <= 2) and a majority slot dominates
        if (selfCount <= 2 && maxCount >= 5 && maxSlot !== currentSlot) {
          grid[idx] = maxSlot;
        }
      }
    }
  }
}

/**
 * Morphological opening / core-distance filter to eliminate thin bands and isolated strands
 * of target biome slots (e.g. 1-cell wide forest ribbons along coastlines).
 * Targets without an interior core of radius >= minRadius (diameter ~ 2 * minRadius + 1 cells)
 * are eliminated and replaced by the surrounding non-target land majority (typically grassland).
 */
export function removeThinBands(
  grid: Uint8Array,
  cols: number,
  rows: number,
  targetSlots: number[],
  minRadius: number = 2
): void {
  const size = cols * rows;
  const targetSet = new Set(targetSlots);
  const mask = new Uint8Array(size);
  let targetCount = 0;
  for (let i = 0; i < size; i++) {
    if (targetSet.has(grid[i])) {
      mask[i] = 1;
      targetCount++;
    }
  }

  if (targetCount === 0) return;

  // 1. Distance transform to nearest non-target cell
  const dist = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    dist[i] = mask[i] ? 9999 : 0;
  }

  for (let r = 0; r < rows; r++) {
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      const idx = rowOff + c;
      if (!mask[idx]) continue;
      let d = dist[idx];
      if (r > 0) d = Math.min(d, dist[(r - 1) * cols + c] + 1);
      if (c > 0) d = Math.min(d, dist[idx - 1] + 1);
      if (r > 0 && c > 0) d = Math.min(d, dist[(r - 1) * cols + (c - 1)] + 1.414);
      if (r > 0 && c < cols - 1) d = Math.min(d, dist[(r - 1) * cols + (c + 1)] + 1.414);
      dist[idx] = d;
    }
  }

  for (let r = rows - 1; r >= 0; r--) {
    const rowOff = r * cols;
    for (let c = cols - 1; c >= 0; c--) {
      const idx = rowOff + c;
      if (!mask[idx]) continue;
      let d = dist[idx];
      if (r < rows - 1) d = Math.min(d, dist[(r + 1) * cols + c] + 1);
      if (c < cols - 1) d = Math.min(d, dist[idx + 1] + 1);
      if (r < rows - 1 && c > 0) d = Math.min(d, dist[(r + 1) * cols + (c - 1)] + 1.414);
      if (r < rows - 1 && c < cols - 1) d = Math.min(d, dist[(r + 1) * cols + (c + 1)] + 1.414);
      dist[idx] = d;
    }
  }

  // 2. Cores: cells deep inside the target region (dist >= minRadius)
  const isCore = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (dist[i] >= minRadius) {
      isCore[i] = 1;
    }
  }

  // 3. Propagation from cores within the target region
  const distFromCore = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    distFromCore[i] = isCore[i] ? 0 : 9999;
  }

  for (let r = 0; r < rows; r++) {
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      const idx = rowOff + c;
      if (!mask[idx] || isCore[idx]) continue;
      let d = distFromCore[idx];
      if (r > 0 && mask[(r - 1) * cols + c]) d = Math.min(d, distFromCore[(r - 1) * cols + c] + 1);
      if (c > 0 && mask[idx - 1]) d = Math.min(d, distFromCore[idx - 1] + 1);
      if (r > 0 && c > 0 && mask[(r - 1) * cols + (c - 1)]) d = Math.min(d, distFromCore[(r - 1) * cols + (c - 1)] + 1.414);
      if (r > 0 && c < cols - 1 && mask[(r - 1) * cols + (c + 1)]) d = Math.min(d, distFromCore[(r - 1) * cols + (c + 1)] + 1.414);
      distFromCore[idx] = d;
    }
  }

  for (let r = rows - 1; r >= 0; r--) {
    const rowOff = r * cols;
    for (let c = cols - 1; c >= 0; c--) {
      const idx = rowOff + c;
      if (!mask[idx] || isCore[idx]) continue;
      let d = distFromCore[idx];
      if (r < rows - 1 && mask[(r + 1) * cols + c]) d = Math.min(d, distFromCore[(r + 1) * cols + c] + 1);
      if (c < cols - 1 && mask[idx + 1]) d = Math.min(d, distFromCore[idx + 1] + 1);
      if (r < rows - 1 && c > 0 && mask[(r + 1) * cols + (c - 1)]) d = Math.min(d, distFromCore[(r + 1) * cols + (c - 1)] + 1.414);
      if (r < rows - 1 && c < cols - 1 && mask[(r + 1) * cols + (c + 1)]) d = Math.min(d, distFromCore[(r + 1) * cols + (c + 1)] + 1.414);
      distFromCore[idx] = d;
    }
  }

  // 4. Any target cell that cannot reach a core within maxReach (minRadius + 1.5) is discarded
  const maxReach = minRadius + 1.5;
  const toReplace: number[] = [];
  for (let i = 0; i < size; i++) {
    if (mask[i] && distFromCore[i] > maxReach) {
      toReplace.push(i);
    }
  }

  // 5. Replace discarded cells with the surrounding non-target land majority
  for (const idx of toReplace) {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const counts = new Map<number, number>();

    const rMin = Math.max(0, r - 3);
    const rMax = Math.min(rows - 1, r + 3);
    const cMin = Math.max(0, c - 3);
    const cMax = Math.min(cols - 1, c + 3);

    for (let nr = rMin; nr <= rMax; nr++) {
      const rowOff = nr * cols;
      for (let nc = cMin; nc <= cMax; nc++) {
        const nSlot = grid[rowOff + nc];
        if (nSlot !== 0 && !targetSet.has(nSlot)) {
          counts.set(nSlot, (counts.get(nSlot) || 0) + 1);
        }
      }
    }

    let bestSlot = 3; // Default grassland fallback
    let bestCount = -1;
    for (const [slot, count] of counts.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestSlot = slot;
      }
    }
    grid[idx] = bestSlot;
  }
}

/**
 * Generates biomeGrid based on terrain elevation, slope, latitude, and water coverage.
 */
export function generateBiomeGridFromTerrain(params: GenerateBiomeGridParams): Uint8Array {
  const {
    elevationGrid,
    gridCols,
    gridRows,
    seaLevel,
    mapWidth,
    mapHeight,
    waterGrid,
    seed,
    latitudeMode = 'planet',
    availableSlots = [1, 2, 3, 4, 5, 6, 7],
    existingBiomeGrid,
    preservePainted = true,
  } = params;

  const totalCells = gridCols * gridRows;
  const resultGrid = new Uint8Array(totalCells);

  if (!elevationGrid || elevationGrid.length !== totalCells) {
    return resultGrid;
  }

  const availableSet = new Set<number>(availableSlots);

  // 1. Calculate Land Elevation Percentiles
  const percentiles = calculateLandElevPercentiles(elevationGrid, seaLevel, waterGrid);

  // 2. Build Land/Water mask for distance transform
  // mask: 1 = land, 0 = water (ocean, river, or lake)
  const landMask = new Uint8Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    if (elevationGrid[i] >= seaLevel && !(waterGrid && waterGrid[i] >= 128)) {
      landMask[i] = 1;
    }
  }

  // 3. Distance transform: world distance to nearest water cell
  const distToWater = computeChamferDistance(landMask, gridCols, gridRows, mapWidth, mapHeight);

  // 4. Initialize deterministic procedural noise
  const moistNoise = new Noise2D(seed ^ 0xa8f152d1);
  const patchNoise = new Noise2D(seed ^ 0x51c3b87a);
  const tempNoise = new Noise2D(seed ^ 0x3d7b891e);
  const jitterNoise = new Noise2D(seed ^ 0x6e2a91f4);

  const cellW = mapWidth / gridCols;
  const cellH = mapHeight / gridRows;

  // 5. Classify each cell
  for (let r = 0; r < gridRows; r++) {
    const rowOff = r * gridCols;
    const rPrev = Math.max(0, r - 1);
    const rNext = Math.min(gridRows - 1, r + 1);
    const wy = (r + 0.5) * cellH;

    // Latitude determination
    const lat = latitudeMode === 'planet'
      ? Math.abs((r + 0.5) / gridRows - 0.5) * 2.0 // 0 at equator, 1 at poles
      : 0.35; // Uniform mode: temperate baseline

    for (let c = 0; c < gridCols; c++) {
      const idx = rowOff + c;

      // Preserve existing painted cell if requested
      if (preservePainted && existingBiomeGrid && existingBiomeGrid[idx] !== 0) {
        resultGrid[idx] = existingBiomeGrid[idx];
        continue;
      }

      // Check sea or water body
      if (elevationGrid[idx] < seaLevel || (waterGrid && waterGrid[idx] >= 128)) {
        resultGrid[idx] = 0;
        continue;
      }

      const wx = (c + 0.5) * cellW;
      const elev = elevationGrid[idx];
      const landH = Math.max(0, elev - seaLevel);

      // Slope calculation (gradient magnitude)
      const cPrev = Math.max(0, c - 1);
      const cNext = Math.min(gridCols - 1, c + 1);
      const dx = (elevationGrid[rowOff + cNext] - elevationGrid[rowOff + cPrev]) / (Math.max(1, cNext - cPrev) * cellW);
      const dy = (elevationGrid[rNext * gridCols + c] - elevationGrid[rPrev * gridCols + c]) / (Math.max(1, rNext - rPrev) * cellH);
      const slope = Math.hypot(dx, dy);

      // Temperature calculation
      const baseTemp = 1.0 - Math.pow(lat, 1.25);
      const elevLapse = landH * BIOME_GEN_CONSTANTS.TEMP_ELEV_LAPSE_RATE;
      const tNoise = tempNoise.sample(wx * BIOME_GEN_CONSTANTS.TEMP_NOISE_SCALE, wy * BIOME_GEN_CONSTANTS.TEMP_NOISE_SCALE) * 0.08;
      const temperature = Math.max(0, Math.min(1, baseTemp - elevLapse + tNoise));

      // Moisture calculation: combine medium-frequency FBM with low-frequency forest patch noise and moderated water bonus
      const mNoise = moistNoise.fbm(wx * BIOME_GEN_CONSTANTS.MOISTURE_NOISE_SCALE, wy * BIOME_GEN_CONSTANTS.MOISTURE_NOISE_SCALE, 3, 0.5, 2.0) * 0.5 + 0.5;
      const pNoise = patchNoise.sample(wx * BIOME_GEN_CONSTANTS.PATCH_NOISE_SCALE, wy * BIOME_GEN_CONSTANTS.PATCH_NOISE_SCALE) * BIOME_GEN_CONSTANTS.PATCH_AMPLITUDE;
      const waterDist = distToWater[idx];
      const waterBonus = Math.exp(-waterDist / BIOME_GEN_CONSTANTS.WATER_DECAY_DIST) * BIOME_GEN_CONSTANTS.WATER_BONUS_MAX;
      const moisture = Math.max(0, Math.min(1, mNoise * 0.70 + pNoise + waterBonus));

      // Boundary jitter
      const jitter = jitterNoise.sample(wx * BIOME_GEN_CONSTANTS.JITTER_NOISE_SCALE, wy * BIOME_GEN_CONSTANTS.JITTER_NOISE_SCALE) * BIOME_GEN_CONSTANTS.JITTER_AMPLITUDE;

      // Priority-based biome classification
      let assignedSlot = 3; // Default: Grassland (3)

      if (
        landH >= percentiles.p70 ||
        (landH >= percentiles.p70 * 0.85 && slope > 0.11) ||
        (landH >= percentiles.p88)
      ) {
        // 1. Rocky Mountain (7): Continuous crests, ridges, and elevated highlands
        // Evaluated before temperature snow check to keep connected mountain ranges intact
        assignedSlot = 7;
      } else if (temperature + jitter < BIOME_GEN_CONSTANTS.SNOW_TEMP_THRESHOLD) {
        // 2. Snow / Tundra (6): Polar and frigid climate
        assignedSlot = 6;
      } else if (
        landH < BIOME_GEN_CONSTANTS.WETLAND_LAND_H_MAX &&
        moisture + jitter > BIOME_GEN_CONSTANTS.WETLAND_MOISTURE_MIN &&
        waterDist < BIOME_GEN_CONSTANTS.WETLAND_WATER_DIST_MAX
      ) {
        // 3. Wetland (5)
        assignedSlot = 5;
      } else if (
        moisture + jitter < BIOME_GEN_CONSTANTS.DESERT_MOISTURE_MAX &&
        temperature + jitter > BIOME_GEN_CONSTANTS.DESERT_TEMP_MIN
      ) {
        // 4. Desert / Wasteland (4)
        assignedSlot = 4;
      } else if (
        moisture + jitter >= BIOME_GEN_CONSTANTS.CONIFER_MOISTURE_MIN
      ) {
        // 5 & 6. Forest: Partitioned into Coniferous vs Broadleaf by temperature and elevation
        if (
          temperature + jitter < BIOME_GEN_CONSTANTS.CONIFER_TEMP_MAX ||
          landH >= BIOME_GEN_CONSTANTS.CONIFER_SUBALPINE_H_MIN
        ) {
          assignedSlot = 1; // Coniferous Forest (1)
        } else {
          assignedSlot = 2; // Broadleaf Forest (2)
        }
      } else {
        // 7. Grassland (3)
        assignedSlot = 3;
      }

      // Map to closest available slot if necessary
      resultGrid[idx] = resolveSlotWithFallback(assignedSlot, availableSet);
    }
  }

  // 6. Post-processing:
  // Remove thin ribbon bands (< 5 cells wide) for forest (slots 1, 2)
  removeThinBands(resultGrid, gridCols, gridRows, [1, 2], 2);
  // Keep mountain ridges (slot 7) intact without eroding ridge chains

  // 3x3 Majority filter to smooth small salt-and-pepper noise
  applyMajorityFilter(resultGrid, gridCols, gridRows, 1);

  // If preservePainted is true, re-enforce existing painted cells after majority filter
  if (preservePainted && existingBiomeGrid) {
    for (let i = 0; i < totalCells; i++) {
      if (existingBiomeGrid[i] !== 0) {
        resultGrid[i] = existingBiomeGrid[i];
      }
    }
  }

  return resultGrid;
}
