/**
 * Biome Grid Type Definitions & Color Palettes
 * Distinct from elevation: captures forest, grassland, desert, wetland, etc.
 */

export interface BiomeTypeDefinition {
  id: number;
  name: string;
  nameEn: string;
  color: string;
  rgba: [number, number, number, number]; // [R, G, B, A] 0-255
  description: string;
}

export const BIOME_NONE_ID = 0;

export const BIOME_TYPES: readonly BiomeTypeDefinition[] = [
  {
    id: 0,
    name: '指定なし',
    nameEn: 'None',
    color: 'transparent',
    rgba: [0, 0, 0, 0],
    description: '地形タイプの着色なし（透明）',
  },
  {
    id: 1,
    name: '針葉樹林',
    nameEn: 'Coniferous Forest',
    color: '#1f5d3a',
    rgba: [31, 93, 58, 255],
    description: 'モミ・トドマツなどの寒冷・高山帯針葉樹林',
  },
  {
    id: 2,
    name: '広葉樹林',
    nameEn: 'Broadleaf Forest',
    color: '#4f9a3c',
    rgba: [79, 154, 60, 255],
    description: 'カシ・ブナなどの温帯広葉樹林・原生林',
  },
  {
    id: 3,
    name: '草原',
    nameEn: 'Grassland',
    color: '#b9cf6a',
    rgba: [185, 207, 106, 255],
    description: 'サバンナ・ステップ・緑豊かな平野部',
  },
  {
    id: 4,
    name: '砂漠・荒地',
    nameEn: 'Desert / Wasteland',
    color: '#d9b46a',
    rgba: [217, 180, 106, 255],
    description: '乾燥砂丘・岩石砂漠・不毛の荒野',
  },
  {
    id: 5,
    name: '湿地',
    nameEn: 'Wetland',
    color: '#3f8f86',
    rgba: [63, 143, 134, 255],
    description: '沼地・マングローブ・氾濫原湿原',
  },
  {
    id: 6,
    name: '雪原・ツンドラ',
    nameEn: 'Snow / Tundra',
    color: '#e8eef2',
    rgba: [232, 238, 242, 255],
    description: '永久凍土・ツンドラ・氷雪地帯',
  },
  {
    id: 7,
    name: '岩山',
    nameEn: 'Rocky Mountain',
    color: '#8c7f74',
    rgba: [140, 127, 116, 255],
    description: '岩肌が露出した高嶺・険しい岩石地帯',
  },
] as const;

/**
 * Fast lookup array indexed by biome id (0 to 7)
 */
export const BIOME_BY_ID: Record<number, BiomeTypeDefinition> = Object.fromEntries(
  BIOME_TYPES.map((b) => [b.id, b])
);

/**
 * Selectable biomes (excluding ID 0 which is 'None / Erase')
 */
export const SELECTABLE_BIOMES = BIOME_TYPES.filter((b) => b.id !== 0);

export interface BiomePaintOptions {
  softness: number; // 0 - 100 (0: hard edge, >0: stochastic boundary jitter)
  landOnly: boolean; // Only paint where elevation >= seaLevel
  elevationGrid?: Float32Array;
  seaLevel?: number;
}
