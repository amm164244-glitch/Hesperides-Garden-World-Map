/**
 * Cartographic Symbol Auto-Populator & Scatter Brush Generator
 * Generates natural distributions of mountains, forests, settlements, and sea monsters
 * based on elevation, moisture, and temperature biomes.
 */

import { MapSymbolInstance, MapSymbolType } from '../types/symbols';

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
