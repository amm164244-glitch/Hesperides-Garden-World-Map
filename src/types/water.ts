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
}

export interface LakeData {
  id: string;
  name?: string;
  polygon: [number, number][]; // Closed polygon of lake shoreline in map coordinates
  color?: string;              // Optional custom water fill color
  borderColor?: string;       // Optional custom ink border color
  depth?: number;             // Approximate depth in meters or units
  elevation?: number;         // Average surface elevation
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
};

