import { BiomeSymbolRule, BiomeType, DEFAULT_BIOME_TYPES } from '../types/biome';
import { CustomMapAsset, MapSymbolType, BUILTIN_SYMBOL_OPTIONS } from '../types/symbols';

/**
 * Parses #rrggbb hex color into RGBA tuple [r, g, b, a] in 0-255 range.
 */
export function hexToRgba(hex: string, alpha: number = 215): [number, number, number, number] {
  if (typeof hex !== 'string') return [0, 0, 0, alpha];
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return [0, 0, 0, alpha];
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return [r, g, b, alpha];
}

/**
 * Calculates Euclidean RGB distance between two hex colors.
 */
export function rgbDistance(hex1: string, hex2: string): number {
  const [r1, g1, b1] = hexToRgba(hex1);
  const [r2, g2, b2] = hexToRgba(hex2);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/**
 * Checks whether color is visually too close (RGB distance < 50) to any biome in otherTypes.
 * Returns closest other biome name and distance, or null if no conflict.
 */
export function checkColorProximity(
  color: string,
  otherTypes: BiomeType[]
): { otherName: string; distance: number } | null {
  if (!color || !Array.isArray(otherTypes) || otherTypes.length === 0) {
    return null;
  }

  let minDistance = Infinity;
  let closestBiome: BiomeType | null = null;

  for (const other of otherTypes) {
    if (!other.color) continue;
    const dist = rgbDistance(color, other.color);
    if (dist < minDistance) {
      minDistance = dist;
      closestBiome = other;
    }
  }

  if (minDistance < 50 && closestBiome) {
    return {
      otherName: closestBiome.name,
      distance: Math.round(minDistance),
    };
  }

  return null;
}

/**
 * Adds a new biome type, automatically assigning the smallest unused slot between 1 and 255.
 * Throws an error on validation failure.
 */
export function addBiomeType(
  types: BiomeType[],
  nameOrPartial: string | Partial<BiomeType>,
  colorArg?: string,
  extra?: Partial<BiomeType>
): BiomeType[] {
  if (types.length >= 32) {
    throw new Error('地形タイプの上限（32種類）に達しています');
  }

  let name = '';
  let color = '';
  let options: Partial<BiomeType> = {};

  if (typeof nameOrPartial === 'object' && nameOrPartial !== null) {
    name = (nameOrPartial.name || '').trim();
    color = (nameOrPartial.color || '').toLowerCase();
    options = nameOrPartial;
  } else {
    name = (nameOrPartial || '').trim();
    color = (colorArg || '').toLowerCase();
    options = extra || {};
  }

  if (!name || name.length > 20) {
    throw new Error('名前は1〜20文字で入力してください');
  }

  if (types.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('同じ名前の地形タイプが既に存在します（重複不可）');
  }

  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw new Error('色は #rrggbb の形式で指定してください');
  }

  // Find lowest available slot in 1..255
  const usedSlots = new Set(types.map((t) => t.slot));
  let allocatedSlot = 1;
  while (allocatedSlot <= 255 && usedSlots.has(allocatedSlot)) {
    allocatedSlot++;
  }

  if (allocatedSlot > 255) {
    throw new Error('利用可能なスロット番号がありません（1〜255）');
  }

  const newType: BiomeType = {
    slot: allocatedSlot,
    name,
    color,
    symbols: options.symbols ? [...options.symbols] : [],
    density: Math.max(0, Math.min(100, options.density ?? 50)),
    minDistance: Math.max(2, Math.min(60, options.minDistance ?? 16)),
    flipRandom: options.flipRandom ?? true,
  };

  return [...types, newType];
}

/**
 * Updates an existing biome type by slot. Slot number cannot be changed.
 * Throws an error on validation failure.
 */
export function updateBiomeType(
  types: BiomeType[],
  slot: number,
  patch: Partial<Omit<BiomeType, 'slot'>>
): BiomeType[] {
  const index = types.findIndex((t) => t.slot === slot);
  if (index === -1) {
    throw new Error(`スロット ${slot} の地形タイプが存在しません`);
  }

  const current = types[index];
  const name = patch.name !== undefined ? patch.name.trim() : current.name;
  if (!name || name.length > 20) {
    throw new Error('名前は1〜20文字で入力してください');
  }

  if (types.some((t) => t.slot !== slot && t.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('同じ名前の地形タイプが既に存在します（重複不可）');
  }

  const color = (patch.color !== undefined ? patch.color : current.color).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw new Error('色は #rrggbb の形式で指定してください');
  }

  const updatedType: BiomeType = {
    ...current,
    name,
    color,
    symbols: patch.symbols !== undefined ? [...patch.symbols] : current.symbols,
    density:
      patch.density !== undefined
        ? Math.max(0, Math.min(100, patch.density))
        : current.density,
    minDistance:
      patch.minDistance !== undefined
        ? Math.max(2, Math.min(60, patch.minDistance))
        : current.minDistance,
    flipRandom:
      patch.flipRandom !== undefined ? patch.flipRandom : current.flipRandom,
  };

  const nextTypes = [...types];
  nextTypes[index] = updatedType;
  return nextTypes;
}

/**
 * Replaces all cells painted with the given slot with 0 (None) across world and regional maps,
 * and removes the type from the array. Returns updated biomeTypes and total replaced cells.
 */
export function removeBiomeType(
  types: BiomeType[],
  slot: number,
  mapData: any
): { biomeTypes: BiomeType[]; replacedCells: number } {
  let replacedCells = 0;

  const sanitizeGrid = (grid: Uint8Array | undefined) => {
    if (!grid) return;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === slot) {
        grid[i] = 0;
        replacedCells++;
      }
    }
  };

  if (mapData) {
    sanitizeGrid(mapData.biomeGrid);
    if (mapData.regionalMaps && typeof mapData.regionalMaps === 'object') {
      for (const reg of Object.values(mapData.regionalMaps as Record<string, any>)) {
        sanitizeGrid(reg.biomeGrid);
      }
    }
  }

  const remainingTypes = types.filter((t) => t.slot !== slot);
  return {
    biomeTypes: remainingTypes,
    replacedCells,
  };
}

