import test from 'node:test';
import assert from 'node:assert/strict';
import { Mulberry32, hashStringToSeed } from './prng.ts';
import { generateTectonicWorld } from './tectonicGenerator.ts';
import { generateRegionalMap } from './regionGenerator.ts';
import { applyBrushToElevationGrid } from './terrainEditor.ts';
import { serializeMapData, deserializeMapData } from './serialization.ts';
import { applyErosion } from './erosion.ts';
import { GeneratorConfig } from '../types/map.ts';

test('Mulberry32 produces deterministic random sequences from same seed', () => {
  const rng1 = new Mulberry32(42);
  const rng2 = new Mulberry32(42);

  const seq1 = [rng1.next(), rng1.next(), rng1.next(), rng1.nextInt(0, 100)];
  const seq2 = [rng2.next(), rng2.next(), rng2.next(), rng2.nextInt(0, 100)];

  assert.deepEqual(seq1, seq2);
});

test('hashStringToSeed returns stable unsigned integer', () => {
  const h1 = hashStringToSeed('Avalon');
  const h2 = hashStringToSeed('Avalon');
  const h3 = hashStringToSeed('MiddleEarth');

  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert(h1 > 0);
});

test('generateTectonicWorld creates 2:1 global map with plates and Float32 grids', () => {
  const config: GeneratorConfig = {
    seed: 8888,
    gridResolution: '1024x512',
    worldWidthKm: 40000,
    plateCount: 10,
    seaRatio: 60,
    continentCount: 3,
    continentSize: 5,
    mountainStrength: 6,
    islandDensity: 5,
    minIslandArea: 10,
  };

  const mapData = generateTectonicWorld(2000, 1000, config);

  assert.equal(mapData.width, 2000);
  assert.equal(mapData.height, 1000);
  assert.equal(mapData.gridCols, 1024);
  assert.equal(mapData.gridRows, 512);
  assert(mapData.elevationGrid instanceof Float32Array);
  assert(mapData.temperatureGrid instanceof Float32Array);
  assert(mapData.plates && mapData.plates.length >= 8);

  // Check latitude-dependent temperature gradient
  // Equator row is at index r = 256
  const equatorTemp = mapData.temperatureGrid[256 * 1024 + 512];
  // Arctic row is at index r = 10
  const arcticTemp = mapData.temperatureGrid[10 * 1024 + 512];
  // Antarctic row is at index r = 500
  const antarcticTemp = mapData.temperatureGrid[500 * 1024 + 512];

  assert(equatorTemp > arcticTemp, `Equator temp (${equatorTemp}) should be warmer than Arctic (${arcticTemp})`);
  assert(equatorTemp > antarcticTemp, `Equator temp (${equatorTemp}) should be warmer than Antarctic (${antarcticTemp})`);
});

test('generateRegionalMap inherits macro terrain and adds micro detail at 4x and 16x', () => {
  const config: GeneratorConfig = {
    seed: 54321,
    gridResolution: '1024x512',
    worldWidthKm: 40000,
    plateCount: 10,
    seaRatio: 55,
    continentCount: 3,
    continentSize: 5,
    mountainStrength: 5,
    islandDensity: 5,
    minIslandArea: 10,
  };

  const worldMap = generateTectonicWorld(2000, 1000, config);
  const bounds = { minX: 400, minY: 200, maxX: 800, maxY: 400 };

  const region4x = generateRegionalMap(worldMap, bounds, 4, 'テスト地域4x');
  assert.equal(region4x.zoomScale, 4);
  assert.equal(region4x.gridCols, 1024);
  assert.equal(region4x.gridRows, 512);
  assert.equal(region4x.width, 2000);
  assert.equal(region4x.height, 1000);
  assert.equal(region4x.parentId, null);
  assert.equal(region4x.widthKm, Math.round(worldMap.worldWidthKm * (400 / 2000)));
  assert(region4x.elevationGrid instanceof Float32Array);

  const region16x = generateRegionalMap(worldMap, bounds, 16, 'テスト地域16x');
  assert.equal(region16x.zoomScale, 16);
  assert.equal(region16x.gridCols, 2048);
  assert.equal(region16x.gridRows, 1024);

  // Test recursive child regional map generation (Region -> Subregion)
  const subRegion = generateRegionalMap(region4x, { minX: 100, minY: 100, maxX: 300, maxY: 300 }, 4, 'テスト小地域');
  assert.equal(subRegion.parentId, region4x.id);
  assert.equal(subRegion.widthKm, Math.round(region4x.widthKm * (200 / region4x.width)));
  assert(typeof subRegion.seed === 'number');

  // Test arbitrary aspect ratio regional map generation (e.g. 1:1 square)
  const squareBounds = { minX: 200, minY: 200, maxX: 500, maxY: 500 };
  const squareRegion = generateRegionalMap(worldMap, squareBounds, 4, '正方形地域');
  const aspect = squareRegion.width / squareRegion.height;
  assert.ok(Math.abs(aspect - 1.0) < 1e-4, 'Region aspect ratio must match bounds aspect ratio (1.0)');
  assert.equal(squareRegion.gridCols, squareRegion.gridRows, 'Grid resolution must be square');
  assert(squareRegion.elevationGrid.length === squareRegion.gridCols * squareRegion.gridRows);
});

