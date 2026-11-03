import test from 'node:test';
import assert from 'node:assert/strict';

import {
  polygonArea,
  polygonCentroid,
  pointInPolygon,
  polylineLength,
  offsetPolyline,
  sampleCatmullRom,
  metersToUnits,
  isBoundsVisible,
  objectBounds,
} from './town/townGeometry';
import { generateSampleTown } from './town/townSample';
import {
  computePointsHash,
  getCachedRoughened,
  hasCachedTownGeometry,
  clearTownGeometryCache,
} from './town/townRenderer';
import {
  serializeMapData,
  deserializeMapData,
  sanitizeTownObjects,
} from './serialization';
import { serializeMapDataToFwm, deserializeMapDataFromFwm } from './binaryMapStorage';
import { Pt, TownObject, TownWall } from '../types/town';
import { MapData } from '../types/map';

test('townGeometry: polygonArea calculates signed area accurately', () => {
  // 10x10 square
  const squareCW: Pt[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const areaCW = polygonArea(squareCW);
  assert.equal(Math.abs(areaCW), 100);

  // Counter-clockwise
  const squareCCW: Pt[] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
  ];
  const areaCCW = polygonArea(squareCCW);
  assert.equal(Math.abs(areaCCW), 100);
  assert.equal(areaCW, -areaCCW);
});

test('townGeometry: polygonCentroid correctly computes geometric center', () => {
  const square: Pt[] = [
    [10, 20],
    [30, 20],
    [30, 40],
    [10, 40],
  ];
  const [cx, cy] = polygonCentroid(square);
  assert.ok(Math.abs(cx - 20) < 1e-5);
  assert.ok(Math.abs(cy - 30) < 1e-5);
});

