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
  STEEP_SLOPE_THRESHOLD: 0.35,

  // Temperature Parameters
  SNOW_TEMP_THRESHOLD: 0.22,
  TEMP_ELEV_LAPSE_RATE: 0.007,
  CONIFER_TEMP_MAX: 0.50,
  DESERT_TEMP_MIN: 0.45,

  // Moisture Parameters
  WETLAND_LAND_H_MAX: 9.0,
  WETLAND_MOISTURE_MIN: 0.60,
  WETLAND_WATER_DIST_MAX: 50.0,
  DESERT_MOISTURE_MAX: 0.34,
  CONIFER_MOISTURE_MIN: 0.42,
  CONIFER_SUBALPINE_H_MIN: 18.0,
  BROADLEAF_MOISTURE_MIN: 0.42,

  // Noise & Jitter Scales
  MOISTURE_NOISE_SCALE: 0.0025,
  TEMP_NOISE_SCALE: 0.002,
  JITTER_NOISE_SCALE: 0.015,
  JITTER_AMPLITUDE: 0.04,
  WATER_DECAY_DIST: 120.0,
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
      const baseTemp = 1.0 - Math.pow(lat, 1.2);
      const elevLapse = landH * BIOME_GEN_CONSTANTS.TEMP_ELEV_LAPSE_RATE;
      const tNoise = tempNoise.sample(wx * BIOME_GEN_CONSTANTS.TEMP_NOISE_SCALE, wy * BIOME_GEN_CONSTANTS.TEMP_NOISE_SCALE) * 0.08;
      const temperature = Math.max(0, Math.min(1, baseTemp - elevLapse + tNoise));

      // Moisture calculation
      const mNoise = moistNoise.fbm(wx * BIOME_GEN_CONSTANTS.MOISTURE_NOISE_SCALE, wy * BIOME_GEN_CONSTANTS.MOISTURE_NOISE_SCALE, 3, 0.5, 2.0) * 0.5 + 0.5;
      const waterDist = distToWater[idx];
      const waterBonus = Math.exp(-waterDist / BIOME_GEN_CONSTANTS.WATER_DECAY_DIST);
      const moisture = Math.max(0, Math.min(1, mNoise * 0.65 + waterBonus * 0.35));

      // Boundary jitter
      const jitter = jitterNoise.sample(wx * BIOME_GEN_CONSTANTS.JITTER_NOISE_SCALE, wy * BIOME_GEN_CONSTANTS.JITTER_NOISE_SCALE) * BIOME_GEN_CONSTANTS.JITTER_AMPLITUDE;

      // Priority-based biome classification
      let assignedSlot = 3; // Default: Grassland (3)

      if (temperature + jitter < BIOME_GEN_CONSTANTS.SNOW_TEMP_THRESHOLD || landH >= percentiles.p96) {
        // 1. Snow / Tundra (6)
        assignedSlot = 6;
      } else if (landH >= percentiles.p88 || (slope > BIOME_GEN_CONSTANTS.STEEP_SLOPE_THRESHOLD && landH >= percentiles.p70)) {
        // 2. Rocky Mountain (7)
        assignedSlot = 7;
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
        moisture + jitter >= BIOME_GEN_CONSTANTS.CONIFER_MOISTURE_MIN &&
        (temperature + jitter < BIOME_GEN_CONSTANTS.CONIFER_TEMP_MAX || landH >= BIOME_GEN_CONSTANTS.CONIFER_SUBALPINE_H_MIN)
      ) {
        // 5. Coniferous Forest (1)
        assignedSlot = 1;
      } else if (
        moisture + jitter >= BIOME_GEN_CONSTANTS.BROADLEAF_MOISTURE_MIN &&
        temperature + jitter >= BIOME_GEN_CONSTANTS.CONIFER_TEMP_MAX
      ) {
        // 6. Broadleaf Forest (2)
        assignedSlot = 2;
      } else {
        // 7. Grassland (3)
        assignedSlot = 3;
      }

      // Map to closest available slot if necessary
      resultGrid[idx] = resolveSlotWithFallback(assignedSlot, availableSet);
    }
  }

  // 6. Post-processing: 3x3 Majority filter to smooth small salt-and-pepper noise
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
