import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paintBiomeCircle,
  floodFillBiome,
  encodeBiomeGrid,
  decodeBiomeGrid,
  biomeGridToBase64,
  base64ToBiomeGrid,
} from './biomePainter';
import { BIOME_TYPES, SELECTABLE_BIOMES, BIOME_BY_ID } from '../types/biome';

test('Biome definitions contain all required 8 types with valid attributes', () => {
  assert.equal(BIOME_TYPES.length, 8);
  assert.equal(SELECTABLE_BIOMES.length, 7);

  const expectedNames = [
    '指定なし',
    '針葉樹林',
    '広葉樹林',
    '草原',
    '砂漠・荒地',
    '湿地',
    '雪原・ツンドラ',
    '岩山',
  ];

  for (let id = 0; id <= 7; id++) {
    const biome = BIOME_BY_ID[id];
    assert(biome, `Biome ID ${id} must exist`);
    assert.equal(biome.name, expectedNames[id]);
    assert(Array.isArray(biome.rgba) && biome.rgba.length === 4);
    assert(typeof biome.color === 'string');
  }
});

test('paintBiomeCircle: paints only within the specified radius', () => {
  const cols = 50;
  const rows = 50;
  const width = 500;
  const height = 500;
  const grid = new Uint8Array(cols * rows);

  const targetX = 250;
  const targetY = 250;
  const radius = 50; // In map units
  const biomeId = 2; // 広葉樹林

  const result = paintBiomeCircle(
    grid,
    cols,
    rows,
    width,
    height,
    targetX,
    targetY,
    radius,
    biomeId,
    0, // softness 0 (crisp edge)
    { softness: 0, landOnly: false }
  );

  assert(result.changes.length > 0, 'Should paint cells');

  const cellW = width / (cols - 1);
  const cellH = height / (rows - 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const gx = c * cellW;
      const gy = r * cellH;
      const dist = Math.hypot(gx - targetX, gy - targetY);

      if (dist <= radius) {
        assert.equal(grid[idx], biomeId, `Cell at dist ${dist} <= ${radius} should be painted`);
      } else {
        assert.equal(grid[idx], 0, `Cell at dist ${dist} > ${radius} should remain 0`);
      }
    }
  }
});

test('paintBiomeCircle: landOnly skips sea cells under seaLevel', () => {
  const cols = 50;
  const rows = 50;
  const width = 500;
  const height = 500;
  const grid = new Uint8Array(cols * rows);
  const elevationGrid = new Float32Array(cols * rows);
  const seaLevel = 35.0;

  // Half land (50.0), half ocean (20.0)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      elevationGrid[idx] = c < 25 ? 50.0 : 20.0;
    }
  }

  const targetX = 250; // exactly on the border
  const targetY = 250;
  const radius = 60;
  const biomeId = 3; // 草原

  paintBiomeCircle(
    grid,
    cols,
    rows,
    width,
    height,
    targetX,
    targetY,
    radius,
    biomeId,
    0,
    {
      softness: 0,
      landOnly: true,
      elevationGrid,
      seaLevel,
    }
  );

  const cellW = width / (cols - 1);
  const cellH = height / (rows - 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const gx = c * cellW;
      const gy = r * cellH;
      const dist = Math.hypot(gx - targetX, gy - targetY);

      if (dist <= radius) {
        if (elevationGrid[idx] >= seaLevel) {
          assert.equal(grid[idx], biomeId, 'Land cell should be painted');
        } else {
          assert.equal(grid[idx], 0, 'Sea cell must NOT be painted when landOnly is true');
        }
      }
    }
  }
});

test('paintBiomeCircle: softness produces strictly deterministic results for identical input', () => {
  const cols = 60;
  const rows = 60;
  const width = 600;
  const height = 600;

  const grid1 = new Uint8Array(cols * rows);
  const grid2 = new Uint8Array(cols * rows);

  const res1 = paintBiomeCircle(
    grid1,
    cols,
    rows,
    width,
    height,
    300,
    300,
    80,
    4,
    0.6, // 60% softness
    { softness: 60, landOnly: false }
  );

  const res2 = paintBiomeCircle(
    grid2,
    cols,
    rows,
    width,
    height,
    300,
    300,
    80,
    4,
    0.6, // 60% softness
    { softness: 60, landOnly: false }
  );

  assert.equal(res1.changes.length, res2.changes.length, 'Change counts must match');
  assert.deepEqual(Array.from(grid1), Array.from(grid2), 'Both grids must be byte-for-byte identical');
});

