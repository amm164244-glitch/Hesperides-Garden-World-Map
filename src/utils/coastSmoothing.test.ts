import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothCoastBand, smoothSteps } from './coastSmoothing';
import { generateTectonicWorld, STANDARD_SEA_LEVEL } from './tectonicGenerator';

// Helper to compute median of a number array
function computeMedian(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// Helper to find elevation differences across the coast boundary
function getCoastStepDifferences(
  grid: Float32Array,
  cols: number,
  rows: number,
  seaLevel: number
): number[] {
  const diffs: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const elev = grid[idx];
      const isLand = elev >= seaLevel;

      // Check right neighbor
      if (c < cols - 1) {
        const rightIdx = idx + 1;
        const rightLand = grid[rightIdx] >= seaLevel;
        if (isLand !== rightLand) {
          diffs.push(Math.abs(elev - grid[rightIdx]));
        }
      }
      // Check bottom neighbor
      if (r < rows - 1) {
        const botIdx = idx + cols;
        const botLand = grid[botIdx] >= seaLevel;
        if (isLand !== botLand) {
          diffs.push(Math.abs(elev - grid[botIdx]));
        }
      }
    }
  }
  return diffs;
}

test('崖状の海岸で、海岸をまたぐ隣のマスの標高差の中央値が適用前より小さくなる', () => {
  const cols = 100;
  const rows = 100;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  const cx = 50;
  const cy = 50;
  const radius = 30;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dist = Math.hypot(c - cx, r - cy);
      grid[r * cols + c] = dist <= radius ? 55.0 : 15.0;
    }
  }

  const beforeDiffs = getCoastStepDifferences(grid, cols, rows, seaLevel);
  const beforeMedian = computeMedian(beforeDiffs);
  assert.equal(beforeMedian, 40.0); // Exact 55 - 15 step

  const smoothed = smoothCoastBand(grid, cols, rows, seaLevel, {
    bandCells: 3,
    sigmaCells: 1.6,
    blend: 1.0,
  });

  const afterDiffs = getCoastStepDifferences(smoothed, cols, rows, seaLevel);
  const afterMedian = computeMedian(afterDiffs);

  assert.ok(
    afterMedian < beforeMedian,
    `Smoothed median step (${afterMedian.toFixed(2)}) must be smaller than initial (${beforeMedian.toFixed(2)})`
  );
  // Specifically, should be substantially smoothed (e.g. under 20)
  assert.ok(afterMedian < 20.0, `Expected smoothed step to be under 20.0, got ${afterMedian}`);
});

test('陸地の面積(標高 >= seaLevel のマス数)の変化が ±1.5% 以内である', () => {
  const cols = 100;
  const rows = 100;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  const cx = 50;
  const cy = 50;
  const radius = 30;

  let initialLandCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dist = Math.hypot(c - cx, r - cy);
      const elev = dist <= radius ? 55.0 : 15.0;
      grid[r * cols + c] = elev;
      if (elev >= seaLevel) initialLandCount++;
    }
  }

  const smoothed = smoothCoastBand(grid, cols, rows, seaLevel, {
    bandCells: 3,
    sigmaCells: 1.6,
    blend: 1.0,
  });

  let smoothedLandCount = 0;
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] >= seaLevel) smoothedLandCount++;
  }

  const percentDiff = (Math.abs(smoothedLandCount - initialLandCount) / initialLandCount) * 100;
  assert.ok(
    percentDiff <= 1.5,
    `Land area change (${percentDiff.toFixed(2)}%) must be within ±1.5%`
  );
});

test('帯の外側(海岸から 8マス以上離れた場所)の標高が変化しない', () => {
  const cols = 100;
  const rows = 100;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  const cx = 50;
  const cy = 50;
  const radius = 30;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dist = Math.hypot(c - cx, r - cy);
      grid[r * cols + c] = dist <= radius ? 55.0 : 15.0;
    }
  }

  const smoothed = smoothCoastBand(grid, cols, rows, seaLevel, {
    bandCells: 3,
    sigmaCells: 1.6,
    blend: 1.0,
  });

  // Verify that any cell at distance >= 8 from the radius boundary (r=30)
  // is strictly untouched.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const distToCenter = Math.hypot(c - cx, r - cy);
      const distToCoast = Math.abs(distToCenter - radius);

      if (distToCoast >= 8.5) {
        const idx = r * cols + c;
        assert.equal(
          smoothed[idx],
          grid[idx],
          `Cell at (${c}, ${r}) dist ${distToCoast.toFixed(1)} changed from ${grid[idx]} to ${smoothed[idx]}`
        );
      }
    }
  }
});

