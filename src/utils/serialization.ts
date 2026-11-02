import { MapData, RegionalMapData } from '../types/map';
import { BiomeType, DEFAULT_BIOME_TYPES } from '../types/biome';
import { biomeGridToBase64, base64ToBiomeGrid } from './biomePainter';

/**
 * Base64 encoding/decoding for Float32Array to keep JSON exports compact (<10MB)
 * and prevent memory overhead and key expansion from JSON.stringify.
 */
export function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.length)) as any);
  }
  return btoa(binary);
}

export function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

/**
 * Converts any array/object representation of grid into a Float32Array.
 */
export function ensureFloat32Array(input: any, expectedLength?: number): Float32Array {
  if (input instanceof Float32Array) {
    return input;
  }
  if (typeof input === 'string') {
    return base64ToFloat32(input);
  }
  if (Array.isArray(input)) {
    return new Float32Array(input);
  }
  if (input && typeof input === 'object') {
    const keys = Object.keys(input);
    const arr = new Float32Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      arr[i] = Number(input[i]);
    }
    return arr;
  }
  return new Float32Array(expectedLength || 1024 * 512);
}

/**
 * Prepares MapData for JSON export or Supabase database storage with Base64 compressed typed arrays.
 */
export function serializeMapData(mapData: MapData): any {
  const regionalMapsSerialized: Record<string, any> = {};

  if (mapData.regionalMaps) {
    for (const [id, reg] of Object.entries(mapData.regionalMaps)) {
      regionalMapsSerialized[id] = {
        ...reg,
        parentId: reg.parentId ?? null,
        seed: reg.seed,
        widthKm: reg.widthKm,
        symbols: reg.symbols || [],
        elevationGridBase64: float32ToBase64(reg.elevationGrid),
        temperatureGridBase64: float32ToBase64(reg.temperatureGrid),
        biomeGridBase64: reg.biomeGrid ? biomeGridToBase64(reg.biomeGrid) : undefined,
        elevationGrid: undefined,
        temperatureGrid: undefined,
        biomeGrid: undefined,
      };
    }
  }

  return {
    ...mapData,
    biomeTypes: mapData.biomeTypes || DEFAULT_BIOME_TYPES,
    symbols: mapData.symbols || [],
    elevationGridBase64: float32ToBase64(mapData.elevationGrid),
    temperatureGridBase64: float32ToBase64(mapData.temperatureGrid),
    biomeGridBase64: mapData.biomeGrid ? biomeGridToBase64(mapData.biomeGrid) : undefined,
    elevationGrid: undefined,
    temperatureGrid: undefined,
    biomeGrid: undefined,
    regionalMaps: regionalMapsSerialized,
  };
}

function sanitizeBiomeGrid(grid: Uint8Array | undefined, validSlots: Set<number>): Uint8Array | undefined {
  if (!grid) return undefined;
  for (let i = 0; i < grid.length; i++) {
    const slot = grid[i];
    if (slot !== 0 && !validSlots.has(slot)) {
      grid[i] = 0;
    }
  }
  return grid;
}

/**
 * Restores MapData loaded from JSON file or Supabase into fully typed Float32Array runtime structures.
 */
