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
}

export const DEFAULT_TOWN_TOOL_CONFIG: TownToolConfig = {
  roadStyle: 'street',
  roadWidthM: 6,
  roadSmooth: true,
  wallThicknessM: 4,
  wallClosed: false,
  wallTowers: true,
  wallTowerRadiusM: 3.5,
  pierVariant: 'pier',
  pierWidthM: 4,
  snapEnabled: true,
  showLengths: true,
};
