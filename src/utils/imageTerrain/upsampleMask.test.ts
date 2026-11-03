import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildElevationFromMask,
  boxBlurHorizontalWrap,
  boxBlurVerticalClamp,
} from './upsampleMask.ts';
import { maskToElevationGrid } from './maskEditor.ts';
import { getEffectiveAnalysisResolution } from '../../components/ImageToTerrainModal.tsx';
import { STANDARD_SEA_LEVEL } from '../tectonicGenerator.ts';

test('buildElevationFromMask: src と dst が同じ大きさのとき、従来の方法(ぼかし→ lerp)と同じ結果になること', () => {
  const width = 128;
  const height = 64;
  const mask = new Uint8Array(width * height);

  // Simple island in center
  for (let y = 16; y < 48; y++) {
    for (let x = 32; x < 96; x++) {
      mask[y * width + x] = 1;
    }
  }

  const legacy = maskToElevationGrid(mask, width, height, STANDARD_SEA_LEVEL, 2.5);
  const upsampled = buildElevationFromMask(
    mask,
    width,
    height,
    width,
    height,
    STANDARD_SEA_LEVEL,
    { blurRadius: 2.5 }
  );

  assert.equal(legacy.length, upsampled.length);
  for (let i = 0; i < legacy.length; i++) {
    assert(
      Math.abs(legacy[i] - upsampled[i]) < 1e-4,
      `Pixel ${i} differs: legacy ${legacy[i]} vs upsampled ${upsampled[i]}`
    );
  }
});

test('円形の陸を持つ 256×128 のマスクを 1024×512 に拡大したとき、陸の面積の割合が誤差2%以内で保たれ、値が [seaLevel − 12, seaLevel + 12] に収まること', () => {
  const srcW = 256;
  const srcH = 128;
  const mask = new Uint8Array(srcW * srcH);

  // Circular island centered at (128, 64) with radius 40
  const cx = 128;
  const cy = 64;
  const r = 40;
  let srcLandPixels = 0;

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= r) {
        mask[y * srcW + x] = 1;
        srcLandPixels++;
      }
    }
  }

  const srcRatio = (srcLandPixels / (srcW * srcH)) * 100;

  const dstW = 1024;
  const dstH = 512;
  const seaLevel = STANDARD_SEA_LEVEL;
  const minElev = seaLevel - 12.0;
  const maxElev = seaLevel + 12.0;

  const elevationGrid = buildElevationFromMask(mask, srcW, srcH, dstW, dstH, seaLevel, { blurRadius: 2.5 });

  let dstLandPixels = 0;
  for (let i = 0; i < elevationGrid.length; i++) {
    const val = elevationGrid[i];
    // Check range bounds
    assert(
      val >= minElev - 1e-4 && val <= maxElev + 1e-4,
      `Elevation out of bounds: ${val} (expected [${minElev}, ${maxElev}])`
    );

    if (val > seaLevel) {
      dstLandPixels++;
    }
  }

  const dstRatio = (dstLandPixels / (dstW * dstH)) * 100;
  const error = Math.abs(srcRatio - dstRatio);

  assert(
    error <= 2.0,
    `Land area ratio error should be <= 2%: src=${srcRatio.toFixed(2)}%, dst=${dstRatio.toFixed(2)}%, error=${error.toFixed(2)}%`
  );
});

test('拡大率が違っても(256→1024 と 256→2048)、海岸線の境界の幅(標高が seaLevel を横切る幅を、地図座標で測った値)が近いこと', () => {
  const srcW = 256;
  const srcH = 128;
  const mask = new Uint8Array(srcW * srcH);

  // Circular island centered at (128, 64) with radius 40
  const cx = 128;
  const cy = 64;
  const r = 40;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) {
        mask[y * srcW + x] = 1;
      }
    }
  }

  const seaLevel = STANDARD_SEA_LEVEL;

  // Measure transition zone width (elevation between seaLevel - 6 and seaLevel + 6)
  // across horizontal line through center (y = dstH / 2)
  const measureTransitionNormalized = (dstW: number, dstH: number): number => {
    const grid = buildElevationFromMask(mask, srcW, srcH, dstW, dstH, seaLevel, { blurRadius: 2.5 });
    const midY = Math.floor(dstH / 2);
    const rowOffset = midY * dstW;

    let minX = -1;
    let maxX = -1;
    // Scan right side of circle edge (from center to right border)
    const midX = Math.floor(dstW / 2);
    for (let x = midX; x < dstW; x++) {
      const val = grid[rowOffset + x];
      if (val <= seaLevel + 6.0 && minX === -1) {
        minX = x;
      }
      if (val <= seaLevel - 6.0 && maxX === -1) {
        maxX = x;
        break;
      }
    }

    const pixelWidth = maxX - minX;
    return pixelWidth / dstW; // Normalized to map coordinate space
  };

  const width1024 = measureTransitionNormalized(1024, 512);
  const width2048 = measureTransitionNormalized(2048, 1024);

  // The normalized transition width should be close within a small relative tolerance (e.g. within 20%)
  const relativeDiff = Math.abs(width1024 - width2048) / ((width1024 + width2048) / 2);
  assert(
    relativeDiff < 0.25,
    `Transition widths in normalized coordinates should be close: 1024=${width1024.toFixed(5)}, 2048=${width2048.toFixed(5)}, diff=${(relativeDiff * 100).toFixed(1)}%`
  );
});