test('小さな島(面積 6〜10 マス)が消えない', () => {
  const cols = 64;
  const rows = 64;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows).fill(20.0); // deep ocean

  // Island 1: 7-cell land component around (20, 20) with marginal height (37.0)
  const islandCells = [
    [20, 20], [21, 20], [22, 20],
    [20, 21], [21, 21], [22, 21],
    [21, 22],
  ];
  for (const [c, r] of islandCells) {
    grid[r * cols + c] = 37.0;
  }

  // Island 2: 6-cell land component around (45, 45)
  const island2Cells = [
    [45, 45], [46, 45], [47, 45],
    [45, 46], [46, 46], [47, 46],
  ];
  for (const [c, r] of island2Cells) {
    grid[r * cols + c] = 36.5;
  }

  const smoothed = smoothCoastBand(grid, cols, rows, seaLevel, {
    bandCells: 3,
    sigmaCells: 2.2, // Strong blur that would otherwise submerge thin land
    blend: 1.0,
  });

  // Island 1 must have at least one land cell remaining
  const island1Land = islandCells.some(([c, r]) => smoothed[r * cols + c] >= seaLevel);
  assert.ok(island1Land, 'Island 1 (7 cells) must not be submerged to 0 land cells');

  // Island 2 must have at least one land cell remaining
  const island2Land = island2Cells.some(([c, r]) => smoothed[r * cols + c] >= seaLevel);
  assert.ok(island2Land, 'Island 2 (6 cells) must not be submerged to 0 land cells');
});

test('入力の配列が変更されないこと、blend = 0 のとき結果が入力と一致すること', () => {
  const cols = 32;
  const rows = 32;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  for (let i = 0; i < grid.length; i++) {
    grid[i] = i % 2 === 0 ? 50.0 : 20.0;
  }
  const originalCopy = new Float32Array(grid);

  // blend = 0
  const resultBlend0 = smoothCoastBand(grid, cols, rows, seaLevel, { blend: 0 });

  // Input array is not modified
  assert.deepEqual(grid, originalCopy);

  // Result with blend = 0 matches input exactly
  assert.deepEqual(resultBlend0, originalCopy);
});

test('2048x1024 の格子で処理時間が 1.5 秒以内であること', () => {
  const cols = 2048;
  const rows = 1024;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  // Synthesize several continents and islands
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const wave = Math.sin(u * 8) * Math.cos(v * 6) * 30;
      grid[r * cols + c] = 30.0 + wave;
    }
  }

  const t0 = performance.now();
  const smoothed = smoothCoastBand(grid, cols, rows, seaLevel, {
    bandCells: 3,
    sigmaCells: 1.6,
    blend: 1.0,
  });
  const elapsed = performance.now() - t0;

  assert.ok(
    elapsed < 1500,
    `Execution time ${elapsed.toFixed(1)}ms must be under 1500ms`
  );
  assert.equal(smoothed.length, cols * rows);
});

test('同じ入力で同じ結果になること(決定論的)', () => {
  const cols = 64;
  const rows = 64;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  for (let i = 0; i < grid.length; i++) {
    grid[i] = ((i * 37) % 100);
  }

  const out1 = smoothCoastBand(grid, cols, rows, seaLevel, { bandCells: 3, sigmaCells: 1.6, blend: 0.8 });
  const out2 = smoothCoastBand(grid, cols, rows, seaLevel, { bandCells: 3, sigmaCells: 1.6, blend: 0.8 });

  assert.deepEqual(out1, out2);
});

// ==========================================
// Tests for smoothSteps (内陸段差と海岸の平滑化)
// ==========================================

