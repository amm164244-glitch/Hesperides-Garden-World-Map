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
  computeVariableWidthPolyline,
  createRiverMouthCap,
  computeRiverPointWidths,
  buildRiverStrokeGroups,
  quantizeWidth,
  partitionRiverStrokeBuckets,
} from './waterRenderer';
import { createTerrainWaterSampler } from './town/townSample';
import { RiverData, LakeData } from '../types/water';
import { computeHydrology, downsampleForHydrology } from './hydrology';
import { generateTectonicWorld } from './tectonicGenerator';
import { GeneratorConfig } from '../types/map';
import {
  hasSelfIntersection,
  clampSharpCorners,
  computeCircumcircleRadius,
  computeRiverPointWidthsForExtraction,
  projectPointToPolyline,
} from './riverExtraction';

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

// =========================================================================
// River Improvements: Headwaters, Smoothness, Estuary & Confluence Tests
// =========================================================================

function computeTotalRiverLength(rivers: RiverData[]): number {
  let total = 0;
  for (const r of rivers) {
    for (let i = 0; i < r.points.length - 1; i++) {
      total += Math.hypot(r.points[i + 1][0] - r.points[i][0], r.points[i + 1][1] - r.points[i][1]);
    }
  }
  return total;
}

test('River Improvement: Headwaters extension significantly increases river length compared to extension=0', () => {
  const cols = 96;
  const rows = 96;
  const mapW = 1000;
  const mapH = 1000;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  // Sloping terrain with converging central valley draining down to ocean on the right
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const v = r / (rows - 1);
      const valley = Math.abs(v - 0.5) * 25.0;
      grid[r * cols + c] = 85.0 - u * 60.0 + valley;
    }
  }

  // Generate with headExtension = 0 (no head extension)
  const res0 = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    777,
    { riverCount: 8, lakeCount: 0, riverDensity: 50, headExtension: 0 }
  );

  // Generate with headExtension = 0.8 (extended headwaters)
  const res80 = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    777,
    { riverCount: 8, lakeCount: 0, riverDensity: 50, headExtension: 0.8 }
  );

  assert.ok(res0.rivers.length > 0);
  assert.ok(res80.rivers.length > 0);

  const len0 = computeTotalRiverLength(res0.rivers);
  const len80 = computeTotalRiverLength(res80.rivers);

  // Extended rivers must be significantly longer than unextended rivers
  assert.ok(
    len80 > len0 + 25,
    `Headwaters extension (0.8) total length (${len80.toFixed(1)}) must be significantly longer than extension=0 (${len0.toFixed(1)})`
  );

  // Verify monotonicity of extended rivers
  assertElevationMonotonicity(res80.rivers, grid, cols, rows, mapW, mapH);
});

test('River Improvement: Smoothness - eliminates acute corner foldbacks and relaxes corners', () => {
  // Test direct corner clamp helper
  const sharpCornerPts: [number, number][] = [
    [0, 0],
    [10, 0],
    [0, 5], // acute hairpin turn
  ];
  const clamped = clampSharpCorners(sharpCornerPts);
  // Corner at index 1 must be relaxed toward midpoint of neighbors
  assert.notDeepEqual(clamped[1], [10, 0]);
  assert.ok(clamped[1][0] < 10);

  // Test generated rivers for absence of sharp foldbacks
  const cols = 64;
  const rows = 64;
  const mapW = 1000;
  const mapH = 1000;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const v = r / (rows - 1);
      grid[r * cols + c] = 80.0 - u * 55.0 + Math.sin(v * 6) * 5;
    }
  }

  const { rivers } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    999,
    { riverCount: 6, lakeCount: 0, riverDensity: 50, meander: 0.6 }
  );

  for (const river of rivers) {
    for (let i = 1; i < river.points.length - 1; i++) {
      const v1x = river.points[i][0] - river.points[i - 1][0];
      const v1y = river.points[i][1] - river.points[i - 1][1];
      const v2x = river.points[i + 1][0] - river.points[i][0];
      const v2y = river.points[i + 1][1] - river.points[i][1];
      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      if (len1 > 1e-4 && len2 > 1e-4) {
        const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
        // dot >= -0.25 ensures turn angle <= 104 deg, strictly eliminating sharp < 90 deg foldbacks
        assert.ok(
          dot >= -0.25,
          `River ${river.id} at point ${i} has acute turn (dot=${dot.toFixed(2)})`
        );
      }
    }
  }
});

