import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catmullRomWeights,
  catmullRomBilinearTaps,
  sampleElevationBicubic,
  evaluateCatmullRom4BilinearTaps,
  sampleHardwareBilinearCorrect,
  sampleBuggyOldShaderMethod,
} from './elevationSampling.ts';
import { Mulberry32 } from './prng.ts';

/**
 * Reference un-clamped Catmull-Rom implementation matching the original sampleParentElev
 */
function legacySampleParentElev(
  grid: Float32Array | number[],
  parentCols: number,
  parentRows: number,
  mapWidth: number,
  mapHeight: number,
  wx: number,
  wy: number
): number {
  const clampedX = Math.max(0, Math.min(mapWidth, wx));
  const clampedY = Math.max(0, Math.min(mapHeight, wy));

  const u = (clampedX / mapWidth) * (parentCols - 1);
  const v = (clampedY / mapHeight) * (parentRows - 1);

  const c1 = Math.floor(u);
  const r1 = Math.floor(v);
  const tx = u - c1;
  const ty = v - r1;

  const getVal = (c: number, r: number) => {
    const cc = Math.max(0, Math.min(parentCols - 1, c));
    const rr = Math.max(0, Math.min(parentRows - 1, r));
    return grid[rr * parentCols + cc];
  };

  const hermite = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    const b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
    const c = -0.5 * p0 + 0.5 * p2;
    const d = p1;
    return a * t * t * t + b * t * t + c * t + d;
  };

  const rows: number[] = new Array(4);
  for (let i = 0; i < 4; i++) {
    const r = r1 - 1 + i;
    rows[i] = hermite(getVal(c1 - 1, r), getVal(c1, r), getVal(c1 + 1, r), getVal(c1 + 2, r), tx);
  }

  return hermite(rows[0], rows[1], rows[2], rows[3], ty);
}

test('sampleElevationBicubic returns exact values at grid points (error < 1e-6)', () => {
  const cols = 8;
  const rows = 8;
  const mapWidth = 800;
  const mapHeight = 800;
  const rng = new Mulberry32(12345);

  const grid = new Float32Array(cols * rows);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rng.next() * 100;
  }

  for (let r = 0; r < rows; r++) {
    const wy = (r * mapHeight) / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const wx = (c * mapWidth) / (cols - 1);
      const sampled = sampleElevationBicubic(grid, cols, rows, mapWidth, mapHeight, wx, wy, false);
      const expected = grid[r * cols + c];
      assert(
        Math.abs(sampled - expected) < 1e-6,
        `Expected ${expected} at (${c}, ${r}), got ${sampled}`
      );
    }
  }
});

test('sampleElevationBicubic matches legacy un-clamped sampleParentElev at random points (clamp = false)', () => {
  const cols = 12;
  const rows = 12;
  const mapWidth = 1000;
  const mapHeight = 1000;
  const rng = new Mulberry32(54321);

  const grid = new Float32Array(cols * rows);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rng.next() * 80 + 10;
  }

  for (let i = 0; i < 50; i++) {
    const wx = rng.next() * mapWidth;
    const wy = rng.next() * mapHeight;

    const actual = sampleElevationBicubic(grid, cols, rows, mapWidth, mapHeight, wx, wy, false);
    const expected = legacySampleParentElev(grid, cols, rows, mapWidth, mapHeight, wx, wy);

    assert(
      Math.abs(actual - expected) < 1e-6,
      `Mismatch at (${wx}, ${wy}): expected ${expected}, got ${actual}`
    );
  }
});

test('clamp = true prevents ringing on steep steps (10 -> 60)', () => {
  const cols = 6;
  const rows = 6;
  const mapWidth = 500;
  const mapHeight = 500;

  // Step grid: columns 0..2 are 10, columns 3..5 are 60
  const grid = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r * cols + c] = c <= 2 ? 10.0 : 60.0;
    }
  }

  // Sample at u = 1.8 (between c=1 and c=2, just before the step at c=3)
  // Standard Catmull-Rom with control points [10, 10, 10, 60] has an undershoot dip (< 10)
  const wx = (1.8 * mapWidth) / (cols - 1);
  const wy = (2.5 * mapHeight) / (rows - 1);

  const unClamped = sampleElevationBicubic(grid, cols, rows, mapWidth, mapHeight, wx, wy, false);
  const clamped = sampleElevationBicubic(grid, cols, rows, mapWidth, mapHeight, wx, wy, true);

  // Un-clamped exhibits ringing undershoot below 10.0
  assert(
    unClamped < 10.0,
    `Expected un-clamped Catmull-Rom to undershoot below 10.0, got ${unClamped}`
  );

  // Clamped must stay within the surrounding 2x2 grid values (all 10.0 in this neighborhood)
  assert(
    clamped >= 10.0 && clamped <= 60.0,
    `Expected clamped value in [10, 60], got ${clamped}`
  );
  assert.equal(clamped, 10.0);
});

