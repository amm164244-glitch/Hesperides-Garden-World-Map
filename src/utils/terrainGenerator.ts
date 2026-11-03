import { GeneratorConfig, MapCell, MapData } from '../types/map';
import { generateMesh, MeshData } from './mesh';
import { Mulberry32, Noise2D } from './prng';
import {
  extractClosedContours,
  smoothPolygonChaikin,
} from './marchingSquares';
import { ElevationField } from './elevationField';

const STANDARD_SEA_LEVEL = 35;

/**
 * Enhanced Procedural Terrain Generator
 * - Domain Warping for natural coastlines, peninsulas, and bays
 * - Continental interior mountain chains with surrounding foothill gradients
 * - Small island noise reduction filter based on islandDensity
 * - High-resolution continuous elevation grid & Marching Squares isocontour coastlines
 */
export function generateTerrain(
  width: number,
  height: number,
  config: GeneratorConfig,
  existingMesh?: MeshData,
  onProgress?: (progress: number, message: string) => void
): MapData {
  const seed = config.seed;
  const rng = new Mulberry32(seed);
  const noise = new Noise2D(seed);
  const warpNoise = new Noise2D(seed + 9991);
  const mountainNoise = new Noise2D(seed + 1013);
  const detailNoise = new Noise2D(seed + 4099);

  onProgress?.(15, 'ボロノイメッシュ構築中...');

  // 1. Generate or reuse Voronoi mesh
  const targetCellCount = config.cellCount ?? 4000;
  const mesh =
    existingMesh &&
    existingMesh.cellCount === targetCellCount &&
    existingMesh.width === width &&
    existingMesh.height === height
      ? existingMesh
      : generateMesh(width, height, targetCellCount, seed);

  const cellCount = mesh.cellCount;
  const rawElevations = new Float64Array(cellCount);

  onProgress?.(35, '大陸核と山脈構造を生成中...');

  // 2. Generate Continent Cores with elliptical forms
  const continentCores: {
    x: number;
    y: number;
    radiusX: number;
    radiusY: number;
    angle: number;
    power: number;
  }[] = [];

  const marginX = width * 0.12;
  const marginY = height * 0.12;

  for (let i = 0; i < config.continentCount; i++) {
    const cx = marginX + rng.next() * (width - 2 * marginX);
    const cy = marginY + rng.next() * (height - 2 * marginY);
    const sizeScale = 1.35 / Math.sqrt(config.continentCount);
    const radX = (width * 0.18 + rng.next() * (width * 0.22)) * sizeScale;
    const radY = (height * 0.18 + rng.next() * (height * 0.22)) * sizeScale;
    const angle = rng.next() * Math.PI;
    const power = 0.9 + rng.next() * 0.4;
    continentCores.push({ x: cx, y: cy, radiusX: radX, radiusY: radY, angle, power });
  }

  // Generate Mountain Ridge Spines (tectonic lines positioned inside continent bodies)
  const mountainRidges: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    height: number;
  }[] = [];

  const ridgeCount = Math.max(1, Math.round(config.continentCount * 1.5));
  for (let i = 0; i < ridgeCount; i++) {
    const core = continentCores[i % continentCores.length];
    const len = width * 0.16 + rng.next() * (width * 0.22);
    const dir = core.angle + (rng.next() - 0.5) * 0.9;
    // Keep mountain ridges slightly offset inside the continent center
    const ox = (rng.next() - 0.5) * (core.radiusX * 0.3);
    const oy = (rng.next() - 0.5) * (core.radiusY * 0.3);
    const x1 = core.x + ox - (Math.cos(dir) * len) / 2;
    const y1 = core.y + oy - (Math.sin(dir) * len) / 2;
    const x2 = core.x + ox + (Math.cos(dir) * len) / 2;
    const y2 = core.y + oy + (Math.sin(dir) * len) / 2;
    mountainRidges.push({ x1, y1, x2, y2, height: 35 + rng.next() * 30 });
  }

  onProgress?.(50, 'ドメインワーピングと標高計算中...');

  // 3. Compute raw elevations using Domain Warping
  const baseScale = 0.0028;
  const complexity = config.coastlineComplexity ?? 5;
  const warpStrength = 0.35 + (complexity / 10) * 0.45; // 0.39 ~ 0.8
  const octaves = Math.min(6, Math.max(3, Math.round(2 + complexity * 0.4)));

  for (let i = 0; i < cellCount; i++) {
    const { x, y } = mesh.centroids[i];

    // Distance to edge falloff
    const edgeDistX = Math.min(x, width - x) / (width * 0.08);
    const edgeDistY = Math.min(y, height - y) / (height * 0.08);
    const edgeFactor = Math.min(1.0, Math.min(edgeDistX, edgeDistY));

    // Domain warping sample: distorts x and y with noise
    const warp = warpNoise.domainWarpFBM(x * baseScale, y * baseScale, warpStrength, octaves);
    const warpedX = x + warp.qx * (width * 0.12 * warpStrength);
    const warpedY = y + warp.qy * (height * 0.12 * warpStrength);

    // Macro landmass mask from warped continent cores
    let macroLand = 0;
    for (const core of continentCores) {
      const dx = warpedX - core.x;
      const dy = warpedY - core.y;
      const cosA = Math.cos(core.angle);
      const sinA = Math.sin(core.angle);
      const rotX = dx * cosA + dy * sinA;
      const rotY = -dx * sinA + dy * cosA;

      const normDist = Math.sqrt(
        (rotX / core.radiusX) ** 2 + (rotY / core.radiusY) ** 2
      );

      if (normDist < 1.0) {
        const falloff = Math.cos(normDist * (Math.PI / 2)) ** 1.6;
        macroLand = Math.max(macroLand, falloff * core.power);
      }
    }

    // FBM fractal noise for detailed coastlines, bays, and peninsulas
    const fbmVal = (warp.value * 0.5 + 0.5);

    // Mountain noise: ridged multifractal
    const mountainVal = mountainNoise.ridged(
      x * baseScale * 2.8,
      y * baseScale * 2.8,
      4,
      0.55,
      2.2
    );

    // Interior mountain tectonic ridge proximity
    let ridgeInfluence = 0;
    for (const ridge of mountainRidges) {
      const dx = ridge.x2 - ridge.x1;
      const dy = ridge.y2 - ridge.y1;
      const l2 = dx * dx + dy * dy;
      let t = 0;
      if (l2 > 0) {
        t = Math.max(0, Math.min(1, ((x - ridge.x1) * dx + (y - ridge.y1) * dy) / l2));
      }
      const projX = ridge.x1 + t * dx;
      const projY = ridge.y1 + t * dy;
      const dist = Math.hypot(x - projX, y - projY);
      const widthThreshold = width * 0.09;
      if (dist < widthThreshold) {
        const rFactor = (1 - dist / widthThreshold) ** 2.2;
        ridgeInfluence = Math.max(ridgeInfluence, rFactor * (ridge.height / 50));
      }
    }

    // Fine detail noise
    const detail = detailNoise.sample(x * baseScale * 7, y * baseScale * 7) * 0.12;

    // Combine terrain layers: mountains only emerge strongly inside continental bodies
    const mountainMultiplier = (config.mountainStrength / 5); // 0.2 ~ 2.0
    const inlandMountainFactor = Math.pow(Math.max(0, macroLand - 0.25), 1.2);

    let elevation =
      macroLand * 0.58 +
      fbmVal * 0.32 +
      mountainVal * 0.32 * mountainMultiplier * inlandMountainFactor +
      ridgeInfluence * 0.48 * mountainMultiplier * Math.max(0.3, macroLand) +
      detail;

    // Apply edge falloff
    elevation *= Math.pow(edgeFactor, 0.75);

    rawElevations[i] = elevation;
  }

  onProgress?.(70, '海面校正と水域・孤島フィルタリング中...');

  // 4. Calibrate Sea Level and normalize elevations to 0 - 100
  const sorted = Array.from(rawElevations).sort((a, b) => a - b);
  const seaThresholdIndex = Math.floor((config.seaRatio / 100) * cellCount);
  const targetSeaThreshold = sorted[Math.min(cellCount - 1, Math.max(0, seaThresholdIndex))];

  const cells: MapCell[] = new Array(cellCount);

  for (let i = 0; i < cellCount; i++) {
    const raw = rawElevations[i];
    let elevation: number;

    if (raw <= targetSeaThreshold) {
      const minVal = sorted[0];
      const range = Math.max(1e-5, targetSeaThreshold - minVal);
      const t = (raw - minVal) / range;
      elevation = t * STANDARD_SEA_LEVEL;
    } else {
      const maxVal = sorted[sorted.length - 1];
      const range = Math.max(1e-5, maxVal - targetSeaThreshold);
      const t = (raw - targetSeaThreshold) / range;
      const curvedT = Math.pow(t, 0.95);
      elevation = STANDARD_SEA_LEVEL + curvedT * (100 - STANDARD_SEA_LEVEL);
    }

    elevation = Math.max(0, Math.min(100, elevation));

    cells[i] = {
      id: i,
      x: mesh.centroids[i].x,
      y: mesh.centroids[i].y,
      elevation,
      isWater: elevation <= STANDARD_SEA_LEVEL,
      neighbors: mesh.neighbors[i],
      polygon: mesh.polygons[i],
    };
  }

  // 5. Island Noise Reduction (Connected-Component Analysis)
  // config.islandDensity (1 to 10):
  // At density 1: minIslandCells = 30 (removes almost all tiny specks)
  // At density 10: minIslandCells = 3 (allows many small archipelagos)
  const densityNormalized = (config.islandDensity ?? 5) / 10;
  const minIslandCells = Math.max(3, Math.round(32 * (1 - densityNormalized * 0.85)));

  const landVisited = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    if (cells[i].isWater || landVisited[i]) continue;

    // Find all connected land cells in this island
    const islandCells: number[] = [];
    const queue = [i];
    landVisited[i] = 1;

    while (queue.length > 0) {
      const curr = queue.pop()!;
      islandCells.push(curr);

      for (const nid of cells[curr].neighbors) {
        if (!cells[nid].isWater && !landVisited[nid]) {
          landVisited[nid] = 1;
          queue.push(nid);
        }
      }
    }

    // If island is smaller than threshold, submerge it to shallow coastal water!
    if (islandCells.length < minIslandCells) {
      for (const cid of islandCells) {
        cells[cid].elevation = STANDARD_SEA_LEVEL - 3;
        cells[cid].isWater = true;
      }
    }
  }

  // Also remove tiny 1-2 cell isolated water holes on land
  const waterHoleVisited = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    if (!cells[i].isWater || waterHoleVisited[i]) continue;

    const holeCells: number[] = [];
    const queue = [i];
    waterHoleVisited[i] = 1;
    let reachesBorder = false;

    while (queue.length > 0) {
      const curr = queue.pop()!;
      holeCells.push(curr);

      if (
        cells[curr].x <= width * 0.02 ||
        cells[curr].x >= width * 0.98 ||
        cells[curr].y <= height * 0.02 ||
        cells[curr].y >= height * 0.98
      ) {
        reachesBorder = true;
      }

      for (const nid of cells[curr].neighbors) {
        if (cells[nid].isWater && !waterHoleVisited[nid]) {
          waterHoleVisited[nid] = 1;
          queue.push(nid);
        }
      }
    }

    // Tiny 1-2 cell hole: fill up to land
    if (!reachesBorder && holeCells.length <= 2) {
      for (const cid of holeCells) {
        cells[cid].elevation = STANDARD_SEA_LEVEL + 4;
        cells[cid].isWater = false;
      }
    }
  }

  // 6. Classify Ocean vs Inland Lakes
  const oceanVisited = new Uint8Array(cellCount);
  const oceanQueue: number[] = [];

  for (let i = 0; i < cellCount; i++) {
    const c = cells[i];
    if (
      c.isWater &&
      (c.x <= width * 0.03 ||
        c.x >= width * 0.97 ||
        c.y <= height * 0.03 ||
        c.y >= height * 0.97)
    ) {
      oceanVisited[i] = 1;
      c.isOcean = true;
      c.isLake = false;
      oceanQueue.push(i);
    }
  }

  let head = 0;
  while (head < oceanQueue.length) {
    const currentId = oceanQueue[head++];
    const neighbors = cells[currentId].neighbors;
    for (const nid of neighbors) {
      if (!oceanVisited[nid] && cells[nid].isWater) {
        oceanVisited[nid] = 1;
        cells[nid].isOcean = true;
        cells[nid].isLake = false;
        oceanQueue.push(nid);
      }
    }
  }

  for (let i = 0; i < cellCount; i++) {
    const c = cells[i];
    if (c.isWater) {
      if (!oceanVisited[i]) {
        c.isLake = true;
        c.isOcean = false;
      }
    } else {
      c.isLake = false;
      c.isOcean = false;
    }
  }



  onProgress?.(85, '高精細等高線と海岸線を抽出中...');

  // 8. Build High-Resolution Elevation Grid with Bicubic Interpolation and Closed Contours
  const gridCols = 350;
  const gridRows = 225;
  const cellW = width / (gridCols - 1);
  const cellH = height / (gridRows - 1);
  const rawGrid = new Float32Array(gridCols * gridRows);

  const gridSpatial = new Map<string, number>();
  for (let i = 0; i < cellCount; i++) {
    const gx = Math.floor(cells[i].x / cellW);
    const gy = Math.floor(cells[i].y / cellH);
    gridSpatial.set(`${gx},${gy}`, i);
  }

  for (let r = 0; r < gridRows; r++) {
    const gy = r * cellH;
    for (let c = 0; c < gridCols; c++) {
      const gx = c * cellW;
      let bestId = 0;
      let minD2 = Infinity;
      const gCellX = Math.floor(gx / cellW);
      const gCellY = Math.floor(gy / cellH);

      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const cid = gridSpatial.get(`${gCellX + dx},${gCellY + dy}`);
          if (cid !== undefined) {
            const d2 = (cells[cid].x - gx) ** 2 + (cells[cid].y - gy) ** 2;
            if (d2 < minD2) {
              minD2 = d2;
              bestId = cid;
            }
          }
        }
      }

      rawGrid[r * gridCols + c] = cells[bestId].elevation;
    }
  }

  // Create Continuous Bicubic Elevation Field with pre-contour fractal noise
  const elevField = new ElevationField(width, height, gridCols, gridRows, rawGrid, seed, 0.7);
  const smoothGrid = elevField.generateSampleGrid(gridCols, gridRows);

  // Extract closed coastline polygons at seaLevel
  const minAreaThreshold = config.minIslandArea ?? 45;
  const rawPolygons = extractClosedContours(
    smoothGrid,
    gridCols,
    gridRows,
    width,
    height,
    STANDARD_SEA_LEVEL,
    minAreaThreshold
  );

  // Smooth polygons using Chaikin corner-cutting (preserves closure, zero self-intersections)
  const smoothedCoastlines: [number, number][][] = rawPolygons.map((poly) => {
    const sm = smoothPolygonChaikin(poly, 2);
    return sm.map((p) => [p.x, p.y]);
  });

  // Extract 1 subtle shallow ocean ripple contour (波紋)
  const ripplePolygons = extractClosedContours(
    smoothGrid,
    gridCols,
    gridRows,
    width,
    height,
    STANDARD_SEA_LEVEL - 1.5,
    minAreaThreshold * 1.2
  );
  const smoothedRipples: [number, number][][] = ripplePolygons.map((poly) => {
    const sm = smoothPolygonChaikin(poly, 2);
    return sm.map((p) => [p.x, p.y]);
  });

  onProgress?.(100, '地形生成完了！');

  return {
    width,
    height,
    cellCount,
    seed,
    cells,
    seaLevel: STANDARD_SEA_LEVEL,
    worldWidthKm: config.worldWidthKm || 40000,
    config,
    createdAt: new Date().toISOString(),
    gridCols,
    gridRows,
    elevationGrid: smoothGrid,
    regionalMaps: {},
    coastlines: smoothedCoastlines,
    ripples: smoothedRipples,
  };
}
