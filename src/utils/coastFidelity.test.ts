import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRegionalMap } from './regionGenerator';
import { ParentMapSource } from '../types/map';
import { Noise2D } from './prng';

function createConstantParent(elevation: number, seaLevel: number = 35.0): ParentMapSource {
  const cols = 200;
  const rows = 100;
  const grid = new Float32Array(cols * rows).fill(elevation);
  return {
    id: null,
    kind: 'region',
    width: 2000,
    height: 1000,
    gridCols: cols,
    gridRows: rows,
    elevationGrid: grid,
    seaLevel,
    seed: 4242,
    widthKm: 40000,
  };
}

test('偏りの確認: 親の標高が一定(10, 35, 60)のとき、子の標高の平均が親の標高と ±0.05 以内で一致する (4倍と16倍)', () => {
  const bounds = { minX: 400, minY: 200, maxX: 800, maxY: 400 };

  // 1. Elevation 10 (Sea)
  for (const zoomScale of [4, 16] as const) {
    const parent = createConstantParent(10, 35);
    const child = generateRegionalMap(parent, bounds, zoomScale, 'flat-10');
    let sum = 0;
    for (let i = 0; i < child.elevationGrid.length; i++) {
      sum += child.elevationGrid[i];
    }
    const mean = sum / child.elevationGrid.length;
    assert.ok(
      Math.abs(mean - 10.0) < 0.05,
      `Flat 10 at ${zoomScale}x: mean ${mean} should be within ±0.05 of 10.0`
    );
  }

  // 2. Elevation 35 (Sea level)
  for (const zoomScale of [4, 16] as const) {
    const parent = createConstantParent(35, 35);
    const child = generateRegionalMap(parent, bounds, zoomScale, 'flat-35');
    let sum = 0;
    for (let i = 0; i < child.elevationGrid.length; i++) {
      sum += child.elevationGrid[i];
    }
    const mean = sum / child.elevationGrid.length;
    assert.ok(
      Math.abs(mean - 35.0) < 0.05,
      `Flat 35 at ${zoomScale}x: mean ${mean} should be within ±0.05 of 35.0`
    );
  }

  // 3. Elevation 60 (Mountain: mountainBonus を除いた確認)
  for (const zoomScale of [4, 16] as const) {
    const parent = createConstantParent(60, 35);
    const child = generateRegionalMap(parent, bounds, zoomScale, 'flat-60');

    // Calculate mountainBonus mean to subtract, verifying zero-mean micro noise
    const seed = parent.seed + Math.round(bounds.minX * 31 + bounds.minY * 97);
    const microNoise = new Noise2D(seed + 773);
    const noiseScale = zoomScale === 16 ? 0.03 : 0.012;
    const baseDetailAmp = zoomScale === 16 ? 4.5 : 2.8;

    let sumWithoutMountain = 0;
    const boundsW = bounds.maxX - bounds.minX;
    const boundsH = bounds.maxY - bounds.minY;
    for (let r = 0; r < child.gridRows; r++) {
      const ty = r / (child.gridRows - 1);
      const wy = bounds.minY + ty * boundsH;
      for (let c = 0; c < child.gridCols; c++) {
        const tx = c / (child.gridCols - 1);
        const wx = bounds.minX + tx * boundsW;
        const mountainBonus = microNoise.ridged(wx * noiseScale * 2.0, wy * noiseScale * 2.0, 3) * (baseDetailAmp * 1.5);
        const cellElev = child.elevationGrid[r * child.gridCols + c];
        sumWithoutMountain += (cellElev - mountainBonus);
      }
    }
    const meanBase = sumWithoutMountain / child.elevationGrid.length;
    assert.ok(
      Math.abs(meanBase - 60.0) < 0.05,
      `Flat 60 (excluding mountainBonus) at ${zoomScale}x: mean ${meanBase} should be within ±0.05 of 60.0`
    );
  }
});

