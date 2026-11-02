import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskToElevationGrid,
  floodFillMask,
  applyBrushToMask,
  applyPatchToMask,
  createMapDataFromMask,
} from './maskEditor.ts';

test('小さなマスク(8×8)から標高への変換で、陸の内部が seaLevel+12 付近、海が seaLevel-12 付近になること', () => {
  const width = 8;
  const height = 8;
  const seaLevel = 35.0;
  const mask = new Uint8Array(width * height);

  // Fill outer border with sea (0), center 4x4 with land (1)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= 2 && x <= 5 && y >= 2 && y <= 5) {
        mask[y * width + x] = 1;
      } else {
        mask[y * width + x] = 0;
      }
    }
  }

  // Gaussian blur with radius = 1 on small 8x8 mask
  const elev = maskToElevationGrid(mask, width, height, seaLevel, 1.0);

  // Center deep land point: (3, 3) and (4, 4)
  const centerElev = elev[3 * width + 3];
  assert(
    centerElev >= seaLevel + 9 && centerElev <= seaLevel + 12.1,
    `Center land elevation should be near seaLevel+12 (${seaLevel + 12}), got ${centerElev}`
  );

  // Outer corner sea point: (0, 0)
  const cornerElev = elev[0 * width + 0];
  assert(
    cornerElev >= seaLevel - 12.1 && cornerElev <= seaLevel - 9,
    `Corner sea elevation should be near seaLevel-12 (${seaLevel - 12}), got ${cornerElev}`
  );

  // Boundary point between land and sea: should be close to seaLevel
  const borderElev = elev[2 * width + 1];
  assert(
    borderElev > seaLevel - 10 && borderElev < seaLevel + 10,
    `Coastline transition should be intermediate, got ${borderElev}`
  );
});

test('バケツ塗りつぶしが、つながった領域だけを反転すること', () => {
  const width = 10;
  const height = 10;
  const mask = new Uint8Array(width * height);

  // Background is all sea (0)
  // Island A (top-left 3x3)
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      mask[y * width + x] = 1;
    }
  }

  // Island B (bottom-right 3x3), separated by sea
  for (let y = 6; y <= 8; y++) {
    for (let x = 6; x <= 8; x++) {
      mask[y * width + x] = 1;
    }
  }

  // Click inside Island A at (2, 2)
  const fillResult = floodFillMask(mask, width, height, 2, 2);
  assert(fillResult !== null, 'Flood fill should succeed');
  assert.equal(fillResult.updatedCount, 9, 'Should invert exactly 9 pixels of Island A');

  // Island A should now be sea (0)
  assert.equal(mask[2 * width + 2], 0, 'Island A center should be inverted to sea (0)');
  assert.equal(mask[1 * width + 1], 0, 'Island A corner should be inverted to sea (0)');

  // Island B should remain untouched land (1)
  assert.equal(mask[7 * width + 7], 1, 'Island B center must remain land (1)');
  assert.equal(mask[6 * width + 6], 1, 'Island B corner must remain land (1)');

  // Surrounding sea between islands must remain sea (0)
  assert.equal(mask[5 * width + 5], 0, 'Separating ocean must remain sea (0)');
});

test('元に戻す/やり直しでマスクが正しく復元されること', () => {
  const width = 12;
  const height = 12;
  const mask = new Uint8Array(width * height);

  // Initial state: sea (0) with a 2x2 island at (5, 5)
  mask[5 * width + 5] = 1;
  mask[5 * width + 6] = 1;
  mask[6 * width + 5] = 1;
  mask[6 * width + 6] = 1;

  const originalCopy = new Uint8Array(mask);

  // Apply brush stroke to draw a land circle around (2, 2)
  const patch = applyBrushToMask(mask, width, height, 2, 2, 2, 1);
  assert(patch !== null, 'Brush patch should be generated');

  // Verify that (2, 2) is now 1
  assert.equal(mask[2 * width + 2], 1, 'Brush should have made (2, 2) land');

  // 1. Undo: apply 'before'
  applyPatchToMask(mask, width, patch, 'before');
  assert.deepEqual(mask, originalCopy, 'Undo should restore exact original mask state');

  // 2. Redo: apply 'after'
  applyPatchToMask(mask, width, patch, 'after');
  assert.equal(mask[2 * width + 2], 1, 'Redo should re-apply the brush stroke at (2, 2)');

  // 3. Undo again
  applyPatchToMask(mask, width, patch, 'before');
  assert.deepEqual(mask, originalCopy, 'Second undo should restore original mask state');
});

test('createMapDataFromMask constructs complete MapData with Float32Array grids and cells', () => {
  const width = 32;
  const height = 16;
  const mask = new Uint8Array(width * height);
  mask.fill(1); // All land

  const mapData = createMapDataFromMask(mask, width, height, { seed: 9999 });

  assert.equal(mapData.width, 2000);
  assert.equal(mapData.height, 1000);
  assert.equal(mapData.gridCols, 32);
  assert.equal(mapData.gridRows, 16);
  assert.equal(mapData.elevationGrid.length, 32 * 16);
  assert.equal(mapData.temperatureGrid.length, 32 * 16);
  assert.equal(mapData.cells.length, 100 * 50);
  assert.equal(mapData.symbols?.length, 0);
  assert.deepEqual(mapData.regionalMaps, {});

  // Since all land, elevation should be > seaLevel
  assert(mapData.elevationGrid[8 * 32 + 16] > mapData.seaLevel);
});