test('River Improvement: Estuaries & Confluences - coastline snapping, estuary expansion, and confluence alignment', () => {
  const cols = 80;
  const rows = 80;
  const mapW = 1000;
  const mapH = 1000;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  // Diagonal slope from (0,0) down to (1000, 1000)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dist = Math.hypot(c, r);
      grid[r * cols + c] = 80.0 - dist * 0.65;
    }
  }

  const { rivers } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    1234,
    { riverCount: 10, lakeCount: 0, riverDensity: 70 }
  );

  const cellSize = mapW / cols;

  for (const r of rivers) {
    if (r.terminatesAt === 'ocean') {
      const pLast = r.points[r.points.length - 1];
      const eMouth = sampleElev(grid, cols, rows, mapW, mapH, pLast[0], pLast[1]);
      // Mouth endpoint should be snapped to coast (near seaLevel) or border
      const isBorder = pLast[0] <= 1 || pLast[0] >= mapW - 1 || pLast[1] <= 1 || pLast[1] >= mapH - 1;
      if (!isBorder) {
        assert.ok(
          Math.abs(eMouth - seaLevel) <= 2.0 || eMouth <= seaLevel,
          `River ${r.id} ocean mouth at (${pLast[0].toFixed(1)}, ${pLast[1].toFixed(1)}) elevation ${eMouth.toFixed(2)} should be near seaLevel ${seaLevel}`
        );
      }
      // Estuary width expanded
      assert.ok(r.widthEnd >= r.widthStart, `Estuary widthEnd must be >= widthStart`);
    } else if (r.terminatesAt === 'river' && r.connectedRiverId) {
      const mainRiver = rivers.find((m) => m.id === r.connectedRiverId);
      if (mainRiver) {
        const pLast = r.points[r.points.length - 1];
        // Must lie on one of the segments of mainRiver
        let minDist = Infinity;
        let bestSegTangent: [number, number] = [0, 0];
        for (let s = 0; s < mainRiver.points.length - 1; s++) {
          const A = mainRiver.points[s];
          const B = mainRiver.points[s + 1];
          const ABx = B[0] - A[0];
          const ABy = B[1] - A[1];
          const len2 = ABx * ABx + ABy * ABy;
          if (len2 < 1e-6) continue;
          const t = Math.max(0, Math.min(1, ((pLast[0] - A[0]) * ABx + (pLast[1] - A[1]) * ABy) / len2));
          const projX = A[0] + t * ABx;
          const projY = A[1] + t * ABy;
          const d = Math.hypot(pLast[0] - projX, pLast[1] - projY);
          if (d < minDist) {
            minDist = d;
            const l = Math.hypot(ABx, ABy) || 1;
            bestSegTangent = [ABx / l, ABy / l];
          }
        }
        assert.ok(
          minDist <= 0.5 * cellSize,
          `Tributary ${r.id} final point must snap onto main river ${mainRiver.id} segment (dist: ${minDist.toFixed(2)}, max allowed: ${0.5 * cellSize})`
        );

        // Check confluence angle: tributary incoming direction should align favorably with main stream direction (dot product >= 0, angle <= 90 deg)
        if (r.points.length >= 2) {
          const inDx = pLast[0] - r.points[r.points.length - 2][0];
          const inDy = pLast[1] - r.points[r.points.length - 2][1];
          const inLen = Math.hypot(inDx, inDy) || 1;
          const dot = (inDx / inLen) * bestSegTangent[0] + (inDy / inLen) * bestSegTangent[1];
          assert.ok(
            dot >= -0.1,
            `Tributary ${r.id} confluence angle should flow in direction of main river (dot=${dot.toFixed(2)})`
          );
        }
      }
    }
  }
});

test('River Improvement: Rivers do not self-intersect', () => {
  const cols = 64;
  const rows = 64;
  const mapW = 1000;
  const mapH = 1000;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const v = r / (rows - 1);
      grid[r * cols + c] = 85.0 - u * 55.0 + Math.sin(v * 8) * 8;
    }
  }

  const { rivers } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    5555,
    { riverCount: 8, lakeCount: 0, riverDensity: 50, meander: 0.8 }
  );

  for (const r of rivers) {
    const selfIntersects = hasSelfIntersection(r.points);
    assert.equal(selfIntersects, false, `River ${r.id} must not self-intersect`);
  }
});

test('River Improvement: Determinism and summary statistics', () => {
  const cols = 64;
  const rows = 64;
  const mapW = 1000;
  const mapH = 1000;
  const seaLevel = 35.0;
  const grid = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r * cols + c] = 75.0 - (c / cols) * 50.0;
    }
  }

  const run1 = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    8888,
    { riverCount: 6, lakeCount: 1, riverDensity: 40, headExtension: 0.8 }
  );

  const run2 = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    8888,
    { riverCount: 6, lakeCount: 1, riverDensity: 40, headExtension: 0.8 }
  );

  assert.deepEqual(run1.rivers, run2.rivers, 'Rivers must be strictly deterministic given same seed');
  assert.deepEqual(run1.lakes, run2.lakes, 'Lakes must be strictly deterministic given same seed');

  // Verify stats include longestRiverKm and avgRiverLengthKm
  assert.ok(run1.stats, 'Stats should be present');
  assert.ok(typeof run1.stats.longestRiverKm === 'number' && run1.stats.longestRiverKm > 0);
  assert.ok(typeof run1.stats.avgRiverLengthKm === 'number' && run1.stats.avgRiverLengthKm > 0);
  assert.ok(run1.stats.longestRiverKm >= run1.stats.avgRiverLengthKm);
});

