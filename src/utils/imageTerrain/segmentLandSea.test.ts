import test from 'node:test';
import assert from 'node:assert/strict';
import {
  segmentLandSea,
  rgbToLab,
  deltaE,
  applyMedianFilter,
  runBucketWatershed,
  runLabKMeans,
  InsufficientSeedsError,
  estimateSegmentationMemory,
} from './segmentLandSea.ts';
import { segmentLandSea as segmentLandSeaRef } from './__reference__/segmentLandSeaReference.ts';

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

test('左半分が茶色、右半分が薄い黄緑の合成画像で、正しく陸と海に分かれること', () => {
  const width = 64;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);

  // Left half = Brown Land: (120, 80, 50)
  // Right half = Pale Yellow-Green Sea (Parchment tone): (220, 230, 195)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (x < width / 2) {
        data[idx] = 120;
        data[idx + 1] = 80;
        data[idx + 2] = 50;
        data[idx + 3] = 255;
      } else {
        data[idx] = 220;
        data[idx + 1] = 230;
        data[idx + 2] = 195;
        data[idx + 3] = 255;
      }
    }
  }

  const result = segmentLandSea(
    { data, width, height },
    {
      medianRadius: 1,
      marginPx: 0,
      minIslandAreaRatio: 0.05,
      smoothingIterations: 0,
      seaSamples: [
        { id: 'sea1', r: 220, g: 230, b: 195, lab: rgbToLab(220, 230, 195), type: 'sea' },
      ],
      landSamples: [
        { id: 'land1', r: 120, g: 80, b: 50, lab: rgbToLab(120, 80, 50), type: 'land' },
      ],
    }
  );

  // Deep interior of left half should be land (1)
  assert.equal(result.mask[16 * width + 10], 1, '左側領域は陸(1)として判定されること');
  // Deep interior of right half should be sea (0)
  assert.equal(result.mask[16 * width + 50], 0, '右側領域は海(0)として判定されること');

  // Stats check
  assert(result.stats.landRatio > 40 && result.stats.landRatio < 60);
  assert.equal(result.stats.islandCount, 1, '陸地塊が1つ検出されること');
});

test('海側に、細い黒線(グリッド線を模擬)や小さな文字状のノイズを入れても、陸海が崩れないこと', () => {
  const width = 64;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);

  // Pale yellow-green sea: (220, 230, 195)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 220;
    data[i * 4 + 1] = 230;
    data[i * 4 + 2] = 195;
    data[i * 4 + 3] = 255;
  }

  // Draw a valid land continent on left side (16x16 pixels): (120, 80, 50)
  for (let y = 8; y < 24; y++) {
    for (let x = 8; x < 24; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = 120;
      data[idx + 1] = 80;
      data[idx + 2] = 50;
    }
  }

  // Add 1px black grid line horizontally across y=16 in the sea (x >= 32)
  for (let x = 32; x < width; x++) {
    const idx = (16 * width + x) * 4;
    data[idx] = 20;
    data[idx + 1] = 20;
    data[idx + 2] = 20;
  }

  // Add 1px text noise dots in the sea
  const noiseCoords = [
    [40, 8],
    [41, 8],
    [40, 9],
    [50, 24],
    [51, 24],
  ];
  for (const [nx, ny] of noiseCoords) {
    const idx = (ny * width + nx) * 4;
    data[idx] = 10;
    data[idx + 1] = 10;
    data[idx + 2] = 10;
  }

  const result = segmentLandSea(
    { data, width, height },
    {
      medianRadius: 2,
      minIslandAreaRatio: 0.05,
      seaSamples: [
        { id: 's', r: 220, g: 230, b: 195, lab: rgbToLab(220, 230, 195), type: 'sea' },
      ],
      landSamples: [
        { id: 'l', r: 120, g: 80, b: 50, lab: rgbToLab(120, 80, 50), type: 'land' },
      ],
    }
  );

  assert.equal(result.stats.islandCount, 1, 'ノイズが島(陸)として誤検知されず、陸塊が1つだけ検出されること');
});

