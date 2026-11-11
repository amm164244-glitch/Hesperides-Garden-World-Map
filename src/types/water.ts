/**
 * Cartographic River and Lake Data Types
 * Supports procedural hydrological flow generation, variable-width winding rivers,
 * organic lake shorelines, and interactive vector editing.
 */

export interface RiverData {
  id: string;
  name?: string;
  points: [number, number][]; // Map space coordinates [x, y]
  widthStart: number;         // Width in map units at river source / spring
  widthEnd: number;           // Width in map units at mouth / confluence
  color?: string;             // Optional custom water fill color
  borderColor?: string;       // Optional custom ink border color
  sourceType?: 'spring' | 'lake'; // Where the river starts
  sourceLakeId?: string;          // If started from a lake outlet
  terminatesAt?: 'ocean' | 'lake' | 'river' | 'inland'; // Where the river ends
  targetLakeId?: string;          // If empties into a lower lake
  connectedRiverId?: string;      // If tributary of another river
  elevationStart?: number;        // Elevation at river source (m)
  elevationEnd?: number;          // Elevation at river mouth / confluence (m)
  elevations?: number[];          // Elevation sampled along each point
  isMonotonic?: boolean;          // True if strictly flowing downhill
  maxUphill?: number;             // Maximum uphill bump in meters if any
  carveDepthFactor?: number;      // Optional local depth multiplier (default 1.0)
}

export interface LakeData {
  id: string;
  name?: string;
  polygon: [number, number][]; // Closed polygon of lake shoreline in map coordinates
  color?: string;              // Optional custom water fill color
  borderColor?: string;        // Optional custom ink border color
  depth?: number;              // Approximate depth in meters or units
  elevation?: number;          // Average surface elevation (m)
  minRimElevation?: number;    // Lowest point on basin rim (spillway elevation)
  maxRimElevation?: number;    // Highest point on basin rim
}

export interface WaterToolSettings {
  riverWidthStart: number;
  riverWidthEnd: number;
  lakeRadius: number;
  lakeMode: 'drag' | 'polygon';
  showWater: boolean;
  riverDensity?: number;
  meander?: number;
  riverCount?: number;
  lakeCount?: number;
  headExtension?: number;     // 0 ~ 100, default 80
  carveIntoTerrain?: boolean; // 地形に直接彫り込む (水面テクスチャを貼らない) (既定: true)
  carveDepthFactor?: number;  // 彫り込み水深係数 (0.2 ~ 1.5, 既定: 0.6)
  carveWidthFactor?: number;  // 彫り込み川幅係数 (0.5 ~ 2.5, 既定: 1.1)
  autoSnapToValleys?: boolean;// 谷筋スナップ・下り坂誘導 (既定: true)
}

export const DEFAULT_WATER_TOOL_SETTINGS: WaterToolSettings = {
  riverWidthStart: 1.5,
  riverWidthEnd: 4.5,
  lakeRadius: 18,
  lakeMode: 'drag',
  showWater: true,
  riverDensity: 40,
  meander: 60,
  riverCount: 14,
  lakeCount: 6,
  headExtension: 80,
  carveIntoTerrain: true,
  carveDepthFactor: 0.6,
  carveWidthFactor: 1.1,
  autoSnapToValleys: true,
};