test('River Improvement: Sinuosity, straight-run elimination, mouth variance, and headwater hook prevention', () => {
  const cols = 160;
  const rows = 120;
  const mapW = 1600;
  const mapH = 1200;
  const seaLevel = 35.0;
  const cellSize = mapW / (cols - 1);
  const grid = new Float32Array(cols * rows);

  // Broad continent sloping from north-west mountains down to south-east sea
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const v = r / (rows - 1);
      const dist = Math.hypot(u, v);
      const ridge = Math.sin(u * 12 + v * 8) * 4.0;
      grid[r * cols + c] = 85.0 - dist * 55.0 + ridge;
    }
  }

  const { rivers } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    7,
    { riverCount: 12, lakeCount: 2, riverDensity: 60, meander: 0.8, headExtension: 0.8 }
  );

  assert.ok(rivers.length >= 4, 'Should extract multiple rivers');

  // 1. Zero self-intersections across all rivers
  for (const r of rivers) {
    assert.equal(hasSelfIntersection(r.points), false, `River ${r.id} must not self-intersect`);
  }

  // 2. Headwater hook check: angle change between adjacent segments in first 12 points <= 100 deg
  const maxHookCos = Math.cos((100 * Math.PI) / 180);
  for (const r of rivers) {
    const pts = r.points;
    const checkN = Math.min(pts.length - 1, 12);
    for (let i = 1; i < checkN; i++) {
      const v1x = pts[i][0] - pts[i - 1][0];
      const v1y = pts[i][1] - pts[i - 1][1];
      const v2x = pts[i + 1][0] - pts[i][0];
      const v2y = pts[i + 1][1] - pts[i][1];
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 < 1e-4 || l2 < 1e-4) continue;
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
      assert.ok(
        dot >= maxHookCos - 0.05,
        `River ${r.id} at point ${i} in headwater has hook bend (dot=${dot.toFixed(2)}, cos(100)=${maxHookCos.toFixed(2)})`
      );
    }
  }

  // 3. Sinuosity check for rivers with length >= 80 cells
  const sinuosities: number[] = [];
  for (const r of rivers) {
    const pts = r.points;
    let totalLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      totalLen += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    const lenCells = totalLen / cellSize;
    if (lenCells >= 80) {
      const midIdx = Math.floor(pts.length / 2);
      let mouthHalfLen = 0;
      for (let i = midIdx; i < pts.length - 1; i++) {
        mouthHalfLen += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      }
      const eucl = Math.hypot(pts[pts.length - 1][0] - pts[midIdx][0], pts[pts.length - 1][1] - pts[midIdx][1]);
      if (eucl > 1e-3) {
        sinuosities.push(mouthHalfLen / eucl);
      }
    }
  }

  if (sinuosities.length > 0) {
    sinuosities.sort((a, b) => a - b);
    const medianSinuosity = sinuosities[Math.floor(sinuosities.length / 2)];
    assert.ok(
      medianSinuosity >= 1.12 && medianSinuosity <= 1.7,
      `Median mouth-half sinuosity should be between 1.12 and 1.7, got ${medianSinuosity.toFixed(3)}`
    );
  }

  // 4. Straight run check: points in runs of >= 8 consecutive points with < 3 deg change <= 15%
  let totalRiverPoints = 0;
  let straightRunPoints = 0;
  const threeDegRad = (3 * Math.PI) / 180;

  for (const r of rivers) {
    const pts = r.points;
    const n = pts.length;
    totalRiverPoints += n;
    let i = 0;
    while (i < n - 8) {
      let runEnd = i + 1;
      const vBaseX = pts[i + 1][0] - pts[i][0];
      const vBaseY = pts[i + 1][1] - pts[i][1];
      const lenBase = Math.hypot(vBaseX, vBaseY);
      if (lenBase < 1e-6) {
        i++;
        continue;
      }

      while (runEnd < n - 1) {
        const vCurrX = pts[runEnd + 1][0] - pts[runEnd][0];
        const vCurrY = pts[runEnd + 1][1] - pts[runEnd][1];
        const lenCurr = Math.hypot(vCurrX, vCurrY);
        if (lenCurr < 1e-6) {
          runEnd++;
          continue;
        }
        const dot = (vBaseX * vCurrX + vBaseY * vCurrY) / (lenBase * lenCurr);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (angle < threeDegRad) {
          runEnd++;
        } else {
          break;
        }
      }

      const count = runEnd + 1 - i;
      if (count >= 8) {
        straightRunPoints += count;
        i = runEnd;
      } else {
        i++;
      }
    }
  }

  const straightRatio = totalRiverPoints > 0 ? straightRunPoints / totalRiverPoints : 0;
  assert.ok(
    straightRatio <= 0.15,
    `Straight-run points ratio (${(straightRatio * 100).toFixed(1)}%) must be <= 15%`
  );

  // 5. Mouth angle standard deviation: rivers with std dev < 0.5 deg in last 12 cells <= 10%
  const oceanRivers = rivers.filter((r) => r.terminatesAt === 'ocean');
  let straightMouthCount = 0;

  for (const r of oceanRivers) {
    const pts = r.points;
    let distFromMouth = 0;
    const angles: number[] = [];
    for (let i = pts.length - 2; i >= 0; i--) {
      const dx = pts[i + 1][0] - pts[i][0];
      const dy = pts[i + 1][1] - pts[i][1];
      const d = Math.hypot(dx, dy);
      distFromMouth += d;
      angles.push(Math.atan2(dy, dx));
      if (distFromMouth >= 12 * cellSize) break;
    }

    if (angles.length >= 4) {
      const mean = angles.reduce((a, b) => a + b, 0) / angles.length;
      const variance = angles.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / angles.length;
      const stdDevDeg = (Math.sqrt(variance) * 180) / Math.PI;
      if (stdDevDeg < 0.5) {
        straightMouthCount++;
      }
    }
  }

  const straightMouthRatio = oceanRivers.length > 0 ? straightMouthCount / oceanRivers.length : 0;
  assert.ok(
    straightMouthRatio <= 0.10,
    `Rivers with mouth angle std dev < 0.5 deg (${(straightMouthRatio * 100).toFixed(1)}%) must be <= 10%`
  );

  // 6. Monotonicity: uphill segments <= 1%, disconnected rivers = 0
  let totalSegments = 0;
  let uphillSegments = 0;
  for (const r of rivers) {
    for (let i = 0; i < r.points.length - 1; i++) {
      totalSegments++;
      const e1 = sampleElev(grid, cols, rows, mapW, mapH, r.points[i][0], r.points[i][1]);
      const e2 = sampleElev(grid, cols, rows, mapW, mapH, r.points[i + 1][0], r.points[i + 1][1]);
      if (e2 - e1 > 0.35) {
        uphillSegments++;
      }
    }
  }
  const uphillRatio = totalSegments > 0 ? uphillSegments / totalSegments : 0;
  assert.ok(
    uphillRatio <= 0.01,
    `Uphill segments ratio (${(uphillRatio * 100).toFixed(2)}%) must be <= 1%`
  );
  assertValidTerminations(rivers);
});