test('floodFillBiome: replaces only connected matching region', () => {
  const cols = 20;
  const rows = 20;
  const grid = new Uint8Array(cols * rows);

  // Create an enclosed 4x4 room of biome 1
  for (let r = 5; r <= 8; r++) {
    for (let c = 5; c <= 8; c++) {
      grid[r * cols + c] = 1;
    }
  }
  // Create another disconnected 2x2 room of biome 1 elsewhere
  for (let r = 15; r <= 16; r++) {
    for (let c = 15; c <= 16; c++) {
      grid[r * cols + c] = 1;
    }
  }

  // Flood fill the first room with biome 5 (湿地)
  const startIdx = 6 * cols + 6;
  const result = floodFillBiome(grid, cols, rows, startIdx, 5, { landOnly: false });

  assert.equal(result.changes.length, 16, 'Should fill exactly 16 cells of the 4x4 room');

  // Verify first room is now 5
  for (let r = 5; r <= 8; r++) {
    for (let c = 5; c <= 8; c++) {
      assert.equal(grid[r * cols + c], 5);
    }
  }

  // Verify disconnected second room is untouched (remains 1)
  for (let r = 15; r <= 16; r++) {
    for (let c = 15; c <= 16; c++) {
      assert.equal(grid[r * cols + c], 1, 'Disconnected component should remain unchanged');
    }
  }
});

test('floodFillBiome: treats water as impassable barrier when landOnly is true', () => {
  const cols = 20;
  const rows = 20;
  const grid = new Uint8Array(cols * rows);
  const elevationGrid = new Float32Array(cols * rows).fill(50.0);
  const seaLevel = 35.0;

  // Create a sea barrier dividing left and right at column 10
  for (let r = 0; r < rows; r++) {
    elevationGrid[r * cols + 10] = 20.0; // Sea
  }

  // Fill starting on the left half (column 4)
  const startIdx = 5 * cols + 4;
  const result = floodFillBiome(grid, cols, rows, startIdx, 3, {
    landOnly: true,
    elevationGrid,
    seaLevel,
  });

  assert(result.changes.length > 0);

  // Left half (cols 0..9) should be filled with 3
  assert.equal(grid[5 * cols + 4], 3);
  // Column 10 (sea barrier) should not be filled
  assert.equal(grid[5 * cols + 10], 0, 'Sea barrier must not be filled');
  // Right half (cols 11..19) should NOT be filled
  assert.equal(grid[5 * cols + 15], 0, 'Land beyond sea barrier must not be filled');
});

test('encodeBiomeGrid / decodeBiomeGrid: roundtrips correctly and produces compact output on 2048x1024', () => {
  const total = 2048 * 1024; // 2,097,152 cells
  const grid = new Uint8Array(total);

  // Mostly zero, with scattered biome islands
  for (let i = 50000; i < 50500; i++) grid[i] = 1;
  for (let i = 120000; i < 122000; i++) grid[i] = 4;
  for (let i = 900000; i < 901000; i++) grid[i] = 7;

  const encoded = encodeBiomeGrid(grid);
  const decoded = decodeBiomeGrid(encoded, total);

  assert.deepEqual(Array.from(decoded), Array.from(grid), 'Roundtrip must be identical');

  // Check compact size: 2 million empty/sparse cells should compress to a few hundred bytes
  assert(
    encoded.length < 2000,
    `Encoded sparse 2048x1024 grid size (${encoded.length} bytes) should be under 2KB`
  );

  // Check Base64 conversion
  const b64 = biomeGridToBase64(grid);
  const restoredFromB64 = base64ToBiomeGrid(b64, total);
  assert.deepEqual(Array.from(restoredFromB64), Array.from(grid), 'Base64 roundtrip must match');
});

// ==========================================
// Tests for Customizable Biome Types (Step 10)
// ==========================================
import {
  DEFAULT_BIOME_TYPES,
  BiomeType,
} from '../types/biome';
import {
  addBiomeType,
  updateBiomeType,
  removeBiomeType,
  countBiomeUsage,
  moveBiomeType,
  resetToDefaultBiomeTypes,
  buildBiomeColorTable,
  resolveSymbolRule,
  checkColorProximity,
} from './biomeTypes';
import { serializeMapData, deserializeMapData } from './serialization';
import { MapData } from '../types/map';

