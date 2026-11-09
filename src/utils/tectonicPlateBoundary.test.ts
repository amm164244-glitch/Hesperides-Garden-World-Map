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

function analyzeStepCliffMetrics(
  grid: Float32Array,
  cols: number,
  rows: number,
  seaLevel = STANDARD_SEA_LEVEL
) {
  let inlandDiff5Count = 0;
  let maxCoastDiff = 0;

  for (let r = 0; r < rows; r++) {
    const rowOffset = r * cols;
    for (let c = 0; c < cols; c++) {
      const idx = rowOffset + c;
      const e0 = grid[idx];

      // Horizontal neighbor (c + 1)
      if (c < cols - 1) {
        const eRight = grid[idx + 1];
        const dH = Math.abs(e0 - eRight);
        if (e0 >= seaLevel + 6.0 && eRight >= seaLevel + 6.0 && dH >= 5.0) {
          inlandDiff5Count++;
        }
        const isCoastH = (e0 <= seaLevel && eRight > seaLevel) || (e0 > seaLevel && eRight <= seaLevel);
        if (isCoastH && dH > maxCoastDiff) {
          maxCoastDiff = dH;
        }
      }

      // Vertical neighbor (r + 1)
      if (r < rows - 1) {
        const eDown = grid[idx + cols];
        const dV = Math.abs(e0 - eDown);
        if (e0 >= seaLevel + 6.0 && eDown >= seaLevel + 6.0 && dV >= 5.0) {
          inlandDiff5Count++;
        }
        const isCoastV = (e0 <= seaLevel && eDown > seaLevel) || (e0 > seaLevel && eDown <= seaLevel);
        if (isCoastV && dV > maxCoastDiff) {
          maxCoastDiff = dV;
        }
      }
    }
  }

  // Polar analysis: top 7% and bottom 7% of rows
  const bandRows = Math.floor(rows * 0.07);

  function analyzePolarTransitions(startR: number, endR: number) {
    const rowCounts: number[] = new Array(endR - startR).fill(0);
    let totalTransitions = 0;

    for (let r = startR; r < endR; r++) {
      let count = 0;
      for (let c = 0; c < cols; c++) {
        const isW1 = grid[r * cols + c] <= seaLevel;
        const isW2 = grid[(r + 1) * cols + c] <= seaLevel;
        if (isW1 !== isW2) {
          count++;
        }
      }
      rowCounts[r - startR] = count;
      totalTransitions += count;
    }

    const maxCount = totalTransitions > 0 ? Math.max(...rowCounts) : 0;
    const maxRatio = totalTransitions > 0 ? maxCount / totalTransitions : 0;
    return { maxCount, totalTransitions, maxRatio };
  }

  const northPolar = analyzePolarTransitions(0, bandRows);
  const southPolar = analyzePolarTransitions(rows - 1 - bandRows, rows - 1);

  return {
    inlandDiff5Count,
    maxCoastDiff,
    northPolar,
    southPolar,
  };
}

