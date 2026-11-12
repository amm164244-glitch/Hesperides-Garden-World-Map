/**
 * Fantasy Cartography Symbol Types (Tolkien & Inkarnate Style)
 */

export type MapSymbolCategory =
  | 'mountain'
  | 'tree'
  | 'village'     // 村 (Villages - 4 patterns)
  | 'town'        // 街・都市 (Towns & Cities - 4 patterns)
  | 'port'        // 港 (Ports & Harbors - 2 patterns)
  | 'tower'       // 塔 (Towers & Spires - 3 patterns)
  | 'dungeon'     // ダンジョン (Dungeons & Catacombs - 4 patterns)
  | 'maritime'    // 海洋・船 (Maritime)
  | 'settlement'  // Legacy compatibility
  | 'landmark'
  | 'custom';

export type MapSymbolType =
  // Mountains & Ridges
  | 'mountain_snow'      // 峻厳な雪冠主峰
  | 'mountain_rock'      // 鋭利な岩峰
  | 'mountain_ridge'     // 連続する岩稜
  | 'hill_mound'         // なだらかな丘陵群
  | 'volcano'            // 火山・孤高の噴火口
  // Trees & Forests
  | 'tree_pine'          // 針葉樹（エゾマツ・スプルース）
  | 'tree_pine_cluster'  // 密集した針葉樹林
  | 'tree_oak'           // 広葉樹・樫
  | 'tree_oak_cluster'   // 広葉樹樹海
  | 'tree_dead'          // 荒野の枯木
  // Villages (村 - 4 patterns)
  | 'village_hamlet'     // 茅葺きの集落
  | 'village_palisade'   // 丸太防塞の村
  | 'village_farm'       // 風車と農村
  | 'village_coastal'    // 水辺の漁村
  // Towns & Cities (街 - 4 patterns)
  | 'city_spires'        // 尖塔大聖堂都市 (Tolkien Capital)
  | 'town_walled'        // 城郭市街・中世都市
  | 'town_canal'         // 運河商業街
  | 'city_hilltop'       // 丘上城塞都市
  // Ports & Harbors (港 - 2 patterns)
  | 'port_harbor'        // 交易港・波止場
  | 'port_lighthouse'    // 灯台港・岬の灯台
  // Towers & Spires (塔 - 3 patterns)
  | 'tower_wizard'       // 孤高の魔術師の尖塔
  | 'tower_beacon'       // 沿岸狼煙台・烽火塔
  | 'tower_bastion'      // 防衛監視砦塔
  // Dungeons & Catacombs (ダンジョン - 4 patterns)
  | 'dungeon_cave'       // 龍の洞窟・魔窟
  | 'dungeon_ruins'      // 古代巨石の崩落神殿
  | 'dungeon_crypt'      // 地下迷宮・古代霊廟
  | 'dungeon_portal'     // 異界の門・ストーンポータル
  // Maritime & Mythological
  | 'sea_serpent'        // 海竜・リヴァイアサン
  | 'sailing_ship'       // 3本マスト帆船
  // Legacy aliases
  | 'castle_keep'
  | 'walled_city'
  | 'town'
  | 'watchtower'
  | 'village'
  | 'ruins'
  // Custom user-created asset
  | 'custom';

export interface CustomSymbolCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  createdAt: number;
}

export const DEFAULT_CUSTOM_CATEGORIES: CustomSymbolCategory[] = [];

export interface CustomMapAsset {
  id: string;
  name: string;
  category: string;
  dataUrl: string;       // Base64 transparent PNG
  width: number;
  height: number;
  originX: number;       // Center horizontal (e.g. 0.5)
  originY: number;       // Base vertical anchor (e.g. 0.85 - 0.95)
  createdAt: number;
  isPixelArt?: boolean;
  displayWidth?: number; // Width in world units at scale 1.0 (default 64). Height follows aspect ratio.
  gridSize?: number;     // 16, 24, 32, 48
  gridData?: string[][]; // Raw 2D array of color strings ('' for transparent)
}

export interface SymbolColorTheme {
  name: string;
  ink: string;           // Outlines and shadow hatch lines (e.g. #1f1913)
  fill: string;          // Base parchment / stone fill (e.g. #faf6ed)
  roof: string;          // Building roofs, banners, flags (e.g. #8f382a)
  foliage: string;       // Tree canopies (e.g. #2a4c38)
  accent: string;        // Gold/magic accents & lanterns (e.g. #c99e38)
}

export const DEFAULT_SYMBOL_COLOR_THEME: SymbolColorTheme = {
  name: '古典セピア調',
  ink: '#1f1913',
  fill: '#faf6ed',
  roof: '#8f382a',
  foliage: '#2a4c38',
  accent: '#c99e38',
};

