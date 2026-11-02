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
