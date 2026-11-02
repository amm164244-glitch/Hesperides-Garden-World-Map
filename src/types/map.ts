/**
 * World Map and Regional Map Data Types
 * Supports 2:1 global planetary scale, tectonic plates, 2048x1024 Float32Array grids,
 * and hierarchical 4x/16x regional maps.
 */

export interface TectonicPlate {
  id: number;
  x: number;
  y: number;
  isContinental: boolean;
  driftX: number; // Plate movement vector X (-1 to 1)
  driftY: number; // Plate movement vector Y (-1 to 1)
  density: number;
  baseElevation: number;
}

export interface GeneratorConfig {
  seed: number;
  gridResolution: '1024x512' | '2048x1024' | '4096x2048' | '8192x4096';
  worldWidthKm: number; // e.g. 40,000 km (Earth size)
  plateCount: number; // 8 - 16
  seaRatio: number; // 40 - 75%
  continentCount: number; // 2 - 6 major continental masses
  continentSize: number; // 1 - 10
  mountainStrength: number; // 1 - 10 (Plate collision fold mountains)
  islandDensity: number; // 1 - 10
  minIslandArea: number; // Minimum island area in grid cells
  erosionIterations?: number; // 0 - 50 (熱侵食・水侵食の反復回数)
  erosionStrength?: number; // 1 - 10 (侵食強度)
  cellCount?: number;
  coastlineComplexity?: number;
}

export interface RegionalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RegionalMapData {
  id: string;
  name: string;
  bounds: RegionalBounds;
  zoomScale: 4 | 16;
  width: number;
  height: number;
  gridCols: number;
  gridRows: number;
  elevationGrid: Float32Array;
  temperatureGrid: Float32Array;
  seaLevel: number;
  createdAt: string;
  parentId: string | null; // null = 世界マップが親
  seed: number;            // 親のseedと bounds から決める
  widthKm: number;         // このマップ全体の実距離。親のwidthKm × (bounds幅 ÷ 親のwidth)
  symbols?: import('./symbols').MapSymbolInstance[];
  biomeGrid?: Uint8Array;
  outline?: [number, number][]; // 親マップ座標系での境界多角形頂点列
}

export interface ShapeMaskConfig {
  polygon: [number, number][];
  outsideSea: boolean;
  featherRatio: number;
}

export interface ParentMapSource {
  id?: string | null;
  width: number;
  height: number;
  gridCols: number;
  gridRows: number;
  elevationGrid: Float32Array;
  temperatureGrid: Float32Array;
  seaLevel: number;
  seed: number;
  widthKm: number;
}

export interface MapCell {
  id: number;
  x: number;
  y: number;
  elevation: number;
  isWater: boolean;
  isLake?: boolean;
  isOcean?: boolean;
  temperature: number; // 0 - 100 (0: Polar -40°C, 100: Equatorial +40°C)
  moisture: number; // 0 - 100
  neighbors: number[];
  polygon?: [number, number][];
}

export interface MapData {
  id?: string;
  name?: string;
  width: number; // e.g. 2000 (2:1 aspect ratio)
  height: number; // e.g. 1000
  gridCols: number; // 1024, 2048, or 4096
  gridRows: number; // 512, 1024, or 2048
  cellCount: number;
  seed: number;
  seaLevel: number; // Default 35.0
  worldWidthKm: number; // Default 40,000 km
  config: GeneratorConfig;
  createdAt: string;

  // High-performance Float32 elevation and temperature fields
  elevationGrid: Float32Array;
  temperatureGrid: Float32Array;

  // Tectonic simulation metadata
  plates?: TectonicPlate[];

  // Cells for inspector queries and vector overlays
  cells: MapCell[];

  // Hierarchical regional maps created from this world
  regionalMaps: Record<string, RegionalMapData>;

  // Optional vector coastline contours & ripple waves
  coastlines?: [number, number][][];
  ripples?: [number, number][][];

  // Placed cartographic symbols (Tolkien mountains, trees, settlements, etc.)
  symbols?: import('./symbols').MapSymbolInstance[];

  // Biome Grid (Terrain type raster overlay: 1 byte per cell, 0 to 7)
  biomeGrid?: Uint8Array;
}

export interface SupabaseMapRecord {
  id: string;
  name: string;
  seed: number;
  cell_count: number;
  created_at: string;
  updated_at: string;
}

export type BrushMode =
  | 'elevate'      // 隆起
  | 'depress'      // 沈降
  | 'smooth'       // 平滑化
  | 'flatten'      // 平坦化
  | 'makeLand'     // 陸地化
  | 'makeSea'      // 海洋化
  | 'mountain'     // 山脈隆起描画
  | 'stamp'        // スタンプ配置・選択移動
  | 'symbolBrush'  // シンボル散布ペイント（森林・山脈）
  | 'symbolEraser' // シンボル消しゴム
  | 'biomePaint'   // 地形タイプブラシ
  | 'biomeFill'    // 地形タイプバケツ塗りつぶし
  | 'biomeErase'   // 地形タイプ消しゴム
  | 'selectRegion' // 地域範囲選択
  | 'pan';         // 視点移動

export interface BrushSettings {
  mode: BrushMode;
  radius: number;
  strength: number;
  flattenTarget: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type ViewMode = 'elevation' | 'temperature' | 'moisture' | 'landSea' | 'plates';

export interface HistoryRecord {
  description: string;
  timestamp: number;
  changes?: {
    gridIndex?: number;
    cellId?: number;
    id?: number;
    prevElevation: number;
    newElevation: number;
  }[];
  symbolChanges?: {
    prevSymbols: import('./symbols').MapSymbolInstance[];
    newSymbols: import('./symbols').MapSymbolInstance[];
  };
  biomeChanges?: {
    gridIndex: number;
    prev: number;
    next: number;
  }[];
}