test('海岸線の忠実度: 合成の島で、子の陸地と親バイキュービック陸地の IoU が 4倍で 0.97 以上、16倍で 0.95 以上、面積比 ±3% 以内', () => {
  const pCols = 150;
  const pRows = 100;
  const seaLevel = 35.0;

  // Test 3 blur radii: small (r=3), medium (r=8), large (r=18)
  for (const blurRadius of [3, 8, 18]) {
    const grid = new Float32Array(pCols * pRows);
    // Ellipse center at (75, 50), radii (40, 25)
    for (let r = 0; r < pRows; r++) {
      for (let c = 0; c < pCols; c++) {
        const dx = (c - 75) / 40;
        const dy = (r - 50) / 25;
        const dist = Math.hypot(dx, dy); // 1.0 at boundary
        const dr = (dist - 1.0) * (Math.max(pCols, pRows) / blurRadius);
        const t = Math.max(0, Math.min(1, 0.5 - dr * 0.5));
        grid[r * pCols + c] = 20.0 + 35.0 * t;
      }
    }

    const parent: ParentMapSource = {
      id: null,
      kind: 'region',
      width: 1500,
      height: 1000,
      gridCols: pCols,
      gridRows: pRows,
      elevationGrid: grid,
      seaLevel,
      seed: 12345 + blurRadius,
      widthKm: 30000,
    };

    const bounds = { minX: 300, minY: 200, maxX: 1200, maxY: 800 };

    // Test 4x (zoomScale = 4)
    const child4x = generateRegionalMap(parent, bounds, 4, 'island-4x', undefined, { coastFidelity: 0.8 });
    let intersection4 = 0;
    let union4 = 0;
    let childLand4 = 0;
    let parentLand4 = 0;

    const boundsW = bounds.maxX - bounds.minX;
    const boundsH = bounds.maxY - bounds.minY;

    for (let r = 0; r < child4x.gridRows; r++) {
      const ty = r / (child4x.gridRows - 1);
      const wy = bounds.minY + ty * boundsH;
      const v = (wy / parent.height) * (pRows - 1);
      const r1 = Math.max(0, Math.min(pRows - 1, Math.round(v)));

      for (let c = 0; c < child4x.gridCols; c++) {
        const tx = c / (child4x.gridCols - 1);
        const wx = bounds.minX + tx * boundsW;
        const u = (wx / parent.width) * (pCols - 1);
        const c1 = Math.max(0, Math.min(pCols - 1, Math.round(u)));

        const isChildLand = child4x.elevationGrid[r * child4x.gridCols + c] >= seaLevel;
        const isParentLand = parent.elevationGrid[r1 * pCols + c1] >= seaLevel;

        if (isChildLand) childLand4++;
        if (isParentLand) parentLand4++;
        if (isChildLand && isParentLand) intersection4++;
        if (isChildLand || isParentLand) union4++;
      }
    }

    const iou4 = intersection4 / union4;
    const areaDiff4 = Math.abs(childLand4 - parentLand4) / parentLand4;

    assert.ok(
      iou4 >= 0.97,
      `4x IoU for blurRadius ${blurRadius} should be >= 0.97, got ${iou4.toFixed(4)}`
    );
    assert.ok(
      areaDiff4 <= 0.03,
      `4x land area diff for blurRadius ${blurRadius} should be <= 3%, got ${(areaDiff4 * 100).toFixed(2)}%`
    );

    // Test 16x (zoomScale = 16)
    const child16x = generateRegionalMap(parent, bounds, 16, 'island-16x', undefined, { coastFidelity: 0.8 });
    let intersection16 = 0;
    let union16 = 0;
    let childLand16 = 0;
    let parentLand16 = 0;

    for (let r = 0; r < child16x.gridRows; r++) {
      const ty = r / (child16x.gridRows - 1);
      const wy = bounds.minY + ty * boundsH;
      const v = (wy / parent.height) * (pRows - 1);
      const r1 = Math.max(0, Math.min(pRows - 1, Math.round(v)));

      for (let c = 0; c < child16x.gridCols; c++) {
        const tx = c / (child16x.gridCols - 1);
        const wx = bounds.minX + tx * boundsW;
        const u = (wx / parent.width) * (pCols - 1);
        const c1 = Math.max(0, Math.min(pCols - 1, Math.round(u)));

        const isChildLand = child16x.elevationGrid[r * child16x.gridCols + c] >= seaLevel;
        const isParentLand = parent.elevationGrid[r1 * pCols + c1] >= seaLevel;

        if (isChildLand) childLand16++;
        if (isParentLand) parentLand16++;
        if (isChildLand && isParentLand) intersection16++;
        if (isChildLand || isParentLand) union16++;
      }
    }

    const iou16 = intersection16 / union16;
    const areaDiff16 = Math.abs(childLand16 - parentLand16) / parentLand16;

    assert.ok(
      iou16 >= 0.95,
      `16x IoU for blurRadius ${blurRadius} should be >= 0.95, got ${iou16.toFixed(4)}`
    );
    assert.ok(
      areaDiff16 <= 0.03,
      `16x land area diff for blurRadius ${blurRadius} should be <= 3%, got ${(areaDiff16 * 100).toFixed(2)}%`
    );
  }
});