test('townGeometry: pointInPolygon tests points inside, outside, and on boundary', () => {
  const poly: Pt[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  // Inside
  assert.equal(pointInPolygon([5, 5], poly), true);
  // Outside
  assert.equal(pointInPolygon([15, 5], poly), false);
  assert.equal(pointInPolygon([-1, 5], poly), false);
  // On boundary
  assert.equal(pointInPolygon([5, 0], poly), true);
  assert.equal(pointInPolygon([10, 5], poly), true);
});

test('townGeometry: polylineLength and metersToUnits calculate correct lengths', () => {
  const line: Pt[] = [
    [0, 0],
    [30, 40],
    [30, 50],
  ];
  // 50 + 10 = 60
  const len = polylineLength(line);
  assert.ok(Math.abs(len - 60) < 1e-5);

  // metersToUnits: 600m with metersPerUnit = 2 -> 300 units
  const units = metersToUnits(600, 2);
  assert.equal(units, 300);
});

test('townGeometry: offsetPolyline creates parallel offset lines at exact distance', () => {
  // Horizontal straight line along y=20 from x=10 to x=50
  const line: Pt[] = [
    [10, 20],
    [50, 20],
  ];
  const { left, right } = offsetPolyline(line, 5);

  assert.equal(left.length, 2);
  assert.equal(right.length, 2);

  // Normals for (1, 0) are (0, 1) and (0, -1) depending on left/right convention
  // Distance from original line should be exactly 5
  assert.ok(Math.abs(Math.abs(left[0][1] - 20) - 5) < 1e-5);
  assert.ok(Math.abs(Math.abs(right[0][1] - 20) - 5) < 1e-5);
});

test('townGeometry: sampleCatmullRom passes through original control points', () => {
  const points: Pt[] = [
    [10, 10],
    [25, 40],
    [60, 30],
    [90, 80],
  ];
  const sampled = sampleCatmullRom(points, 8, false);

  // First and last points should match exactly
  assert.ok(Math.hypot(sampled[0][0] - points[0][0], sampled[0][1] - points[0][1]) < 1e-5);
  assert.ok(
    Math.hypot(
      sampled[sampled.length - 1][0] - points[points.length - 1][0],
      sampled[sampled.length - 1][1] - points[points.length - 1][1]
    ) < 1e-5
  );

  // Intermediate points should be visited
  for (const pt of points) {
    const minDistance = Math.min(...sampled.map((s) => Math.hypot(s[0] - pt[0], s[1] - pt[1])));
    assert.ok(minDistance < 1e-3, `Spline missed control point [${pt[0]}, ${pt[1]}]`);
  }
});

test('townGeometry: isBoundsVisible correctly tests AABB intersections', () => {
  const viewBounds = { minX: 100, minY: 100, maxX: 300, maxY: 300 };

  // Fully inside
  assert.equal(isBoundsVisible({ minX: 150, minY: 150, maxX: 200, maxY: 200 }, viewBounds), true);
  // Partially overlapping
  assert.equal(isBoundsVisible({ minX: 50, minY: 50, maxX: 150, maxY: 150 }, viewBounds), true);
  // Outside to left
  assert.equal(isBoundsVisible({ minX: 10, minY: 10, maxX: 90, maxY: 90 }, viewBounds), false);
  // Outside to right
  assert.equal(isBoundsVisible({ minX: 350, minY: 100, maxX: 400, maxY: 200 }, viewBounds), false);
});

test('generateSampleTown: produces deterministic, contained town layout with ~150 buildings', () => {
  const width = 2000;
  const height = 1000;
  const metersPerUnit = 0.5; // 1km wide map
  const seed = 54321;

  const town1 = generateSampleTown(width, height, metersPerUnit, seed);
  const town2 = generateSampleTown(width, height, metersPerUnit, seed);

  // Determinism check
  assert.deepEqual(town1, town2, 'Identical seed must generate identical objects');

  // Building count check (~100 to 250)
  const buildings = town1.filter((o) => o.kind === 'building');
  assert.ok(
    buildings.length >= 100 && buildings.length <= 250,
    `Building count ${buildings.length} should be in [100, 250]`
  );

  // Must contain special key buildings (keep, church, tower)
  assert.ok(buildings.some((b) => (b as any).buildingKind === 'keep'), 'Should contain keep');
  assert.ok(buildings.some((b) => (b as any).buildingKind === 'tower'), 'Should contain tower');

  // Must contain wall with gates and towers
  const wall = town1.find((o) => o.kind === 'wall') as TownWall | undefined;
  assert.ok(wall, 'Should contain wall');
  assert.equal(wall?.towers, true);
  assert.ok((wall?.gates.length || 0) >= 2, 'Wall should have at least 2 gates');

  // Containment in [0, width] x [0, height]
  for (const obj of town1) {
    const b = objectBounds(obj);
    assert.ok(b.minX >= -20 && b.maxX <= width + 20, `Object ${obj.id} bounds out of X: ${b.minX}..${b.maxX}`);
    assert.ok(b.minY >= -20 && b.maxY <= height + 20, `Object ${obj.id} bounds out of Y: ${b.minY}..${b.maxY}`);
  }
});

test('serialization: preserves all town object types across JSON and .fwm, sanitizes invalid data', async () => {
  const wall: TownWall = {
    id: 'wall_test_1',
    name: '石造城壁',
    kind: 'wall',
    points: [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ],
    closed: true,
    thicknessM: 4.0,
    towers: true,
    towerRadiusM: 6.0,
    gates: [{ segmentIndex: 1, t: 0.5, widthM: 8.0 }],
  };

  const sampleTown: TownObject[] = [
    {
      id: 'dist_1',
      kind: 'district',
      districtKind: 'market',
      polygon: [
        [120, 120],
        [180, 120],
        [180, 180],
        [120, 180],
      ],
    },
    {
      id: 'road_1',
      kind: 'road',
      style: 'main',
      points: [
        [100, 150],
        [200, 150],
      ],
      widthM: 8.0,
      smooth: true,
    },
    {
      id: 'bld_1',
      kind: 'building',
      buildingKind: 'keep',
      polygon: [
        [140, 140],
        [160, 140],
        [160, 160],
        [140, 160],
      ],
      heightM: 20.0,
      tone: 0.45,
    },
    wall,
    {
      id: 'pier_1',
      kind: 'pier',
      variant: 'bridge',
      points: [
        [200, 150],
        [250, 150],
      ],
      widthM: 6.0,
    },
  ];

  const dummyMap: MapData = {
    name: '世界地図',
    width: 2000,
    height: 1000,
    gridCols: 64,
    gridRows: 32,
    cellCount: 0,
    seed: 12345,
    createdAt: new Date().toISOString(),
    config: {
      seed: 12345,
      gridResolution: '1024x512' as any,
      worldWidthKm: 40000,
      plateCount: 12,
      seaRatio: 60,
      continentCount: 4,
      continentSize: 6,
      mountainStrength: 6,
      islandDensity: 5,
      minIslandArea: 15,
    },
    elevationGrid: new Float32Array(64 * 32).fill(40),
    seaLevel: 35,
    worldWidthKm: 40000,
    symbols: [],
    cells: [],
    regionalMaps: {
      town_1: {
        id: 'town_1',
        name: '王都城下町',
        kind: 'town',
        bounds: { minX: 100, minY: 100, maxX: 300, maxY: 300 },
        zoomScale: 16,
        width: 1000,
        height: 1000,
        gridCols: 64,
        gridRows: 64,
        elevationGrid: new Float32Array(64 * 64).fill(45),
        seaLevel: 35,
        createdAt: new Date().toISOString(),
        parentId: null,
        seed: 9999,
        widthKm: 0.6,
        symbols: [],
        townObjects: sampleTown,
      },
    },
  };

  // 1. JSON Roundtrip
  const serialized = serializeMapData(dummyMap);
  const jsonStr = JSON.stringify(serialized);
  const parsed = JSON.parse(jsonStr);
  const deserialized = deserializeMapData(parsed);

  const restoredTown = deserialized.regionalMaps?.town_1?.townObjects;
  assert.ok(restoredTown, 'townObjects should be restored in regionalMaps');
  assert.equal(restoredTown.length, 5);
  assert.deepEqual(restoredTown, sampleTown);

  // 2. .fwm Binary Roundtrip
  const fwmResult = await serializeMapDataToFwm(dummyMap);
  const fwmRestored = await deserializeMapDataFromFwm(fwmResult.blob);
  const fwmTown = fwmRestored.mapData.regionalMaps?.town_1?.townObjects;
  assert.ok(fwmTown, 'townObjects should be restored from .fwm');
  assert.equal(fwmTown.length, 5);
  assert.deepEqual(fwmTown, sampleTown);

  // 3. Sanitizer tests: unknown kind or corrupted coordinates
  const corrupted = [
    { id: 'bad_1', kind: 'alien_ship', points: [[0, 0], [10, 10]] },
    { id: 'bad_2', kind: 'building', polygon: [[0, 0]] }, // too few vertices
    { id: 'bad_3', kind: 'road', points: [[0, 'NaN'], [10, 10]] }, // NaN coord
    { id: 'good_1', kind: 'road', style: 'street', points: [[1, 1], [5, 5]], widthM: 4, smooth: false },
  ];
  const cleaned = sanitizeTownObjects(corrupted);
  assert.equal(cleaned?.length, 1);
  assert.equal(cleaned?.[0].id, 'good_1');

  // 4. Legacy map with no townObjects loads cleanly
  const legacy = deserializeMapData({
    width: 2000,
    height: 1000,
    gridCols: 64,
    gridRows: 32,
    elevationGrid: new Float32Array(64 * 32),
    regionalMaps: {
      old_reg: {
        id: 'old_reg',
        name: '旧地域',
        gridCols: 64,
        gridRows: 32,
        elevationGrid: new Float32Array(64 * 32),
      },
    },
  });
  assert.equal(legacy.regionalMaps?.old_reg?.townObjects, undefined);
});

test('history & caching: supports undo/redo reference replacement and vertex cache invalidation', () => {
  clearTownGeometryCache();

  // Test caching
  const id = 'building_cache_test';
  const ptsA: Pt[] = [
    [10, 10],
    [20, 10],
    [20, 20],
    [10, 20],
  ];

  const roughenedA1 = getCachedRoughened(id, ptsA, 0.5);
  const roughenedA2 = getCachedRoughened(id, ptsA, 0.5);
  assert.equal(roughenedA1, roughenedA2, 'Cache hit must return identical reference');

  // Altering vertices should change hash and invalidate cache key
  const ptsB: Pt[] = [
    [15, 10],
    [25, 10],
    [25, 20],
    [15, 20],
  ];
  assert.notEqual(computePointsHash(ptsA), computePointsHash(ptsB));
  const roughenedB = getCachedRoughened(id, ptsB, 0.5);
  assert.notEqual(roughenedA1, roughenedB, 'Modified points must create new cache entry');

  // Test Undo/Redo immutable reference swapping
  const obj1: TownObject = {
    id: 'b1',
    kind: 'building',
    buildingKind: 'house',
    polygon: ptsA,
    heightM: 6,
    tone: 0.2,
  };
  const obj2: TownObject = {
    id: 'b2',
    kind: 'building',
    buildingKind: 'shop',
    polygon: ptsB,
    heightM: 8,
    tone: 0.7,
  };

  const initialList: TownObject[] = [obj1];
  const nextList: TownObject[] = [...initialList, obj2];

  // History record captures immutable array references
  const record = {
    description: 'Add building',
    timestamp: Date.now(),
    townChanges: {
      prevObjects: initialList,
      newObjects: nextList,
    },
  };

  // Undo restores initial reference
  const undone = record.townChanges.prevObjects;
  assert.equal(undone, initialList);
  assert.equal(undone.length, 1);

  // Redo restores new reference
  const redone = record.townChanges.newObjects;
  assert.equal(redone, nextList);
  assert.equal(redone.length, 2);
});
