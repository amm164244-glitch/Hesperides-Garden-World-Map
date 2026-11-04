import { MapData, ParentMapSource, RegionalBounds, RegionalMapData, ShapeMaskConfig } from '../types/map';
import { Noise2D } from './prng';
import { computeRegionLayout, formatDistance } from './regionLayout';
import {
  rasterizePolygonMask,
  blurMask,
  applyShapeMaskElevation,
} from './regionShape';
import { sampleElevationBicubic } from './elevationSampling';

export interface GenerateRegionOptions {
  kind?: 'region' | 'town';
  detailScale?: number;
  coastFidelity?: number;
}

/**
 * Converts MapData or RegionalMapData into a uniform ParentMapSource interface.
 */
export function toParentMapSource(source: ParentMapSource | MapData | RegionalMapData): ParentMapSource {
  if ('worldWidthKm' in source) {
    const world = source as MapData;
    return {
      id: null,
      kind: 'region',
      width: world.width,
      height: world.height,
      gridCols: world.gridCols,
      gridRows: world.gridRows,
      elevationGrid: world.elevationGrid,
      seaLevel: world.seaLevel,
      seed: world.seed,
      widthKm: world.worldWidthKm,
    };
  }
  return {
    id: source.id ?? null,
    kind: (source as RegionalMapData).kind,
    width: source.width,
    height: source.height,
    gridCols: source.gridCols,
    gridRows: source.gridRows,
    elevationGrid: source.elevationGrid,
    seaLevel: source.seaLevel,
    seed: source.seed,
    widthKm: (source as RegionalMapData).widthKm ?? (source as any).worldWidthKm ?? 40000,
  };
}

/**
 * Hierarchical Regional Map Generator
 * Inherits macro coastlines and mountain chains seamlessly from the Parent Map (World or Region),
 * while synthesizing high-fidelity micro-detail at 4x or 16x resolution.
 */
