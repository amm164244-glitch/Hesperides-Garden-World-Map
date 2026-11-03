import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTownBounds, fitBoundsToLimits, formatDistance } from './regionLayout';
import { generateRegionalMap } from './regionGenerator';
import {
  isUniformChild,
  parentToChildViewport,
  childToParentViewport,
  getMaxZoomForMap,
  findChildToEnter,
} from './regionNavigation';
import { serializeMapData, deserializeMapData } from './serialization';
import { serializeMapDataToFwm, deserializeMapDataFromFwm } from './binaryMapStorage';
import { MapData, RegionalMapData } from '../types/map';

test('computeTownBounds computes correct bounds inside parent limits', () => {
  const parent = { width: 2000, height: 1000, widthKm: 40000 };

  // 1. Center placement with 600m width, 4:3 aspect
  const b1 = computeTownBounds(parent, 1000, 500, 600, 4 / 3);
  // boundsW = 2000 * (0.6 / 40000) = 0.03
  // boundsH = 0.03 / (4/3) = 0.0225
  assert.ok(Math.abs((b1.maxX - b1.minX) - 0.03) < 1e-5);
  assert.ok(Math.abs((b1.maxY - b1.minY) - 0.0225) < 1e-5);
  assert.ok(Math.abs((b1.minX + b1.maxX) / 2 - 1000) < 1e-5);
  assert.ok(Math.abs((b1.minY + b1.maxY) / 2 - 500) < 1e-5);

  // 2. Corner placement: shifts to stay within [0, parent.width] x [0, parent.height]
  const bCorner = computeTownBounds(parent, 0, 0, 600, 4 / 3);
  assert.ok(bCorner.minX >= 0);
  assert.ok(bCorner.minY >= 0);
  assert.ok(bCorner.maxX <= parent.width);
  assert.ok(bCorner.maxY <= parent.height);
  assert.ok(Math.abs((bCorner.maxX - bCorner.minX) - 0.03) < 1e-5);

  // 3. Various scales (100m and 5000m)
  const b100 = computeTownBounds(parent, 500, 500, 100, 1.0);
  assert.ok(Math.abs((b100.maxX - b100.minX) - 0.005) < 1e-5);
  assert.ok(Math.abs((b100.maxY - b100.minY) - 0.005) < 1e-5);

  const b5000 = computeTownBounds(parent, 500, 500, 5000, 2.0);
  assert.ok(Math.abs((b5000.maxX - b5000.minX) - 0.25) < 1e-5);
  assert.ok(Math.abs((b5000.maxY - b5000.minY) - 0.125) < 1e-5);
});

test('fitBoundsToLimits supports custom minWidthRatio and minAbsolute for towns', () => {
  const rawBounds = { minX: 100, minY: 100, maxX: 100.05, maxY: 100.0375 };
  const res = fitBoundsToLimits(rawBounds, 2000, 1000, { minWidthRatio: 0.00001, minAbsolute: 0.01 });
  assert.ok((res.bounds.maxX - res.bounds.minX) >= 0.01);
});

test('formatDistance accurately formats meters and kilometers', () => {
  assert.strictEqual(formatDistance(0.1), '100 m');
  assert.strictEqual(formatDistance(0.6), '600 m');
  assert.strictEqual(formatDistance(0.025), '25 m');
  assert.strictEqual(formatDistance(1.0), '1 km');
  assert.strictEqual(formatDistance(1.2), '1.2 km');
  assert.strictEqual(formatDistance(40000), '40,000 km');
});

test('Viewport roundtrip error is <= 1e-6 even with small town k (~0.0005)', () => {
  const child: RegionalMapData = {
    id: 'town_test',
    name: 'テスト町',
    kind: 'town',
    bounds: { minX: 500, minY: 300, maxX: 500.8, maxY: 300.6 },
    zoomScale: 4,
    width: 1600,
    height: 1200,
    gridCols: 1024,
    gridRows: 768,
    elevationGrid: new Float32Array(1024 * 768),
    seaLevel: 35.0,
    createdAt: new Date().toISOString(),
    parentId: null,
    seed: 42,
    widthKm: 0.6,
  };

  const initialVp = { x: 120.456, y: -78.912, zoom: 2.5 };
  const childVp = parentToChildViewport(initialVp, child);
  const roundtripVp = childToParentViewport(childVp, child);

  assert.ok(Math.abs(roundtripVp.x - initialVp.x) <= 1e-6);
  assert.ok(Math.abs(roundtripVp.y - initialVp.y) <= 1e-6);
  assert.ok(Math.abs(roundtripVp.zoom - initialVp.zoom) <= 1e-6);
});

test('getMaxZoomForMap scales up to 500x for small town maps', () => {
  const townChild: RegionalMapData = {
    id: 'town_small',
    name: '街道の宿場町',
    kind: 'town',
    bounds: { minX: 1000, minY: 500, maxX: 1000.03, maxY: 500.0225 },
    zoomScale: 4,
    width: 1600,
    height: 1200,
    gridCols: 1024,
    gridRows: 768,
    elevationGrid: new Float32Array(1024 * 768),
    seaLevel: 35.0,
    createdAt: new Date().toISOString(),
    parentId: null,
    seed: 123,
    widthKm: 0.6,
  };

  const maxZoom = getMaxZoomForMap([townChild]);
  assert.ok(maxZoom >= 100);
  assert.ok(maxZoom <= 500);
});