test('箱ぼかし(running sum)の結果が、素朴な実装と一致すること', () => {
  const width = 32;
  const height = 16;
  const radius = 3;
  const size = width * height;

  const src = new Float32Array(size);
  // Fill with test gradient + pulses
  for (let i = 0; i < size; i++) {
    src[i] = (i % 7) * 0.15 + (i % 13 === 0 ? 1.0 : 0.0);
  }

  // 1. Horizontal with wrap
  const fastH = new Float32Array(size);
  boxBlurHorizontalWrap(src, fastH, width, height, radius);

  const naiveH = new Float32Array(size);
  const win = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = ((x + k) % width + width) % width;
        sum += src[y * width + nx];
      }
      naiveH[y * width + x] = sum / win;
    }
  }

  for (let i = 0; i < size; i++) {
    assert(
      Math.abs(fastH[i] - naiveH[i]) < 1e-5,
      `Horizontal mismatch at ${i}: fast=${fastH[i]} vs naive=${naiveH[i]}`
    );
  }

  // 2. Vertical with clamp
  const fastV = new Float32Array(size);
  boxBlurVerticalClamp(src, fastV, width, height, radius);

  const naiveV = new Float32Array(size);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = Math.max(0, Math.min(height - 1, y + k));
        sum += src[ny * width + x];
      }
      naiveV[y * width + x] = sum / win;
    }
  }

  for (let i = 0; i < size; i++) {
    assert(
      Math.abs(fastV[i] - naiveV[i]) < 1e-5,
      `Vertical mismatch at ${i}: fast=${fastV[i]} vs naive=${naiveV[i]}`
    );
  }
});

test('自動判定解像度が、切り抜き範囲の元画像の画素数に応じて、期待どおりに決まること', () => {
  // Auto mode tests
  assert.equal(
    getEffectiveAnalysisResolution('auto', '1024x512', 4000),
    '1024x512',
    'Output 1024x512 caps auto analysis to 1024x512'
  );
  assert.equal(
    getEffectiveAnalysisResolution('auto', '4096x2048', 800),
    '1024x512',
    'Crop width < 1024 / < 2048 selects 1024x512'
  );
  assert.equal(
    getEffectiveAnalysisResolution('auto', '4096x2048', 1500),
    '1024x512',
    'Crop width < 2048 selects 1024x512'
  );
  assert.equal(
    getEffectiveAnalysisResolution('auto', '4096x2048', 3000),
    '2048x1024',
    'Crop width >= 2048 with high output selects 2048x1024'
  );
  assert.equal(
    getEffectiveAnalysisResolution('auto', '8192x4096', 5000),
    '2048x1024',
    'Auto never exceeds 2048x1024'
  );

  // Manual mode tests
  assert.equal(
    getEffectiveAnalysisResolution('1024x512', '4096x2048', 5000),
    '1024x512',
    'Manual 1024x512 respected'
  );
  assert.equal(
    getEffectiveAnalysisResolution('2048x1024', '4096x2048', 5000),
    '2048x1024',
    'Manual 2048x1024 respected'
  );
  assert.equal(
    getEffectiveAnalysisResolution('4096x2048', '8192x4096', 4500),
    '4096x2048',
    'Manual 4096x2048 allowed when crop >= 4096'
  );
  assert.equal(
    getEffectiveAnalysisResolution('4096x2048', '8192x4096', 3000),
    '2048x1024',
    'Manual 4096x2048 falls back when crop < 4096'
  );
});