test('smoothSteps: 合成の段差(左60, 右30)で崖の標高差が減少し、崖から10マス以上離れた場所は変化しない', () => {
  const cols = 100;
  const rows = 60;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  // Left half = 60.0 (land), Right half = 30.0 (sea/lowland)
  // Step is at col 49 -> 50
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r * cols + c] = c < 50 ? 60.0 : 30.0;
    }
  }

  const initialStepDiff = Math.abs(grid[30 * cols + 49] - grid[30 * cols + 50]);
  assert.equal(initialStepDiff, 30.0);

  const smoothed = smoothSteps(grid, cols, rows, seaLevel, {
    jumpThreshold: 3.0,
    bandCells: 3,
    sigmaCells: 1.6,
    blend: 1.0,
    passes: 2,
    includeCoast: true,
  });

  // 1. Cliff step is smoothed
  const smoothedStepDiff = Math.abs(smoothed[30 * cols + 49] - smoothed[30 * cols + 50]);
  assert.ok(
    smoothedStepDiff < initialStepDiff,
    `Smoothed step (${smoothedStepDiff.toFixed(2)}) must be smaller than initial (${initialStepDiff.toFixed(2)})`
  );

  // 2. Cells at distance >= 10 from cliff (i.e. col <= 39 or col >= 60) are strictly untouched
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const distFromCliff = Math.abs(c - 49.5) - 0.5; // distance in cells from boundary between 49 and 50
      if (distFromCliff >= 10) {
        const idx = r * cols + c;
        assert.equal(
          smoothed[idx],
          grid[idx],
          `Cell at (c=${c}, r=${r}) dist=${distFromCliff} changed from ${grid[idx]} to ${smoothed[idx]}`
        );
      }
    }
  }
});

test('smoothSteps: 実際の生成(1024x512, seed 7, boundarySoftness=0)で内陸段差99.9%タイルが25%以上低下、面積±1.5%以内、最高標高92%以上', () => {
  const map = generateTectonicWorld(1024, 512, {
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
    coastSmoothing: 0, // generation coast smoothing disabled to isolate smoothSteps
    boundarySoftness: 0, // steep plate boundary steps
  });

  const cols = map.gridCols;
  const rows = map.gridRows;
  const seaLevel = map.seaLevel;

  // Helper to extract inland neighbor differences (both cells >= seaLevel + 6.0)
  function getInlandDiffs(grid: Float32Array): number[] {
    const diffs: number[] = [];
    const minInlandElev = seaLevel + 6.0;

    for (let r = 0; r < rows; r++) {
      const rowOffset = r * cols;
      for (let c = 0; c < cols; c++) {
        const idx = rowOffset + c;
        const e1 = grid[idx];
        if (e1 < minInlandElev) continue;

        if (c < cols - 1) {
          const e2 = grid[idx + 1];
          if (e2 >= minInlandElev) {
            diffs.push(Math.abs(e1 - e2));
          }
        }
        if (r < rows - 1) {
          const e3 = grid[idx + cols];
          if (e3 >= minInlandElev) {
            diffs.push(Math.abs(e1 - e3));
          }
        }
      }
    }
    return diffs.sort((a, b) => a - b);
  }

  const beforeDiffs = getInlandDiffs(map.elevationGrid);
  assert.ok(beforeDiffs.length > 1000, 'Must have sufficient inland cells');
  const beforeP999Idx = Math.min(beforeDiffs.length - 1, Math.floor(0.999 * beforeDiffs.length));
  const beforeP999 = beforeDiffs[beforeP999Idx];

  let beforeLandCount = 0;
  let beforeMaxElev = -Infinity;
  for (let i = 0; i < map.elevationGrid.length; i++) {
    const val = map.elevationGrid[i];
    if (val >= seaLevel) beforeLandCount++;
    if (val > beforeMaxElev) beforeMaxElev = val;
  }

  const smoothed = smoothSteps(map.elevationGrid, cols, rows, seaLevel);

  const afterDiffs = getInlandDiffs(smoothed);
  const afterP999Idx = Math.min(afterDiffs.length - 1, Math.floor(0.999 * afterDiffs.length));
  const afterP999 = afterDiffs[afterP999Idx];

  // 1. 99.9th percentile drops by >= 25%
  const reductionRate = (beforeP999 - afterP999) / beforeP999;
  assert.ok(
    reductionRate >= 0.25,
    `Inland 99.9% difference reduction (${(reductionRate * 100).toFixed(1)}%) must be >= 25% (before=${beforeP999.toFixed(2)}, after=${afterP999.toFixed(2)})`
  );

  // 2. Land area within ±1.5%
  let afterLandCount = 0;
  let afterMaxElev = -Infinity;
  for (let i = 0; i < smoothed.length; i++) {
    const val = smoothed[i];
    if (val >= seaLevel) afterLandCount++;
    if (val > afterMaxElev) afterMaxElev = val;
  }

  const landChangePercent = (Math.abs(afterLandCount - beforeLandCount) / beforeLandCount) * 100;
  assert.ok(
    landChangePercent <= 1.5,
    `Land area change (${landChangePercent.toFixed(2)}%) must be within ±1.5%`
  );

  // 3. Max elevation >= 92% of original
  const maxElevRatio = afterMaxElev / beforeMaxElev;
  assert.ok(
    maxElevRatio >= 0.92,
    `Max elevation ratio (${(maxElevRatio * 100).toFixed(1)}%) must be >= 92% (before=${beforeMaxElev.toFixed(1)}, after=${afterMaxElev.toFixed(1)})`
  );
});

