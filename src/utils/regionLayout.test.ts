import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRegionLayout,
  fitBoundsToLimits,
  MIN_ASPECT_RATIO,
  MAX_ASPECT_RATIO,
  STANDARD_REGION_AREA,
  MAX_GRID_DIMENSION,
} from './regionLayout.ts';

test('computeRegionLayout: a=2 produces standard 2000x1000 layout with exact grids', () => {
  // Bounds with 2:1 aspect ratio: 400 x 200
  const bounds2to1 = { minX: 100, minY: 100, maxX: 500, maxY: 300 };
  
  // 4x zoom
  const layout4x = computeRegionLayout(bounds2to1, 4);
  assert.equal(Math.round(layout4x.width), 2000);
  assert.equal(Math.round(layout4x.height), 1000);
  assert.equal(layout4x.gridCols, 1024);
  assert.equal(layout4x.gridRows, 512);

  // 16x zoom
  const layout16x = computeRegionLayout(bounds2to1, 16);
  assert.equal(Math.round(layout16x.width), 2000);
  assert.equal(Math.round(layout16x.height), 1000);
  assert.equal(layout16x.gridCols, 2048);
  assert.equal(layout16x.gridRows, 1024);
});

test('computeRegionLayout: preserves 1:1 scale (zero stretching) across arbitrary aspect ratios', () => {
  const testAspects = [0.2, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0];

  for (const a of testAspects) {
    const boundsW = 300 * a;
    const boundsH = 300;
    const bounds = { minX: 50, minY: 50, maxX: 50 + boundsW, maxY: 50 + boundsH };

    const layout = computeRegionLayout(bounds, 4);

    // Constant area check
    const area = layout.width * layout.height;
    assert.ok(Math.abs(area - STANDARD_REGION_AREA) < 1e-3, `Area should equal ${STANDARD_REGION_AREA}`);

    // Non-distorted scale check: width / boundsW === height / boundsH
    const scaleX = layout.width / boundsW;
    const scaleY = layout.height / boundsH;
    assert.ok(Math.abs(scaleX - scaleY) / scaleX < 1e-4, `Scales X and Y must be identical for aspect ${a}`);

    // Grid dimension check
    assert.ok(layout.gridCols <= MAX_GRID_DIMENSION);
    assert.ok(layout.gridRows <= MAX_GRID_DIMENSION);
  }
});

test('computeRegionLayout: clamps extreme aspect ratios to [1/8, 8] and caps grids to 4096', () => {
  // Extreme flat bounds: 1000 x 50 => ratio 20
  const flatBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 50 };
  const flatLayout = computeRegionLayout(flatBounds, 16);
  const flatAspect = flatLayout.width / flatLayout.height;
  assert.ok(Math.abs(flatAspect - MAX_ASPECT_RATIO) < 1e-4, 'Aspect should clamp to 8');
  assert.ok(flatLayout.gridCols <= MAX_GRID_DIMENSION, 'Cols capped to 4096');

  // Extreme tall bounds: 50 x 1000 => ratio 0.05
  const tallBounds = { minX: 0, minY: 0, maxX: 50, maxY: 1000 };
  const tallLayout = computeRegionLayout(tallBounds, 16);
  const tallAspect = tallLayout.width / tallLayout.height;
  assert.ok(Math.abs(tallAspect - MIN_ASPECT_RATIO) < 1e-4, 'Aspect should clamp to 1/8');
  assert.ok(tallLayout.gridRows <= MAX_GRID_DIMENSION, 'Rows capped to 4096');
});

test('fitBoundsToLimits: handles aspect ratio limits, out-of-bounds translation, and minimum size', () => {
  const parentW = 2000;
  const parentH = 1000;

  // Case 1: Valid bounds within limits -> adjusted: false
  const valid = fitBoundsToLimits({ minX: 200, minY: 200, maxX: 600, maxY: 400 }, parentW, parentH);
  assert.equal(valid.adjusted, false);
  assert.equal(valid.bounds.minX, 200);
  assert.equal(valid.bounds.maxX, 600);
  assert.equal(valid.bounds.minY, 200);
  assert.equal(valid.bounds.maxY, 400);

  // Case 2: Extreme aspect ratio (> 8) expands height around center
  const tooWide = fitBoundsToLimits({ minX: 100, minY: 100, maxX: 1000, maxY: 150 }, parentW, parentH); // 900x50 => ratio 18
  assert.equal(tooWide.adjusted, true);
  const adjustedAspect = (tooWide.bounds.maxX - tooWide.bounds.minX) / (tooWide.bounds.maxY - tooWide.bounds.minY);
  assert.ok(Math.abs(adjustedAspect - MAX_ASPECT_RATIO) < 1e-3);

  // Case 3: Out of parent bounds (partially negative) translates inside
  const outsideLeft = fitBoundsToLimits({ minX: -100, minY: 200, maxX: 200, maxY: 400 }, parentW, parentH);
  assert.equal(outsideLeft.adjusted, true);
  assert.ok(outsideLeft.bounds.minX >= 0);
  assert.ok(outsideLeft.bounds.maxX <= parentW);

  // Case 4: Tiny selection (< 2% parent width) expands to min size
  const tiny = fitBoundsToLimits({ minX: 500, minY: 500, maxX: 505, maxY: 505 }, parentW, parentH);
  assert.equal(tiny.adjusted, true);
  const tinyW = tiny.bounds.maxX - tiny.bounds.minX;
  assert.ok(tinyW >= parentW * 0.02);
});
