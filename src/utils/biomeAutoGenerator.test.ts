import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBiomeGridFromTerrain,
  calculateLandElevPercentiles,
  resolveSlotWithFallback,
} from './biomeAutoGenerator';

function createTerrainSetup() {
  const gridCols = 64;
  const gridRows = 64;
  const mapWidth = 640;
  const mapHeight = 640;
  const seaLevel = 35;

  const elevationGrid = new Float32Array(gridCols * gridRows);

  // Bottom half: Sea (elevation 20)
  // Top half: Land (elevation 40 to 95)
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const idx = r * gridCols + c;
      if (r < 32) {
        // Land: row 0..31 with varied elevations
        // Rows 0..5: High mountain peak (85..95)
        // Rows 6..15: Mid elevation (50..65)
        // Rows 16..31: Low land (36..45)
        if (r < 6) {
          elevationGrid[idx] = 88 + (c % 7);
        } else if (r < 16) {
          elevationGrid[idx] = 55 + (c % 5);
        } else {
          elevationGrid[idx] = 38 + (c % 4);
        }
      } else {
        // Sea: row 32..63 (elevation 20)
        elevationGrid[idx] = 20;
      }
    }
  }

  return {
    gridCols,
    gridRows,
    mapWidth,
    mapHeight,
    seaLevel,
    elevationGrid,
  };
}

test('1. Determinism: same seed produces identical biome grids; different seeds produce variation', () => {
  const setup = createTerrainSetup();

  const gridA1 = generateBiomeGridFromTerrain({
    ...setup,
    seed: 12345,
    latitudeMode: 'planet',
  });

  const gridA2 = generateBiomeGridFromTerrain({
    ...setup,
    seed: 12345,
    latitudeMode: 'planet',
  });

  const gridB = generateBiomeGridFromTerrain({
    ...setup,
    seed: 99999,
    latitudeMode: 'planet',
  });

  assert.equal(gridA1.length, gridA2.length);
  assert.deepEqual(gridA1, gridA2, 'Same seed must produce byte-identical biomeGrid');

  let differencesWithB = 0;
  for (let i = 0; i < gridA1.length; i++) {
    if (gridA1[i] !== gridB[i]) {
      differencesWithB++;
    }
  }
  assert(differencesWithB > 0, 'Different seeds should produce slight procedural variations');
});

test('2. Water exclusion: cells with elevation < seaLevel or waterGrid >= 128 must strictly be slot 0', () => {
  const setup = createTerrainSetup();
  const waterGrid = new Uint8Array(setup.gridCols * setup.gridRows);

  // Carve a river across land rows 20..25, cols 0..31
  for (let r = 20; r <= 25; r++) {
    for (let c = 0; c < 32; c++) {
      waterGrid[r * setup.gridCols + c] = 255;
    }
  }

  const result = generateBiomeGridFromTerrain({
    ...setup,
    waterGrid,
    seed: 45678,
  });

  for (let r = 0; r < setup.gridRows; r++) {
    for (let c = 0; c < setup.gridCols; c++) {
      const idx = r * setup.gridCols + c;
      const isOcean = setup.elevationGrid[idx] < setup.seaLevel;
      const isRiver = waterGrid[idx] >= 128;

      if (isOcean || isRiver) {
        assert.equal(
          result[idx],
          0,
          `Water cell at (${c}, ${r}) [elev=${setup.elevationGrid[idx]}, water=${waterGrid[idx]}] must be slot 0`
        );
      }
    }
  }
});

test('3. preservePainted: existing non-zero cells in existingBiomeGrid are strictly preserved', () => {
  const setup = createTerrainSetup();
  const existingBiomeGrid = new Uint8Array(setup.gridCols * setup.gridRows);

  // Hand-paint slot 4 (Desert) on a mountain peak cell at (5, 5)
  existingBiomeGrid[5 * setup.gridCols + 5] = 4;
  // Hand-paint slot 6 (Snow) on a lowland cell at (25, 10)
  existingBiomeGrid[25 * setup.gridCols + 10] = 6;

  const resultPreserved = generateBiomeGridFromTerrain({
    ...setup,
    existingBiomeGrid,
    preservePainted: true,
    seed: 33221,
  });

  assert.equal(resultPreserved[5 * setup.gridCols + 5], 4, 'Existing slot 4 at (5, 5) must be preserved');
  assert.equal(resultPreserved[25 * setup.gridCols + 10], 6, 'Existing slot 6 at (25, 10) must be preserved');

  const resultOverwritten = generateBiomeGridFromTerrain({
    ...setup,
    existingBiomeGrid,
    preservePainted: false,
    seed: 33221,
  });

  // At mountain peak (5, 5), high elevation should naturally generate slot 7 (Rock) or 6 (Snow), not hand-painted 4
  assert.notEqual(
    resultOverwritten[5 * setup.gridCols + 5],
    4,
    'When preservePainted is false, existing cell should be reclassified based on terrain'
  );
});

test('4. availableSlots fallback: missing slots fall back cleanly without producing invalid IDs', () => {
  const setup = createTerrainSetup();

  // Restrict to only Grassland (3) and Conifer (1)
  const allowed = [1, 3];
  const result = generateBiomeGridFromTerrain({
    ...setup,
    availableSlots: allowed,
    seed: 77889,
  });

  for (let i = 0; i < result.length; i++) {
    const slot = result[i];
    if (slot !== 0) {
      assert(
        allowed.includes(slot),
        `Cell ${i} has slot ${slot} which is not in availableSlots [${allowed.join(',')}]`
      );
    }
  }

  // Test fallback resolution function specifically
  const availableSet = new Set([2, 3]);
  assert.equal(resolveSlotWithFallback(7, availableSet), 3, 'Rock falls back to Grassland (3)');
  assert.equal(resolveSlotWithFallback(1, availableSet), 2, 'Conifer falls back to Broadleaf (2)');
});

test('5. Terrain elevation classification: high peaks receive mountain/snow (slots 6, 7)', () => {
  const setup = createTerrainSetup();

  const result = generateBiomeGridFromTerrain({
    ...setup,
    seed: 11111,
    latitudeMode: 'uniform',
  });

  // Top rows 0..3 are elevation >= 88 (p96 range)
  let mountainOrSnowCount = 0;
  let totalPeakCells = 0;
  for (let r = 0; r <= 3; r++) {
    for (let c = 0; c < setup.gridCols; c++) {
      const slot = result[r * setup.gridCols + c];
      if (slot === 7 || slot === 6) {
        mountainOrSnowCount++;
      }
      totalPeakCells++;
    }
  }

  assert(
    mountainOrSnowCount / totalPeakCells > 0.65,
    `High peak cells should mostly be mountain or snow (got ${mountainOrSnowCount}/${totalPeakCells})`
  );
});
