import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRiversAndLakes,
  createOrganicLake,
  pointInLake,
  smoothRiverPath,
} from './waterGenerator';
import {
  distanceToRiver,
  findNearestRiverVertex,
  findNearestLakeVertex,
  findWaterAtPoint,
} from './waterRenderer';
import { createTerrainWaterSampler } from './town/townSample';
import { RiverData, LakeData } from '../types/water';

test('creates an organic closed lake polygon', () => {
  const lake = createOrganicLake(100, 100, 30, 12345);
  assert.ok(lake.length > 10);
  // Center point should be inside the lake
  assert.equal(pointInLake(100, 100, lake), true);
  // Point far away should be outside
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

test('generates rivers and lakes from downhill elevation gradient', () => {
  const cols = 64;
  const rows = 32;
  const grid = new Float32Array(cols * rows);
  const seaLevel = 35.0;

  // Mountain in top-left (elevation 80) sloping down to ocean in bottom-right (elevation 20)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const v = r / (rows - 1);
      grid[r * cols + c] = 80 - (u + v) * 35;
    }
  }

  const { rivers, lakes } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    1000,
    500,
    seaLevel,
    9999,
    { riverCount: 4, lakeCount: 2 }
  );

  assert.ok(Array.isArray(rivers));
  assert.ok(Array.isArray(lakes));
  if (rivers.length > 0) {
    assert.ok(rivers[0].points.length > 1);
    assert.ok(rivers[0].widthStart > 0);
    assert.ok(rivers[0].widthEnd > 0);
  }
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

  // Exactly on line
  const onLine = distanceToRiver(150, 100, river);
  assert.equal(onLine.distance, 0);

  // 4 units away (within half-width 5) -> effective distance 0
  const nearLine = distanceToRiver(150, 104, river);
  assert.equal(nearLine.distance, 0);

  // 12 units away (outside half-width 5) -> effective distance ~7
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
  const grid = new Float32Array(10 * 10).fill(50.0); // high elevation land
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

  // On river
  assert.equal(sampler.isWater(50, 10), true);
  // Inside lake
  assert.equal(sampler.isWater(50, 50), true);
  // On normal land far from river/lake
  assert.equal(sampler.isWater(10, 90), false);
});

test('lake generation strictly constrains diameter to under 100km on world scale', () => {
  const cols = 80;
  const rows = 40;
  const grid = new Float32Array(cols * rows);
  const seaLevel = 35.0;
  const worldWidthKm = 40000;
  const mapW = 2000;
  const mapH = 1000;

  // Broad inland continent: center is elevated plateau with gentle depressions
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = (c / (cols - 1)) * 2 - 1;
      const v = (r / (rows - 1)) * 2 - 1;
      const dist = Math.hypot(u, v);
      if (dist < 0.6) {
        // High land with small dip at (35, 20)
        const dBasin = Math.hypot(c - 35, r - 20);
        grid[r * cols + c] = 55.0 + Math.min(10, dBasin * 0.8);
      } else {
        grid[r * cols + c] = 20.0; // Ocean
      }
    }
  }

  const { lakes } = generateRiversAndLakes(
    grid,
    cols,
    rows,
    mapW,
    mapH,
    seaLevel,
    12345,
    { lakeCount: 3, enableRivers: false, worldWidthKm }
  );

  const kmPerUnit = worldWidthKm / mapW; // 20 km/unit
  for (const lake of lakes) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of lake.polygon) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const widthKm = (maxX - minX) * kmPerUnit;
    const heightKm = (maxY - minY) * kmPerUnit;
    const maxDimKm = Math.max(widthKm, heightKm);

    // Assert lake diameter strictly does NOT exceed 100km
    assert.ok(maxDimKm < 100, `Lake ${lake.name} diameter ${maxDimKm.toFixed(1)}km exceeds 100km limit!`);

    // Assert all lake vertices are comfortably on land (> seaLevel)
    for (const [px, py] of lake.polygon) {
      const gx = Math.round((px / mapW) * (cols - 1));
      const gy = Math.round((py / mapH) * (rows - 1));
      const e = grid[gy * cols + gx];
      assert.ok(e > seaLevel, `Lake vertex at (${px}, ${py}) with elev ${e} clipped into ocean!`);
    }
  }
});