test('画像の外周を海とみなす幅を指定すると、外周が海になること', () => {
  const width = 64;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);

  // Entirely brown land: (120, 80, 50)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 120;
    data[i * 4 + 1] = 80;
    data[i * 4 + 2] = 50;
    data[i * 4 + 3] = 255;
  }

  const marginPx = 4;
  const result = segmentLandSea(
    { data, width, height },
    {
      medianRadius: 0,
      marginPx,
      minIslandAreaRatio: 0.01,
      smoothingIterations: 0,
      landSamples: [
        { id: 'land', r: 120, g: 80, b: 50, lab: rgbToLab(120, 80, 50), type: 'land' },
      ],
    }
  );

  // Border margin pixels must be sea (0)
  for (let x = 0; x < width; x++) {
    assert.equal(result.mask[0 * width + x], 0, 'Top outer edge must be sea');
    assert.equal(result.mask[(marginPx - 1) * width + x], 0, 'Top margin inner edge must be sea');
    assert.equal(result.mask[(height - 1) * width + x], 0, 'Bottom outer edge must be sea');
  }

  for (let y = 0; y < height; y++) {
    assert.equal(result.mask[y * width + 0], 0, 'Left outer edge must be sea');
    assert.equal(result.mask[y * width + (marginPx - 1)], 0, 'Left margin inner edge must be sea');
    assert.equal(result.mask[y * width + (width - 1)], 0, 'Right outer edge must be sea');
  }

  // Interior beyond margin should remain land (1)
  assert.equal(result.mask[16 * width + 32], 1, 'Interior must remain land');
});

test('海シードが0個のとき、watershed を実行せずエラーまたは案内を返すこと', () => {
  const width = 64;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);

  // Entirely brown land: (120, 80, 50)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 120;
    data[i * 4 + 1] = 80;
    data[i * 4 + 2] = 50;
    data[i * 4 + 3] = 255;
  }

  // With margin 0% and only land samples provided, sea seeds will be 0
  assert.throws(
    () => {
      segmentLandSea(
        { data, width, height },
        {
          medianRadius: 0,
          marginPercent: 0,
          marginPx: 0,
          landSamples: [
            { id: 'land', r: 120, g: 80, b: 50, lab: rgbToLab(120, 80, 50), type: 'land' },
          ],
          seaSamples: [],
        }
      );
    },
    (err: unknown) => {
      assert(err instanceof Error);
      assert(
        err.message.includes('海の目印が足りません') || err.message.includes('目印が足りません'),
        `Error message should mention insufficient sea seed: got "${err.message}"`
      );
      assert(err instanceof InsufficientSeedsError);
      assert.equal(err.seedCounts.seaSeedCount, 0, 'Sea seed count should be 0');
      return true;
    }
  );
});

test('合成画像から提案された色の候補に、陸と海それぞれの代表色が含まれること', () => {
  const width = 64;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);

  const landRgb = { r: 120, g: 80, b: 50 };
  const seaRgb = { r: 220, g: 230, b: 195 };

  // Left half = Land, Right half = Sea
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (x < width / 2) {
        data[idx] = landRgb.r;
        data[idx + 1] = landRgb.g;
        data[idx + 2] = landRgb.b;
        data[idx + 3] = 255;
      } else {
        data[idx] = seaRgb.r;
        data[idx + 1] = seaRgb.g;
        data[idx + 2] = seaRgb.b;
        data[idx + 3] = 255;
      }
    }
  }

  const clusters = runLabKMeans({ data, width, height }, 6);
  assert(clusters.length >= 2, 'Should return color clusters');

  const targetSeaLab = rgbToLab(seaRgb.r, seaRgb.g, seaRgb.b);
  const targetLandLab = rgbToLab(landRgb.r, landRgb.g, landRgb.b);

  let hasLandMatch = false;
  let hasSeaMatch = false;

  for (const c of clusters) {
    if (deltaE(c.lab, targetLandLab) < 15) {
      hasLandMatch = true;
    }
    if (deltaE(c.lab, targetSeaLab) < 15) {
      hasSeaMatch = true;
    }
  }

  assert(hasLandMatch, '色の候補に陸の代表色が含まれること');
  assert(hasSeaMatch, '色の候補に海の代表色が含まれること');

  // Verify area proportions sum to ~100%
  const totalRatio = clusters.reduce((sum, c) => sum + c.ratioPercent, 0);
  assert(totalRatio >= 99 && totalRatio <= 101, `Total ratio should be approx 100%, got ${totalRatio}`);
});