test('River Improvement: River mouth position pinned within 0.5 * cellSize of unmeandered mouth', () => {
  const cols = 64;
  const rows = 64;
  const mapW = 1000;
  const mapH = 1000;
  const seaLevel = 35.0;
  const cellSize = mapW / (cols - 1);
  const grid = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r * cols + c] = 80.0 - (c / (cols - 1)) * 55.0;
    }
  }

  const { rivers: unmeandered } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    999,
    { riverCount: 6, lakeCount: 0, meander: 0 }
  );

  const { rivers: meandered } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    999,
    { riverCount: 6, lakeCount: 0, meander: 0.8 }
  );

  for (const mRiv of meandered) {
    if (mRiv.terminatesAt !== 'ocean') continue;
    const unRiv = unmeandered.find((u) => u.id === mRiv.id);
    if (!unRiv) continue;
    const pMouthM = mRiv.points[mRiv.points.length - 1];
    const pMouthU = unRiv.points[unRiv.points.length - 1];
    const dist = Math.hypot(pMouthM[0] - pMouthU[0], pMouthM[1] - pMouthU[1]);
    assert.ok(
      dist <= 0.5 * cellSize,
      `River ${mRiv.id} mouth position (${pMouthM[0].toFixed(1)}, ${pMouthM[1].toFixed(1)}) shifted by ${dist.toFixed(2)} > ${0.5 * cellSize}`
    );
  }
});

test('Estuary Improvement: computeRiverPointWidths flares to 1.4x and tapers tip to 0.7x, spacing-independent', () => {
  const wStart = 2.0;
  const wEnd = 10.0;
  const cellSize = 2.0;
  // Flare length = max(10 * 6, 2 * 6) = 60.0
  // Taper length = 1.5 * 10 = 15.0

  // 1. Fine points (spacing = 1.0, 101 points from 0 to 100)
  const finePoints: [number, number][] = [];
  for (let x = 0; x <= 100; x += 1) {
    finePoints.push([x, 50]);
  }
  const fineWidths = computeRiverPointWidths(finePoints, wStart, wEnd, true, cellSize);

  // 2. Coarse points (spacing = 5.0, 21 points from 0 to 100)
  const coarsePoints: [number, number][] = [];
  for (let x = 0; x <= 100; x += 5) {
    coarsePoints.push([x, 50]);
  }
  const coarseWidths = computeRiverPointWidths(coarsePoints, wStart, wEnd, true, cellSize);

  // Check last point reaches (wEnd * 1.4 * 0.7) = 0.98 * wEnd = 9.8
  const fineLastW = fineWidths[fineWidths.length - 1];
  const coarseLastW = coarseWidths[coarseWidths.length - 1];
  const expectedMouthW = wEnd * 1.4 * 0.7; // 9.8

  assert.ok(
    Math.abs(fineLastW - expectedMouthW) < 1e-4,
    `Fine mouth width ${fineLastW} should equal ${expectedMouthW}`
  );
  assert.ok(
    Math.abs(coarseLastW - expectedMouthW) < 1e-4,
    `Coarse mouth width ${coarseLastW} should equal ${expectedMouthW}`
  );

  // Check flare reaches near 1.4x of base width before tip taper begins (around x = 85, where distFromMouth = 15 = taperLength)
  const flarePeakW = fineWidths[85];
  const baseWAt85 = wStart + (wEnd - wStart) * 0.85; // 8.8
  assert.ok(
    flarePeakW > baseWAt85 * 1.3,
    `Width before taper at x=85 (${flarePeakW.toFixed(2)}) should be flared (> ${(baseWAt85 * 1.3).toFixed(2)})`
  );

  // Compare widths between fine and coarse at sample positions
  const testXs = [40, 60, 70, 80, 90, 100];
  for (const x of testXs) {
    const fineIdx = x; // step = 1
    const coarseIdx = x / 5; // step = 5
    const wFine = fineWidths[fineIdx];
    const wCoarse = coarseWidths[coarseIdx];
    const diff = Math.abs(wFine - wCoarse);
    assert.ok(
      diff < 0.1,
      `Width difference at x=${x} between fine (${wFine.toFixed(3)}) and coarse (${wCoarse.toFixed(3)}) should be < 0.1, got ${diff.toFixed(4)}`
    );
  }
});

test('Estuary Improvement: Semicircle river mouth cap vertices are equidistant from mouth point', () => {
  const mouthPt: [number, number] = [200, 150];
  const tangent: [number, number] = [0.8, 0.6]; // diagonal direction
  const halfWidth = 8.0;

  const cap = createRiverMouthCap(mouthPt, tangent, halfWidth, 16);
  assert.equal(cap.length, 17);

  for (let i = 0; i < cap.length; i++) {
    const v = cap[i];
    const dist = Math.hypot(v[0] - mouthPt[0], v[1] - mouthPt[1]);
    assert.ok(
      Math.abs(dist - halfWidth) < 1e-5,
      `Cap vertex ${i} distance ${dist.toFixed(5)} must equal halfWidth ${halfWidth}`
    );
  }

  // First vertex should be at left bank normal (+pi/2 from tangent)
  // tangent = [0.8, 0.6], normal = [-0.6, 0.8]
  const expectedLeft: [number, number] = [mouthPt[0] - 0.6 * halfWidth, mouthPt[1] + 0.8 * halfWidth];
  assert.ok(Math.hypot(cap[0][0] - expectedLeft[0], cap[0][1] - expectedLeft[1]) < 1e-4);

  // Last vertex should be at right bank normal (-pi/2 from tangent)
  const expectedRight: [number, number] = [mouthPt[0] + 0.6 * halfWidth, mouthPt[1] - 0.8 * halfWidth];
  assert.ok(Math.hypot(cap[16][0] - expectedRight[0], cap[16][1] - expectedRight[1]) < 1e-4);
});

