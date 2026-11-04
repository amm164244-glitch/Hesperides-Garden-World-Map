/**
 * Cartographic River and Lake Data Types
 * Supports procedural hydrological flow generation, variable-width winding rivers,
 * organic lake shorelines, and interactive vector editing.
 */

export interface RiverData {
  id: string;
  name?: string;
  points: [number, number][]; // Map space coordinates [x, y]
  widthStart: number;         // Width in map units at river source / spring (e.g. 2 - 4)
  widthEnd: number;           // Width in map units at mouth / confluence (e.g. 6 - 16)
  color?: string;             // Optional custom water fill color
  borderColor?: string;       // Optional custom ink border color
}

export interface LakeData {
  id: string;
  name?: string;
  polygon: [number, number][]; // Closed polygon of lake shoreline in map coordinates
  color?: string;              // Optional custom water fill color
  borderColor?: string;       // Optional custom ink border color
  depth?: number;             // Approximate depth in meters or units
}

export interface WaterToolSettings {
  riverWidthStart: number;
  riverWidthEnd: number;
  lakeRadius: number;
  lakeMode: 'drag' | 'polygon';
  autoRiverCount: number;
  autoLakeCount: number;
  showWater: boolean;
}

export const DEFAULT_WATER_TOOL_SETTINGS: WaterToolSettings = {
  riverWidthStart: 2.5,
  riverWidthEnd: 8.0,
  lakeRadius: 35,
  lakeMode: 'drag',
  autoRiverCount: 14,
  autoLakeCount: 6,
  showWater: true,
};
