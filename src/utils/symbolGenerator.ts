/**
 * Cartographic Symbol Auto-Populator & Scatter Brush Generator
 * Generates natural distributions of mountains, forests, settlements, and sea monsters
 * based on elevation, moisture, and temperature biomes.
 */

import { MapSymbolInstance, MapSymbolType, CustomMapAsset } from '../types/symbols';
import { BiomeType, BiomeSymbolRule } from '../types/biome';

export interface TerrainContext {
  biomeGrid?: Uint8Array;
  elevationGrid?: Float32Array;
  gridCols: number;
  gridRows: number;
  mapWidth: number;
  mapHeight: number;
  seaLevel?: number;
}

/**
 * Returns a discrete terrain type identifier at world coordinate (x, y).
 * Types:
 * - 'water': ocean/sea where elevation < seaLevel
 * - `biome_${slot}`: painted biome type (slot 1..255) on land
 * - 'land_none': unpainted land (elevation >= seaLevel, biome 0)
 */
export function getTerrainTypeAt(
  x: number,
  y: number,
  ctx?: TerrainContext
): string {
  if (!ctx || ctx.gridCols <= 0 || ctx.gridRows <= 0 || ctx.mapWidth <= 0 || ctx.mapHeight <= 0) {
    return 'any';
  }

  const { biomeGrid, elevationGrid, gridCols, gridRows, mapWidth, mapHeight, seaLevel = 35.0 } = ctx;
  const cellW = mapWidth / (gridCols - 1);
  const cellH = mapHeight / (gridRows - 1);

  const c = Math.max(0, Math.min(gridCols - 1, Math.round(x / cellW)));
  const r = Math.max(0, Math.min(gridRows - 1, Math.round(y / cellH)));
  const idx = r * gridCols + c;

  const isWater = elevationGrid ? elevationGrid[idx] < seaLevel : false;
  if (isWater) {
    return 'water';
  }

  const biomeSlot = biomeGrid ? biomeGrid[idx] : 0;
  if (biomeSlot > 0) {
    return `biome_${biomeSlot}`;
  }

  return 'land_none';
}

/**
 * Scatters symbols under a brush stroke (for tree brush, mountain brush, or custom pixel symbols)
 * Respects symbol size (scale), scatter density, and scatter radius.
 * Restricts placement ONLY to the terrain type where the cursor center is located.
 */