test('addBiomeType: assigns smallest unused slot and validates name & constraints', () => {
  const initial = DEFAULT_BIOME_TYPES; // slots 1..7
  assert.equal(initial.length, 7);

  // Add 8th biome -> should get slot 8
  const step1 = addBiomeType(initial, '水晶平原', '#9933ff');
  assert.equal(step1.length, 8);
  assert.equal(step1[7].slot, 8);
  assert.equal(step1[7].name, '水晶平原');
  assert.equal(step1[7].color, '#9933ff');

  // If slot 3 was removed, new addition should reuse slot 3 (smallest unused)
  const missingSlot3 = step1.filter((b) => b.slot !== 3);
  const step2 = addBiomeType(missingSlot3, '竹林', '#33aa55');
  const reusedBiome = step2.find((b) => b.name === '竹林');
  assert(reusedBiome);
  assert.equal(reusedBiome.slot, 3, 'Must reuse smallest unused slot (3)');

  // Duplicate name check
  assert.throws(() => {
    addBiomeType(step1, '水晶平原', '#112233');
  }, /重複/);

  // Empty name check
  assert.throws(() => {
    addBiomeType(step1, '   ', '#112233');
  }, /1〜20文字/);

  // Too long name (>20 chars)
  assert.throws(() => {
    addBiomeType(step1, '123456789012345678901', '#112233');
  }, /1〜20文字/);
});

test('removeBiomeType: replaces cells with 0 across world and regional maps and counts replaced cells', () => {
  const biomeTypes = [...DEFAULT_BIOME_TYPES];
  const worldCols = 10;
  const worldRows = 10;
  const worldGrid = new Uint8Array(worldCols * worldRows);

  // Paint 5 cells with slot 2 (広葉樹林)
  worldGrid[0] = 2;
  worldGrid[1] = 2;
  worldGrid[2] = 2;
  worldGrid[10] = 2;
  worldGrid[11] = 2;

  // Regional map with 3 cells of slot 2
  const regCols = 5;
  const regRows = 5;
  const regGrid = new Uint8Array(regCols * regRows);
  regGrid[0] = 2;
  regGrid[1] = 2;
  regGrid[2] = 2;

  const mapData: MapData = {
    width: 100,
    height: 100,
    gridCols: worldCols,
    gridRows: worldRows,
    worldWidthKm: 40000,
    seaLevel: 35.0,
    seed: 123,
    cellCount: worldCols * worldRows,
    createdAt: new Date().toISOString(),
    elevationGrid: new Float32Array(worldCols * worldRows),
    temperatureGrid: new Float32Array(worldCols * worldRows),
    biomeGrid: worldGrid,
    biomeTypes,
    cells: [],
    symbols: [],
    regionalMaps: {
      reg1: {
        id: 'reg1',
        name: '地方',
        bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
        zoomScale: 4,
        width: 100,
        height: 100,
        gridCols: regCols,
        gridRows: regRows,
        widthKm: 10000,
        seaLevel: 35.0,
        seed: 456,
        createdAt: new Date().toISOString(),
        parentId: null,
        elevationGrid: new Float32Array(regCols * regRows),
        temperatureGrid: new Float32Array(regCols * regRows),
        biomeGrid: regGrid,
        symbols: [],
      },
    },
    config: {} as any,
  };

  // Pre-check usage count
  const usage = countBiomeUsage(mapData);
  assert.equal(usage[2], 8, 'Total 5 world + 3 regional = 8 cells');

  // Remove slot 2
  const removeResult = removeBiomeType(biomeTypes, 2, mapData);
  assert.equal(removeResult.replacedCells, 8);
  assert.equal(removeResult.biomeTypes.some((b) => b.slot === 2), false);

  // Verify world grid cells became 0
  assert.equal(worldGrid[0], 0);
  assert.equal(worldGrid[1], 0);
  assert.equal(worldGrid[2], 0);
  assert.equal(worldGrid[10], 0);
  assert.equal(worldGrid[11], 0);

  // Verify regional grid cells became 0
  assert.equal(regGrid[0], 0);
  assert.equal(regGrid[1], 0);
  assert.equal(regGrid[2], 0);
});

test('buildBiomeColorTable: correctly maps 256 slots and reads custom biome RGBA', () => {
  const customTypes: BiomeType[] = [
    {
      slot: 1,
      name: '針葉樹林',
      color: '#2d6a4f',
      symbols: [],
      density: 50,
      minDistance: 16,
      flipRandom: true,
    },
    {
      slot: 42,
      name: '溶岩大地',
      color: '#ff4500',
      symbols: [],
      density: 70,
      minDistance: 20,
      flipRandom: true,
    },
  ];

  const table = buildBiomeColorTable(customTypes);
  assert.equal(table.length, 256);

  // Slot 0 must be transparent
  assert.deepEqual(Array.from(table[0]), [0, 0, 0, 0]);

  // Slot 1 (#2d6a4f -> r:45, g:106, b:79)
  assert.equal(table[1][0], 0x2d);
  assert.equal(table[1][1], 0x6a);
  assert.equal(table[1][2], 0x4f);
  assert.equal(table[1][3], 215);

  // Slot 42 (#ff4500 -> r:255, g:69, b:0)
  assert.equal(table[42][0], 255);
  assert.equal(table[42][1], 69);
  assert.equal(table[42][2], 0);
  assert.equal(table[42][3], 215);

  // Unassigned slot 99 must be transparent
  assert.deepEqual(Array.from(table[99]), [0, 0, 0, 0]);
});