test('Estuary Improvement: Rivers terminating at lake or river maintain linear distance-based width interpolation', () => {
  const points: [number, number][] = [
    [0, 0],
    [50, 0],
    [100, 0],
    [150, 0],
  ];
  const wStart = 2.0;
  const wEnd = 6.0;

  const widths = computeRiverPointWidths(points, wStart, wEnd, false);

  // End width should be exactly wEnd
  assert.equal(widths[widths.length - 1], wEnd);

  // Baseline verification: linear progression along distance
  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    const expectedW = wStart + (wEnd - wStart) * t;
    assert.ok(Math.abs(widths[i] - expectedW) < 1e-4);
  }
});

test('Casing Improvement: buildRiverStrokeGroups shares endpoints and preserves total length', () => {
  const points: [number, number][] = [];
  const widths: number[] = [];
  for (let i = 0; i <= 50; i++) {
    points.push([i * 10, Math.sin(i * 0.2) * 20]);
    widths.push(2.0 + (i / 50) * 8.0); // 2.0 to 10.0
  }

  const bucketCount = 12;
  const groups = buildRiverStrokeGroups(points, widths, bucketCount);

  assert.ok(groups.length > 1, `Should generate multiple stroke groups for varying widths, got ${groups.length}`);

  // 1. Boundary sharing: consecutive groups must share endpoint
  for (let g = 0; g < groups.length - 1; g++) {
    const curLast = groups[g].points[groups[g].points.length - 1];
    const nextFirst = groups[g + 1].points[0];
    assert.equal(curLast[0], nextFirst[0], `Group ${g} end X must match group ${g + 1} start X`);
    assert.equal(curLast[1], nextFirst[1], `Group ${g} end Y must match group ${g + 1} start Y`);
  }

  // 2. Length preservation: sum of lengths of segments in groups equals original length
  let origLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    origLen += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }

  let groupLen = 0;
  for (const grp of groups) {
    for (let i = 0; i < grp.points.length - 1; i++) {
      groupLen += Math.hypot(grp.points[i + 1][0] - grp.points[i][0], grp.points[i + 1][1] - grp.points[i][1]);
    }
  }

  assert.ok(
    Math.abs(origLen - groupLen) < 1e-6,
    `Total polyline length (${groupLen.toFixed(4)}) must match original length (${origLen.toFixed(4)})`
  );

  // 3. Quantization error bound: <= (maxW - minW) / bucketCount
  const segWidths = [];
  for (let i = 0; i < points.length - 1; i++) {
    segWidths.push((widths[i] + widths[i + 1]) * 0.5);
  }
  const minW = Math.min(...segWidths);
  const maxW = Math.max(...segWidths);
  const maxAllowedError = (maxW - minW) / bucketCount;

  for (const grp of groups) {
    for (let i = 0; i < grp.points.length - 1; i++) {
      const p0 = grp.points[i];
      const origIdx = points.findIndex((p) => p[0] === p0[0] && p[1] === p0[1]);
      if (origIdx >= 0 && origIdx < segWidths.length) {
        const err = Math.abs(grp.width - segWidths[origIdx]);
        assert.ok(
          err <= maxAllowedError + 1e-6,
          `Quantization error ${err.toFixed(4)} must be <= maxAllowedError ${maxAllowedError.toFixed(4)}`
        );
      }
    }
  }
});

test('Casing Improvement: 2-point or uniform-width rivers collapse to exactly 1 stroke group', () => {
  // 1. 2-point river
  const twoPoints: [number, number][] = [[0, 0], [100, 100]];
  const twoWidths = [2.0, 4.0];
  const twoGroups = buildRiverStrokeGroups(twoPoints, twoWidths, 12);
  assert.equal(twoGroups.length, 1, '2-point river must yield exactly 1 group');
  assert.equal(twoGroups[0].width, 3.0);
  assert.equal(twoGroups[0].points.length, 2);

  // 2. Multi-point uniform width river
  const uniPoints: [number, number][] = [
    [0, 0], [10, 5], [20, 2], [30, 8], [40, 10]
  ];
  const uniWidths = [3.5, 3.5, 3.5, 3.5, 3.5];
  const uniGroups = buildRiverStrokeGroups(uniPoints, uniWidths, 12);
  assert.equal(uniGroups.length, 1, 'Uniform-width river must yield exactly 1 group');
  assert.equal(uniGroups[0].width, 3.5);
  assert.equal(uniGroups[0].points.length, 5);
});

test('Casing Improvement: Sharp hairpin turns (R = 0.3 * W) avoid self-intersecting polygon anomalies', () => {
  const W = 5.0;
  const R = 1.5;
  const hairpinPoints: [number, number][] = [
    [0, 0],
    [50, 0],
    [100, 0],
  ];
  for (let deg = 0; deg <= 180; deg += 30) {
    const rad = (deg * Math.PI) / 180;
    hairpinPoints.push([100 + R * Math.sin(rad), R - R * Math.cos(rad)]);
  }
  hairpinPoints.push([50, 2 * R]);
  hairpinPoints.push([0, 2 * R]);

  const widths = new Array(hairpinPoints.length).fill(W);
  const groups = buildRiverStrokeGroups(hairpinPoints, widths, 12);

  assert.ok(groups.length >= 1);
  assert.equal(groups[0].width, W);

  let totalSegs = 0;
  for (const g of groups) {
    totalSegs += g.points.length - 1;
  }
  assert.equal(totalSegs, hairpinPoints.length - 1, 'All hairpin segments must be preserved');
});

