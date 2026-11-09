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
  assert(mapData.plates && mapData.plates.length >= 8);
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
  assert.equal(serialized.temperatureGridBase64, undefined, 'Should not serialize temperatureGrid');
  assert(typeof serialized.regionalMaps[region.id].elevationGridBase64 === 'string', 'Should serialize region grids');
  assert.equal(serialized.regionalMaps[region.id].temperatureGridBase64, undefined, 'Should not serialize region temperatureGrid');
  assert.equal(serialized.symbols.length, 1);
  assert.equal(serialized.regionalMaps[region.id].symbols.length, 1);

  const restored = deserializeMapData(serialized);
  assert(restored.elevationGrid instanceof Float32Array, 'Should restore Float32Array for world elevation');
  assert.equal((restored as any).temperatureGrid, undefined, 'World map should not have temperatureGrid');
  assert.equal(restored.elevationGrid.length, worldMap.elevationGrid.length);
  assert.equal(restored.elevationGrid[500], worldMap.elevationGrid[500]);
  assert.equal(restored.symbols?.length, 1);
  assert.equal(restored.symbols?.[0].id, 'world_sym1');

  const restoredRegion = restored.regionalMaps[region.id];
  assert(restoredRegion, 'Should restore regional map');
  assert(restoredRegion.elevationGrid instanceof Float32Array);
  assert.equal((restoredRegion as any).temperatureGrid, undefined, 'Regional map should not have temperatureGrid');
  assert.equal(restoredRegion.elevationGrid[200], region.elevationGrid[200]);
  assert.equal(restoredRegion.symbols?.length, 1);
  assert.equal(restoredRegion.symbols?.[0].id, 'region_sym1');
});

test('deserializeMapData ignores legacy temperatureGrid and temperatureGridBase64', () => {
  const legacyData = {
    width: 2000,
    height: 1000,
    gridCols: 10,
    gridRows: 10,
    seed: 12345,
    seaLevel: 35,
    worldWidthKm: 40000,
    elevationGridBase64: 'AAAAAA==',
    temperatureGridBase64: 'AAAAAA==',
    temperatureGrid: new Float32Array(100),
    regionalMaps: {
      reg1: {
        id: 'reg1',
        gridCols: 10,
        gridRows: 10,
        elevationGridBase64: 'AAAAAA==',
        temperatureGridBase64: 'AAAAAA==',
        temperatureGrid: new Float32Array(100),
        bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      },
    },
  };

  const restored = deserializeMapData(legacyData);
  assert.equal((restored as any).temperatureGrid, undefined);
  assert.equal((restored as any).temperatureGridBase64, undefined);
  assert.equal((restored.regionalMaps.reg1 as any).temperatureGrid, undefined);
  assert.equal((restored.regionalMaps.reg1 as any).temperatureGridBase64, undefined);
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

test('generateTectonicWorld with coastlineComplexity generates jagged rias coastlines', () => {
  const config: GeneratorConfig = {
    seed: 99182,
    gridResolution: '1024x512',
    worldWidthKm: 40000,
    plateCount: 10,
    seaRatio: 60,
    continentCount: 3,
    continentSize: 5,
    mountainStrength: 5,
    islandDensity: 5,
    minIslandArea: 10,
    coastlineComplexity: 8,
  };

  const worldMap = generateTectonicWorld(2000, 1000, config);
  const elev = worldMap.elevationGrid;
  const seaLevel = worldMap.seaLevel;
  const cols = worldMap.gridCols;
  const rows = worldMap.gridRows;

  // Measure shoreline cells and local elevation variance along coast
  let coastalCells = 0;
  let totalVariance = 0;

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx = r * cols + c;
      const h = elev[idx];
      const isLand = h > seaLevel;
      // Check 4-neighbors for land-sea transition
      const topLand = elev[(r - 1) * cols + c] > seaLevel;
      const btmLand = elev[(r + 1) * cols + c] > seaLevel;
      const leftLand = elev[r * cols + (c - 1)] > seaLevel;
      const rightLand = elev[r * cols + (c + 1)] > seaLevel;

      if (isLand !== topLand || isLand !== btmLand || isLand !== leftLand || isLand !== rightLand) {
        coastalCells++;
        // Local roughness in neighborhood
        const diffX = Math.abs(elev[r * cols + (c + 1)] - elev[r * cols + (c - 1)]);
        const diffY = Math.abs(elev[(r + 1) * cols + c] - elev[(r - 1) * cols + c]);
        totalVariance += diffX + diffY;
      }
    }
  }

  assert(coastalCells > 100, 'World map should feature hundreds of coastal transition cells');
  const meanRoughness = totalVariance / coastalCells;
  assert(meanRoughness > 1.0, `Coastline roughness should be significant for rias features (got ${meanRoughness})`);
});