test('checkColorProximity: detects colors that are too close in RGB distance', () => {
  const biomes: BiomeType[] = [
    { slot: 1, name: 'フォレストA', color: '#105010', symbols: [], density: 50, minDistance: 16, flipRandom: true },
    { slot: 2, name: 'デザート', color: '#d4a373', symbols: [], density: 50, minDistance: 16, flipRandom: true },
  ];

  // Very similar green (#125212 has distance ~3.4 < 50)
  const warning = checkColorProximity('#125212', biomes);
  assert(warning);
  assert.equal(warning.otherName, 'フォレストA');

  // Completely different blue (#0033aa has distance > 100)
  const noWarning = checkColorProximity('#0033aa', biomes);
  assert.equal(noWarning, null);
});

test('resolveSymbolRule: distinguishes custom vs builtin and detects missing custom assets', () => {
  const customAssets = [
    {
      id: 'asset_tree_1',
      name: '自作ドット木',
      category: 'cat_nature',
      dataUrl: 'data:image/png;base64,abc',
      width: 32,
      height: 32,
      originX: 0.5,
      originY: 0.9,
      createdAt: 1,
    },
  ];

  // Builtin rule
  const ruleBuiltin = {
    kind: 'builtin' as const,
    symbolType: 'tree_pine' as const,
    weight: 5,
    scaleMin: 0.8,
    scaleMax: 1.2,
  };
  const resolvedBuiltin = resolveSymbolRule(ruleBuiltin, customAssets);
  assert.equal(resolvedBuiltin.displayName, '針葉樹（スプルース）');
  assert.equal(resolvedBuiltin.isMissing, false);

  // Existing custom asset rule
  const ruleCustom = {
    kind: 'custom' as const,
    customAssetId: 'asset_tree_1',
    weight: 7,
    scaleMin: 1.0,
    scaleMax: 1.5,
  };
  const resolvedCustom = resolveSymbolRule(ruleCustom, customAssets);
  assert.equal(resolvedCustom.displayName, '自作ドット木');
  assert.equal(resolvedCustom.isMissing, false);

  // Missing custom asset rule
  const ruleDeleted = {
    kind: 'custom' as const,
    customAssetId: 'asset_deleted_999',
    weight: 5,
    scaleMin: 0.8,
    scaleMax: 1.2,
  };
  const resolvedDeleted = resolveSymbolRule(ruleDeleted, customAssets);
  assert.equal(resolvedDeleted.isMissing, true);
});

test('serialization: biomeTypes roundtrip and sanitizes unknown biome slots in grids', () => {
  const worldCols = 4;
  const worldRows = 4;
  const worldGrid = new Uint8Array(worldCols * worldRows);

  // Slot 1 (valid default) and Slot 99 (orphaned slot not in biomeTypes)
  worldGrid[0] = 1;
  worldGrid[1] = 99; // Should become 0 upon deserialize

  const mapData: MapData = {
    width: 40,
    height: 40,
    gridCols: worldCols,
    gridRows: worldRows,
    worldWidthKm: 40000,
    seaLevel: 35.0,
    seed: 123,
    cellCount: worldCols * worldRows,
    createdAt: new Date().toISOString(),
    elevationGrid: new Float32Array(worldCols * worldRows),
    temperatureGrid: new Float32Array(worldCols * worldRows),
    biomeGrid: worldGrid,
    biomeTypes: DEFAULT_BIOME_TYPES, // only slots 1..7 exist
    cells: [],
    symbols: [],
    regionalMaps: {},
    config: {} as any,
  };

  const serialized = serializeMapData(mapData);
  assert(serialized.biomeTypes);
  assert.equal(serialized.biomeTypes.length, 7);

  const deserialized = deserializeMapData(serialized);
  assert(deserialized.biomeGrid);
  assert.equal(deserialized.biomeGrid[0], 1, 'Valid slot 1 must be kept');
  assert.equal(deserialized.biomeGrid[1], 0, 'Invalid slot 99 must be sanitized to 0');
});