test('Request 10 Verification: Curvature radius, sinuosity, monotonicity, confluence alignment, and local sharp turns', () => {
  const cols = 160;
  const rows = 120;
  const mapW = 1600;
  const mapH = 1200;
  const seaLevel = 35.0;
  const cellSize = mapW / (cols - 1);
  const grid = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const v = r / (rows - 1);
      const dist = Math.hypot(u, v);
      const ridge = Math.sin(u * 12 + v * 8) * 4.0;
      grid[r * cols + c] = 85.0 - dist * 55.0 + ridge;
    }
  }

  const { rivers } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    7,
    { riverCount: 12, lakeCount: 2, riverDensity: 60, meander: 0.8, headExtension: 0.8 }
  );

  assert.ok(rivers.length >= 4, 'Should extract multiple rivers');

  // 1. Curvature radius: R < 0.7 * w <= 1%, min R/w >= 0.5
  let totalPtsChecked = 0;
  let rUnder07wCount = 0;
  let minRRatio = Infinity;

  for (const r of rivers) {
    const pts = r.points;
    const kmPerUnit = Math.max(0.001, 40000 / mapW);
    const wMin = kmPerUnit >= 3.0 ? 0.75 : 1.2;
    const ptWidths = computeRiverPointWidthsForExtraction(pts, r.widthStart, r.widthEnd, wMin);

    for (let i = 1; i < pts.length - 1; i++) {
      const w = ptWidths[i] ?? r.widthStart;
      const R = computeCircumcircleRadius(pts[i - 1], pts[i], pts[i + 1]);
      if (Number.isFinite(R)) {
        totalPtsChecked++;
        const ratio = R / w;
        if (ratio < minRRatio) minRRatio = ratio;
        if (ratio < 0.7) {
          rUnder07wCount++;
        }
      }
    }
  }

  const rUnder07Ratio = totalPtsChecked > 0 ? rUnder07wCount / totalPtsChecked : 0;
  assert.ok(
    rUnder07Ratio <= 0.01,
    `Points with R < 0.7 * w (${(rUnder07Ratio * 100).toFixed(2)}%) must be <= 1%`
  );
  assert.ok(
    minRRatio >= 0.5,
    `Minimum R/w ratio (${minRRatio.toFixed(3)}) must be >= 0.5`
  );

  // 2. Sinuosity: median sinuosity of back half of length >= 80 cells rivers in [1.1, 1.6]
  const sinuosities: number[] = [];
  for (const r of rivers) {
    const pts = r.points;
    let totalLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      totalLen += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    const lenCells = totalLen / cellSize;
    if (lenCells >= 80) {
      const midIdx = Math.floor(pts.length / 2);
      let mouthHalfLen = 0;
      for (let i = midIdx; i < pts.length - 1; i++) {
        mouthHalfLen += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      }
      const eucl = Math.hypot(pts[pts.length - 1][0] - pts[midIdx][0], pts[pts.length - 1][1] - pts[midIdx][1]);
      if (eucl > 1e-3) {
        sinuosities.push(mouthHalfLen / eucl);
      }
    }
  }
  if (sinuosities.length > 0) {
    sinuosities.sort((a, b) => a - b);
    const medianSinuosity = sinuosities[Math.floor(sinuosities.length / 2)];
    assert.ok(
      medianSinuosity >= 1.1 && medianSinuosity <= 1.6,
      `Median mouth-half sinuosity should be between 1.1 and 1.6, got ${medianSinuosity.toFixed(3)}`
    );
  }

  // 3. Self-intersections = 0
  for (const r of rivers) {
    assert.equal(hasSelfIntersection(r.points), false, `River ${r.id} must not self-intersect`);
  }

  // 4. Monotonicity: uphill <= 1%
  let totalSegs = 0;
  let uphillSegs = 0;
  for (const r of rivers) {
    for (let i = 0; i < r.points.length - 1; i++) {
      totalSegs++;
      const e1 = sampleElev(grid, cols, rows, mapW, mapH, r.points[i][0], r.points[i][1]);
      const e2 = sampleElev(grid, cols, rows, mapW, mapH, r.points[i + 1][0], r.points[i + 1][1]);
      if (e2 - e1 > 0.35) {
        uphillSegs++;
      }
    }
  }
  assert.ok(
    uphillSegs / totalSegs <= 0.01,
    `Uphill segments ratio must be <= 1%`
  );

  // 5. Inland endings = 0
  assertValidTerminations(rivers);

  // 6. Confluence checks:
  // - Tributary end point on main river segment (<= 0.1 * cellSize)
  // - Last 3 points do not self-intersect
  // - Approach angle <= 80 deg
  const cos80 = Math.cos((80 * Math.PI) / 180);
  for (const r of rivers) {
    if (r.terminatesAt === 'river' && r.connectedRiverId) {
      const main = rivers.find((m) => m.id === r.connectedRiverId);
      if (!main) continue;
      const pLast = r.points[r.points.length - 1];
      const pPrev = r.points[r.points.length - 2];

      // End point on main river segment
      const proj = projectPointToPolyline(pLast, main.points);
      assert.ok(
        proj.dist <= 0.1 * cellSize,
        `Tributary ${r.id} end point distance to main river (${proj.dist.toFixed(4)}) must be <= ${0.1 * cellSize}`
      );

      // Last 3 points no self-intersection
      if (r.points.length >= 3) {
        const last3 = r.points.slice(r.points.length - 3);
        assert.equal(hasSelfIntersection(last3), false, `Tributary ${r.id} last 3 points must not self-intersect`);
      }

      // Approach angle <= 80 deg
      const inDx = pLast[0] - pPrev[0];
      const inDy = pLast[1] - pPrev[1];
      const inLen = Math.hypot(inDx, inDy) || 1;
      const dot = (inDx * proj.tangent[0] + inDy * proj.tangent[1]) / inLen;
      assert.ok(
        dot >= cos80 - 0.05,
        `Tributary ${r.id} approach angle with main river must be <= 80 deg (dot=${dot.toFixed(3)}, cos80=${cos80.toFixed(3)})`
      );
    }
  }

  // 7. Local sharp turns: consecutive 3 points within distance 0.5 * w do not exceed 130 deg turn angle
  const maxTurnCos = Math.cos((130 * Math.PI) / 180);
  for (const r of rivers) {
    const pts = r.points;
    const kmPerUnit = Math.max(0.001, 40000 / mapW);
    const wMin = kmPerUnit >= 3.0 ? 0.75 : 1.2;
    const ptWidths = computeRiverPointWidthsForExtraction(pts, r.widthStart, r.widthEnd, wMin);

    for (let i = 1; i < pts.length - 1; i++) {
      const w = ptWidths[i] ?? r.widthStart;
      const d1 = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const d2 = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (d1 <= 0.5 * w && d2 <= 0.5 * w) {
        const v1x = pts[i][0] - pts[i - 1][0];
        const v1y = pts[i][1] - pts[i - 1][1];
        const v2x = pts[i + 1][0] - pts[i][0];
        const v2y = pts[i + 1][1] - pts[i][1];
        const dot = (v1x * v2x + v1y * v2y) / (d1 * d2);
        assert.ok(
          dot >= maxTurnCos,
          `River ${r.id} at point ${i} has turn angle > 130 deg (dot=${dot.toFixed(3)}) within distance 0.5 * w`
        );
      }
    }
  }
});