test('image-to-terrain buildElevationFromMask and maskToElevationGrid generate jagged rias coastlines from straight mask', async () => {
  const { buildElevationFromMask } = await import('./imageTerrain/upsampleMask.ts');
  const { maskToElevationGrid } = await import('./imageTerrain/maskEditor.ts');

  const width = 128;
  const height = 64;
  const mask = new Uint8Array(width * height);

  // Half land, half ocean with a perfectly straight horizontal boundary at y = 32
  for (let y = 32; y < height; y++) {
    for (let x = 0; x < width; x++) {
      mask[y * width + x] = 1;
    }
  }

  // 1. Direct maskToElevationGrid with riaRoughness = 8
  const directElev = maskToElevationGrid(mask, width, height, 35.0, 2.0, 8, 4242);
  // Along the straight nominal boundary y = 32, the zero-crossing positions (elev = 35.0) should vary along x due to domain warping and dendritic carving
  const yBoundaryValues: number[] = [];
  for (let x = 0; x < width; x++) {
    yBoundaryValues.push(directElev[32 * width + x]);
  }
  const minVal = Math.min(...yBoundaryValues);
  const maxVal = Math.max(...yBoundaryValues);
  assert(maxVal - minVal > 2.0, `Domain-warped rias should produce non-uniform, jagged values along nominal straight boundary (variance: ${maxVal - minVal})`);

  // 2. buildElevationFromMask with upsampling (128x64 -> 256x128)
  const upsampledElev = buildElevationFromMask(mask, width, height, 256, 128, 35.0, {
    riaRoughness: 8,
    seed: 4242,
  });
  assert.equal(upsampledElev.length, 256 * 128);

  // Verify non-uniformity across boundary in upsampled grid as well
  const upsampledValues: number[] = [];
  for (let x = 0; x < 256; x++) {
    upsampledValues.push(upsampledElev[64 * 256 + x]);
  }
  const upMin = Math.min(...upsampledValues);
  const upMax = Math.max(...upsampledValues);
  assert(upMax - upMin > 2.0, `Upsampled terrain must also feature jagged rias along straight mask edge (variance: ${upMax - upMin})`);
});

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

    // 1. Performance < 3s on 1024x512
    assert(duration < 3000, `Seed ${seed}: Generation took ${duration.toFixed(1)}ms, expected < 3000ms`);

    // Determinism check
    const map5Repeat = generateTectonicWorld(1024, 512, config5);
    assert.equal(map5.elevationGrid.length, map5Repeat.elevationGrid.length);
    assert.equal(map5.elevationGrid[256 * 1024 + 512], map5Repeat.elevationGrid[256 * 1024 + 512]);

    const cols = map5.gridCols;
    const rows = map5.gridRows;
    const seaLevel = map5.seaLevel;
    const grid = map5.elevationGrid;

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

    // 2. 内陸(両方が海面 + 6 以上)の縦横隣標高差 5 以上の数が修正前の 70% 以下
    const maxAllowedDiff5 = baselines[seed] * 0.70;
    assert(
      inlandDiff5Count <= maxAllowedDiff5,
      `Seed ${seed}: Inland diff >= 5 count was ${inlandDiff5Count}, expected <= ${maxAllowedDiff5} (70% of ${baselines[seed]})`
    );

    // 3. 海岸をまたぐ隣のマスの標高差の最大が 12 以下
    assert(
      maxCoastDiff <= 12.0,
      `Seed ${seed}: Max coastal diff was ${maxCoastDiff}, expected <= 12.0`
    );

    // 4. 極の切り口: 上下それぞれの帯(高さの 7%)で、縦方向の海陸切り替わりのうち最も多い1行に集中する割合が 15% 以下 (polarSoftness = 5)
    const bandRows = Math.floor(rows * 0.07);
    const countPolar = (startR: number, endR: number) => {
      const rowCounts: number[] = new Array(endR - startR).fill(0);
      let total = 0;
      for (let r = startR; r < endR; r++) {
        let count = 0;
        for (let c = 0; c < cols; c++) {
          const w1 = grid[r * cols + c] <= seaLevel;
          const w2 = grid[(r + 1) * cols + c] <= seaLevel;
          if (w1 !== w2) count++;
        }
        rowCounts[r - startR] = count;
        total += count;
      }
      const maxCount = total > 0 ? Math.max(...rowCounts) : 0;
      const maxRatio = total > 0 ? maxCount / total : 0;
      return { maxCount, total, maxRatio };
    };

    const northPolar5 = countPolar(0, bandRows);
    const southPolar5 = countPolar(rows - 1 - bandRows, rows - 1);

    if (northPolar5.total > 30) {
      assert(
        northPolar5.maxRatio <= 0.15,
        `Seed ${seed}: North polar max single-row ratio was ${northPolar5.maxRatio.toFixed(3)}, expected <= 0.15`
      );
    }
    if (southPolar5.total > 30) {
      assert(
        southPolar5.maxRatio <= 0.15,
        `Seed ${seed}: South polar max single-row ratio was ${southPolar5.maxRatio.toFixed(3)}, expected <= 0.15`
      );
    }

    // Compare with polarSoftness = 0: ratio must be greater when polarSoftness = 0
    const config0: GeneratorConfig = {
      ...config5,
      polarSoftness: 0,
    };
    const map0 = generateTectonicWorld(1024, 512, config0);
    const grid0 = map0.elevationGrid;
    const countPolar0 = (startR: number, endR: number) => {
      const rowCounts: number[] = new Array(endR - startR).fill(0);
      let total = 0;
      for (let r = startR; r < endR; r++) {
        let count = 0;
        for (let c = 0; c < cols; c++) {
          const w1 = grid0[r * cols + c] <= map0.seaLevel;
          const w2 = grid0[(r + 1) * cols + c] <= map0.seaLevel;
          if (w1 !== w2) count++;
        }
        rowCounts[r - startR] = count;
        total += count;
      }
      const maxCount = total > 0 ? Math.max(...rowCounts) : 0;
      const maxRatio = total > 0 ? maxCount / total : 0;
      return { maxCount, total, maxRatio };
    };
    const northPolar0 = countPolar0(0, bandRows);
    const southPolar0 = countPolar0(rows - 1 - bandRows, rows - 1);

    if (northPolar5.total > 30 && northPolar0.total > 30) {
      assert(
        northPolar0.maxRatio > northPolar5.maxRatio,
        `Seed ${seed}: polarSoftness=0 north ratio (${northPolar0.maxRatio.toFixed(3)}) should be greater than polarSoftness=5 (${northPolar5.maxRatio.toFixed(3)})`
      );
    }
    if (southPolar5.total > 30 && southPolar0.total > 30) {
      assert(
        southPolar0.maxRatio > southPolar5.maxRatio,
        `Seed ${seed}: polarSoftness=0 south ratio (${southPolar0.maxRatio.toFixed(3)}) should be greater than polarSoftness=5 (${southPolar5.maxRatio.toFixed(3)})`
      );
    }

    // 5. 陸地の割合(標高 >= seaLevel)が (1 - seaRatio / 100) の ±3% 以内。最高標高が 95 以上。
    const total = grid.length;
    let landCount = 0;
    let maxElev = -Infinity;
    for (let i = 0; i < total; i++) {
      const e = grid[i];
      if (e >= seaLevel) landCount++;
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
