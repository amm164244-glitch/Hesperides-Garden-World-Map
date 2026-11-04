export type Pt = [number, number]; // [x, y] in local map coordinates (0..width, 0..height)

export type TownDistrictKind = 'residential' | 'market' | 'noble' | 'poor' | 'park' | 'farmland';
export type TownBuildingKind = 'house' | 'shop' | 'hall' | 'church' | 'keep' | 'tower' | 'barn';
export type TownRoadStyle = 'main' | 'street' | 'path';

export type TownRoofTheme = 'terracotta' | 'thatch' | 'slate' | 'stone';

export interface TownStyle {
  roofTheme: TownRoofTheme;
}

interface TownObjectBase {
  id: string;
  name?: string;
}

export interface TownDistrict extends TownObjectBase {
  kind: 'district';
  districtKind: TownDistrictKind;
  polygon: Pt[];
}

export interface TownRoad extends TownObjectBase {
  kind: 'road';
  style: TownRoadStyle;
  points: Pt[];
  widthM: number;
  smooth: boolean;
}

export interface TownBuilding extends TownObjectBase {
  kind: 'building';
  buildingKind: TownBuildingKind;
  polygon: Pt[];
  heightM: number;
  tone: number; // 0..1 (individual variation of roof tone)
}

export interface TownWallGate {
  segmentIndex: number;
  t: number;
  widthM: number;
}

export interface TownWall extends TownObjectBase {
  kind: 'wall';
  points: Pt[];
  closed: boolean;
  thicknessM: number;
  towers: boolean; // if true, draw watchtowers at vertices
  towerRadiusM: number;
  gates: TownWallGate[]; // gap on segmentIndex at parameter t (0..1) with widthM
}

export interface TownPier extends TownObjectBase {
  kind: 'pier';
  variant: 'pier' | 'bridge';
  points: Pt[];
  widthM: number;
}

export type TownObject = TownDistrict | TownRoad | TownBuilding | TownWall | TownPier;

export interface TownObjectBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const DEFAULT_BUILDING_HEIGHTS: Record<TownBuildingKind, number> = {
  house: 6,
  shop: 7,
  hall: 9,
  church: 14,
  keep: 18,
  tower: 16,
  barn: 7,
};

export type TownBuildingDrawMode = '3point' | 'preset' | 'polygon';
export type TownBuildingOrientationMode = 'auto' | 'fixed';

export interface TownClipboardData {
  metersPerUnit: number;
  objects: TownObject[];
}

export interface TownToolConfig {
  roadStyle: TownRoadStyle;
  roadWidthM: number;
  roadSmooth: boolean;
  wallThicknessM: number;
  wallClosed: boolean;
  wallTowers: boolean;
  wallTowerRadiusM: number;
  pierVariant: 'pier' | 'bridge';
  pierWidthM: number;
  snapEnabled: boolean;
  showLengths: boolean;

  // Building Tool
  buildingKind: TownBuildingKind;
  buildingHeightM: number;
  buildingRoofToneRandom: boolean;
  buildingRoofToneFixed: number;
  buildingDrawMode: TownBuildingDrawMode;
  buildingPresetWidthM: number;
  buildingPresetDepthM: number;
  buildingOrientationMode: TownBuildingOrientationMode;
  buildingFixedAngleDeg: number;

  // District Tool
  districtKind: TownDistrictKind;
}

export const DEFAULT_TOWN_TOOL_CONFIG: TownToolConfig = {
  roadStyle: 'street',
  roadWidthM: 5,
  roadSmooth: true,
  wallThicknessM: 2.5,
  wallClosed: true,
  wallTowers: true,
  wallTowerRadiusM: 4,
  pierVariant: 'pier',
  pierWidthM: 3,
  snapEnabled: true,
  showLengths: true,

  buildingKind: 'house',
  buildingHeightM: 6,
  buildingRoofToneRandom: true,
  buildingRoofToneFixed: 0.5,
  buildingDrawMode: '3point',
  buildingPresetWidthM: 10,
  buildingPresetDepthM: 7,
  buildingOrientationMode: 'auto',
  buildingFixedAngleDeg: 0,

  districtKind: 'residential',
};