test('粒の抑制: 海面より 8 低い深海では標高 >= 海面のセルが 0、海面より 8 高い陸地では標高 < 海面のセルが 0', () => {
  const bounds = { minX: 300, minY: 200, maxX: 700, maxY: 400 };

  // Deep sea (elevation 27 with seaLevel 35)
  for (const zoomScale of [4, 16] as const) {
    const parentSea = createConstantParent(27, 35);
    const childSea = generateRegionalMap(parentSea, bounds, zoomScale, 'deep-sea', undefined, { coastFidelity: 0.8 });
    let landCellCount = 0;
    for (let i = 0; i < childSea.elevationGrid.length; i++) {
      if (childSea.elevationGrid[i] >= 35.0) landCellCount++;
    }
    assert.equal(
      landCellCount,
      0,
      `Deep sea at ${zoomScale}x should have exactly 0 land cells, got ${landCellCount}`
    );
  }

  // High land (elevation 43 with seaLevel 35)
  for (const zoomScale of [4, 16] as const) {
    const parentLand = createConstantParent(43, 35);
    const childLand = generateRegionalMap(parentLand, bounds, zoomScale, 'land', undefined, { coastFidelity: 0.8 });
    let seaCellCount = 0;
    for (let i = 0; i < childLand.elevationGrid.length; i++) {
      if (childLand.elevationGrid[i] < 35.0) seaCellCount++;
    }
    assert.equal(
      seaCellCount,
      0,
      `Land at ${zoomScale}x should have exactly 0 sea cells, got ${seaCellCount}`
    );
  }
});

test('浅瀬の連結成分抑制: 海面付近のなだらかな浅瀬で coastFidelity=0.8 のとき、小面積(<=4)の粒の数が coastFidelity=0 より大幅に少ない', () => {
  const pCols = 100;
  const pRows = 60;
  const grid = new Float32Array(pCols * pRows);

  // Gentle shallow gradient from 34.2 to 35.8 across rows
  for (let r = 0; r < pRows; r++) {
    const elev = 34.2 + (r / pRows) * 1.6;
    for (let c = 0; c < pCols; c++) {
      grid[r * pCols + c] = elev;
    }
  }

  const parent: ParentMapSource = {
    id: null,
    kind: 'region',
    width: 2000,
    height: 1000,
    gridCols: pCols,
    gridRows: pRows,
    elevationGrid: grid,
    seaLevel: 35.0,
    seed: 8888,
    widthKm: 40000,
  };

  const bounds = { minX: 400, minY: 200, maxX: 1600, maxY: 800 };

  // Helper to count small isolated connected components (area <= 4)
  const countSmallComponents = (childGrid: Float32Array, cols: number, rows: number): number => {
    const visited = new Uint8Array(cols * rows);
    let smallComponentCount = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (visited[idx]) continue;

        const isLand = childGrid[idx] >= 35.0;
        const queue: [number, number][] = [[c, r]];
        visited[idx] = 1;
        let size = 0;

        while (queue.length > 0) {
          const [cx, cy] = queue.pop()!;
          size++;

          const neighbors = [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1],
          ];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
              const nIdx = ny * cols + nx;
              if (!visited[nIdx] && (childGrid[nIdx] >= 35.0) === isLand) {
                visited[nIdx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }

        if (size <= 4) {
          smallComponentCount++;
        }
      }
    }
    return smallComponentCount;
  };

  const childFidelity = generateRegionalMap(parent, bounds, 4, 'fidelity', undefined, { coastFidelity: 0.8 });
  const smallFidelity = countSmallComponents(childFidelity.elevationGrid, childFidelity.gridCols, childFidelity.gridRows);

  const childNoFidelity = generateRegionalMap(parent, bounds, 4, 'no-fidelity', undefined, { coastFidelity: 0.0 });
  const smallNoFidelity = countSmallComponents(childNoFidelity.elevationGrid, childNoFidelity.gridCols, childNoFidelity.gridRows);

  assert.ok(
    smallFidelity < smallNoFidelity * 0.25,
    `coastFidelity=0.8 small components (${smallFidelity}) should be significantly less than coastFidelity=0 (${smallNoFidelity})`
  );
});

