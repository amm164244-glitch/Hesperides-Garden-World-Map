/**
 * Biome Grid Type Definitions & Dynamic Custom Biome Types
 */

import { MapSymbolType } from './symbols';

export interface BiomeSymbolRule {
  kind: 'builtin' | 'custom';
  symbolType?: MapSymbolType;     // kind が 'builtin' のとき
  customAssetId?: string;         // kind が 'custom' のとき
  weight: number;                 // 1〜10(選ばれやすさ)
  scaleMin: number;               // 0.3〜3(初期値 0.8)
  scaleMax: number;               // scaleMin 以上、3 まで(初期値 1.2)
  elevationMin?: number;          // 標高の最小値 (0〜100、任意。未設定なら制限なし)
  elevationMax?: number;          // 標高の最大値 (0〜100、任意。未設定なら制限なし)
}

export interface BiomeType {
  slot: number;                   // 1〜255。biomeGrid に格納される番号。作成後は変えない
  name: string;                   // 1〜20文字。他と重複しない
  color: string;                  // '#rrggbb'
  symbols: BiomeSymbolRule[];     // 対象シンボル(空でもよい)
  density: number;                // 0〜100(%)。配置の濃さの目安。初期値 50
  minDistance: number;            // 地図座標でのシンボル間の最小距離。初期値 8、範囲 2〜60
  flipRandom: boolean;            // 左右反転をランダムにするか。初期値 true
}

export const DEFAULT_BIOME_TYPES: BiomeType[] = [
  {
    slot: 1,
    name: '針葉樹林',
    color: '#1f5d3a',
    symbols: [],
    density: 50,
    minDistance: 8,
    flipRandom: true,
  },
  {
    slot: 2,
    name: '広葉樹林',
    color: '#4f9a3c',
    symbols: [],
    density: 50,
    minDistance: 8,
    flipRandom: true,
  },
  {
    slot: 3,
    name: '草原',
    color: '#b9cf6a',
    symbols: [],
    density: 50,
    minDistance: 8,
    flipRandom: true,
  },
  {
    slot: 4,
    name: '砂漠・荒地',
    color: '#d9b46a',
    symbols: [],
    density: 50,
    minDistance: 8,
    flipRandom: true,
  },
  {
    slot: 5,
    name: '湿地',
    color: '#3f8f86',
    symbols: [],
    density: 50,
    minDistance: 8,
    flipRandom: true,
  },
  {
    slot: 6,
    name: '雪原・ツンドラ',
    color: '#e8eef2',
    symbols: [],
    density: 50,
    minDistance: 8,
    flipRandom: true,
  },
  {
    slot: 7,
    name: '岩山',
    color: '#8c7f74',
    symbols: [],
    density: 50,
    minDistance: 8,
    flipRandom: true,
  },
];

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

export const BIOME_BY_ID: Record<number, BiomeTypeDefinition> = Object.fromEntries(
  BIOME_TYPES.map((b) => [b.id, b])
);

export const SELECTABLE_BIOMES = BIOME_TYPES.filter((b) => b.id !== 0);

export interface BiomePaintOptions {
  softness: number; // 0 - 100 (0: hard edge, >0: stochastic boundary jitter)
  landOnly: boolean; // Only paint where elevation >= seaLevel
  elevationGrid?: Float32Array;
  seaLevel?: number;
}