test('generateRegionalMap with kind: town generates proper kind, decimal widthKm, and reduced detailAmp', () => {
  const worldCols = 256;
  const worldRows = 128;
  const dummyParent = {
    width: 2000,
    height: 1000,
    gridCols: worldCols,
    gridRows: worldRows,
    elevationGrid: new Float32Array(worldCols * worldRows).fill(45.0),
    seaLevel: 35.0,
    seed: 999,
    worldWidthKm: 40000,
  } as any;

  // Town bounds: 600m width
  const townBounds = computeTownBounds(dummyParent, 1000, 500, 600, 4 / 3);

  // Generate town with detailScale 0.15
  const townMap = generateRegionalMap(
    dummyParent,
    townBounds,
    4,
    'テスト町',
    undefined,
    { kind: 'town', detailScale: 0.15 }
  );

  assert.strictEqual(townMap.kind, 'town');
  assert.strictEqual(townMap.name, 'テスト町');
  assert.ok(townMap.widthKm < 1.0);
  assert.strictEqual(townMap.widthKm, 0.6);

  // Generate normal region for comparison
  const normalRegion = generateRegionalMap(
    dummyParent,
    townBounds,
    4,
    'テスト地域',
    undefined,
    { kind: 'region', detailScale: 1.0 }
  );

  // Verify that town elevation deviations from base 45.0 are significantly smaller than normal region
  let maxTownDev = 0;
  for (let i = 0; i < townMap.elevationGrid.length; i++) {
    const dev = Math.abs(townMap.elevationGrid[i] - 45.0);
    if (dev > maxTownDev) maxTownDev = dev;
  }

  let maxRegionDev = 0;
  for (let i = 0; i < normalRegion.elevationGrid.length; i++) {
    const dev = Math.abs(normalRegion.elevationGrid[i] - 45.0);
    if (dev > maxRegionDev) maxRegionDev = dev;
  }

  assert.ok(maxTownDev < maxRegionDev);
});

test('kind: town and decimal widthKm are preserved across JSON serialization', () => {
  const dummyMap: MapData = {
    width: 2000,
    height: 1000,
    gridCols: 64,
    gridRows: 32,
    cellCount: 0,
    seed: 1234,
    seaLevel: 35.0,
    worldWidthKm: 40000,
    createdAt: new Date().toISOString(),
    elevationGrid: new Float32Array(64 * 32).fill(40),
    cells: [],
    regionalMaps: {
      town_1: {
        id: 'town_1',
        name: '港砦',
        kind: 'town',
        bounds: { minX: 100, minY: 100, maxX: 100.03, maxY: 100.0225 },
        zoomScale: 4,
        width: 1600,
        height: 1200,
        gridCols: 64,
        gridRows: 48,
        elevationGrid: new Float32Array(64 * 48).fill(38),
        seaLevel: 35.0,
        createdAt: new Date().toISOString(),
        parentId: null,
        seed: 555,
        widthKm: 0.6,
      },
    },
    config: {
      seed: 1234,
      gridResolution: '1024x512',
      worldWidthKm: 40000,
      plateCount: 12,
      seaRatio: 60,
      continentCount: 4,
      continentSize: 6,
      mountainStrength: 6,
      islandDensity: 5,
      minIslandArea: 15,
    },
  };

  const serialized = serializeMapData(dummyMap);
  const deserialized = deserializeMapData(serialized);

  const restoredTown = deserialized.regionalMaps['town_1'];
  assert.ok(restoredTown);
  assert.strictEqual(restoredTown.kind, 'town');
  assert.strictEqual(restoredTown.name, '港砦');
  assert.strictEqual(restoredTown.widthKm, 0.6);
});

test('kind: town and decimal widthKm are preserved across .fwm binary serialization', async () => {
  const dummyMap: MapData = {
    width: 2000,
    height: 1000,
    gridCols: 64,
    gridRows: 32,
    cellCount: 0,
    seed: 1234,
    seaLevel: 35.0,
    worldWidthKm: 40000,
    createdAt: new Date().toISOString(),
    elevationGrid: new Float32Array(64 * 32).fill(40),
    cells: [],
    regionalMaps: {
      town_1: {
        id: 'town_1',
        name: '王都',
        kind: 'town',
        bounds: { minX: 500, minY: 500, maxX: 500.06, maxY: 500.045 },
        zoomScale: 4,
        width: 1600,
        height: 1200,
        gridCols: 64,
        gridRows: 48,
        elevationGrid: new Float32Array(64 * 48).fill(42),
        seaLevel: 35.0,
        createdAt: new Date().toISOString(),
        parentId: null,
        seed: 777,
        widthKm: 1.2,
      },
    },
    config: {
      seed: 1234,
      gridResolution: '1024x512',
      worldWidthKm: 40000,
      plateCount: 12,
      seaRatio: 60,
      continentCount: 4,
      continentSize: 6,
      mountainStrength: 6,
      islandDensity: 5,
      minIslandArea: 15,
    },
  };

  const { blob } = await serializeMapDataToFwm(dummyMap);
  const { mapData: loaded } = await deserializeMapDataFromFwm(blob);

  const restoredTown = loaded.regionalMaps['town_1'];
  assert.ok(restoredTown);
  assert.strictEqual(restoredTown.kind, 'town');
  assert.strictEqual(restoredTown.name, '王都');
  assert.strictEqual(restoredTown.widthKm, 1.2);
});