export function scatterSymbolsUnderBrush(
  centerX: number,
  centerY: number,
  type: MapSymbolType,
  brushRadius: number,
  density: number = 3,
  existingSymbols: MapSymbolInstance[],
  customAssetId?: string,
  baseScale: number = 1.0,
  randomScaleVar: number = 0.15,
  terrainCtx?: TerrainContext
): MapSymbolInstance[] {
  const newSymbols: MapSymbolInstance[] = [];

  // Determine the target terrain type at the center (cursor position)
  const targetTerrainType = terrainCtx ? getTerrainTypeAt(centerX, centerY, terrainCtx) : 'any';

  // Minimum spacing between symbols scales with baseScale and inversely with density
  // Base footprint: custom pixel symbols ~20px, trees ~14px, mountains ~26px, others ~22px
  const naturalSize = type === 'custom'
    ? 20
    : type.startsWith('tree')
    ? 14
    : type.startsWith('mountain')
    ? 26
    : 22;

  // Scaled minimum spacing: when scale is 0.1, spacing is appropriately tiny
  const scaledFootprint = Math.max(3, naturalSize * baseScale);
  // Density factor (1=spread out, 10=compact)
  const densityFactor = Math.max(0.25, 1.25 - (density - 1) * 0.1);
  const minDistance = Math.max(3, scaledFootprint * densityFactor);

  // Number of placement attempts per dab, scaling with density and brush area
  const safeRadius = Math.max(10, brushRadius);
  const areaRatio = Math.pow(safeRadius / 50, 1.3);
  const targetCount = Math.max(1, Math.min(36, Math.round(density * 1.6 * areaRatio)));
  // Extra candidate attempts for rejection sampling when near borders of different terrain types
  const maxAttempts = Math.min(80, targetCount * 3);

  for (let attempt = 0; attempt < maxAttempts && newSymbols.length < targetCount; attempt++) {
    // Uniform 2D circle sampling
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * (safeRadius * 0.95);
    const px = Math.round(centerX + Math.cos(angle) * dist);
    const py = Math.round(centerY + Math.sin(angle) * dist);

    // Map bounds check
    if (terrainCtx) {
      if (px < 0 || px >= terrainCtx.mapWidth || py < 0 || py >= terrainCtx.mapHeight) {
        continue;
      }
      // CRITICAL: Reject any point that doesn't match the cursor's terrain type
      if (targetTerrainType !== 'any') {
        const pointTerrainType = getTerrainTypeAt(px, py, terrainCtx);
        if (pointTerrainType !== targetTerrainType) {
          continue; // Different terrain type -> Do not place symbol here
        }
      }
    }

    // Check minimum distance against existing symbols (check recent/nearby first)
    let tooClose = false;
    for (let j = existingSymbols.length - 1; j >= 0; j--) {
      const sym = existingSymbols[j];
      const dx = sym.x - px;
      const dy = sym.y - py;
      if (Math.abs(dx) > minDistance || Math.abs(dy) > minDistance) continue;
      if (Math.hypot(dx, dy) < minDistance) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // Apply baseScale with random organic variance
    const safeVar = Math.max(0, Math.min(0.5, randomScaleVar));
    const varFactor = 1 + (Math.random() * 2 - 1) * safeVar;
    const finalScale = Math.max(0.05, Number((baseScale * varFactor).toFixed(3)));

    const newSym: MapSymbolInstance = {
      id: `sym_paint_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type,
      customAssetId,
      x: px,
      y: py,
      scale: finalScale,
      rotation: (Math.random() - 0.5) * 0.1,
      flipX: Math.random() < 0.5,
      variant: Math.floor(Math.random() * 3),
    };

    newSymbols.push(newSym);
    existingSymbols.push(newSym); // Prevent overlapping within the same stroke dab
  }

  return newSymbols;
}

/**
 * Weighted random selection of a symbol rule from a biome's symbol definitions,
 * respecting optional elevation constraints and filtering out missing custom assets.
 */
export function pickBiomeSymbolRule(
  rules: BiomeSymbolRule[],
  elevation?: number,
  customAssets?: CustomMapAsset[]
): BiomeSymbolRule | null {
  if (!rules || rules.length === 0) return null;

  const validRules = rules.filter((r) => {
    if (elevation !== undefined) {
      if (r.elevationMin !== undefined && elevation < r.elevationMin) return false;
      if (r.elevationMax !== undefined && elevation > r.elevationMax) return false;
    }
    if (r.kind === 'custom') {
      if (!r.customAssetId) return false;
      if (customAssets && customAssets.length > 0 && !customAssets.some((a) => a.id === r.customAssetId)) {
        return false;
      }
    }
    return true;
  });

  if (validRules.length === 0) return null;

  const totalWeight = validRules.reduce((sum, r) => sum + Math.max(1, r.weight || 1), 0);
  let rand = Math.random() * totalWeight;

  for (const rule of validRules) {
    rand -= Math.max(1, rule.weight || 1);
    if (rand <= 0) {
      return rule;
    }
  }

  return validRules[validRules.length - 1];
}

/**
 * Creates a MapSymbolInstance from a BiomeSymbolRule and BiomeType.
 */
export function createBiomeSymbolInstance(
  rule: BiomeSymbolRule,
  biome: BiomeType,
  x: number,
  y: number
): MapSymbolInstance {
  const minS = Math.max(0.05, rule.scaleMin ?? 0.8);
  const maxS = Math.max(minS, rule.scaleMax ?? 1.2);
  const finalScale = Number((minS + Math.random() * (maxS - minS)).toFixed(3));
  const isCustom = rule.kind === 'custom' || !!rule.customAssetId;
  const symbolType = isCustom ? 'custom' : (rule.symbolType || 'tree_pine_cluster');
  const customAssetId = isCustom ? rule.customAssetId : undefined;

  return {
    id: `sym_biome_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type: symbolType,
    customAssetId,
    x: Math.round(x),
    y: Math.round(y),
    scale: finalScale,
    rotation: (Math.random() - 0.5) * 0.12,
    flipX: biome.flipRandom !== false ? Math.random() < 0.5 : false,
    variant: Math.floor(Math.random() * 3),
    autoBiomeSlot: biome.slot,
  };
}

/**
 * Scatters symbols during a biome brush paint stroke according to the active biome's
 * configured symbol rules, density, minimum spacing, and elevation constraints.
 */
export function scatterSymbolsForBiomeStroke(
  centerX: number,
  centerY: number,
  brushRadius: number,
  biome: BiomeType,
  existingSymbols: MapSymbolInstance[],
  biomeGrid: Uint8Array,
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
  elevationGrid?: Float32Array,
  seaLevel: number = 35.0,
  landOnly: boolean = true,
  customAssets?: CustomMapAsset[]
): MapSymbolInstance[] {
  if (!biome.symbols || biome.symbols.length === 0 || (biome.density ?? 50) <= 0) {
    return [];
  }

  const newSymbols: MapSymbolInstance[] = [];
  const minDist = Math.max(2, biome.minDistance ?? 8);
  const safeRadius = Math.max(8, brushRadius);

  // Density factor (0..100)
  const densityPercent = Math.max(1, Math.min(100, biome.density ?? 50));
  const area = Math.PI * safeRadius * safeRadius;
  const theoreticalCapacity = Math.max(1, Math.round(area / (1.5 * minDist * minDist)));
  const targetCount = Math.max(
    1,
    Math.min(32, Math.round((densityPercent / 100) * Math.min(28, theoreticalCapacity * 0.45 + 2)))
  );
  const maxAttempts = Math.min(80, targetCount * 4);

  // Bounding check optimization: only check existing symbols in local box
  const checkDist = safeRadius + minDist + 20;
  const nearbySymbols = existingSymbols.filter(
    (s) => Math.abs(s.x - centerX) <= checkDist && Math.abs(s.y - centerY) <= checkDist
  );

  const cellW = mapWidth / (cols - 1);
  const cellH = mapHeight / (rows - 1);

  for (let attempt = 0; attempt < maxAttempts && newSymbols.length < targetCount; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * (safeRadius * 0.95);
    const px = Math.round(centerX + Math.cos(angle) * dist);
    const py = Math.round(centerY + Math.sin(angle) * dist);

    if (px < 0 || px >= mapWidth || py < 0 || py >= mapHeight) continue;

    const c = Math.max(0, Math.min(cols - 1, Math.round(px / cellW)));
    const r = Math.max(0, Math.min(rows - 1, Math.round(py / cellH)));
    const idx = r * cols + c;

    // Check biome grid: candidate must be painted with this biome's slot
    if (biomeGrid[idx] !== biome.slot) continue;

    // Check elevation & landOnly
    let elev: number | undefined = undefined;
    if (elevationGrid) {
      elev = elevationGrid[idx];
      if (landOnly && elev < seaLevel) continue;
    }

    // Pick rule matching this elevation and custom assets
    const rule = pickBiomeSymbolRule(biome.symbols, elev, customAssets);
    if (!rule) continue;

    // Check collision against nearby symbols
    let tooClose = false;
    for (let i = nearbySymbols.length - 1; i >= 0; i--) {
      const s = nearbySymbols[i];
      const dx = s.x - px;
      const dy = s.y - py;
      if (Math.abs(dx) > minDist || Math.abs(dy) > minDist) continue;
      if (Math.hypot(dx, dy) < minDist) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const newSym = createBiomeSymbolInstance(rule, biome, px, py);
    newSymbols.push(newSym);
    nearbySymbols.push(newSym);
    existingSymbols.push(newSym);
  }

  return newSymbols;
}

/**
 * Distributes symbols across a newly filled biome region (from biome bucket fill),
 * respecting symbol rules, density, spacing, and elevation constraints.
 */
export function populateSymbolsForBiomeFill(
  changedIndices: number[],
  biome: BiomeType,
  existingSymbols: MapSymbolInstance[],
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
  elevationGrid?: Float32Array,
  seaLevel: number = 35.0,
  landOnly: boolean = true,
  customAssets?: CustomMapAsset[]
): MapSymbolInstance[] {
  if (
    !biome.symbols ||
    biome.symbols.length === 0 ||
    (biome.density ?? 50) <= 0 ||
    changedIndices.length === 0
  ) {
    return [];
  }

  const newSymbols: MapSymbolInstance[] = [];
  const minDist = Math.max(2, biome.minDistance ?? 8);
  const cellW = mapWidth / (cols - 1);
  const cellH = mapHeight / (rows - 1);

  // Approximate pixel area of changed cells
  const areaPx = changedIndices.length * cellW * cellH;
  const theoreticalCapacity = Math.max(1, Math.round(areaPx / (1.5 * minDist * minDist)));
  const densityPercent = Math.max(1, Math.min(100, biome.density ?? 50));
  const targetCount = Math.max(
    1,
    Math.min(1200, Math.round((densityPercent / 100) * theoreticalCapacity * 0.4))
  );

  // Spatial bucket grid for fast collision check
  const bucketSize = Math.max(24, minDist * 2);
  const buckets = new Map<string, { x: number; y: number }[]>();
  const getBucketKey = (bx: number, by: number) =>
    `${Math.floor(bx / bucketSize)}_${Math.floor(by / bucketSize)}`;

  // Populate buckets with existing symbols
  for (const s of existingSymbols) {
    const key = getBucketKey(s.x, s.y);
    const b = buckets.get(key);
    if (b) b.push(s);
    else buckets.set(key, [{ x: s.x, y: s.y }]);
  }

  // Sample candidates from changedIndices
  const stride = Math.max(1, Math.floor(changedIndices.length / (targetCount * 3)));
  const candidateIndices: number[] = [];
  for (let i = 0; i < changedIndices.length; i += stride) {
    candidateIndices.push(changedIndices[i]);
  }

  // Shuffle candidate array (first portion)
  const sampleLimit = Math.min(candidateIndices.length, targetCount * 5);
  for (let i = 0; i < sampleLimit; i++) {
    const swapIdx = i + Math.floor(Math.random() * (candidateIndices.length - i));
    const temp = candidateIndices[i];
    candidateIndices[i] = candidateIndices[swapIdx];
    candidateIndices[swapIdx] = temp;
  }

  for (let i = 0; i < sampleLimit && newSymbols.length < targetCount; i++) {
    const idx = candidateIndices[i];
    const c = idx % cols;
    const r = Math.floor(idx / cols);

    const px = Math.round(c * cellW + (Math.random() - 0.5) * cellW * 0.8);
    const py = Math.round(r * cellH + (Math.random() - 0.5) * cellH * 0.8);

    if (px < 0 || px >= mapWidth || py < 0 || py >= mapHeight) continue;

    let elev: number | undefined = undefined;
    if (elevationGrid) {
      elev = elevationGrid[idx];
      if (landOnly && elev < seaLevel) continue;
    }

    const rule = pickBiomeSymbolRule(biome.symbols, elev, customAssets);
    if (!rule) continue;

    // Check collision in neighbor buckets
    const bX = Math.floor(px / bucketSize);
    const bY = Math.floor(py / bucketSize);
    let tooClose = false;

    for (let ox = -1; ox <= 1 && !tooClose; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const neighbor = buckets.get(`${bX + ox}_${bY + oy}`);
        if (!neighbor) continue;
        for (const pt of neighbor) {
          const dx = pt.x - px;
          const dy = pt.y - py;
          if (Math.abs(dx) > minDist || Math.abs(dy) > minDist) continue;
          if (Math.hypot(dx, dy) < minDist) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) break;
      }
    }
    if (tooClose) continue;

    const newSym = createBiomeSymbolInstance(rule, biome, px, py);
    newSymbols.push(newSym);
    existingSymbols.push(newSym);

    const key = getBucketKey(px, py);
    const b = buckets.get(key);
    if (b) b.push({ x: px, y: py });
    else buckets.set(key, [{ x: px, y: py }]);
  }

  return newSymbols;
}
