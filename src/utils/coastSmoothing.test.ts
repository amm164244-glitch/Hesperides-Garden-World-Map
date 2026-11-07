import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothCoastBand } from './coastSmoothing';

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