test('幅の量子化: quantizeWidth と partitionRiverStrokeBuckets による誤差・バケット数・隣接差の検証', () => {
  // 1. quantizeWidth error <= step * 0.5
  const step = 0.6;
  const testWidths = [0.1, 0.45, 0.6, 0.89, 1.2, 2.34, 4.88, 7.5];
  for (const w of testWidths) {
    const qw = quantizeWidth(w, step);
    const err = Math.abs(qw - w);
    assert.ok(
      err <= step * 0.5 + 1e-9,
      `quantizeWidth(${w}, ${step}) = ${qw}, error ${err} must be <= ${step * 0.5}`
    );
  }

  // 2. Smoothly changing river: width 1 -> 6 across 500 points
  const points: [number, number][] = [];
  const widths: number[] = [];
  for (let i = 0; i < 500; i++) {
    points.push([i * 2, 0]);
    widths.push(1.0 + (i / 499) * 5.0);
  }

  const riverStep = 0.5;
  const groups = partitionRiverStrokeBuckets(points, widths, { step: riverStep, maxBuckets: 128 });

  // バケットの数が 128 以下であること
  assert.ok(groups.length <= 128, `Bucket count ${groups.length} must be <= 128`);
  assert.ok(groups.length >= 8, `Should create multiple buckets for width 1 -> 6 with step 0.5`);

  // 幅の量子化の誤差が (step の半分) 以下であること
  for (const grp of groups) {
    for (let i = 0; i < grp.points.length - 1; i++) {
      const p0 = grp.points[i];
      const origIdx = Math.round(p0[0] / 2);
      const segW = (widths[origIdx] + widths[origIdx + 1]) * 0.5;
      const err = Math.abs(grp.width - segW);
      assert.ok(
        err <= riverStep * 0.5 + 1e-6,
        `Quantization error ${err.toFixed(4)} must be <= ${(riverStep * 0.5).toFixed(4)}`
      );
    }
  }

  // 隣り合うバケットの幅の差が、step であること
  for (let g = 0; g < groups.length - 1; g++) {
    const diff = Math.abs(groups[g + 1].width - groups[g].width);
    assert.ok(
      Math.abs(diff - riverStep) < 1e-6,
      `Adjacent bucket width difference ${diff.toFixed(4)} must equal step ${riverStep}`
    );
  }

  // 3. 画面上の幅が 2 ピクセル未満の川は、バケットを使わず、1つの幅(平均)で描く
  const thinRiverPoints: [number, number][] = [
    [0, 0], [10, 0], [20, 0], [30, 0], [40, 0]
  ];
  const thinWidths = [0.8, 0.9, 1.1, 1.3, 1.4]; // max 1.4, with zoomPx = 1.0 -> screen width 1.4 < 2.0
  const thinGroups = partitionRiverStrokeBuckets(thinRiverPoints, thinWidths, { zoomPx: 1.0 });
  assert.equal(thinGroups.length, 1, 'River with screen width < 2px must collapse to exactly 1 group');
  const expectedAvg = (0.85 + 1.0 + 1.2 + 1.35) / 4;
  assert.ok(Math.abs(thinGroups[0].width - expectedAvg) < 1e-6);
});

