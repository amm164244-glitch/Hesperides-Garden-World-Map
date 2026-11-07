import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRiversAndLakes,
  createOrganicLake,
  pointInLake,
  smoothRiverPath,
  sampleElev,
} from './waterGenerator';
import {
  distanceToRiver,
  findNearestRiverVertex,
  findNearestLakeVertex,
  findWaterAtPoint,
} from './waterRenderer';
import { createTerrainWaterSampler } from './town/townSample';
import { RiverData, LakeData } from '../types/water';
import { computeHydrology, downsampleForHydrology } from './hydrology';

/**
 * Asserts that river elevations monotonically decrease downstream (towards mouth).
 * Allowable tolerance for minor spline interpolation overshoot is 0.35.
 */
function assertElevationMonotonicity(
  rivers: RiverData[],
  grid: Float32Array,
  cols: number,
  rows: number,
  mapW: number,
  mapH: number,
  tolerance: number = 0.35
) {
  for (const river of rivers) {
    for (let i = 0; i < river.points.length - 1; i++) {
      const p1 = river.points[i];
      const p2 = river.points[i + 1];
      const e1 = sampleElev(grid, cols, rows, mapW, mapH, p1[0], p1[1]);
      const e2 = sampleElev(grid, cols, rows, mapW, mapH, p2[0], p2[1]);
      const uphill = e2 - e1;
      assert.ok(
        uphill <= tolerance,
        `River ${river.id} climbs uphill by ${uphill.toFixed(2)} between point ${i} and ${i + 1} (${e1.toFixed(1)} -> ${e2.toFixed(1)})`
      );
    }
  }
}

/**
 * Asserts that all rivers terminate cleanly into ocean, lake, or another river.
 * 'inland' termination is strictly 0.
 */
function assertValidTerminations(rivers: RiverData[]) {
  for (const r of rivers) {
    assert.ok(
      r.terminatesAt === 'ocean' || r.terminatesAt === 'lake' || r.terminatesAt === 'river',
      `River ${r.id} terminated at invalid type: ${r.terminatesAt}`
    );
    assert.notEqual(r.terminatesAt, 'inland');
  }
}

test('creates an organic closed lake polygon', () => {
  const lake = createOrganicLake(100, 100, 30, 12345);
  assert.ok(lake.length > 10);
  assert.equal(pointInLake(100, 100, lake), true);
  assert.equal(pointInLake(300, 300, lake), false);
});

test('smooths river paths', () => {
  const raw: [number, number][] = [
    [10, 10],
    [20, 30],
    [40, 50],
    [60, 90],
  ];
  const smoothed = smoothRiverPath(raw, 2);
  assert.ok(smoothed.length > raw.length);
  assert.deepEqual(smoothed[0], raw[0]);
});

test('accurately tests distance to river and detects hit within width', () => {
  const river: RiverData = {
    id: 'river_test',
    points: [
      [100, 100],
      [200, 100],
    ],
    widthStart: 10,
    widthEnd: 10,
  };

  const onLine = distanceToRiver(150, 100, river);
  assert.equal(onLine.distance, 0);

  const nearLine = distanceToRiver(150, 104, river);
  assert.equal(nearLine.distance, 0);

  const outside = distanceToRiver(150, 112, river);
  assert.ok(Math.abs(outside.distance - 7) < 0.1);
});

test('detects nearest river and lake vertices for interactive dragging', () => {
  const river: RiverData = {
    id: 'river_test',
    points: [
      [50, 50],
      [150, 60],
      [250, 70],
    ],
    widthStart: 4,
    widthEnd: 8,
  };

  assert.equal(findNearestRiverVertex(51, 51, river, 5), 0);
  assert.equal(findNearestRiverVertex(150, 62, river, 5), 1);
  assert.equal(findNearestRiverVertex(0, 0, river, 5), null);

  const lake: LakeData = {
    id: 'lake_test',
    polygon: [
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
    ],
  };

  assert.equal(findNearestLakeVertex(39, 41, lake, 5), 2);
  assert.equal(findNearestLakeVertex(100, 100, lake, 5), null);
});

test('finds water body under cursor', () => {
  const river: RiverData = {
    id: 'river_1',
    points: [
      [0, 0],
      [100, 0],
    ],
    widthStart: 4,
    widthEnd: 6,
  };
  const lake: LakeData = {
    id: 'lake_1',
    polygon: [
      [200, 200],
      [300, 200],
      [300, 300],
      [200, 300],
    ],
  };

  const hitRiver = findWaterAtPoint(50, 2, [river], [lake], 8);
  assert.deepEqual(hitRiver, { type: 'river', id: 'river_1' });

  const hitLake = findWaterAtPoint(250, 250, [river], [lake], 8);
  assert.deepEqual(hitLake, { type: 'lake', id: 'lake_1' });

  const hitNone = findWaterAtPoint(500, 500, [river], [lake], 8);
  assert.equal(hitNone, null);
});

test('createTerrainWaterSampler correctly identifies rivers and lakes as water', () => {
  const grid = new Float32Array(10 * 10).fill(50.0);
  const seaLevel = 35.0;

  const river: RiverData = {
    id: 'river_town',
    points: [
      [10, 10],
      [90, 10],
    ],
    widthStart: 8,
    widthEnd: 8,
  };
  const lake: LakeData = {
    id: 'lake_town',
    polygon: [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60],
    ],
  };

  const sampler = createTerrainWaterSampler(grid, 10, 10, 100, 100, seaLevel, [river], [lake]);

  assert.equal(sampler.isWater(50, 10), true);
  assert.equal(sampler.isWater(50, 50), true);
  assert.equal(sampler.isWater(10, 90), false);
});