test('catmullRomBilinearTaps matches 16-point CPU bicubic within 1e-5', () => {
  const cols = 10;
  const rows = 10;
  const mapWidth = 900;
  const mapHeight = 900;
  const rng = new Mulberry32(9999);

  const grid = new Float32Array(cols * rows);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rng.next() * 100;
  }

  for (let i = 0; i < 50; i++) {
    const wx = rng.next() * mapWidth;
    const wy = rng.next() * mapHeight;

    const val4Taps = evaluateCatmullRom4BilinearTaps(grid, cols, rows, wx, wy, mapWidth, mapHeight);
    const valBicubic = sampleElevationBicubic(grid, cols, rows, mapWidth, mapHeight, wx, wy, false);

    assert(
      Math.abs(val4Taps - valBicubic) < 1e-5,
      `Tap approximation error at (${wx}, ${wy}): 4-taps ${val4Taps} vs bicubic ${valBicubic}`
    );
  }
});

test('hardware bilinear with (n + 0.5)/size returns exact grid values at integer node indices', () => {
  const cols = 9;
  const rows = 9;
  const rng = new Mulberry32(777);

  const grid = new Float32Array(cols * rows);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = 10 + i * 1.5;
  }

  // Left edge (n = 0, uvX = 0)
  const leftVal = sampleHardwareBilinearCorrect(grid, cols, rows, 0.0, 0.0);
  assert.equal(leftVal, grid[0]);

  // Right edge (n = cols - 1, uvX = 1)
  const rightVal = sampleHardwareBilinearCorrect(grid, cols, rows, 1.0, 0.0);
  assert.equal(rightVal, grid[cols - 1]);

  // Center (n = (cols - 1)/2, uvX = 0.5)
  const centerC = (cols - 1) / 2;
  const centerR = (rows - 1) / 2;
  const centerVal = sampleHardwareBilinearCorrect(grid, cols, rows, 0.5, 0.5);
  assert.equal(centerVal, grid[centerR * cols + centerC]);

  // Check all integer node coordinates
  for (let r = 0; r < rows; r++) {
    const uvY = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const uvX = c / (cols - 1);
      const val = sampleHardwareBilinearCorrect(grid, cols, rows, uvX, uvY);
      assert(
        Math.abs(val - grid[r * cols + c]) < 1e-6,
        `Expected ${grid[r * cols + c]} at node (${c}, ${r}), got ${val}`
      );
    }
  }
});

test('comparison: old buggy method causes coordinate shift and smoothstep plateau distortion', () => {
  const cols = 9;
  const rows = 9;

  // Linear ramp along X: 0, 10, 20, 30, 40, 50, 60, 70, 80
  const grid = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r * cols + c] = c * 10;
    }
  }

  // At midway between c=0 and c=1 (uvX = 0.5 / (cols - 1) = 0.0625):
  // True linear interpolation should yield 5.0
  const midUvX = 0.5 / (cols - 1);
  const correctVal = sampleHardwareBilinearCorrect(grid, cols, rows, midUvX, 0.0);
  assert.equal(correctVal, 5.0);

  // In the old shader, f = 0.5 was distorted by f*f*(3 - 2f) = 0.5 (at 0.5 it happens to be 0.5),
  // but at f = 0.25 (linear value 2.5):
  const quarterUvX = 0.25 / (cols - 1);
  const correctQuarter = sampleHardwareBilinearCorrect(grid, cols, rows, quarterUvX, 0.0);
  const buggyQuarter = sampleBuggyOldShaderMethod(grid, cols, rows, quarterUvX, 0.0);

  assert.equal(correctQuarter, 2.5);
  // Old shader f' = 0.25 * 0.25 * (3 - 2*0.25) = 0.0625 * 2.5 = 0.15625 -> value = 1.5625 != 2.5
  assert(
    Math.abs(buggyQuarter - 2.5) > 0.8,
    `Old shader should exhibit flattening distortion: got ${buggyQuarter}, expected distortion away from 2.5`
  );
});