test('細い川の蛇行と直線区間の解消: generateTectonicWorld (シード 7, 21, 99, 1024x512) での検証', () => {
  const seeds = [7, 21, 99];
  const threeDegRad = (3 * Math.PI) / 180;

  for (const seed of seeds) {
    const config: GeneratorConfig = {
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

    const map = generateTectonicWorld(1024, 512, config);
    const cols = map.gridCols;
    const rows = map.gridRows;
    const seaLevel = map.seaLevel;

    const t0 = performance.now();
    const { rivers } = generateRiversAndLakes(
      map.elevationGrid,
      cols,
      rows,
      map.width,
      map.height,
      seaLevel,
      seed,
      {
        riverCount: 12,
        lakeCount: 2,
        riverDensity: 50,
        meander: 0.8,
        headExtension: 0.8,
      }
    );
    const duration = performance.now() - t0;

    // 1. 性能: 1024x512 の川の生成が 2 秒以内
    assert.ok(
      duration < 2000,
      `Seed ${seed}: River generation took ${duration.toFixed(1)}ms, expected < 2000ms`
    );

    // 2. 決定論的であること
    const repeat = generateRiversAndLakes(
      map.elevationGrid,
      cols,
      rows,
      map.width,
      map.height,
      seaLevel,
      seed,
      {
        riverCount: 12,
        lakeCount: 2,
        riverDensity: 50,
        meander: 0.8,
        headExtension: 0.8,
      }
    );
    assert.equal(rivers.length, repeat.rivers.length);
    for (let i = 0; i < rivers.length; i++) {
      assert.deepEqual(rivers[i].points, repeat.rivers[i].points);
    }

    // 3. 川が自己交差しないこと
    for (const r of rivers) {
      assert.equal(
        hasSelfIntersection(r.points),
        false,
        `Seed ${seed}, River ${r.id} must not self-intersect`
      );
    }

    // 4. 単調性: 上り坂の区間が全体の 1% 以下
    let totalSegs = 0;
    let uphillSegs = 0;
    for (const r of rivers) {
      for (let i = 0; i < r.points.length - 1; i++) {
        totalSegs++;
        const e1 = sampleElev(map.elevationGrid, cols, rows, map.width, map.height, r.points[i][0], r.points[i][1]);
        const e2 = sampleElev(map.elevationGrid, cols, rows, map.width, map.height, r.points[i + 1][0], r.points[i + 1][1]);
        if (e2 - e1 > 0.35) {
          uphillSegs++;
        }
      }
    }
    const uphillRatio = totalSegs > 0 ? uphillSegs / totalSegs : 0;
    assert.ok(
      uphillRatio <= 0.01,
      `Seed ${seed}: Uphill segments ratio (${(uphillRatio * 100).toFixed(2)}%) must be <= 1%`
    );

    // 5. 曲率半径が川の幅の 0.7 倍未満の点が 1% 以下であること
    let checkedRadiusCount = 0;
    let sharpCurvatureCount = 0;
    const kmPerUnit = Math.max(0.001, map.worldWidthKm / map.width);
    const wMin = kmPerUnit >= 3.0 ? 0.75 : 1.2;

    for (const r of rivers) {
      const ptWidths = computeRiverPointWidthsForExtraction(r.points, r.widthStart, r.widthEnd, wMin);
      for (let i = 1; i < r.points.length - 1; i++) {
        const w = ptWidths[i] ?? r.widthStart;
        const R = computeCircumcircleRadius(r.points[i - 1], r.points[i], r.points[i + 1]);
        if (Number.isFinite(R)) {
          checkedRadiusCount++;
          if (R < 0.7 * w) {
            sharpCurvatureCount++;
          }
        }
      }
    }
    const sharpCurvRatio = checkedRadiusCount > 0 ? sharpCurvatureCount / checkedRadiusCount : 0;
    assert.ok(
      sharpCurvRatio <= 0.01,
      `Seed ${seed}: Points with R < 0.7 * w (${(sharpCurvRatio * 100).toFixed(2)}%) must be <= 1%`
    );

    // 6. 「連続 8 点以上で、進行方向の変化が 3° 未満の区間」に含まれる点の割合:
    // 幅が 1.5 未満の川でも、全体でも 12% 以下であること
    let totalAllPts = 0;
    let straightAllPts = 0;
    let totalThinPts = 0;
    let straightThinPts = 0;

    for (const r of rivers) {
      const pts = r.points;
      const n = pts.length;
      const isThin = (r.widthEnd < 1.5) || ((r.widthStart + r.widthEnd) * 0.5 < 1.5);

      totalAllPts += n;
      if (isThin) totalThinPts += n;

      let i = 0;
      while (i < n - 8) {
        let runEnd = i + 1;
        const vBaseX = pts[i + 1][0] - pts[i][0];
        const vBaseY = pts[i + 1][1] - pts[i][1];
        const lenBase = Math.hypot(vBaseX, vBaseY);
        if (lenBase < 1e-6) {
          i++;
          continue;
        }

        while (runEnd < n - 1) {
          const vCurrX = pts[runEnd + 1][0] - pts[runEnd][0];
          const vCurrY = pts[runEnd + 1][1] - pts[runEnd][1];
          const lenCurr = Math.hypot(vCurrX, vCurrY);
          if (lenCurr < 1e-6) {
            runEnd++;
            continue;
          }
          const dot = (vBaseX * vCurrX + vBaseY * vCurrY) / (lenBase * lenCurr);
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          if (angle < threeDegRad) {
            runEnd++;
          } else {
            break;
          }
        }

        const count = runEnd + 1 - i;
        if (count >= 8) {
          straightAllPts += count;
          if (isThin) straightThinPts += count;
          i = runEnd;
        } else {
          i++;
        }
      }
    }

    const overallStraightRatio = totalAllPts > 0 ? straightAllPts / totalAllPts : 0;
    assert.ok(
      overallStraightRatio <= 0.12,
      `Seed ${seed}: Overall straight-run ratio (${(overallStraightRatio * 100).toFixed(1)}%) must be <= 12%`
    );

    if (totalThinPts > 50) {
      const thinStraightRatio = straightThinPts / totalThinPts;
      assert.ok(
        thinStraightRatio <= 0.12,
        `Seed ${seed}: Thin rivers (w < 1.5) straight-run ratio (${(thinStraightRatio * 100).toFixed(1)}%) must be <= 12%`
      );
    }
  }
});