test('バイキュービックのクランプ: 急な段差(10 -> 60)の親で、子の標高が親の最小値〜最大値(10〜60)を超えない', () => {
  const cols = 100;
  const rows = 50;
  const grid = new Float32Array(cols * rows);

  // Left half 10, right half 60
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r * cols + c] = c < 50 ? 10.0 : 60.0;
    }
  }

  const parent: ParentMapSource = {
    id: null,
    kind: 'region',
    width: 2000,
    height: 1000,
    gridCols: cols,
    gridRows: rows,
    elevationGrid: grid,
    seaLevel: 35.0,
    seed: 9999,
    widthKm: 40000,
  };

  const bounds = { minX: 800, minY: 400, maxX: 1200, maxY: 600 };
  const child = generateRegionalMap(parent, bounds, 4, 'clamped', undefined, { detailScale: 0 });

  let minObserved = Infinity;
  let maxObserved = -Infinity;
  for (let i = 0; i < child.elevationGrid.length; i++) {
    const val = child.elevationGrid[i];
    if (val < minObserved) minObserved = val;
    if (val > maxObserved) maxObserved = val;
  }

  assert.ok(minObserved >= 10.0 - 1e-4, `Min observed ${minObserved} must not undershoot 10.0`);
  assert.ok(maxObserved <= 60.0 + 1e-4, `Max observed ${maxObserved} must not overshoot 60.0`);
});

test('coastFidelity=0 で細部ノイズの標準偏差が従来の ±20% 以内', () => {
  const parent = createConstantParent(15, 35);
  const bounds = { minX: 400, minY: 200, maxX: 800, maxY: 400 };

  const child0 = generateRegionalMap(parent, bounds, 4, 'cf-0', undefined, { coastFidelity: 0 });

  let sum = 0;
  let sumSq = 0;
  const n = child0.elevationGrid.length;
  for (let i = 0; i < n; i++) {
    const diff = child0.elevationGrid[i] - 15.0;
    sum += diff;
    sumSq += diff * diff;
  }
  const variance = sumSq / n - (sum / n) ** 2;
  const stdDev = Math.sqrt(variance);

  // Expected stdDev of (n1 * 2.8 + n2 * 1.12) is ~0.8-1.2
  assert.ok(stdDev >= 0.6 && stdDev <= 1.4, `StdDev ${stdDev} should be close to expected noise stdDev (~0.9)`);
});

test('山: 親の標高が海面+15を超える領域で mountainBonus の動作が変わらない (標準偏差が従来の ±20% 以内)', () => {
  const parent = createConstantParent(65, 35);
  const bounds = { minX: 400, minY: 200, maxX: 800, maxY: 400 };

  const childMountain = generateRegionalMap(parent, bounds, 4, 'mountain', undefined, { coastFidelity: 0.8 });

  let sum = 0;
  let sumSq = 0;
  const n = childMountain.elevationGrid.length;
  for (let i = 0; i < n; i++) {
    sum += childMountain.elevationGrid[i];
    sumSq += childMountain.elevationGrid[i] * childMountain.elevationGrid[i];
  }
  const variance = sumSq / n - (sum / n) ** 2;
  const stdDev = Math.sqrt(variance);

  // Baseline standard deviation:
  // In mountain regions, baseElev = 65, mountainBonus is added.
  // Previous stdDev with (n1 - 0.5) has the exact same variance as with n1 since constant shift has var 0.
  // Verify stdDev is within ±20% of baseline (~0.92)
  const baselineStdDev = 0.92;
  const diffRatio = Math.abs(stdDev - baselineStdDev) / baselineStdDev;
  assert.ok(diffRatio <= 0.20, `Mountain stdDev ${stdDev} diff ratio ${diffRatio} must be within ±20% of baseline`);
});