export function deserializeMapData(raw: any): MapData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('無効な地図データ形式です');
  }

  const gridCols = raw.gridCols || 2048;
  const gridRows = raw.gridRows || 1024;
  const expectedTotal = gridCols * gridRows;

  const elevationGrid = raw.elevationGridBase64
    ? base64ToFloat32(raw.elevationGridBase64)
    : ensureFloat32Array(raw.elevationGrid, expectedTotal);

  const temperatureGrid = raw.temperatureGridBase64
    ? base64ToFloat32(raw.temperatureGridBase64)
    : ensureFloat32Array(raw.temperatureGrid, expectedTotal);

  // Restore biomeTypes, falling back to defaults if absent
  const biomeTypes: BiomeType[] = Array.isArray(raw.biomeTypes) && raw.biomeTypes.length > 0
    ? raw.biomeTypes
    : DEFAULT_BIOME_TYPES;
  const validSlots = new Set<number>(biomeTypes.map((b) => b.slot));

  const regionalMaps: Record<string, RegionalMapData> = {};
  if (raw.regionalMaps && typeof raw.regionalMaps === 'object') {
    for (const [id, regRaw] of Object.entries(raw.regionalMaps as Record<string, any>)) {
      const regCols = regRaw.gridCols || 1024;
      const regRows = regRaw.gridRows || 512;
      const regTotal = regCols * regRows;

      const regElev = regRaw.elevationGridBase64
        ? base64ToFloat32(regRaw.elevationGridBase64)
        : ensureFloat32Array(regRaw.elevationGrid, regTotal);

      const regTemp = regRaw.temperatureGridBase64
        ? base64ToFloat32(regRaw.temperatureGridBase64)
        : ensureFloat32Array(regRaw.temperatureGrid, regTotal);

      let regBiome = regRaw.biomeGridBase64
        ? base64ToBiomeGrid(regRaw.biomeGridBase64, regTotal)
        : (regRaw.biomeGrid instanceof Uint8Array ? regRaw.biomeGrid : undefined);

      regBiome = sanitizeBiomeGrid(regBiome, validSlots);

      const parentId = regRaw.parentId !== undefined ? regRaw.parentId : null;
      const seed = regRaw.seed !== undefined
        ? regRaw.seed
        : (raw.seed || 0) + Math.round((regRaw.bounds?.minX || 0) * 31 + (regRaw.bounds?.minY || 0) * 97);
      const boundsW = regRaw.bounds ? (regRaw.bounds.maxX - regRaw.bounds.minX) : 0;
      const worldW = raw.width || 2000;
      const worldWidthKm = raw.worldWidthKm || 40000;
      const widthKm = regRaw.widthKm !== undefined
        ? regRaw.widthKm
        : Math.round(worldWidthKm * (boundsW / worldW));

      regionalMaps[id] = {
        id: regRaw.id || id,
        name: regRaw.name || '地域マップ',
        bounds: regRaw.bounds,
        zoomScale: regRaw.zoomScale || 4,
        width: regRaw.width || 2000,
        height: regRaw.height || 1000,
        gridCols: regCols,
        gridRows: regRows,
        elevationGrid: regElev,
        temperatureGrid: regTemp,
        seaLevel: regRaw.seaLevel ?? 35.0,
        createdAt: regRaw.createdAt || new Date().toISOString(),
        parentId,
        seed,
        widthKm,
        symbols: Array.isArray(regRaw.symbols) ? regRaw.symbols : [],
        biomeGrid: regBiome,
        outline: Array.isArray(regRaw.outline) ? regRaw.outline : undefined,
      };
    }
  }

  let biomeGrid = raw.biomeGridBase64
    ? base64ToBiomeGrid(raw.biomeGridBase64, expectedTotal)
    : (raw.biomeGrid instanceof Uint8Array ? raw.biomeGrid : undefined);

  biomeGrid = sanitizeBiomeGrid(biomeGrid, validSlots);

  return {
    ...raw,
    gridCols,
    gridRows,
    elevationGrid,
    temperatureGrid,
    biomeGrid,
    biomeTypes,
    symbols: Array.isArray(raw.symbols) ? raw.symbols : [],
    regionalMaps,
    cells: Array.isArray(raw.cells) ? raw.cells : [],
    config: raw.config || {
      seed: raw.seed || 12345,
      gridResolution: `${gridCols}x${gridRows}`,
      worldWidthKm: raw.worldWidthKm || 40000,
      plateCount: 12,
      seaRatio: 60,
      continentCount: 4,
      continentSize: 6,
      mountainStrength: 6,
      islandDensity: 5,
      minIslandArea: 15,
    },
  };
}
