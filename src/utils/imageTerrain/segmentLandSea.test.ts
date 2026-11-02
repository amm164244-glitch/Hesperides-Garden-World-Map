import test from 'node:test';
import assert from 'node:assert/strict';
import {
  segmentLandSea,
  rgbToLab,
  deltaE,
  applyMedianFilter,
  runBucketWatershed,
} from './segmentLandSea.ts';

test('rgbToLab and deltaE distinguish parchment sea from green/brown land', () => {
  // Parchment sea color (pale cream/light beige)
  const sea = rgbToLab(235, 230, 210);
  // Mountain/forest land color (earthy brown/green)
  const land = rgbToLab(80, 110, 60);

  const diff = deltaE(sea, land);
  assert(diff > 35, `DeltaE between sea and land should be large, got ${diff}`);
});

test('applyMedianFilter eliminates thin 1px grid line noise in sea', () => {
  const width = 20;
  const height = 20;
  const img = new Uint8ClampedArray(width * height * 4);

  // Fill with pale sea: (230, 230, 210)
  for (let i = 0; i < width * height; i++) {
    img[i * 4] = 230;
    img[i * 4 + 1] = 230;
    img[i * 4 + 2] = 210;
    img[i * 4 + 3] = 255;
  }

  // Draw 1px dark grid line across row y=10
  for (let x = 0; x < width; x++) {
    const idx = (10 * width + x) * 4;
    img[idx] = 40;
    img[idx + 1] = 40;
    img[idx + 2] = 40;
  }

  const filtered = applyMedianFilter(img, width, height, 1);
  // Point on former grid line should now be close to sea color
  const sampleIdx = (10 * width + 10) * 4;
  assert(filtered[sampleIdx] > 180, '1px line noise should be removed by median filter');
});

test('segmentLandSea cleanly separates left-half land from right-half sea', () => {
  const width = 64;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);

  // Left half = Land (Dark Brown / Forest: 65, 85, 45)
  // Right half = Sea (Parchment: 235, 225, 205)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (x < width / 2) {
        data[idx] = 65;
        data[idx + 1] = 85;
        data[idx + 2] = 45;
        data[idx + 3] = 255;
      } else {
        data[idx] = 235;
        data[idx + 1] = 225;
        data[idx + 2] = 205;
        data[idx + 3] = 255;
      }
    }
  }

  const result = segmentLandSea(
    { data, width, height },
    {
      medianRadius: 1,
      marginPx: 2,
      minIslandAreaRatio: 0.05,
      smoothingIterations: 0,
      seaSamples: [
        { id: '1', r: 235, g: 225, b: 205, lab: rgbToLab(235, 225, 205), type: 'sea' },
      ],
      landSamples: [
        { id: '2', r: 65, g: 85, b: 45, lab: rgbToLab(65, 85, 45), type: 'land' },
      ],
    }
  );

  // Deep interior of left half should be land (1)
  assert.equal(result.mask[16 * width + 10], 1, 'Left side should be classified as land');
  // Deep interior of right half should be sea (0)
  assert.equal(result.mask[16 * width + 50], 0, 'Right side should be classified as sea');

  // Outer border margin should be guaranteed sea (0)
  assert.equal(result.mask[0], 0, 'Top-left corner margin must be sea');
  assert.equal(result.mask[1 * width + 1], 0, 'Margin pixel must be sea');

  // Stats check
  assert(result.stats.landRatio > 35 && result.stats.landRatio < 55);
  assert.equal(result.stats.islandCount, 1, 'Should detect 1 connected landmass');
});

test('segmentLandSea ignores thin text and grid noise on sea without false islands', () => {
  const width = 64;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);

  // Entirely parchment sea: (240, 230, 210)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 240;
    data[i * 4 + 1] = 230;
    data[i * 4 + 2] = 210;
    data[i * 4 + 3] = 255;
  }

  // Add 1px text/grid noise dots in the middle
  const noiseCoords = [
    [20, 15],
    [21, 15],
    [20, 16],
    [40, 20],
  ];
  for (const [nx, ny] of noiseCoords) {
    const idx = (ny * width + nx) * 4;
    data[idx] = 30;
    data[idx + 1] = 30;
    data[idx + 2] = 30;
  }

  const result = segmentLandSea(
    { data, width, height },
    {
      medianRadius: 1,
      minIslandAreaRatio: 0.05,
      seaSamples: [
        { id: 's', r: 240, g: 230, b: 210, lab: rgbToLab(240, 230, 210), type: 'sea' },
      ],
    }
  );

  assert.equal(result.stats.islandCount, 0, 'Should not detect noise as an island');
  assert.equal(result.stats.landRatio, 0, 'All sea map should have 0% land ratio');
});
