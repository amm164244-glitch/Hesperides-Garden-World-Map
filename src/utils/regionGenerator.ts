import { MapData, ParentMapSource, RegionalBounds, RegionalMapData, ShapeMaskConfig } from '../types/map';
import { Noise2D } from './prng';
import { computeRegionLayout } from './regionLayout';
import {
  rasterizePolygonMask,
  blurMask,
  applyShapeMaskElevation,
} from './regionShape';

/**
 * Converts MapData or RegionalMapData into a uniform ParentMapSource interface.
 */
export function toParentMapSource(source: ParentMapSource | MapData | RegionalMapData): ParentMapSource {
  if ('worldWidthKm' in source) {
    const world = source as MapData;
    return {
      id: null,
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
  shapeMask?: ShapeMaskConfig
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

  // Helper for bicubic sampling of the parent elevation
  const sampleParentElev = (wx: number, wy: number): number => {
    const clampedX = Math.max(0, Math.min(parent.width, wx));
    const clampedY = Math.max(0, Math.min(parent.height, wy));

    const u = (clampedX / parent.width) * (parentCols - 1);
    const v = (clampedY / parent.height) * (parentRows - 1);

    const c1 = Math.floor(u);
    const r1 = Math.floor(v);
    const tx = u - c1;
    const ty = v - r1;

    const getVal = (c: number, r: number) => {
      const cc = Math.max(0, Math.min(parentCols - 1, c));
      const rr = Math.max(0, Math.min(parentRows - 1, r));
      return parent.elevationGrid[rr * parentCols + cc];
    };

    const hermite = (p0: number, p1: number, p2: number, p3: number, t: number) => {
      const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
      const b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
      const c = -0.5 * p0 + 0.5 * p2;
      const d = p1;
      return a * t * t * t + b * t * t + c * t + d;
    };

    const rows: number[] = new Array(4);
    for (let i = 0; i < 4; i++) {
      const r = r1 - 1 + i;
      rows[i] = hermite(getVal(c1 - 1, r), getVal(c1, r), getVal(c1 + 1, r), getVal(c1 + 2, r), tx);
    }

    return hermite(rows[0], rows[1], rows[2], rows[3], ty);
  };

  const noiseScale = zoomScale === 16 ? 0.03 : 0.012;
  const detailAmp = zoomScale === 16 ? 4.5 : 2.8;

  for (let r = 0; r < gridRows; r++) {
    const ty = r / (gridRows - 1);
    const wy = bounds.minY + ty * boundsH;

    for (let c = 0; c < gridCols; c++) {
      const tx = c / (gridCols - 1);
      const wx = bounds.minX + tx * boundsW;

      // 1. Inherit macro elevation from parent Map
      const baseElev = sampleParentElev(wx, wy);

      // 2. Add resolution-dependent micro-fractal detail
      // More detail on land and coastal shallows than deep ocean abyss
      const dCoast = Math.abs(baseElev - parent.seaLevel);
      const shoreFactor = Math.exp(-dCoast * 0.12);

      const n1 = microNoise.fbm(wx * noiseScale, wy * noiseScale, 3);
      const n2 = detailNoise.sample(wx * noiseScale * 3.5, wy * noiseScale * 3.5);

      // High mountains also get craggy ridged detail
      let mountainBonus = 0;
      if (baseElev > parent.seaLevel + 15) {
        mountainBonus = microNoise.ridged(wx * noiseScale * 2.0, wy * noiseScale * 2.0, 3) * (detailAmp * 1.5);
      }

      const microElev = (n1 - 0.5) * detailAmp + n2 * (detailAmp * 0.4) * shoreFactor + mountainBonus;
      const finalElev = Math.max(0, Math.min(100, baseElev + microElev));

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

  const regionId = `region_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const defaultName = name || `地域マップ (${zoomScale}x: ${Math.round(boundsW)}x${Math.round(boundsH)}km)`;
  const widthKm = Math.round(parent.widthKm * (boundsW / parent.width));

  return {
    id: regionId,
    name: defaultName,
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
  };
}