export const SYMBOL_COLOR_PRESETS: Record<string, SymbolColorTheme> = {
  classic: {
    name: '古典セピア調',
    ink: '#1f1913',
    fill: '#faf6ed',
    roof: '#8f382a',
    foliage: '#2a4c38',
    accent: '#c99e38',
  },
  tolkien: {
    name: 'トールキン原画（純黒ペン画）',
    ink: '#11100f',
    fill: '#ffffff',
    roof: '#222222',
    foliage: '#1c2820',
    accent: '#666666',
  },
  royal: {
    name: '王都ロイヤル（紺碧＆深紅）',
    ink: '#181e28',
    fill: '#f8f9fa',
    roof: '#284664',
    foliage: '#1b3d2f',
    accent: '#d4af37',
  },
  autumn: {
    name: '黄昏・秋枯れ（琥珀＆煉瓦）',
    ink: '#2a1a12',
    fill: '#fcf6e8',
    roof: '#a04828',
    foliage: '#965b26',
    accent: '#d97706',
  },
  mystic: {
    name: '魔導・幽玄（薄紫＆蒼光）',
    ink: '#1a1824',
    fill: '#f5f3ff',
    roof: '#582c5f',
    foliage: '#1e3a34',
    accent: '#38bdf8',
  },
};

export interface MapSymbolInstance {
  id: string;
  type: MapSymbolType;
  customAssetId?: string; // If type === 'custom'
  x: number;              // World coordinates (0 .. MAP_WIDTH)
  y: number;              // World coordinates (0 .. MAP_HEIGHT)
  scale: number;          // 0.05 .. 3.0 (default 1.0)
  rotation?: number;      // Radians (-0.15 .. +0.15 for organic tilt)
  flipX?: boolean;        // Mirror horizontally for visual variety
  variant?: number;       // 0, 1, 2 for subtle ridge/branch variations
  colorOverride?: Partial<SymbolColorTheme>; // Optional individual tint override
  autoBiomeSlot?: number; // Automatically placed by biome slot; stripped if manually modified
}

export interface SymbolToolSettings {
  selectedType: MapSymbolType;
  selectedCustomAssetId?: string | null;
  category: string;       // Custom category ID or category name
  scale: number;          // 0.05 .. 3.0 (supports micro/compact symbols)
  density: number;        // For scatter brush (1 .. 10)
  scatterRadius: number;  // 15 .. 200 px
  randomScaleVar: number; // 0.0 .. 0.4
  colorTheme?: SymbolColorTheme; // Active color theme
}

export interface BuiltinSymbolInfo {
  type: MapSymbolType;
  name: string;
  category: string;
}

export const BUILTIN_SYMBOL_OPTIONS: BuiltinSymbolInfo[] = [
  // 樹木・森林
  { type: 'tree_pine', name: '針葉樹（スプルース）', category: '樹木・森林' },
  { type: 'tree_pine_cluster', name: '密集した針葉樹林', category: '樹木・森林' },
  { type: 'tree_oak', name: '広葉樹（オーク）', category: '樹木・森林' },
  { type: 'tree_oak_cluster', name: '広葉樹樹海', category: '樹木・森林' },
  { type: 'tree_dead', name: '荒野の枯木', category: '樹木・森林' },
  // 山岳・丘陵
  { type: 'mountain_snow', name: '峻厳な雪冠主峰', category: '山岳・丘陵' },
  { type: 'mountain_rock', name: '鋭利な岩峰', category: '山岳・丘陵' },
  { type: 'mountain_ridge', name: '連続する岩稜', category: '山岳・丘陵' },
  { type: 'hill_mound', name: 'なだらかな丘陵群', category: '山岳・丘陵' },
  { type: 'volcano', name: '火山・孤高の噴火口', category: '山岳・丘陵' },
  // 集落・村
  { type: 'village_hamlet', name: '茅葺きの集落', category: '集落・村' },
  { type: 'village_palisade', name: '丸太防塞の村', category: '集落・村' },
  { type: 'village_farm', name: '風車と農村', category: '集落・村' },
  { type: 'village_coastal', name: '水辺の漁村', category: '集落・村' },
  // 都市・城塞
  { type: 'city_spires', name: '尖塔大聖堂都市', category: '都市・城塞' },
  { type: 'town_walled', name: '城郭市街・中世都市', category: '都市・城塞' },
  { type: 'town_canal', name: '運河商業街', category: '都市・城塞' },
  { type: 'city_hilltop', name: '丘上城塞都市', category: '都市・城塞' },
  // 港・沿岸
  { type: 'port_harbor', name: '交易港・波止場', category: '港・沿岸' },
  { type: 'port_lighthouse', name: '灯台港・岬の灯台', category: '港・沿岸' },
  // 塔・砦
  { type: 'tower_wizard', name: '孤高の魔術師の尖塔', category: '塔・砦' },
  { type: 'tower_beacon', name: '沿岸狼煙台・烽火塔', category: '塔・砦' },
  { type: 'tower_bastion', name: '防衛監視砦塔', category: '塔・砦' },
  // ダンジョン・遺跡
  { type: 'dungeon_cave', name: '龍の洞窟・魔窟', category: 'ダンジョン・遺跡' },
  { type: 'dungeon_ruins', name: '古代巨石の崩落神殿', category: 'ダンジョン・遺跡' },
  { type: 'dungeon_crypt', name: '地下迷宮・古代霊廟', category: 'ダンジョン・遺跡' },
  { type: 'dungeon_portal', name: '異界の門・ストーンポータル', category: 'ダンジョン・遺跡' },
  // 海洋・神話
  { type: 'sailing_ship', name: '3本マスト帆船', category: '海洋・神話' },
  { type: 'sea_serpent', name: '海竜・リヴァイアサン', category: '海洋・神話' },
];