test('プレート境界および極のなめらかさ改善の検証 (シード 7, 21, 99)', () => {
  const seeds = [7, 21, 99];
  const baselines: Record<number, number> = {
    7: 2500,
    21: 650,
    99: 3000,
  };

  for (const seed of seeds) {
    const config5: GeneratorConfig = {
      seed,
      gridResolution: '1024x512',
      worldWidthKm: 40000,
      plateCount: 12,
      seaRatio: 60,
      continentCount: 4,
      continentSize: 5,
      mountainStrength: 5,
      islandDensity: 4,
      coastlineComplexity: 4,
      boundarySoftness: 5,
      polarSoftness: 5,
      minIslandArea: 1,
    };

    const t0 = performance.now();
    const map5 = generateTectonicWorld(1024, 512, config5);
    const duration = performance.now() - t0;

    // 1. Performance < 3s
    assert(duration < 3000, `Seed ${seed}: Generation took ${duration.toFixed(1)}ms, expected < 3000ms`);

    const metrics5 = analyzeStepCliffMetrics(map5.elevationGrid, map5.gridCols, map5.gridRows, map5.seaLevel);

    // 2. 内陸(両方が海面 + 6 以上)の縦横隣標高差 5 以上の数が修正前の 70% 以下
    const maxAllowedDiff5 = baselines[seed] * 0.70;
    assert(
      metrics5.inlandDiff5Count <= maxAllowedDiff5,
      `Seed ${seed}: Inland diff >= 5 count was ${metrics5.inlandDiff5Count}, expected <= ${maxAllowedDiff5} (70% of ${baselines[seed]})`
    );

    // 3. 海岸をまたぐ隣のマスの標高差の最大が 12 以下
    assert(
      metrics5.maxCoastDiff <= 12.0,
      `Seed ${seed}: Max coastal diff was ${metrics5.maxCoastDiff}, expected <= 12.0`
    );

    // 4. 極の切り口: 上下それぞれの帯(高さの 7%)で、縦方向の海陸切り替わりのうち最も多い1行に集中する割合が 15% 以下 (polarSoftness = 5)
    if (metrics5.northPolar.totalTransitions > 0) {
      assert(
        metrics5.northPolar.maxRatio <= 0.15,
        `Seed ${seed}: North polar max single-row ratio was ${metrics5.northPolar.maxRatio.toFixed(3)}, expected <= 0.15`
      );
    }
    if (metrics5.southPolar.totalTransitions > 0) {
      assert(
        metrics5.southPolar.maxRatio <= 0.15,
        `Seed ${seed}: South polar max single-row ratio was ${metrics5.southPolar.maxRatio.toFixed(3)}, expected <= 0.15`
      );
    }

    // Compare with polarSoftness = 0: ratio must be greater when polarSoftness = 0
    const config0: GeneratorConfig = {
      ...config5,
      polarSoftness: 0,
    };
    const map0 = generateTectonicWorld(1024, 512, config0);
    const metrics0 = analyzeStepCliffMetrics(map0.elevationGrid, map0.gridCols, map0.gridRows, map0.seaLevel);

    if (metrics5.northPolar.totalTransitions > 0 && metrics0.northPolar.totalTransitions > 0) {
      assert(
        metrics0.northPolar.maxRatio > metrics5.northPolar.maxRatio,
        `Seed ${seed}: polarSoftness=0 north ratio (${metrics0.northPolar.maxRatio.toFixed(3)}) should be greater than polarSoftness=5 (${metrics5.northPolar.maxRatio.toFixed(3)})`
      );
    }
    if (metrics5.southPolar.totalTransitions > 0 && metrics0.southPolar.totalTransitions > 0) {
      assert(
        metrics0.southPolar.maxRatio > metrics5.southPolar.maxRatio,
        `Seed ${seed}: polarSoftness=0 south ratio (${metrics0.southPolar.maxRatio.toFixed(3)}) should be greater than polarSoftness=5 (${metrics5.southPolar.maxRatio.toFixed(3)})`
      );
    }

    // 5. 陸地の割合(標高 >= seaLevel)が (1 - seaRatio / 100) の ±3% 以内。最高標高が 95 以上。
    const total = map5.elevationGrid.length;
    let landCount = 0;
    let maxElev = -Infinity;
    for (let i = 0; i < total; i++) {
      const e = map5.elevationGrid[i];
      if (e >= map5.seaLevel) landCount++;
      if (e > maxElev) maxElev = e;
    }
    const landRatio = landCount / total;
    const targetLandRatio = 1 - config5.seaRatio / 100; // 0.40
    assert(
      Math.abs(landRatio - targetLandRatio) <= 0.03,
      `Seed ${seed}: Land ratio was ${landRatio.toFixed(4)}, expected within ±0.03 of ${targetLandRatio}`
    );
    assert(
      maxElev >= 95.0,
      `Seed ${seed}: Max elevation was ${maxElev.toFixed(1)}, expected >= 95.0`
    );
  }
});
