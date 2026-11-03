import test from 'node:test';
import assert from 'node:assert/strict';
import {
  polygonBounds,
  simplifyPolyline,
  smoothPolygon,
  rasterizePolygonMask,
  blurMask,
  applyShapeMaskElevation,
} from './regionShape.ts';
import { generateTectonicWorld } from './tectonicGenerator.ts';
import { generateRegionalMap } from './regionGenerator.ts';
import { serializeMapData, deserializeMapData } from './serialization.ts';
import { GeneratorConfig } from '../types/map.ts';

test('rasterizePolygonMask: handles rectangle and concave polygon with inner 1.0 and outer 0.0, robust to out-of-bounds vertices', () => {
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const cols = 50;
  const rows = 50;

  // 1. Rectangle inside bounds [20, 20] to [80, 80]
  const rectPoly: [number, number][] = [
    [20, 20],
    [80, 20],
    [80, 80],
    [20, 80],
  ];
  const rectMask = rasterizePolygonMask(rectPoly, bounds, cols, rows);

  // Center (50, 50) -> grid (25, 25) should be inside (1.0)
  assert.equal(rectMask[25 * cols + 25], 1.0, 'Center of rectangle should be 1.0');
  // Outside corner (5, 5) -> grid (2, 2) should be 0.0
  assert.equal(rectMask[2 * cols + 2], 0.0, 'Outside corner should be 0.0');

  // 2. Concave polygon (V-shape or L-shape)
  // L-shaped polygon:
  // (20,20) -> (80,20) -> (80,50) -> (50,50) -> (50,80) -> (20,80)
  const lPoly: [number, number][] = [
    [20, 20],
    [80, 20],
    [80, 50],
    [50, 50],
    [50, 80],
    [20, 80],
  ];
  const lMask = rasterizePolygonMask(lPoly, bounds, cols, rows);

  // Inside bottom-left leg (30, 30) -> grid (15, 15) should be 1.0
  assert.equal(lMask[15 * cols + 15], 1.0, 'Inside L-shape should be 1.0');
  // Concave cutout region (65, 65) -> grid (32, 32) should be 0.0
  assert.equal(lMask[32 * cols + 32], 0.0, 'Cutout region of concave polygon should be 0.0');

  // 3. Polygon with vertices sticking outside of bounds (e.g. negative or > 100)
  const outPoly: [number, number][] = [
    [-50, -50],
    [150, -50],
    [150, 60],
    [-50, 60],
  ];
  assert.doesNotThrow(() => {
    const outMask = rasterizePolygonMask(outPoly, bounds, cols, rows);
    assert.equal(outMask[10 * cols + 25], 1.0);
    assert.equal(outMask[40 * cols + 25], 0.0);
  }, 'Should not throw or crash on vertices exceeding bounds');
});

test('blurMask: preserves values in flat regions, smoothly transitions boundaries, and stays within [0, 1]', () => {
  const cols = 60;
  const rows = 60;
  const mask = new Float32Array(cols * rows);

  // Half 0, half 1
  for (let r = 0; r < rows; r++) {
    for (let c = 30; c < cols; c++) {
      mask[r * cols + c] = 1.0;
    }
  }

  const blurred = blurMask(mask, cols, rows, 3);

  // Deep flat regions far from boundary (c = 5 and c = 55) should remain 0 and 1
  assert.equal(blurred[30 * cols + 5], 0.0, 'Far outside should stay 0.0');
  assert.equal(blurred[30 * cols + 55], 1.0, 'Far inside should stay 1.0');

  // Boundary region (c = 30) should have intermediate value between 0 and 1
  const boundaryVal = blurred[30 * cols + 30];
  assert.ok(boundaryVal > 0.3 && boundaryVal < 0.7, `Boundary should be smooth transition, got ${boundaryVal}`);

  // Stays strictly in [0, 1]
  for (let i = 0; i < blurred.length; i++) {
    assert.ok(blurred[i] >= 0 && blurred[i] <= 1.0, 'Values must remain in [0, 1]');
  }
});

test('smoothPolygon and simplifyPolyline: vertex count changes as expected and bounding box is preserved', () => {
  // Polyline with dense redundant points along a line
  const rawPoints: [number, number][] = [
    [10, 10],
    [20, 10.1],
    [30, 9.9],
    [40, 10.05],
    [50, 10],
    [50, 30],
    [50, 50],
    [30, 50],
    [10, 50],
    [10, 30],
  ];

  // Simplify polyline
  const simplified = simplifyPolyline(rawPoints, 1.0);
  assert.ok(simplified.length < rawPoints.length, `Simplified length (${simplified.length}) should be less than raw (${rawPoints.length})`);

  // Bounding box comparison
  const rawBox = polygonBounds(rawPoints);
  const simpBox = polygonBounds(simplified);
  assert.ok(Math.abs(rawBox.minX - simpBox.minX) <= 1.0);
  assert.ok(Math.abs(rawBox.maxX - simpBox.maxX) <= 1.0);
  assert.ok(Math.abs(rawBox.minY - simpBox.minY) <= 1.0);
  assert.ok(Math.abs(rawBox.maxY - simpBox.maxY) <= 1.0);

  // Smooth polygon: 4 vertices should produce 4 * segmentsPerEdge vertices
  const quad: [number, number][] = [
    [100, 100],
    [200, 100],
    [200, 200],
    [100, 200],
  ];
  const smoothed = smoothPolygon(quad, 4);
  assert.equal(smoothed.length, quad.length * 4, 'Smoothed polygon should have 16 vertices for 4 edges with 4 segments');
});