test('applyBrushToElevationGrid smoothly modifies elevation with Gaussian falloff', () => {
  const cols = 100;
  const rows = 50;
  const grid = new Float32Array(cols * rows).fill(30.0);

  const changes = applyBrushToElevationGrid(
    grid,
    cols,
    rows,
    1000,
    500,
    500,
    250,
    {
      mode: 'elevate',
      radius: 60,
      strength: 0.5,
      flattenTarget: 50,
    },
    35.0
  );

  assert(changes.length > 0, 'Should modify grid nodes inside brush radius');
  // Center should be elevated
  const centerIdx = 25 * cols + 50;
  assert(grid[centerIdx] > 30.0, 'Center grid node should be elevated');
});

test('serializeMapData and deserializeMapData preserve Float32Array grids and regional maps', () => {
  const config: GeneratorConfig = {
    seed: 9999,
    gridResolution: '1024x512',
    worldWidthKm: 40000,
    plateCount: 10,
    seaRatio: 60,
    continentCount: 3,
    continentSize: 5,
    mountainStrength: 6,
    islandDensity: 5,
    minIslandArea: 10,
  };

  const worldMap = generateTectonicWorld(2000, 1000, config);
  const region = generateRegionalMap(worldMap, { minX: 100, minY: 100, maxX: 500, maxY: 400 }, 4, '保存テスト地域');
  worldMap.regionalMaps[region.id] = region;

  worldMap.symbols = [{ id: 'world_sym1', type: 'mountain_snow', x: 250, y: 150, scale: 1.2, rotation: 0 }];
  region.symbols = [{ id: 'region_sym1', type: 'village_hamlet', x: 80, y: 120, scale: 0.9, rotation: 0 }];

  const serialized = serializeMapData(worldMap);
  assert(typeof serialized.elevationGridBase64 === 'string', 'Should produce base64 string for elevation');
  assert(typeof serialized.regionalMaps[region.id].elevationGridBase64 === 'string', 'Should serialize region grids');
  assert.equal(serialized.symbols.length, 1);
  assert.equal(serialized.regionalMaps[region.id].symbols.length, 1);

  const restored = deserializeMapData(serialized);
  assert(restored.elevationGrid instanceof Float32Array, 'Should restore Float32Array for world elevation');
  assert.equal(restored.elevationGrid.length, worldMap.elevationGrid.length);
  assert.equal(restored.elevationGrid[500], worldMap.elevationGrid[500]);
  assert.equal(restored.symbols?.length, 1);
  assert.equal(restored.symbols?.[0].id, 'world_sym1');

  const restoredRegion = restored.regionalMaps[region.id];
  assert(restoredRegion, 'Should restore regional map');
  assert(restoredRegion.elevationGrid instanceof Float32Array);
  assert.equal(restoredRegion.elevationGrid[200], region.elevationGrid[200]);
  assert.equal(restoredRegion.symbols?.length, 1);
  assert.equal(restoredRegion.symbols?.[0].id, 'region_sym1');
});

test('applyErosion smooths steep talus slopes and carves valleys', () => {
  const cols = 50;
  const rows = 50;
  const grid = new Float32Array(cols * rows).fill(40.0);

  // Create sharp spire at center
  const centerIdx = 25 * cols + 25;
  grid[centerIdx] = 90.0;

  applyErosion(grid, cols, rows, {
    iterations: 10,
    strength: 0.8,
    seaLevel: 35.0,
  });

  assert(grid[centerIdx] < 90.0, 'Peak height should be reduced by erosion');
  // Neighbor should have received deposited material
  const neighborIdx = centerIdx + 1;
  assert(grid[neighborIdx] > 40.0, 'Adjacent cells should receive eroded sediment');
});