// =========================================================================
// Hydrology Tests: Analytical Terrains, Monotonicity, and Termination
// =========================================================================

test('Analytical terrain: Conical island has radial downhill rivers reaching the sea with 0 inland endings', () => {
  const cols = 64;
  const rows = 64;
  const mapW = 1000;
  const mapH = 1000;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  const cx = (cols - 1) * 0.5;
  const cy = (rows - 1) * 0.5;
  const maxR = cx * 0.9;

  // Mountain peak at center (85), sloping down radially to ocean (20)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = Math.hypot(c - cx, r - cy);
      const ratio = Math.min(1, d / maxR);
      grid[r * cols + c] = 85.0 - ratio * 65.0;
    }
  }

  const { rivers, lakes } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    12345,
    { riverCount: 8, lakeCount: 0, riverDensity: 60 }
  );

  assert.ok(rivers.length > 0, 'Should generate rivers on conical island');
  assertValidTerminations(rivers);
  assertElevationMonotonicity(rivers, grid, cols, rows, mapW, mapH);

  // Check radial outward flow: river end points should be further from center than start points
  for (const river of rivers) {
    const pStart = river.points[0];
    const pEnd = river.points[river.points.length - 1];
    const dStart = Math.hypot(pStart[0] - mapW * 0.5, pStart[1] - mapH * 0.5);
    const dEnd = Math.hypot(pEnd[0] - mapW * 0.5, pEnd[1] - mapH * 0.5);
    assert.ok(dEnd > dStart, `River ${river.id} must flow radially outward (dStart=${dStart}, dEnd=${dEnd})`);
  }
});

test('Analytical terrain: Tilted plane rivers flow strictly downhill to bottom border/sea', () => {
  const cols = 64;
  const rows = 32;
  const mapW = 1000;
  const mapH = 500;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  // Mountain in top-left (elevation 85) sloping down to ocean in bottom-right (elevation 20)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const v = r / (rows - 1);
      grid[r * cols + c] = 85.0 - (u * 0.5 + v * 0.5) * 60.0;
    }
  }

  const { rivers } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    54321,
    { riverCount: 6, lakeCount: 0, riverDensity: 50 }
  );

  assert.ok(rivers.length > 0, 'Should generate rivers on tilted plane');
  assertValidTerminations(rivers);
  assertElevationMonotonicity(rivers, grid, cols, rows, mapW, mapH);
});

test('Analytical terrain: Closed basin forms a lake and an outflow river draining it', () => {
  const cols = 64;
  const rows = 64;
  const mapW = 1000;
  const mapH = 1000;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  // Overall slope from left (high, 80) to right (sea, 20)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      grid[r * cols + c] = 80.0 - u * 55.0;
    }
  }

  // Create an inland depression (basin) around (c=25, r=32)
  const bc = 25;
  const br = 32;
  for (let r = br - 6; r <= br + 6; r++) {
    for (let c = bc - 6; c <= bc + 6; c++) {
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        const d = Math.hypot(c - bc, r - br);
        if (d <= 5) {
          // Hollow out the center to depth 6
          grid[r * cols + c] -= (5 - d) * 1.5;
        }
      }
    }
  }

  const { rivers, lakes } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    8888,
    { riverCount: 8, lakeCount: 2, riverDensity: 50 }
  );

  // Basin should form at least one lake
  assert.ok(lakes.length > 0, 'Should extract lake from closed basin');
  const lake = lakes[0];
  assert.ok(lake.polygon.length >= 3);

  // Lake polygon must stay on land
  for (const [px, py] of lake.polygon) {
    const e = sampleElev(grid, cols, rows, mapW, mapH, px, py);
    assert.ok(e >= seaLevel - 0.5, `Lake vertex at (${px}, ${py}) should be inland`);
  }

  assertValidTerminations(rivers);
  assertElevationMonotonicity(rivers, grid, cols, rows, mapW, mapH);

  // Outflow river check: one of the rivers should originate from the lake or enter it
  const lakeConnectedRiver = rivers.find(
    (r) => (r.sourceType === 'lake' && r.sourceLakeId === lake.id) || r.targetLakeId === lake.id
  );
  assert.ok(lakeConnectedRiver, 'Should have river connected to the depression lake');
});

test('Performance: 1024x512 grid computes hydrology and extracts water under 2000ms', () => {
  const cols = 1024;
  const rows = 512;
  const mapW = 2048;
  const mapH = 1024;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  // Generate synthetic wavy terrain
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const wave = Math.sin(u * 12) * Math.cos(v * 8) * 15;
      grid[r * cols + c] = 55.0 - v * 25.0 + wave;
    }
  }

  const t0 = performance.now();
  const { rivers, lakes, stats } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    424242,
    { riverCount: 14, lakeCount: 6, riverDensity: 40 }
  );
  const elapsed = performance.now() - t0;

  assert.ok(elapsed < 2000, `Execution time ${elapsed.toFixed(1)}ms must be under 2000ms!`);
  assert.ok(stats && (stats.computationTimeMs ?? 0) < 2000);
  assert.ok(Array.isArray(rivers));
  assert.ok(Array.isArray(lakes));
  assertValidTerminations(rivers);
});

test('Large grid downsampling scales massive 4096x2048 grid to <= 2048x1024', () => {
  const bigCols = 4096;
  const bigRows = 2048;
  const dummyGrid = new Float32Array(bigCols * bigRows);
  dummyGrid[0] = 50.0;

  const result = downsampleForHydrology(dummyGrid, bigCols, bigRows, 2048 * 1024);
  assert.ok(result.scale >= 2);
  assert.ok(result.cols <= 2048);
  assert.ok(result.rows <= 1024);
  assert.equal(result.grid.length, result.cols * result.rows);
});