test('smoothSteps: 面積 6〜10 マスの小さな島が消えないこと', () => {
  const cols = 64;
  const rows = 64;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows).fill(20.0); // deep ocean

  // Island 1: 7-cell land component around (20, 20) with marginal height (37.0)
  const islandCells = [
    [20, 20], [21, 20], [22, 20],
    [20, 21], [21, 21], [22, 21],
    [21, 22],
  ];
  for (const [c, r] of islandCells) {
    grid[r * cols + c] = 37.0;
  }

  // Island 2: 6-cell land component around (45, 45)
  const island2Cells = [
    [45, 45], [46, 45], [47, 45],
    [45, 46], [46, 46], [47, 46],
  ];
  for (const [c, r] of island2Cells) {
    grid[r * cols + c] = 36.5;
  }

  const smoothed = smoothSteps(grid, cols, rows, seaLevel, {
    bandCells: 3,
    sigmaCells: 2.2,
    blend: 1.0,
    passes: 2,
  });

  const island1Land = islandCells.some(([c, r]) => smoothed[r * cols + c] >= seaLevel);
  assert.ok(island1Land, 'Island 1 (7 cells) must not be submerged to 0 land cells');

  const island2Land = island2Cells.some(([c, r]) => smoothed[r * cols + c] >= seaLevel);
  assert.ok(island2Land, 'Island 2 (6 cells) must not be submerged to 0 land cells');
});

test('smoothSteps: 決定論的であること、入力が変更されないこと、2048x1024 で 2秒以内', () => {
  const cols = 2048;
  const rows = 1024;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  // Generate synthetic stepped landscape with continents
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const wave = Math.sin(u * 8) * Math.cos(v * 6) * 30;
      // Add periodic steps to simulate plate boundary cliffs
      const step = (c % 120 < 60 ? 10.0 : -10.0);
      grid[r * cols + c] = 30.0 + wave + step;
    }
  }

  const gridCopy = new Float32Array(grid);

  const t0 = performance.now();
  const out1 = smoothSteps(grid, cols, rows, seaLevel, {
    jumpThreshold: 3.0,
    bandCells: 3,
    sigmaCells: 1.6,
    blend: 1.0,
    passes: 2,
  });
  const elapsed = performance.now() - t0;

  // 1. Input is not mutated
  assert.deepEqual(grid, gridCopy, 'Original input grid must not be mutated');

  // 2. Performance: under 2000ms
  assert.ok(
    elapsed < 2000,
    `Execution time ${elapsed.toFixed(1)}ms must be under 2000ms`
  );

  // 3. Determinism
  const out2 = smoothSteps(gridCopy, cols, rows, seaLevel, {
    jumpThreshold: 3.0,
    bandCells: 3,
    sigmaCells: 1.6,
    blend: 1.0,
    passes: 2,
  });
  assert.deepEqual(out1, out2, 'Two runs with identical parameters must produce bit-for-bit identical grids');
});