export function generateRegionalMap(
  parentSource: ParentMapSource | MapData | RegionalMapData,
  bounds: RegionalBounds,
  zoomScale: 4 | 16 = 4,
  name?: string,
  shapeMask?: ShapeMaskConfig,
  options?: GenerateRegionOptions
): RegionalMapData {
  const parent = toParentMapSource(parentSource);
  const seed = parent.seed + Math.round(bounds.minX * 31 + bounds.minY * 97);
  const microNoise = new Noise2D(seed + 773);
  const detailNoise = new Noise2D(seed + 991);

  // Compute dynamic dimensions and grid resolution matching bounds aspect ratio
  const layout = computeRegionLayout(bounds, zoomScale);
  const regionW = layout.width;
  const regionH = layout.height;
  const gridCols = layout.gridCols;
  const gridRows = layout.gridRows;

  const elevationGrid = new Float32Array(gridCols * gridRows);

  const boundsW = bounds.maxX - bounds.minX;
  const boundsH = bounds.maxY - bounds.minY;

  const parentCols = parent.gridCols;
  const parentRows = parent.gridRows;

  // Helper for bicubic sampling of the parent elevation (with ringing clamp)
  const sampleParentElev = (wx: number, wy: number): number => {
    return sampleElevationBicubic(
      parent.elevationGrid,
      parentCols,
      parentRows,
      parent.width,
      parent.height,
      wx,
      wy,
      true
    );
  };

  const isTown = options?.kind === 'town';
  const detailScale = typeof options?.detailScale === 'number'
    ? options.detailScale
    : (isTown ? 0.15 : 1.0);

  const defaultCoastFidelity = isTown ? 0.9 : 0.8;
  const coastFidelity = typeof options?.coastFidelity === 'number'
    ? Math.max(0, Math.min(1, options.coastFidelity))
    : defaultCoastFidelity;

  const noiseScale = zoomScale === 16 ? 0.03 : 0.012;
  const baseDetailAmp = zoomScale === 16 ? 4.5 : 2.8;
  const detailAmp = baseDetailAmp * detailScale;

  for (let r = 0; r < gridRows; r++) {
    const ty = r / (gridRows - 1);
    const wy = bounds.minY + ty * boundsH;

    for (let c = 0; c < gridCols; c++) {
      const tx = c / (gridCols - 1);
      const wx = bounds.minX + tx * boundsW;

      // 1. Inherit macro elevation from parent Map
      const baseElev = sampleParentElev(wx, wy);

      // 2. Add resolution-dependent micro-fractal detail
      // d = |baseElev - seaLevel|
      // noiseMul = 1 - coastFidelity * exp(-d / 3)
      const d = Math.abs(baseElev - parent.seaLevel);
      const noiseMul = 1.0 - coastFidelity * Math.exp(-d / 3.0);

      const n1 = microNoise.fbm(wx * noiseScale, wy * noiseScale, 3);
      const n2 = detailNoise.sample(wx * noiseScale * 3.5, wy * noiseScale * 3.5);

      // High mountains also get craggy ridged detail
      let mountainBonus = 0;
      if (baseElev > parent.seaLevel + 15) {
        mountainBonus = microNoise.ridged(wx * noiseScale * 2.0, wy * noiseScale * 2.0, 3) * (detailAmp * 1.5);
      }

      // Base micro noise with zero-mean (n1 instead of n1 - 0.5) and coast fidelity factor
      const baseMicro = (n1 * detailAmp + n2 * (detailAmp * 0.4)) * noiseMul;
      const microElev = baseMicro + mountainBonus;

      let rawElev = baseElev + microElev;

      // 3. Prevent small spurious land/sea islands/holes within ±3 of seaLevel:
      // If parent is on one side of sea level, child stays on the same side.
      // If noise pushes it across, clamp to edge of sea level (seaLevel ± 0.05).
      if (coastFidelity > 0 && d <= 3.0) {
        if (baseElev > parent.seaLevel && rawElev < parent.seaLevel) {
          rawElev = parent.seaLevel + 0.05;
        } else if (baseElev < parent.seaLevel && rawElev >= parent.seaLevel) {
          rawElev = parent.seaLevel - 0.05;
        }
      }

      const finalElev = Math.max(0, Math.min(100, rawElev));

      const idx = r * gridCols + c;
      elevationGrid[idx] = finalElev;
    }
  }

  // 4. If shapeMask with outsideSea is specified, carve sea outside the polygon
  if (shapeMask?.outsideSea && shapeMask.polygon && shapeMask.polygon.length >= 3) {
    const rawMask = rasterizePolygonMask(shapeMask.polygon, bounds, gridCols, gridRows);
    const featherRatio = typeof shapeMask.featherRatio === 'number' ? shapeMask.featherRatio : 0.03;
    const blurRadius = Math.max(1, Math.round(Math.min(gridCols, gridRows) * featherRatio));
    const finalMask = featherRatio > 0 ? blurMask(rawMask, gridCols, gridRows, blurRadius) : rawMask;
    applyShapeMaskElevation(elevationGrid, finalMask, parent.seaLevel);
  }

  const regionId = `${isTown ? 'town' : 'region'}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const rawWidthKm = parent.widthKm * (boundsW / parent.width);
  // Keep decimals up to 3 decimal places without rounding to integer
  const widthKm = rawWidthKm < 1 ? Number(rawWidthKm.toFixed(3)) : Number(rawWidthKm.toFixed(2));
  const formattedW = formatDistance(widthKm);
  const defaultName = name || (isTown ? `町マップ (${formattedW})` : `地域マップ (${zoomScale}x: ${formattedW})`);

  return {
    id: regionId,
    name: defaultName,
    kind: isTown ? 'town' : 'region',
    bounds,
    zoomScale,
    width: regionW,
    height: regionH,
    gridCols,
    gridRows,
    elevationGrid,
    seaLevel: parent.seaLevel,
    createdAt: new Date().toISOString(),
    parentId: parent.id ?? null,
    seed,
    widthKm,
    symbols: [],
    outline: shapeMask?.polygon ? [...shapeMask.polygon] : undefined,
    outsideSea: shapeMask ? shapeMask.outsideSea : undefined,
  };
}