test('配列の確保量の見積もり(estimateSegmentationMemory)が、2048×1024 で約60MB以下、4096×2048 で約250MB以下になること', () => {
  const est2048 = estimateSegmentationMemory(2048, 1024);
  const est4096 = estimateSegmentationMemory(4096, 2048);

  assert(
    est2048.mb <= 60,
    `2048x1024 のメモリ見積もりは 60MB 以下であるべき: 実際は ${est2048.mb} MB`
  );
  assert(
    est4096.mb <= 250,
    `4096x2048 のメモリ見積もりは 250MB 以下であるべき: 実際は ${est4096.mb} MB`
  );
  assert.equal(est2048.isTooLarge, false, '2048x1024 は 1.2GB を超えないこと');
  assert.equal(est4096.isTooLarge, false, '4096x2048 は 1.2GB を超えないこと');
});

test('segmentLandSea(軽量化後)と、リファレンス実装を合成画像で比較し、陸海マスクの一致率が 99.5% 以上であること', () => {

  // Synthetic image with:
  // - Left brown land
  // - Right pale yellow-green sea
  // - Thin black lines (grid line noise)
  // - Text-like noise dots
  // - Dark outer border margin
  const width = 128;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Dark border margin
      if (x < 4 || x >= width - 4 || y < 4 || y >= height - 4) {
        data[idx] = 30;
        data[idx + 1] = 25;
        data[idx + 2] = 20;
        data[idx + 3] = 255;
      } else if (x < width / 2) {
        // Brown land
        data[idx] = 120;
        data[idx + 1] = 80;
        data[idx + 2] = 50;
        data[idx + 3] = 255;
      } else {
        // Pale yellow-green parchment sea
        data[idx] = 220;
        data[idx + 1] = 230;
        data[idx + 2] = 195;
        data[idx + 3] = 255;
      }
    }
  }

  // Thin black line (grid line) across sea
  for (let x = width / 2; x < width - 4; x++) {
    const idx = (20 * width + x) * 4;
    data[idx] = 15;
    data[idx + 1] = 15;
    data[idx + 2] = 15;
  }

  // Text-like noise dots
  const textDots = [
    [70, 10], [71, 10], [70, 11],
    [85, 35], [86, 35], [87, 36],
    [100, 45], [101, 45],
  ];
  for (const [nx, ny] of textDots) {
    const idx = (ny * width + nx) * 4;
    data[idx] = 10;
    data[idx + 1] = 10;
    data[idx + 2] = 10;
  }

  const options = {
    medianRadius: 2,
    tolerance: 18,
    marginPx: 4,
    minIslandAreaRatio: 0.01,
    smoothingIterations: 1,
    fillHoles: true,
    seaSamples: [
      { id: 's', r: 220, g: 230, b: 195, lab: rgbToLab(220, 230, 195), type: 'sea' as const },
    ],
    landSamples: [
      { id: 'l', r: 120, g: 80, b: 50, lab: rgbToLab(120, 80, 50), type: 'land' as const },
    ],
  };

  const copyForRef = new Uint8ClampedArray(data);
  const copyForOpt = new Uint8ClampedArray(data);

  const refResult = segmentLandSeaRef({ data: copyForRef, width, height }, options);
  const optResult = segmentLandSea({ data: copyForOpt, width, height }, options);

  let matchCount = 0;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (refResult.mask[i] === optResult.mask[i]) {
      matchCount++;
    }
  }

  const agreementRate = (matchCount / total) * 100;
  assert(
    agreementRate >= 99.5,
    `リファレンス実装とのマスク一致率は 99.5% 以上であること: 実際は ${agreementRate.toFixed(2)}%`
  );
});

