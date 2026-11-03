import { GeneratorConfig, MapCell, MapData, TectonicPlate } from '../types/map';
import { Mulberry32, Noise2D } from './prng';
import { applyErosion } from './erosion';

export const STANDARD_SEA_LEVEL = 35.0;

/**
 * Tectonic Plate Planetary World Generator
 * Simulates 8-16 continental and oceanic tectonic plates with domain-warped boundary curvature,
 * multi-scale fBm undulating interior relief, ridged mountain ranges with wide foothills and branching spurs,
 * inland elevation gradients, and fast geomorphic erosion simulation.
 */
export function generateTectonicWorld(
  width: number,
  height: number,
  config: GeneratorConfig,
  onProgress?: (progress: number, message: string) => void
): MapData {
  const seed = config.seed;
  const rng = new Mulberry32(seed);
  const macroNoise = new Noise2D(seed + 101);
  const warpNoise = new Noise2D(seed + 997);
  const mountainNoise = new Noise2D(seed + 3331);
  const detailNoise = new Noise2D(seed + 5503);

  // Parse grid resolution
  const [colsStr, rowsStr] = config.gridResolution.split('x');
  const gridCols = parseInt(colsStr, 10);
  const gridRows = parseInt(rowsStr, 10);

  onProgress?.(10, 'プレートテクトニクス構造を初期化中...');

  // 1. Generate Tectonic Plates
  const plateCount = Math.max(8, Math.min(16, config.plateCount || 12));
  const plates: TectonicPlate[] = [];

  const marginX = width * 0.08;
  const marginY = height * 0.08;

  // Continental plates vs Oceanic plates based on continentCount
  const continentalPlateCount = Math.min(plateCount - 3, Math.max(2, config.continentCount || 3));

  for (let i = 0; i < plateCount; i++) {
    const isContinental = i < continentalPlateCount;
    const px = marginX + rng.next() * (width - 2 * marginX);
    const py = marginY + rng.next() * (height - 2 * marginY);

    const angle = rng.next() * Math.PI * 2;
    const speed = 0.4 + rng.next() * 0.6;
    const driftX = Math.cos(angle) * speed;
    const driftY = Math.sin(angle) * speed;

    plates.push({
      id: i,
      x: px,
      y: py,
      isContinental,
      driftX,
      driftY,
      density: isContinental ? 2.7 : 3.0, // Oceanic crust is denser
      baseElevation: isContinental ? 46.0 : 18.0,
    });
  }

  onProgress?.(30, 'プレート境界・衝突山脈・海溝を計算中...');

  const elevationGrid = new Float32Array(gridCols * gridRows);

  const cellW = width / (gridCols - 1);
  const cellH = height / (gridRows - 1);

  const warpScale = 0.0018;
  const warpStrength = 0.35 + (((config as any).coastlineComplexity ?? 5) / 10) * 0.4;
  const mountainMult = (config.mountainStrength / 5.0); // 0.2 ~ 2.0
  const islandDensityFactor = Math.max(1, Math.min(10, config.islandDensity || 5)) / 5.0; // 0.2 ~ 2.0

  // 2. Compute Elevation per grid node
  for (let r = 0; r < gridRows; r++) {
    const wy = r * cellH;

    for (let c = 0; c < gridCols; c++) {
      const wx = c * cellW;

      // 2.1 Multi-frequency Domain Warping: low-frequency large distortion to curve plate boundaries
      const lowWarpX = warpNoise.fbm(wx * 0.00065, wy * 0.00065, 3, 0.5, 2.0);
      const lowWarpY = warpNoise.fbm(wx * 0.00065 + 41.3, wy * 0.00065 + 83.7, 3, 0.5, 2.0);
      const warp = warpNoise.domainWarpFBM(wx * warpScale, wy * warpScale, warpStrength, 3);
      const warpedX = wx + (lowWarpX - 0.5) * (width * 0.26) + warp.qx * (width * 0.08);
      const warpedY = wy + (lowWarpY - 0.5) * (height * 0.26) + warp.qy * (height * 0.08);

      // Find closest and 2nd closest tectonic plates with distance perturbation
      const cellJitter = macroNoise.sample(warpedX * 0.0022, warpedY * 0.0022) * (width * 0.045);
      let p1 = plates[0];
      let p2 = plates[1];
      let d1Sq = Infinity;
      let d2Sq = Infinity;

      for (let p = 0; p < plates.length; p++) {
        const plate = plates[p];
        // Toroidal distance wrapping in X for spherical planetary feeling
        let dx = Math.abs(warpedX - plate.x);
        if (dx > width * 0.5) dx = width - dx;
        const dy = warpedY - plate.y;
        // Irregular boundary perturbation so plate borders meander naturally
        const pJitter = Math.sin(plate.id * 73.13) * cellJitter;
        const distSq = dx * dx + dy * dy + pJitter * (dx + dy + 10.0);

        if (distSq < d1Sq) {
          d2Sq = d1Sq;
          p2 = p1;
          d1Sq = distSq;
          p1 = plate;
        } else if (distSq < d2Sq) {
          d2Sq = distSq;
          p2 = plate;
        }
      }
      const d1 = Math.sqrt(Math.max(0, d1Sq));
      const d2 = Math.sqrt(Math.max(0, d2Sq));

      // Plate boundary proximity with broader transition zone
      const boundaryFactor = Math.min(1.0, Math.max(0.0, (d2 - d1) / (width * 0.14)));

      // Relative motion vector along boundary normal
      const nx = (p2.x - p1.x);
      const ny = (p2.y - p1.y);
      const nLen = Math.hypot(nx, ny) || 1.0;
      const normX = nx / nLen;
      const normY = ny / nLen;

      // Convergence rate: positive means plates colliding, negative means pulling apart
      const relMotion = (p1.driftX - p2.driftX) * normX + (p1.driftY - p2.driftY) * normY;

      // 2.2 Synthesize rich elevation inside the plate:
      // Base elevation + fBm macro swell (大きなうねり) + ridged interior hills/ridges (山の尾根)
      const macroSwell = macroNoise.fbm(warpedX * 0.0013, warpedY * 0.0013, 4, 0.5, 2.0) * 24.0 - 12.0;
      const interiorRidges = mountainNoise.ridged(warpedX * 0.0028, warpedY * 0.0028, 3, 0.55, 2.1) * 16.0;

      let elev = p1.baseElevation + macroSwell + (p1.isContinental ? interiorRidges : interiorRidges * 0.35);

      // Continental interior core boost
      if (p1.isContinental) {
        const coreDist = 1.0 - Math.min(1.0, d1 / (width * 0.24 * (config.continentSize / 5.0)));
        elev += Math.pow(Math.max(0.0, coreDist), 1.2) * 18.0;
      }

      // 2.3 Mountain ranges at tectonic boundaries with wide foothills and branched spurs
      const nearBoundary = 1.0 - boundaryFactor;
      if (nearBoundary > 0.0) {
        const foothillBelt = Math.exp(-Math.pow(boundaryFactor / 0.65, 1.8)); // broad foothill envelope
        const spineBelt = Math.exp(-Math.pow(boundaryFactor / 0.30, 2.0)); // central sharp ridge

        // Main collision spine (主稜線)
        const mainSpine = mountainNoise.ridged(wx * 0.0032, wy * 0.0032, 4, 0.58, 2.2);
        // Branching cross-spurs perpendicular to boundary (支脈)
        const crossSpurs = mountainNoise.ridged(wx * 0.0075 + normY * 0.7, wy * 0.0075 - normX * 0.7, 3, 0.52, 2.1);

        if (relMotion > 0.05) {
          // Convergent boundary (衝突・沈み込み)
          if (p1.isContinental && p2.isContinental) {
            // Continental-continental collision -> High fold mountain ranges with wide foothills
            const mountainHeight = (mainSpine * 0.65 + crossSpurs * 0.35) * (34.0 * mountainMult);
            const foothillHeight = foothillBelt * (18.0 * mountainMult);
            elev += spineBelt * mountainHeight + foothillHeight;
          } else if (p1.isContinental && !p2.isContinental) {
            // Continental margin subduction (e.g. Andes / Cascades)
            const mountainHeight = (mainSpine * 0.70 + crossSpurs * 0.30) * (26.0 * mountainMult);
            const foothillHeight = foothillBelt * (14.0 * mountainMult);
            elev += spineBelt * mountainHeight + foothillHeight;
          } else if (!p1.isContinental && p2.isContinental) {
            // Ocean trench side: subduction trench (deep abyss)
            elev -= 26.0 * Math.pow(nearBoundary, 2.0);
          } else {
            // Oceanic-oceanic: volcanic island arcs (scales with islandDensity)
            const arcNoise = macroNoise.sample(wx * 0.008, wy * 0.008);
            const arcThresh = 0.35 - (islandDensityFactor - 1.0) * 0.15;
            if (arcNoise > arcThresh) {
              elev += ((arcNoise - arcThresh) * 36.0 + 8.0) * foothillBelt * islandDensityFactor;
            }
          }
        } else if (relMotion < -0.05) {
          // Divergent boundary (拡大境界 / 中央海嶺 or 大陸地溝帯)
          if (!p1.isContinental) {
            // Mid-ocean ridge
            elev += 12.0 * foothillBelt;
          } else {
            // Continental rift valley
            elev -= 14.0 * Math.pow(nearBoundary, 2.0);
          }
        }
      }

      // Oceanic hotspots / archipelagos outside boundaries (scales with islandDensity)
      if (!p1.isContinental && nearBoundary < 0.35) {
        const hotspotVal = macroNoise.sample(wx * 0.012, wy * 0.012);
        const hotspotThresh = 0.55 - (islandDensityFactor - 1.0) * 0.15;
        if (hotspotVal > hotspotThresh) {
          elev += (hotspotVal - hotspotThresh) * 35.0 * islandDensityFactor;
        }
      }

      // Multi-scale fine fractal details
      const detail = detailNoise.sample(wx * 0.015, wy * 0.015) * 3.5;
      elev += detail;

      // Edge falloff at northern and southern map poles
      const polarFalloff = Math.min(1.0, wy / (height * 0.04)) * Math.min(1.0, (height - wy) / (height * 0.04));
      elev *= Math.pow(polarFalloff, 0.5);

      elevationGrid[r * gridCols + c] = elev;
    }
  }

  onProgress?.(55, '海面補正と海岸線勾配の計算中...');

  // 3. Fast Histogram Quantile Calibration for Sea Ratio
  let minElev = Infinity;
  let maxElev = -Infinity;
  const totalCells = elevationGrid.length;
  for (let i = 0; i < totalCells; i++) {
    const val = elevationGrid[i];
    if (val < minElev) minElev = val;
    if (val > maxElev) maxElev = val;
  }

  const BINS = 2048;
  const histogram = new Uint32Array(BINS);
  const invRange = (BINS - 1) / Math.max(1e-5, maxElev - minElev);
  for (let i = 0; i < totalCells; i++) {
    const b = Math.floor((elevationGrid[i] - minElev) * invRange);
    histogram[b]++;
  }

  const targetWaterRatio = Math.max(0.35, Math.min(0.80, config.seaRatio / 100.0));
  const targetCount = Math.floor(targetWaterRatio * totalCells);
  let accCount = 0;
  let seaBin = 0;
  for (let b = 0; b < BINS; b++) {
    accCount += histogram[b];
    if (accCount >= targetCount) {
      seaBin = b;
      break;
    }
  }
  const rawSeaThreshold = minElev + (seaBin / (BINS - 1)) * (maxElev - minElev);

  // Normalize elevations around STANDARD_SEA_LEVEL
  for (let i = 0; i < totalCells; i++) {
    const raw = elevationGrid[i];
    let normalized: number;

    if (raw <= rawSeaThreshold) {
      const range = Math.max(1e-5, rawSeaThreshold - minElev);
      const t = (raw - minElev) / range;
      normalized = t * STANDARD_SEA_LEVEL;
    } else {
      const range = Math.max(1e-5, maxElev - rawSeaThreshold);
      const t = (raw - rawSeaThreshold) / range;
      normalized = STANDARD_SEA_LEVEL + Math.pow(t, 0.92) * (100.0 - STANDARD_SEA_LEVEL);
    }

    elevationGrid[i] = Math.max(0.0, Math.min(100.0, normalized));
  }

  // 4. Inland Distance Gradient (海岸からの距離に応じて標高を緩やかに上げる)
  onProgress?.(65, '内陸高原・標高勾配の計算中...');
  const distGrid = new Float32Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    distGrid[i] = elevationGrid[i] > STANDARD_SEA_LEVEL ? 999999 : 0;
  }

  // Two-pass Chamfer distance transform from coastline
  for (let r = 0; r < gridRows; r++) {
    const rowOffset = r * gridCols;
    for (let c = 0; c < gridCols; c++) {
      const idx = rowOffset + c;
      if (distGrid[idx] === 0) continue;
      let d = distGrid[idx];
      if (c > 0) d = Math.min(d, distGrid[idx - 1] + 1.0);
      if (r > 0) d = Math.min(d, distGrid[idx - gridCols] + 1.0);
      if (c > 0 && r > 0) d = Math.min(d, distGrid[idx - gridCols - 1] + 1.414);
      if (c < gridCols - 1 && r > 0) d = Math.min(d, distGrid[idx - gridCols + 1] + 1.414);
      distGrid[idx] = d;
    }
  }

  for (let r = gridRows - 1; r >= 0; r--) {
    const rowOffset = r * gridCols;
    for (let c = gridCols - 1; c >= 0; c--) {
      const idx = rowOffset + c;
      if (distGrid[idx] === 0) continue;
      let d = distGrid[idx];
      if (c < gridCols - 1) d = Math.min(d, distGrid[idx + 1] + 1.0);
      if (r < gridRows - 1) d = Math.min(d, distGrid[idx + gridCols] + 1.0);
      if (c < gridCols - 1 && r < gridRows - 1) d = Math.min(d, distGrid[idx + gridCols + 1] + 1.414);
      if (c > 0 && r < gridRows - 1) d = Math.min(d, distGrid[idx + gridCols - 1] + 1.414);
      distGrid[idx] = d;
    }
  }

  // Smoothly elevate inland plateaus and mountain roots
  const maxInlandReach = Math.min(gridCols, gridRows) * 0.25;
  for (let i = 0; i < totalCells; i++) {
    if (elevationGrid[i] > STANDARD_SEA_LEVEL) {
      const inlandNorm = Math.min(1.0, distGrid[i] / maxInlandReach);
      elevationGrid[i] += Math.pow(inlandNorm, 0.75) * 15.0;
    }
  }

  // 5. Geomorphic Erosion Simulation (熱侵食＋単純な水による侵食)
  const erosionIterations = config.erosionIterations !== undefined ? config.erosionIterations : 20;
  const erosionStrength = (config.erosionStrength !== undefined ? config.erosionStrength : 5) / 10.0;
  if (erosionIterations > 0 && erosionStrength > 0) {
    onProgress?.(72, '簡易侵食シミュレーションを実行中...');
    applyErosion(
      elevationGrid,
      gridCols,
      gridRows,
      {
        iterations: erosionIterations,
        strength: erosionStrength,
        seaLevel: STANDARD_SEA_LEVEL,
      },
      onProgress
    );
  }

  // 6. Filter tiny island noise below minIslandArea
  const minArea = Math.max(1, config.minIslandArea || 1);
  if (minArea > 1) {
    onProgress?.(90, '小島ノイズのフィルタリング中...');
    const visited = new Uint8Array(totalCells);
    const queue = new Int32Array(totalCells);

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const startIdx = r * gridCols + c;
        if (elevationGrid[startIdx] <= STANDARD_SEA_LEVEL || visited[startIdx]) continue;

        let head = 0;
        let tail = 0;
        queue[tail++] = startIdx;
        visited[startIdx] = 1;

        while (head < tail) {
          const idx = queue[head++];
          const qx = idx % gridCols;
          const qy = Math.floor(idx / gridCols);

          const neighbors = [
            qy > 0 ? (qy - 1) * gridCols + qx : -1,
            qy < gridRows - 1 ? (qy + 1) * gridCols + qx : -1,
            (qx > 0 ? qx - 1 : gridCols - 1) + qy * gridCols,
            (qx < gridCols - 1 ? qx + 1 : 0) + qy * gridCols,
          ];

          for (let n = 0; n < 4; n++) {
            const nIdx = neighbors[n];
            if (
              nIdx >= 0 &&
              elevationGrid[nIdx] > STANDARD_SEA_LEVEL &&
              !visited[nIdx]
            ) {
              visited[nIdx] = 1;
              queue[tail++] = nIdx;
            }
          }
        }

        // Submerge islands smaller than minIslandArea
        if (tail < minArea) {
          for (let i = 0; i < tail; i++) {
            elevationGrid[queue[i]] = STANDARD_SEA_LEVEL - 1.8;
          }
        }
      }
    }
  }

  onProgress?.(85, '地域マップ基盤とセルデータを生成中...');

  // 5. Generate cell sampling for inspector telemetry
  const sampleCols = 100;
  const sampleRows = 50;
  const cells: MapCell[] = [];
  const sW = width / sampleCols;
  const sH = height / sampleRows;

  let cellId = 0;
  for (let sr = 0; sr < sampleRows; sr++) {
    for (let sc = 0; sc < sampleCols; sc++) {
      const cx = (sc + 0.5) * sW;
      const cy = (sr + 0.5) * sH;

      const gc = Math.round((cx / width) * (gridCols - 1));
      const gr = Math.round((cy / height) * (gridRows - 1));
      const idx = gr * gridCols + gc;

      const elev = elevationGrid[idx];
      const isWater = elev <= STANDARD_SEA_LEVEL;

      cells.push({
        id: cellId++,
        x: cx,
        y: cy,
        elevation: elev,
        isWater,
        isOcean: isWater,
        neighbors: [],
      });
    }
  }

  onProgress?.(100, '世界マップ生成完了！');

  return {
    width,
    height,
    gridCols,
    gridRows,
    cellCount: cells.length,
    seed,
    seaLevel: STANDARD_SEA_LEVEL,
    worldWidthKm: config.worldWidthKm || 40000,
    config,
    createdAt: new Date().toISOString(),
    elevationGrid,
    plates,
    cells,
    regionalMaps: {},
  };
}

/**
 * Generates an empty, pristine world with 100% ocean and standard planetary latitudinal temperature.
 * Instantly initialized for pure manual terrain sculpting.
 */
export function generateBlankOceanWorld(
  width: number,
  height: number,
  config: GeneratorConfig
): MapData {
  const [colsStr, rowsStr] = config.gridResolution.split('x');
  const gridCols = parseInt(colsStr, 10);
  const gridRows = parseInt(rowsStr, 10);
  const total = gridCols * gridRows;

  // Uniform deep ocean elevation (16.0 where seaLevel is 35.0)
  const elevationGrid = new Float32Array(total);
  elevationGrid.fill(16.0);

  const cells: MapCell[] = [];
  return {
    width,
    height,
    gridCols,
    gridRows,
    cellCount: 0,
    seed: config.seed,
    seaLevel: STANDARD_SEA_LEVEL,
    worldWidthKm: config.worldWidthKm || 40000,
    config,
    createdAt: new Date().toISOString(),
    elevationGrid,
    plates: [],
    cells,
    regionalMaps: {},
  };
}