/**
 * Counts how many cells currently use each slot (1..255) across world and regional maps.
 * Returns Record<number, number> mapping slot number to total cells.
 */
export function countBiomeUsage(mapData: any): Record<number, number> {
  const counts: Record<number, number> = {};

  const tallyGrid = (grid: Uint8Array | undefined) => {
    if (!grid) return;
    for (let i = 0; i < grid.length; i++) {
      const slot = grid[i];
      if (slot !== 0) {
        counts[slot] = (counts[slot] || 0) + 1;
      }
    }
  };

  if (mapData) {
    tallyGrid(mapData.biomeGrid);
    if (mapData.regionalMaps && typeof mapData.regionalMaps === 'object') {
      for (const reg of Object.values(mapData.regionalMaps as Record<string, any>)) {
        tallyGrid(reg.biomeGrid);
      }
    }
  }

  return counts;
}

/**
 * Reorders a biome type in the array by moving fromIndex to toIndex without modifying slot numbers.
 */
export function moveBiomeType(
  types: BiomeType[],
  fromIndex: number,
  toIndex: number
): BiomeType[] {
  if (
    fromIndex < 0 ||
    fromIndex >= types.length ||
    toIndex < 0 ||
    toIndex >= types.length ||
    fromIndex === toIndex
  ) {
    return types;
  }

  const nextTypes = [...types];
  const [item] = nextTypes.splice(fromIndex, 1);
  nextTypes.splice(toIndex, 0, item);
  return nextTypes;
}

/**
 * Resets the biome list to the default 7 types (slots 1..7).
 */
export function resetToDefaultBiomeTypes(): BiomeType[] {
  return DEFAULT_BIOME_TYPES.map((t) => ({
    ...t,
    symbols: [...t.symbols],
  }));
}

/**
 * Builds a fast 256-element color lookup table for offscreen biome canvas rendering.
 * Index = slot (0..255).
 * Slot 0 is [0, 0, 0, 0] (transparent).
 * Slot 1..255 is [r, g, b, 215] for defined biomes.
 * Unassigned slots map to [0, 0, 0, 0].
 */
export function buildBiomeColorTable(
  biomeTypes: BiomeType[]
): [number, number, number, number][] {
  const table: [number, number, number, number][] = new Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] = [0, 0, 0, 0];
  }

  if (Array.isArray(biomeTypes)) {
    for (const t of biomeTypes) {
      if (t && t.slot >= 1 && t.slot <= 255 && t.color) {
        table[t.slot] = hexToRgba(t.color, 215);
      }
    }
  }

  return table;
}

/**
 * Builtin symbols dictionary mapping for user-friendly name resolution.
 */
export const BUILTIN_SYMBOL_LABELS: Record<string, string> = {
  tree_pine: '針葉樹（スプルース）',
  tree_pine_cluster: '密集した針葉樹林',
  tree_oak: '広葉樹（オーク）',
  tree_oak_cluster: '広葉樹樹海',
  tree_dead: '荒野の枯木',
  mountain_snow: '峻厳な雪冠主峰',
  mountain_rock: '鋭利な岩峰',
  mountain_ridge: '連続する岩稜',
  hill_mound: 'なだらかな丘陵群',
  volcano: '火山・孤高の噴火口',
  village_hamlet: '茅葺きの集落',
  village_palisade: '丸太防塞の村',
  village_farm: '風車と農村',
  village_coastal: '水辺の漁村',
  city_spires: '尖塔大聖堂都市',
  town_walled: '城郭市街・中世都市',
  town_canal: '運河商業街',
  city_hilltop: '丘上城塞都市',
  port_harbor: '交易港・波止場',
  port_lighthouse: '灯台港・岬の灯台',
  tower_wizard: '孤高の魔術師の尖塔',
  tower_beacon: '沿岸狼煙台・烽火塔',
  tower_bastion: '防衛監視砦塔',
  dungeon_cave: '龍の洞窟・魔窟',
  dungeon_ruins: '古代巨石の崩落神殿',
  dungeon_crypt: '地下迷宮・古代霊廟',
  dungeon_portal: '異界の門・ストーンポータル',
  sailing_ship: '3本マスト帆船',
  sea_serpent: '海竜・リヴァイアサン',
};

export interface ResolvedSymbolRule {
  displayName: string;
  previewUrl?: string;
  isMissing: boolean;
  customAsset?: CustomMapAsset;
}

/**
 * Resolves a symbol rule against available custom assets to check if it's valid or missing.
 */
export function resolveSymbolRule(
  rule: BiomeSymbolRule,
  customAssets?: CustomMapAsset[]
): ResolvedSymbolRule {
  if (rule.kind === 'builtin') {
    const symType = rule.symbolType || 'tree_pine';
    const label = BUILTIN_SYMBOL_LABELS[symType] || symType;
    return {
      displayName: label,
      isMissing: false,
    };
  }

  if (rule.kind === 'custom') {
    const asset = customAssets?.find((a) => a.id === rule.customAssetId);
    if (asset) {
      return {
        displayName: asset.name,
        previewUrl: asset.dataUrl,
        isMissing: false,
        customAsset: asset,
      };
    }
    return {
      displayName: '削除されたシンボル',
      isMissing: true,
    };
  }

  return {
    displayName: '未知のシンボル',
    isMissing: true,
  };
}