test('generateRegionalMap: outsideSea=true lowers elevation outside polygon to <= seaLevel, preserves inner elevation', () => {
  const config: GeneratorConfig = {
    seed: 12345,
    gridResolution: '1024x512',
    worldWidthKm: 40000,
    plateCount: 10,
    seaRatio: 50,
    continentCount: 3,
    continentSize: 5,
    mountainStrength: 5,
    islandDensity: 5,
    minIslandArea: 10,
  };

  const worldMap = generateTectonicWorld(2000, 1000, config);
  const bounds = { minX: 400, minY: 200, maxX: 800, maxY: 600 };

  // Triangle inside the bounds
  const polygon: [number, number][] = [
    [450, 250],
    [750, 250],
    [600, 550],
  ];

  // Without outsideSea
  const regionNoSea = generateRegionalMap(worldMap, bounds, 4, '通常地域', {
    polygon,
    outsideSea: false,
    featherRatio: 0.03,
  });

  // With outsideSea
  const regionSea = generateRegionalMap(worldMap, bounds, 4, '海化地域', {
    polygon,
    outsideSea: true,
    featherRatio: 0.03,
  });

  // Outside point (e.g. top-left corner of bounds: minX + 20, minY + 20 -> grid (cols*0.05, rows*0.05))
  const outsideIdx = 5 * regionSea.gridCols + 5;
  assert.ok(
    regionSea.elevationGrid[outsideIdx] <= regionSea.seaLevel,
    `Outside elevation (${regionSea.elevationGrid[outsideIdx]}) should be <= seaLevel (${regionSea.seaLevel})`
  );

  // Center of triangle (600, 350) -> relative to bounds (1/2 x, 3/8 y)
  const centerC = Math.round(regionSea.gridCols * 0.5);
  const centerR = Math.round(regionSea.gridRows * 0.375);
  const centerIdx = centerR * regionSea.gridCols + centerC;

  assert.ok(
    Math.abs(regionSea.elevationGrid[centerIdx] - regionNoSea.elevationGrid[centerIdx]) < 1.0,
    'Center of shape should retain identical elevation between outsideSea true and false'
  );

  // Outline should be preserved
  assert.ok(regionSea.outline && regionSea.outline.length === 3);
});

test('serialization: preserves outline field and backward compatibility when outline is missing', () => {
  const config: GeneratorConfig = {
    seed: 777,
    gridResolution: '1024x512',
    worldWidthKm: 40000,
    plateCount: 8,
    seaRatio: 60,
    continentCount: 2,
    continentSize: 5,
    mountainStrength: 5,
    islandDensity: 5,
    minIslandArea: 10,
  };

  const worldMap = generateTectonicWorld(2000, 1000, config);
  const polygon: [number, number][] = [[100, 100], [300, 100], [200, 300]];
  const regionWithOutline = generateRegionalMap(worldMap, { minX: 50, minY: 50, maxX: 350, maxY: 350 }, 4, '形状地域', {
    polygon,
    outsideSea: true,
    featherRatio: 0.03,
  });

  worldMap.regionalMaps[regionWithOutline.id] = regionWithOutline;

  const serialized = serializeMapData(worldMap);
  assert.ok(Array.isArray(serialized.regionalMaps[regionWithOutline.id].outline));
  assert.equal(serialized.regionalMaps[regionWithOutline.id].outline.length, 3);

  const restored = deserializeMapData(serialized);
  const restoredRegion = restored.regionalMaps[regionWithOutline.id];
  assert.ok(restoredRegion.outline);
  assert.deepEqual(restoredRegion.outline, polygon);

  // Backward compatibility test: raw region without outline
  const legacyRaw = {
    ...serialized,
    regionalMaps: {
      legacy1: {
        id: 'legacy1',
        name: '旧形式地域',
        bounds: { minX: 10, minY: 10, maxX: 100, maxY: 100 },
        zoomScale: 4,
        elevationGridBase64: serialized.regionalMaps[regionWithOutline.id].elevationGridBase64,
        // outline is omitted
      },
    },
  };

  const restoredLegacy = deserializeMapData(legacyRaw);
  assert.equal(restoredLegacy.regionalMaps.legacy1.outline, undefined, 'Old format without outline should deserialize with undefined outline');
});
