import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOF_THEMES,
  ROOF_THEME_PALETTES,
  getRoofColor,
  colorDistanceLab,
  getBuildingOutlineMultiplier,
  getBuildingShadowColor,
} from './townStyle';
import {
  generateSampleTown,
  createTerrainWaterSampler,
} from './townSample';
import {
  drawTownObjects,
  DrawTownOptions,
} from './townRenderer';
import {
  TownBuilding,
  TownBuildingKind,
  TownObject,
  TownRoofTheme,
} from '../../types/town';
import { polygonCentroid } from './townGeometry';
import { serializeMapData, deserializeMapData, sanitizeTownStyle } from '../serialization';
import { MapData } from '../../types/map';

const BUILDING_KINDS: readonly TownBuildingKind[] = [
  'house',
  'shop',
  'hall',
  'church',
  'keep',
  'tower',
  'barn',
] as const;

// -----------------------------------------------------------------------------
// 1. Roof Color Themes & Palettes
// -----------------------------------------------------------------------------

test('all 4 themes return exact min and max colors for tone=0 and tone=1 across all building kinds', () => {
  for (const theme of ROOF_THEMES) {
    for (const kind of BUILDING_KINDS) {
      const palette = ROOF_THEME_PALETTES[theme][kind];
      assert.ok(palette, `Missing palette for theme: ${theme}, kind: ${kind}`);

      const colorAt0 = getRoofColor(kind, 0.0, theme).toLowerCase();
      const colorAt1 = getRoofColor(kind, 1.0, theme).toLowerCase();

      assert.strictEqual(
        colorAt0,
        palette.min.toLowerCase(),
        `theme ${theme} kind ${kind} tone 0.0 should match min color`
      );
      assert.strictEqual(
        colorAt1,
        palette.max.toLowerCase(),
        `theme ${theme} kind ${kind} tone 1.0 should match max color`
      );

      // Midpoint interpolation test (tone 0.5 is valid hex color)
      const colorMid = getRoofColor(kind, 0.5, theme);
      assert.match(colorMid, /^#[0-9a-f]{6}$/i);
    }
  }
});

test('roof colors for terracotta, slate, and stone have significant Lab distance from parchment ground (#a68b64)', () => {
  const PARCHMENT = '#a68b64';

  // Terracotta: rich brick/rust reds
  const terracottaHouse0 = getRoofColor('house', 0.0, 'terracotta');
  const terracottaHouse1 = getRoofColor('house', 1.0, 'terracotta');
  assert.ok(colorDistanceLab(PARCHMENT, terracottaHouse0) > 20, 'Terracotta house tone 0 distance > 20');
  assert.ok(colorDistanceLab(PARCHMENT, terracottaHouse1) > 20, 'Terracotta house tone 1 distance > 20');

  // Slate: cool blue-grey tones
  const slateHouse = getRoofColor('house', 0.5, 'slate');
  const slateChurch = getRoofColor('church', 0.5, 'slate');
  assert.ok(colorDistanceLab(PARCHMENT, slateHouse) > 20, 'Slate house distance > 20');
  assert.ok(colorDistanceLab(PARCHMENT, slateChurch) > 20, 'Slate church distance > 20');

  // Stone: light pale stone (high L* value vs darker parchment ground)
  const stoneHouse = getRoofColor('house', 0.5, 'stone');
  const stoneKeep = getRoofColor('keep', 1.0, 'stone');
  assert.ok(colorDistanceLab(PARCHMENT, stoneHouse) > 12, 'Stone house distance > 12');
  assert.ok(colorDistanceLab(PARCHMENT, stoneKeep) > 12, 'Stone keep distance > 12');

  // Also verify stone theme increases building outline and shadow contrast
  const baseOutline = getBuildingOutlineMultiplier('terracotta', false, false);
  const stoneOutline = getBuildingOutlineMultiplier('stone', false, false);
  assert.ok(stoneOutline > baseOutline, 'Stone theme should have stronger outline');

  const baseShadow = getBuildingShadowColor('terracotta');
  const stoneShadow = getBuildingShadowColor('stone');
  assert.notStrictEqual(baseShadow, stoneShadow, 'Stone theme should have intensified shadow');
});

// -----------------------------------------------------------------------------
// 2. Sample Town Adapting to Terrain & Water
// -----------------------------------------------------------------------------

test('generateSampleTown without terrain places NO pier and places buildings normally', () => {
  const width = 1600;
  const height = 1200;
  const metersPerUnit = 0.5;
  const sample = generateSampleTown(width, height, metersPerUnit, 54321);

  // Without water terrain, pier must NOT be placed
  const piers = sample.filter((o) => o.kind === 'pier');
  assert.strictEqual(piers.length, 0, 'No pier placed without water');
  assert.strictEqual(sample.stats.pierPlaced, false);

  const buildings = sample.filter((o): o is TownBuilding => o.kind === 'building');
  assert.ok(buildings.length > 50, 'Generates full collection of sample buildings');
});

test('generateSampleTown with water on the right side places exactly 1 pier (start on land, end in water)', () => {
  const width = 1600;
  const height = 1200;
  const metersPerUnit = 0.5;

  // Water on the right side: x > 1100 is water, x <= 1100 is land
  const waterDividerX = 1100;
  const terrain = {
    isWater: (x: number, y: number) => x > waterDividerX,
  };

  const sample = generateSampleTown(width, height, metersPerUnit, 54321, terrain);

  const piers = sample.filter((o): o is import('../../types/town').TownPier => o.kind === 'pier');
  assert.strictEqual(piers.length, 1, 'Exactly 1 pier should be placed');
  assert.strictEqual(sample.stats.pierPlaced, true);

  const pier = piers[0];
  const startPt = pier.points[0];
  const endPt = pier.points[pier.points.length - 1];

  // Start must be on land
  assert.strictEqual(terrain.isWater(startPt[0], startPt[1]), false, 'Pier start should be on land');
  // End must be in water
  assert.strictEqual(terrain.isWater(endPt[0], endPt[1]), true, 'Pier end should be in water');
});

test('generateSampleTown ensures ZERO buildings have centroid or any vertex on water', () => {
  const width = 1600;
  const height = 1200;
  const metersPerUnit = 0.5;

  // Diagonal water boundary cutting across the bottom-right
  const terrain = {
    isWater: (x: number, y: number) => x + y > 1700,
  };

  const sample = generateSampleTown(width, height, metersPerUnit, 42875, terrain);

  const buildings = sample.filter((o): o is TownBuilding => o.kind === 'building');
  assert.ok(buildings.length > 0);

  for (const bld of buildings) {
    const centroid = polygonCentroid(bld.polygon);
    assert.strictEqual(
      terrain.isWater(centroid[0], centroid[1]),
      false,
      `Building ${bld.id} centroid must not be on water`
    );

    for (const pt of bld.polygon) {
      assert.strictEqual(
        terrain.isWater(pt[0], pt[1]),
        false,
        `Building ${bld.id} vertex [${pt[0]}, ${pt[1]}] must not be on water`
      );
    }
  }

  // Some buildings should have been skipped and reported in stats
  assert.ok(sample.stats.skippedBuildingsCount > 0, 'Stats should record skipped buildings');
});

test('generateSampleTown produces deterministic result for same seed and terrain', () => {
  const width = 1600;
  const height = 1200;
  const metersPerUnit = 0.5;
  const terrain = {
    isWater: (x: number, _y: number) => x > 1150,
  };

  const run1 = generateSampleTown(width, height, metersPerUnit, 9999, terrain);
  const run2 = generateSampleTown(width, height, metersPerUnit, 9999, terrain);

  assert.strictEqual(run1.length, run2.length);
  assert.strictEqual(run1.stats.skippedBuildingsCount, run2.stats.skippedBuildingsCount);
  assert.strictEqual(run1.stats.pierPlaced, run2.stats.pierPlaced);

  for (let i = 0; i < run1.length; i++) {
    assert.strictEqual(run1[i].id, run2[i].id);
    assert.strictEqual(run1[i].kind, run2[i].kind);
  }
});

// -----------------------------------------------------------------------------
// 3. Serialization and Deserialization of townStyle
// -----------------------------------------------------------------------------

test('townStyle with roofTheme is preserved through serializeMapData and deserializeMapData round-trip', () => {
  const testMap: MapData = {
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
      town_slate: {
        id: 'town_slate',
        name: '石切りの港町',
        kind: 'town',
        bounds: { minX: 100, minY: 100, maxX: 100.03, maxY: 100.0225 },
        zoomScale: 4,
        width: 1600,
        height: 1200,
        gridCols: 64,
        gridRows: 48,
        elevationGrid: new Float32Array(64 * 48).fill(40),
        seaLevel: 35.0,
        createdAt: new Date().toISOString(),
        parentId: null,
        seed: 777,
        widthKm: 0.6,
        townStyle: { roofTheme: 'slate' },
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

  const serialized = serializeMapData(testMap);
  const deserialized = deserializeMapData(serialized);

  const restoredTown = deserialized.regionalMaps['town_slate'];
  assert.ok(restoredTown);
  assert.ok(restoredTown.townStyle);
  assert.strictEqual(restoredTown.townStyle.roofTheme, 'slate');
});

test('legacy town map data without townStyle is given the default terracotta roof theme', () => {
  const sanitized = sanitizeTownStyle(undefined, 'town');
  assert.deepStrictEqual(sanitized, { roofTheme: 'terracotta' });

  const sanitizedUnknown = sanitizeTownStyle({ roofTheme: 'unknown_alien' }, 'town');
  assert.deepStrictEqual(sanitizedUnknown, { roofTheme: 'terracotta' });

  // Non-town maps do not receive townStyle
  const nonTown = sanitizeTownStyle(undefined, 'region');
  assert.strictEqual(nonTown, undefined);
});

// -----------------------------------------------------------------------------
// 4. showTownObjects Visibility Logic
// -----------------------------------------------------------------------------

test('drawTownObjects does not render anything when objects array is empty or undefined', () => {
  let callCount = 0;
  const mockCtx = {
    save: () => callCount++,
    restore: () => callCount++,
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
  } as any;

  const opts: DrawTownOptions = {
    metersPerUnit: 0.5,
    zoomPx: 1.0,
    viewBounds: { minX: 0, minY: 0, maxX: 2000, maxY: 1000 },
  };

  drawTownObjects(mockCtx, undefined, opts);
  assert.strictEqual(callCount, 0, 'Should not execute any draw calls for undefined objects');

  drawTownObjects(mockCtx, [], opts);
  assert.strictEqual(callCount, 0, 'Should not execute any draw calls for empty objects');
});
