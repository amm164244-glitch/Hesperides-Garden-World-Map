import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTectonicWorld, STANDARD_SEA_LEVEL } from './tectonicGenerator';
import { GeneratorConfig } from '../types/map';

function getPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function analyzeElevationDiffs(
  grid: Float32Array,
  cols: number,
  rows: number,
  seaLevel = STANDARD_SEA_LEVEL
) {
  const coastalDiffs: number[] = [];
  const inlandDiffs: number[] = [];

  for (let r = 0; r < rows; r++) {
    const rowOffset = r * cols;
    for (let c = 0; c < cols - 1; c++) {
      const e1 = grid[rowOffset + c];
      const e2 = grid[rowOffset + c + 1];
      const diff = Math.abs(e1 - e2);

      // Coastal boundary: crosses seaLevel
      const isCoast = (e1 <= seaLevel && e2 > seaLevel) || (e1 > seaLevel && e2 <= seaLevel);
      if (isCoast) {
        coastalDiffs.push(diff);
      }

      // Inland: both cells >= seaLevel + 6.0 (41.0)
      if (e1 >= seaLevel + 6.0 && e2 >= seaLevel + 6.0) {
        inlandDiffs.push(diff);
      }
    }
  }

  coastalDiffs.sort((a, b) => a - b);
  inlandDiffs.sort((a, b) => a - b);

  return {
    coastal: {
      median: getPercentile(coastalDiffs, 50),
      p90: getPercentile(coastalDiffs, 90),
      max: coastalDiffs.length > 0 ? coastalDiffs[coastalDiffs.length - 1] : 0,
      count: coastalDiffs.length,
    },
    inland: {
      median: getPercentile(inlandDiffs, 50),
      p90: getPercentile(inlandDiffs, 90),
      p999: getPercentile(inlandDiffs, 99.9),
      max: inlandDiffs.length > 0 ? inlandDiffs[inlandDiffs.length - 1] : 0,
      count: inlandDiffs.length,
    },
  };
}

const baseConfig: GeneratorConfig = {
  seed: 7,
  gridResolution: '1024x512',
  worldWidthKm: 40000,
  plateCount: 12,
  seaRatio: 60,
  continentCount: 4,
  continentSize: 6,
  mountainStrength: 6,
  islandDensity: 5,
  minIslandArea: 15,
  erosionIterations: 15,
  erosionStrength: 5,
  coastlineComplexity: 4,
  coastSmoothing: 5,
  boundarySoftness: 5,
};

test('Plate boundary smoothing reduces coastal cliffs across multiple seeds', () => {
  const seeds = [7, 21, 99];

  for (const seed of seeds) {
    const config: GeneratorConfig = {
      ...baseConfig,
      seed,
      boundarySoftness: 5,
    };

    const mapData = generateTectonicWorld(1024, 512, config);
    const { coastal, inland } = analyzeElevationDiffs(
      mapData.elevationGrid,
      mapData.gridCols,
      mapData.gridRows
    );

    // Verify coastal diff constraints: median <= 4.0, 90th percentile <= 8.0, max <= 30.0
    assert(
      coastal.median <= 4.0,
      `Seed ${seed}: coastal median diff ${coastal.median} should be <= 4.0`
    );
    assert(
      coastal.p90 <= 8.0,
      `Seed ${seed}: coastal 90th percentile diff ${coastal.p90} should be <= 8.0`
    );
    assert(
      coastal.max <= 30.0,
      `Seed ${seed}: coastal max diff ${coastal.max} should be <= 30.0`
    );

    // Verify inland diff constraints: 99.9th percentile <= 12.0
    assert(
      inland.p999 <= 12.0,
      `Seed ${seed}: inland 99.9th percentile diff ${inland.p999} should be <= 12.0`
    );
  }
});

test('boundarySoftness = 0 has larger coastal step than boundarySoftness = 5', () => {
  const config0: GeneratorConfig = {
    ...baseConfig,
    seed: 7,
    boundarySoftness: 0,
  };
  const config5: GeneratorConfig = {
    ...baseConfig,
    seed: 7,
    boundarySoftness: 5,
  };

  const map0 = generateTectonicWorld(1024, 512, config0);
  const map5 = generateTectonicWorld(1024, 512, config5);

  const stats0 = analyzeElevationDiffs(map0.elevationGrid, map0.gridCols, map0.gridRows);
  const stats5 = analyzeElevationDiffs(map5.elevationGrid, map5.gridCols, map5.gridRows);

  assert(
    stats0.coastal.median > stats5.coastal.median,
    `boundarySoftness=0 median (${stats0.coastal.median}) should be greater than boundarySoftness=5 median (${stats5.coastal.median})`
  );
  assert(
    stats0.coastal.max > stats5.coastal.max,
    `boundarySoftness=0 max (${stats0.coastal.max}) should be greater than boundarySoftness=5 max (${stats5.coastal.max})`
  );
});

test('Maintains target land ratio and maximum elevation (mountains preserved)', () => {
  const config: GeneratorConfig = {
    ...baseConfig,
    seed: 7,
    seaRatio: 60,
    boundarySoftness: 5,
  };

  const map = generateTectonicWorld(1024, 512, config);
  const total = map.elevationGrid.length;
  let landCells = 0;
  let maxElev = -Infinity;

  for (let i = 0; i < total; i++) {
    const val = map.elevationGrid[i];
    if (val > STANDARD_SEA_LEVEL) landCells++;
    if (val > maxElev) maxElev = val;
  }

  const actualLandRatio = landCells / total;
  const targetLandRatio = 1 - config.seaRatio / 100; // 0.40

  assert(
    Math.abs(actualLandRatio - targetLandRatio) <= 0.03,
    `Land ratio ${actualLandRatio} should be within 3% of target ${targetLandRatio}`
  );
  assert(
    maxElev >= 95.0,
    `Max elevation ${maxElev} should be >= 95.0 (mountain peaks preserved)`
  );
});

test('Determinism: Identical seed and config produce bit-for-bit identical elevation grids', () => {
  const config: GeneratorConfig = {
    ...baseConfig,
    seed: 99,
    boundarySoftness: 5,
  };

  const mapA = generateTectonicWorld(1024, 512, config);
  const mapB = generateTectonicWorld(1024, 512, config);

  assert.equal(mapA.elevationGrid.length, mapB.elevationGrid.length);
  for (let i = 0; i < mapA.elevationGrid.length; i++) {
    assert.equal(
      mapA.elevationGrid[i],
      mapB.elevationGrid[i],
      `Mismatch at cell index ${i}`
    );
  }
});

test('Performance: 1024x512 generation executes within 3.0 seconds', () => {
  const config: GeneratorConfig = {
    ...baseConfig,
    seed: 42,
    boundarySoftness: 5,
  };

  const t0 = performance.now();
  generateTectonicWorld(1024, 512, config);
  const durationMs = performance.now() - t0;

  assert(
    durationMs < 3000,
    `Generation took ${durationMs.toFixed(1)}ms, expected < 3000ms`
  );
});
