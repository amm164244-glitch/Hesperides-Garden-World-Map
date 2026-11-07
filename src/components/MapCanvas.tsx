import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrushSettings,
  HistoryRecord,
  MapCell,
  MapData,
  RegionalBounds,
  RegionalMapData,
  ViewMode,
  Viewport,
} from '../types/map';
import { WebGLMapRenderer } from '../utils/webglMapRenderer';
import { applyBrushToElevationGrid, SpatialIndex } from '../utils/terrainEditor';
import {
  drawCompassRose,
  drawRhumbLines,
} from '../utils/cartographyRenderer';
import { drawSortedSymbols, setCustomImageLoadedCallback } from '../utils/symbolRenderer';
import {
  scatterSymbolsUnderBrush,
  scatterSymbolsForBiomeStroke,
  populateSymbolsForBiomeFill,
} from '../utils/symbolGenerator';
import { MapSymbolInstance, SymbolToolSettings, CustomMapAsset } from '../types/symbols';
import { BiomeType, DEFAULT_BIOME_TYPES } from '../types/biome';
import { buildBiomeColorTable } from '../utils/biomeTypes';
import { paintBiomeCircle, floodFillBiome, BiomeBoundingBox } from '../utils/biomePainter';
import { fitBoundsToLimits, computeTownBounds } from '../utils/regionLayout';
import { ScaleBar } from './ScaleBar';
import { RegionShapeTools, RegionSelectMethod, TownConfig } from './RegionShapeTools';
import {
  polygonBounds,
  pointInPolygon,
  simplifyPolyline,
  smoothPolygon,
  removeDegenerateSpikes,
} from '../utils/regionShape';
import {
  findNearestCoastlinePoint,
  traceCoastlinePath,
  findEnclosingIslandContour,
  CoastlineSnapResult,
} from '../utils/coastlineSelection';

const COASTLINE_SNAP_PX = 24;
import {
  DEFAULT_TOWN_TOOL_CONFIG,
  Pt,
  TownBuilding,
  TownBuildingKind,
  TownClipboardData,
  TownDistrict,
  TownDistrictKind,
  TownObject,
  TownPier,
  TownRoad,
  TownToolConfig,
  TownWall,
} from '../types/town';
import { drawTownObjects } from '../utils/town/townRenderer';
import { townTextureCache } from '../utils/town/townTextureCache';
import { resolveTextureFill } from '../utils/town/townTextures';
import {
  addGate,
  alignParallel,
  alignToLine,
  circlePolygon,
  clipboardToObjects,
  deterministicRoofTone,
  distributeEvenly,
  flipObject,
  generatePresetPolygon,
  getGateWorldPosition,
  getObjectsCentroid,
  hasEdgeLessThanM,
  hitTestTownObjects,
  insertVertex,
  isSimplePolygon,
  minAreaRect,
  moveGate,
  moveVertex,
  nearestPointOnPolyline,
  nearestSegmentDirection,
  objectsInRect,
  objectsToClipboard,
  rectangleFrom3Points,
  removeGate,
  removeVertex,
  rotateObject,
  selectionBounds,
  snapAngle,
  snapPoint,
  translateObject,
} from '../utils/town/townEdit';
import { metersToUnits, polylineLength } from '../utils/town/townGeometry';
import { RiverData, LakeData, WaterToolSettings, DEFAULT_WATER_TOOL_SETTINGS } from '../types/water';
import {
  drawWaterBodies,
  findWaterAtPoint,
  findNearestRiverVertex,
  findNearestLakeVertex,
} from '../utils/waterRenderer';
import { createOrganicLake, smoothRiverPath, generateRiversAndLakes } from '../utils/waterGenerator';
import { WaterPanel } from './WaterPanel';
import {
  TownTemplatePlacement,
  instantiateTemplate,
  placeTemplate,
} from '../utils/town/townTemplate';
import { createFrameScheduler, FrameScheduler } from '../utils/frameScheduler';
import { townPerf } from '../utils/town/townPerf';

interface MapCanvasProps {
  mapData: MapData;
  activeRegionalMap: RegionalMapData | null;
  viewport: Viewport;
  onUpdateViewport: (viewport: Viewport) => void;
  brushSettings: BrushSettings;
  spatialIndex: SpatialIndex;
  viewMode: ViewMode;
  showMesh: boolean;
  showShading: boolean;
  showRipples?: boolean;
  showCompass?: boolean;
  compassPos?: { x: number; y: number };
  onUpdateCompassPos?: (pos: { x: number; y: number }) => void;
  symbols?: MapSymbolInstance[];
  showSymbols?: boolean;
  symbolToolSettings?: SymbolToolSettings;
  customAssets?: CustomMapAsset[];
  onUpdateSymbols?: (symbols: MapSymbolInstance[]) => void;
  selectedSymbolId?: string | null;
  onSelectSymbolId?: (id: string | null) => void;
  biomeSettings?: {
    selectedBiomeId: number;
    softness: number;
    landOnly: boolean;
    showBiome: boolean;
    opacity: number;
  };
  onCommitHistory: (record: HistoryRecord) => void;
  onHoverCell: (cell: MapCell | null) => void;
  onSelectRegionBounds?: (
    bounds: RegionalBounds,
    adjusted?: boolean,
    shapePolygon?: [number, number][],
    options?: { kind?: 'region' | 'town'; name?: string; detailScale?: number; coastFidelity?: number }
  ) => void;
  onSelectRegionMap?: (regionId: string) => void;
  mapBackgroundUrl?: string | null;
  onClearMapBackground?: () => void;
  maxZoom?: number;
  onInteractingChange?: (isInteracting: boolean) => void;
  biomeTypes?: BiomeType[];
  townObjects?: TownObject[];
  showTownObjects?: boolean;
  selectedTownObjectId?: string | null;
  onSelectTownObjectId?: (id: string | null) => void;
  selectedTownObjectIds?: string[];
  onSelectTownObjectIds?: (ids: string[]) => void;
  townToolConfig?: TownToolConfig;
  isAddingGateMode?: boolean;
  onToggleAddingGateMode?: (enabled: boolean) => void;
  onUpdateTownObjects?: (objects: TownObject[]) => void;
  autoFillPreviewBuildings?: TownBuilding[] | null;
  dimOutsideRegion?: boolean;
  rivers?: RiverData[];
  lakes?: LakeData[];
  onUpdateRivers?: (rivers: RiverData[]) => void;
  onUpdateLakes?: (lakes: LakeData[]) => void;
  selectedWaterId?: string | null;
  selectedWaterType?: 'river' | 'lake' | null;
  onSelectWater?: (id: string | null, type: 'river' | 'lake' | null) => void;
  waterSettings?: WaterToolSettings;
  onChangeWaterSettings?: (patch: Partial<WaterToolSettings>) => void;
  onClearAllWater?: () => void;
  onUpdateBrush?: (patch: Partial<BrushSettings>) => void;
  templatePlacement?: TownTemplatePlacement | null;
  onUpdateTemplatePlacement?: (patch: Partial<TownTemplatePlacement>) => void;
  onCancelTemplatePlacement?: () => void;
}

const BUILDING_KIND_LABELS: Record<string, string> = {
  house: '民家',
  shop: '商店・工房',
  hall: '会堂・大広間',
  church: '教会・聖堂',
  keep: '天守・要塞',
  tower: '見張り塔',
  barn: '納屋・倉庫',
};

const DISTRICT_KIND_LABELS: Record<string, string> = {
  residential: '住宅街',
  market: '市場・商業区',
  noble: '貴族街',
  poor: '貧民街・下町',
  park: '庭園・広場',
  farmland: '農地・畑',
  commercial: '商業区',
  military: '軍事区',
  religious: '宗教区',
  agricultural: '農地',
  artisan: '工房区',
};

export const MapCanvas: React.FC<MapCanvasProps> = ({
  mapData,
  activeRegionalMap,
  biomeTypes,
  viewport,
  onUpdateViewport,
  brushSettings,
  spatialIndex,
  viewMode,
  showMesh,
  showShading,
  showRipples = true,
  showCompass = true,
  compassPos,
  onUpdateCompassPos,
  symbols = [],
  showSymbols = true,
  symbolToolSettings,
  customAssets = [],
  onUpdateSymbols,
  selectedSymbolId = null,
  onSelectSymbolId,
  townObjects = [],
  showTownObjects = true,
  selectedTownObjectId = null,
  onSelectTownObjectId,
  selectedTownObjectIds = [],
  onSelectTownObjectIds,
  townToolConfig = DEFAULT_TOWN_TOOL_CONFIG,
  isAddingGateMode = false,
  onToggleAddingGateMode,
  onUpdateTownObjects,
  autoFillPreviewBuildings = null,
  dimOutsideRegion = true,
  biomeSettings,
  onCommitHistory,
  onHoverCell,
  onSelectRegionBounds,
  onSelectRegionMap,
  mapBackgroundUrl,
  onClearMapBackground,
  maxZoom,
  onInteractingChange,
  rivers,
  lakes,
  onUpdateRivers,
  onUpdateLakes,
  selectedWaterId = null,
  selectedWaterType = null,
  onSelectWater,
  waterSettings = DEFAULT_WATER_TOOL_SETTINGS,
  onChangeWaterSettings,
  onClearAllWater,
  onUpdateBrush,
  templatePlacement = null,
  onUpdateTemplatePlacement,
  onCancelTemplatePlacement,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLMapRenderer | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

  // Biome offscreen canvas and active stroke refs
  const biomeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const biomeCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const biomeImageDataRef = useRef<ImageData | null>(null);
  const lastBiomeColsRowsRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const activeBiomeStrokeRef = useRef<Map<number, { prev: number; next: number }>>(new Map());

  // High performance RAF coalescing refs
  const panRafRef = useRef<number | null>(null);
  const pendingPanDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const wheelRafRef = useRef<number | null>(null);
  const pendingWheelZoomRef = useRef<{ mouseX: number; mouseY: number; factor: number } | null>(null);

  const [hoveredCellId, setHoveredCellId] = useState<number | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const cursorPosRef = useRef<{ x: number; y: number } | null>(null);

  // Region selection rectangle drag & aspect ratio setting
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [regionAspect, setRegionAspect] = useState<'free' | '2:1' | '1:1' | 'current'>('free');

  // Region shape selection tools & state
  const [selectMethod, setSelectMethod] = useState<RegionSelectMethod>('rect');
  const [smoothShape, setSmoothShape] = useState<boolean>(true);
  const [marginPercent, setMarginPercent] = useState<number>(8);
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);
  const [rect2Start, setRect2Start] = useState<{ x: number; y: number } | null>(null);
  const [confirmedShape, setConfirmedShape] = useState<{
    polygon: [number, number][];
    bounds: RegionalBounds;
  } | null>(null);
  const freehandPointsRef = useRef<[number, number][]>([]);
  const [freehandPoints, setFreehandPoints] = useState<[number, number][]>([]);
  const [townConfig, setTownConfig] = useState<TownConfig>({
    name: '街道の宿場町',
    realWidthM: 600,
    aspect: 4 / 3,
    detailScale: 0.15,
  });
  const [snapCoastline, setSnapCoastline] = useState<boolean>(true);
  const [followCoastline, setFollowCoastline] = useState<boolean>(false);
  const [isAutoSelectingIsland, setIsAutoSelectingIsland] = useState<boolean>(false);
  const snappedCoastRef = useRef<CoastlineSnapResult | null>(null);

  // Active map properties (Regional vs World)
  const isRegion = activeRegionalMap !== null;
  const currentWidth = isRegion ? activeRegionalMap.width : mapData.width;
  const currentHeight = isRegion ? activeRegionalMap.height : mapData.height;
  const currentCols = isRegion ? activeRegionalMap.gridCols : mapData.gridCols;
  const currentRows = isRegion ? activeRegionalMap.gridRows : mapData.gridRows;
  const currentElevation = isRegion ? activeRegionalMap.elevationGrid : mapData.elevationGrid;
  const currentSeaLevel = isRegion ? activeRegionalMap.seaLevel : mapData.seaLevel;
  const currentBiomeGrid = isRegion ? activeRegionalMap?.biomeGrid : mapData.biomeGrid;

  // Context for terrain-type-aware operations (e.g. symbol scattering restricted to cursor's terrain)
  const terrainContext = useMemo(() => ({
    biomeGrid: currentBiomeGrid,
    elevationGrid: currentElevation,
    gridCols: currentCols,
    gridRows: currentRows,
    mapWidth: currentWidth,
    mapHeight: currentHeight,
    seaLevel: currentSeaLevel ?? 35.0,
  }), [currentBiomeGrid, currentElevation, currentCols, currentRows, currentWidth, currentHeight, currentSeaLevel]);

  // Real-world map width in km (handles World map, and recursive Regional/Town maps)
  const effectiveWidthKm = useMemo(() => {
    if (!activeRegionalMap) {
      return mapData.worldWidthKm || 40000;
    }

    // Helper to compute widthKm for any region, falling back recursively to parent
    const computeRegionWidthKm = (reg: RegionalMapData): number => {
      if (typeof reg.widthKm === 'number' && reg.widthKm > 0) {
        return reg.widthKm;
      }
      const boundsWidth = reg.bounds
        ? Math.abs(reg.bounds.maxX - reg.bounds.minX)
        : reg.width;

      if (!reg.parentId || !mapData.regionalMaps[reg.parentId]) {
        const parentKm = mapData.worldWidthKm || 40000;
        const parentW = mapData.width || 2000;
        return parentKm * (boundsWidth / parentW);
      }

      const parentReg = mapData.regionalMaps[reg.parentId];
      const parentKm = computeRegionWidthKm(parentReg);
      const parentW = parentReg.width || 2000;
      return parentKm * (boundsWidth / parentW);
    };

    return computeRegionWidthKm(activeRegionalMap) || 1000;
  }, [activeRegionalMap, mapData.worldWidthKm, mapData.width, mapData.regionalMaps]);

  // Interaction tracking refs
  const isMouseDownRef = useRef<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const isSelectingRef = useRef<boolean>(false);
  const isDraggingCompassRef = useRef<boolean>(false);
  const compassDragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDraggingSymbolRef = useRef<boolean>(false);
  const draggedSymbolOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const symbolStrokeSnapshotRef = useRef<MapSymbolInstance[]>([]);
  const activeStrokeSymbolsRef = useRef<MapSymbolInstance[]>([]);
  const isSymbolStrokeActiveRef = useRef<boolean>(false);
  const lastSymbolWorldPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastWorldPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const activeStrokeChangesRef = useRef<Map<number, { prev: number; curr: number }>>(new Map());

  // Reset in-progress region selection when mode switches away from selectRegion
  useEffect(() => {
    if (brushSettings.mode !== 'selectRegion') {
      setConfirmedShape(null);
      setPolygonPoints([]);
      setFreehandPoints([]);
      freehandPointsRef.current = [];
      setRect2Start(null);
      setSelectionBox(null);
      setIsAutoSelectingIsland(false);
      snappedCoastRef.current = null;
    }
  }, [brushSettings.mode]);

  // Town Editing State & Helpers
  const effectiveTownSelectedIds = useMemo(() => {
    if (selectedTownObjectIds && selectedTownObjectIds.length > 0) return selectedTownObjectIds;
    if (selectedTownObjectId) return [selectedTownObjectId];
    return [];
  }, [selectedTownObjectIds, selectedTownObjectId]);

  const [drawingTownPoints, setDrawingTownPoints] = useState<Pt[]>([]);
  const [townMarqueeBox, setTownMarqueeBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<{ objectId: string; index: number } | null>(null);
  const [selectedGate, setSelectedGate] = useState<{ objectId: string; index: number } | null>(null);
  const [townClipboard, setTownClipboard] = useState<TownClipboardData | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const townDragRef = useRef<{
    type: 'translate' | 'vertex' | 'gate' | 'marquee' | 'rotate';
    startWorldPos: Pt;
    centroid?: Pt;
    objectId?: string;
    vertexIndex?: number;
    gateIndex?: number;
    initialObjects: TownObject[];
    draftObjects?: TownObject[];
    hasMoved?: boolean;
  } | null>(null);

  const currentTownObjectsRef = useRef<TownObject[]>(townObjects);
  currentTownObjectsRef.current = townObjects;

  // Frame scheduler for overlay canvas rendering (coalesces multiple requests in same frame)
  const renderOverlayRef = useRef<() => void>(() => {});
  const overlaySchedulerRef = useRef<FrameScheduler | null>(null);

  const scheduleOverlayRender = useCallback(() => {
    if (!overlaySchedulerRef.current) {
      overlaySchedulerRef.current = createFrameScheduler(() => {
        renderOverlayRef.current();
      });
    }
    overlaySchedulerRef.current.schedule();
  }, []);

  const renderPreviewOverlayRef = useRef<() => void>(() => {});
  const triggerPreviewOverlay = useCallback(() => {
    renderPreviewOverlayRef.current();
  }, []);

  useEffect(() => {
    return () => {
      overlaySchedulerRef.current?.cancel();
    };
  }, []);

  const [textureCacheVersion, setTextureCacheVersion] = useState(0);
  useEffect(() => {
    return townTextureCache.subscribe(() => {
      setTextureCacheVersion((v) => v + 1);
    });
  }, []);

  // Effective Rivers and Lakes (passed as props or from active map / world map)
  const effectiveRivers: RiverData[] = useMemo(() => {
    if (rivers !== undefined) return rivers;
    if (activeRegionalMap?.rivers !== undefined) return activeRegionalMap.rivers;
    return mapData.rivers || [];
  }, [rivers, activeRegionalMap?.rivers, mapData.rivers]);

  const effectiveLakes: LakeData[] = useMemo(() => {
    if (lakes !== undefined) return lakes;
    if (activeRegionalMap?.lakes !== undefined) return activeRegionalMap.lakes;
    return mapData.lakes || [];
  }, [lakes, activeRegionalMap?.lakes, mapData.lakes]);

  const [drawingRiverPoints, setDrawingRiverPoints] = useState<[number, number][]>([]);
  const [drawingLakeStart, setDrawingLakeStart] = useState<[number, number] | null>(null);
  const [drawingLakePolygon, setDrawingLakePolygon] = useState<[number, number][]>([]);
  const [activeWaterVertexIndex, setActiveWaterVertexIndex] = useState<number | null>(null);

  const waterDragRef = useRef<{
    type: 'translate' | 'vertex';
    waterType: 'river' | 'lake';
    id: string;
    vertexIndex?: number;
    startWorldPos: [number, number];
    initialRiver?: RiverData;
    initialLake?: LakeData;
    hasMoved?: boolean;
  } | null>(null);

  // Reset water drawing states when switching modes
  useEffect(() => {
    if (brushSettings.mode !== 'river') {
      setDrawingRiverPoints([]);
    }
    if (brushSettings.mode !== 'lake') {
      setDrawingLakeStart(null);
      setDrawingLakePolygon([]);
    }
    if (brushSettings.mode !== 'waterEdit') {
      setActiveWaterVertexIndex(null);
    }
  }, [brushSettings.mode]);

  const metersPerUnit = useMemo(() => {
    return (effectiveWidthKm * 1000) / currentWidth;
  }, [effectiveWidthKm, currentWidth]);

  // Reset drawing points when switching away from town drawing tools
  useEffect(() => {
    if (
      brushSettings.mode !== 'townRoad' &&
      brushSettings.mode !== 'townWall' &&
      brushSettings.mode !== 'townPier' &&
      brushSettings.mode !== 'townBuilding' &&
      brushSettings.mode !== 'townDistrict'
    ) {
      setDrawingTownPoints([]);
    }
  }, [brushSettings.mode]);

  // Rotation handle position for selected town objects
  const townRotationHandle = useMemo(() => {
    if (activeRegionalMap?.kind !== 'town' || effectiveTownSelectedIds.length === 0) return null;
    const selectedSet = new Set(effectiveTownSelectedIds);
    const selectedObjs = townObjects.filter((o) => selectedSet.has(o.id));
    if (selectedObjs.length === 0) return null;
    const b = selectionBounds(selectedObjs);
    if (!b) return null;
    const cx = (b.minX + b.maxX) * 0.5;
    const cy = (b.minY + b.maxY) * 0.5;
    const dpr = glCanvasRef.current ? glCanvasRef.current.width / (glCanvasRef.current.clientWidth || 1) : 1;
    const zoomPx = viewport.zoom * dpr;
    const handleDist = 24 / zoomPx;
    const handlePos: Pt = [cx, b.minY - handleDist];
    const stemTop: Pt = [cx, b.minY];
    return {
      handlePos,
      stemTop,
      center: [cx, cy] as Pt,
      bounds: b,
      selectedObjs,
    };
  }, [activeRegionalMap?.kind, effectiveTownSelectedIds, townObjects, viewport.zoom]);

  // Candidates for snapping (8px on screen)
  const baseTownSnapCandidates = useMemo(() => {
    if (activeRegionalMap?.kind !== 'town' || !townToolConfig.snapEnabled) return [];
    const pts: Pt[] = [];
    for (const obj of townObjects) {
      const objPts = obj.kind === 'district' || obj.kind === 'building' ? obj.polygon : obj.points;
      for (let i = 0; i < objPts.length; i++) {
        pts.push(objPts[i]);
      }
    }
    return pts;
  }, [activeRegionalMap?.kind, townToolConfig.snapEnabled, townObjects]);

  const townSnapCandidates = useMemo(() => {
    if (drawingTownPoints.length > 0) {
      return [drawingTownPoints[0], ...baseTownSnapCandidates];
    }
    return baseTownSnapCandidates;
  }, [baseTownSnapCandidates, drawingTownPoints]);

  // Find active handle of a selected object under cursor
  const findTownHandleUnderCursor = useCallback(
    (worldPos: Pt, toleranceUnits: number) => {
      if (effectiveTownSelectedIds.length === 0) return null;
      const selectedSet = new Set(effectiveTownSelectedIds);
      const selectedObjs = townObjects.filter((o) => selectedSet.has(o.id));

      // 1. Gate handles
      for (const obj of selectedObjs) {
        if (obj.kind === 'wall') {
          for (let gIdx = 0; gIdx < obj.gates.length; gIdx++) {
            const g = obj.gates[gIdx];
            const gp = getGateWorldPosition(obj, g);
            if (Math.hypot(worldPos[0] - gp[0], worldPos[1] - gp[1]) <= toleranceUnits) {
              return { type: 'gate' as const, objectId: obj.id, gateIndex: gIdx, p: gp };
            }
          }
        }
      }

      // 2. Vertex handles
      for (const obj of selectedObjs) {
        const pts = obj.kind === 'district' || obj.kind === 'building' ? obj.polygon : obj.points;
        for (let vIdx = 0; vIdx < pts.length; vIdx++) {
          const p = pts[vIdx];
          if (Math.hypot(worldPos[0] - p[0], worldPos[1] - p[1]) <= toleranceUnits) {
            return { type: 'vertex' as const, objectId: obj.id, vertexIndex: vIdx, p };
          }
        }
      }

      // 3. Midpoint handles
      for (const obj of selectedObjs) {
        const pts = obj.kind === 'district' || obj.kind === 'building' ? obj.polygon : obj.points;
        const isClosed =
          obj.kind === 'district' ||
          obj.kind === 'building' ||
          (obj.kind === 'wall' && obj.closed);
        const numEdges = isClosed ? pts.length : pts.length - 1;
        for (let eIdx = 0; eIdx < numEdges; eIdx++) {
          const p0 = pts[eIdx];
          const p1 = pts[(eIdx + 1) % pts.length];
          const mp: Pt = [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5];
          if (Math.hypot(worldPos[0] - mp[0], worldPos[1] - mp[1]) <= toleranceUnits) {
            return { type: 'midpoint' as const, objectId: obj.id, segmentIndex: eIdx, p: mp };
          }
        }
      }

      return null;
    },
    [effectiveTownSelectedIds, townObjects]
  );

  // Finalize in-progress line drawing into a new TownObject
  const finalizeTownDrawing = useCallback(
    (pointsToFinalize: Pt[], forceClosedWall: boolean = false) => {
      if (pointsToFinalize.length < 2) {
        setDrawingTownPoints([]);
        return;
      }

      const mode = brushSettings.mode;
      let newObj: TownObject | null = null;
      const now = Date.now();
      const rand = Math.random().toString(36).substring(2, 6);

      if (mode === 'townRoad') {
        const road: TownRoad = {
          id: `road_${now}_${rand}`,
          name: `道 ${townObjects.filter((o) => o.kind === 'road').length + 1}`,
          kind: 'road',
          style: townToolConfig.roadStyle,
          widthM: townToolConfig.roadWidthM,
          smooth: townToolConfig.roadSmooth,
          points: pointsToFinalize,
        };
        newObj = road;
      } else if (mode === 'townWall') {
        const isClosed =
          forceClosedWall ||
          townToolConfig.wallClosed ||
          (pointsToFinalize.length >= 3 &&
            Math.hypot(
              pointsToFinalize[0][0] - pointsToFinalize[pointsToFinalize.length - 1][0],
              pointsToFinalize[0][1] - pointsToFinalize[pointsToFinalize.length - 1][1]
            ) <
              12 / viewport.zoom);

        const wallPts =
          isClosed &&
          pointsToFinalize.length >= 3 &&
          Math.hypot(
            pointsToFinalize[0][0] - pointsToFinalize[pointsToFinalize.length - 1][0],
            pointsToFinalize[0][1] - pointsToFinalize[pointsToFinalize.length - 1][1]
          ) <
            12 / viewport.zoom
            ? pointsToFinalize.slice(0, pointsToFinalize.length - 1)
            : pointsToFinalize;

        const wall: TownWall = {
          id: `wall_${now}_${rand}`,
          name: `城壁 ${townObjects.filter((o) => o.kind === 'wall').length + 1}`,
          kind: 'wall',
          points: wallPts,
          closed: isClosed,
          thicknessM: townToolConfig.wallThicknessM,
          towers: townToolConfig.wallTowers,
          towerRadiusM: townToolConfig.wallTowerRadiusM,
          gates: [],
        };
        newObj = wall;
      } else if (mode === 'townPier') {
        const pier: TownPier = {
          id: `pier_${now}_${rand}`,
          name: `${townToolConfig.pierVariant === 'pier' ? '桟橋' : '橋'} ${
            townObjects.filter((o) => o.kind === 'pier').length + 1
          }`,
          kind: 'pier',
          variant: townToolConfig.pierVariant,
          widthM: townToolConfig.pierWidthM,
          points: pointsToFinalize,
        };
        newObj = pier;
      }

      if (newObj) {
        const nextObjects = [...townObjects, newObj];
        townPerf.startConfirmation(`${newObj.name || '町部品'}の作成`);
        onCommitHistory({
          description: `${newObj.name || '町部品'}の作成`,
          timestamp: Date.now(),
          townChanges: {
            prevObjects: townObjects,
            newObjects: nextObjects,
          },
        });
        onUpdateTownObjects?.(nextObjects);
        onSelectTownObjectIds?.([newObj.id]);
        onSelectTownObjectId?.(newObj.id);
      }

      setDrawingTownPoints([]);
      scheduleOverlayRender();
    },
    [
      brushSettings.mode,
      townObjects,
      townToolConfig,
      viewport.zoom,
      onCommitHistory,
      onUpdateTownObjects,
      onSelectTownObjectIds,
      onSelectTownObjectId,
      scheduleOverlayRender,
    ]
  );


  // Commits a shape (polygon / freehand) selection, calculates bounds with margin, and fits to limits
  const commitShapeSelection = useCallback(
    (rawPolygon: [number, number][]) => {
      if (rawPolygon.length < 3) return;
      const cleaned = removeDegenerateSpikes(rawPolygon, 2.0);
      if (cleaned.length < 3) return;
      const poly = smoothShape ? smoothPolygon(cleaned, 4) : [...cleaned];
      const rawB = polygonBounds(poly);
      const w = rawB.maxX - rawB.minX;
      const h = rawB.maxY - rawB.minY;
      const marginRatio = marginPercent / 100;
      const mw = w * marginRatio;
      const mh = h * marginRatio;

      const expandedBounds: RegionalBounds = {
        minX: rawB.minX - mw,
        minY: rawB.minY - mh,
        maxX: rawB.maxX + mw,
        maxY: rawB.maxY + mh,
      };

      const fitResult = fitBoundsToLimits(expandedBounds, currentWidth, currentHeight);
      setConfirmedShape({
        polygon: poly,
        bounds: fitResult.bounds,
      });
      setPolygonPoints([]);
      setFreehandPoints([]);
      freehandPointsRef.current = [];
      setSelectionBox(null);
      setRect2Start(null);

      onSelectRegionBounds?.(fitResult.bounds, fitResult.adjusted, poly);
    },
    [smoothShape, marginPercent, currentWidth, currentHeight, onSelectRegionBounds]
  );

  // Initialize WebGL Renderer
  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;

    try {
      rendererRef.current = new WebGLMapRenderer(glCanvas);
      rendererRef.current.updateGridTextures(
        currentElevation,
        currentCols,
        currentRows
      );
    } catch (err) {
      console.error('Failed to initialize WebGLMapRenderer:', err);
    }

    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Update textures when target map changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.updateGridTextures(
        currentElevation,
        currentCols,
        currentRows
      );
    }
  }, [currentElevation, currentCols, currentRows]);

  // Screen to World coordinates
  const screenToWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: (sx - viewport.x) / viewport.zoom,
        y: (sy - viewport.y) / viewport.zoom,
      };
    },
    [viewport]
  );

  // 1. Render WebGL Map (only called when viewport, data, or view settings change)
  const renderWebGL = useCallback(() => {
    const glCanvas = glCanvasRef.current;
    if (rendererRef.current && glCanvas) {
      const dpr = glCanvas.clientWidth > 0
        ? glCanvas.width / glCanvas.clientWidth
        : Math.min(window.devicePixelRatio || 1, 2.0);
      rendererRef.current.render(
        currentWidth,
        currentHeight,
        currentCols,
        currentRows,
        currentElevation,
        currentSeaLevel,
        viewport,
        {
          viewMode,
          showShading,
          showRipples,
        },
        dpr
      );
    }
  }, [
    currentWidth,
    currentHeight,
    currentCols,
    currentRows,
    currentElevation,
    currentSeaLevel,
    viewport,
    viewMode,
    showShading,
    showRipples,
  ]);

  // Biome color lookup table for dynamic custom biome slots (1-255)
  const biomeColorTable = useMemo(() => {
    return buildBiomeColorTable(biomeTypes || mapData.biomeTypes || DEFAULT_BIOME_TYPES);
  }, [biomeTypes, mapData.biomeTypes]);

  // Rebuild offscreen canvas for biome data
  const rebuildBiomeCanvas = useCallback(
    (grid: Uint8Array | undefined, cols: number, rows: number) => {
      let canvas = biomeCanvasRef.current;
      if (
        !canvas ||
        lastBiomeColsRowsRef.current.cols !== cols ||
        lastBiomeColsRowsRef.current.rows !== rows
      ) {
        canvas = document.createElement('canvas');
        canvas.width = cols;
        canvas.height = rows;
        biomeCanvasRef.current = canvas;
        biomeCtxRef.current = canvas.getContext('2d');
        lastBiomeColsRowsRef.current = { cols, rows };
      }
      const ctx = biomeCtxRef.current;
      if (!ctx) return;
      const imgData = ctx.createImageData(cols, rows);
      const data = imgData.data;

      if (grid && grid.length === cols * rows) {
        for (let i = 0; i < grid.length; i++) {
          const bId = grid[i];
          if (bId !== 0) {
            const rgba = biomeColorTable[bId];
            if (rgba) {
              const px = i * 4;
              data[px] = rgba[0];
              data[px + 1] = rgba[1];
              data[px + 2] = rgba[2];
              data[px + 3] = rgba[3];
            }
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      biomeImageDataRef.current = imgData;
    },
    [biomeColorTable]
  );

  // Update dirty subregion of offscreen biome canvas for zero-latency brush strokes
  const updateBiomeSubRegion = useCallback(
    (
      changes: { gridIndex: number; next: number }[],
      bounds: BiomeBoundingBox | null
    ) => {
      const ctx = biomeCtxRef.current;
      const imgData = biomeImageDataRef.current;
      if (!ctx || !imgData) return;

      const data = imgData.data;
      for (const ch of changes) {
        const px = ch.gridIndex * 4;
        const bId = ch.next;
        if (bId !== 0) {
          const rgba = biomeColorTable[bId];
          if (rgba) {
            data[px] = rgba[0];
            data[px + 1] = rgba[1];
            data[px + 2] = rgba[2];
            data[px + 3] = rgba[3];
          }
        } else {
          data[px] = 0;
          data[px + 1] = 0;
          data[px + 2] = 0;
          data[px + 3] = 0;
        }
      }

      if (bounds) {
        const w = bounds.maxC - bounds.minC + 1;
        const h = bounds.maxR - bounds.minR + 1;
        ctx.putImageData(imgData, 0, 0, bounds.minC, bounds.minR, w, h);
      } else {
        ctx.putImageData(imgData, 0, 0);
      }
    },
    [biomeColorTable]
  );

  // Get or lazily initialize the biome grid on first paint
  const getOrCreateBiomeGrid = useCallback((): Uint8Array => {
    let grid = isRegion ? activeRegionalMap?.biomeGrid : mapData.biomeGrid;
    if (!grid) {
      grid = new Uint8Array(currentCols * currentRows);
      if (isRegion && activeRegionalMap) {
        activeRegionalMap.biomeGrid = grid;
      } else {
        mapData.biomeGrid = grid;
      }
      rebuildBiomeCanvas(grid, currentCols, currentRows);
    }
    return grid;
  }, [isRegion, activeRegionalMap, mapData, currentCols, currentRows, rebuildBiomeCanvas]);

  // 2. Render 2D Vector Overlay (cartography ornaments, compass, border, brush cursor)
  const renderOverlay = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    townPerf.start('renderOverlay_total');

    const dpr = overlayCanvas.clientWidth > 0
      ? overlayCanvas.width / overlayCanvas.clientWidth
      : Math.min(window.devicePixelRatio || 1, 2.0);
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    ctx.save();
    ctx.setTransform(viewport.zoom * dpr, 0, 0, viewport.zoom * dpr, viewport.x * dpr, viewport.y * dpr);

    const cPos = compassPos || { x: currentWidth * 0.12, y: currentHeight * 0.28 };

    // 0. Pixel Art Scenic Backdrop or Map Reference Image
    townPerf.start('background');
    if (bgImageRef.current && bgImageRef.current.complete && bgImageRef.current.naturalWidth > 0) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(bgImageRef.current, 0, 0, currentWidth, currentHeight);
      ctx.restore();
    }
    townPerf.end('background');

    // 0.5. Semi-transparent Biome Grid Overlay
    townPerf.start('biome');
    const isBiomeToolActive =
      brushSettings.mode === 'biomePaint' ||
      brushSettings.mode === 'biomeFill' ||
      brushSettings.mode === 'biomeErase';
    const showBiomeOverlay =
      ((biomeSettings?.showBiome ?? true) || isBiomeToolActive) && !!currentBiomeGrid;

    if (showBiomeOverlay && biomeCanvasRef.current) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = (biomeSettings?.opacity ?? 55) / 100;
      ctx.drawImage(biomeCanvasRef.current, 0, 0, currentWidth, currentHeight);
      ctx.restore();
    }
    townPerf.end('biome');

    // 0.8. Regional Map Boundary Outline & Outer Context Dimming
    // When viewing a regional map generated from a shape (especially with "親のまま生成"),
    // darken the terrain outside the shape polygon and stroke a prominent cartographic boundary.
    townPerf.start('boundary');
    if (activeRegionalMap && activeRegionalMap.outline && activeRegionalMap.outline.length >= 3) {
      const b = activeRegionalMap.bounds;
      const bw = b.maxX - b.minX;
      const bh = b.maxY - b.minY;
      if (bw > 0 && bh > 0) {
        const regPoly: [number, number][] = activeRegionalMap.outline.map(([px, py]) => [
          ((px - b.minX) / bw) * currentWidth,
          ((py - b.minY) / bh) * currentHeight,
        ]);

        ctx.save();

        // 1. Darken outer surrounding context (even-odd fill of entire canvas excluding polygon)
        if (dimOutsideRegion) {
          ctx.beginPath();
          ctx.rect(0, 0, currentWidth, currentHeight);
          ctx.moveTo(regPoly[0][0], regPoly[0][1]);
          for (let i = 1; i < regPoly.length; i++) {
            ctx.lineTo(regPoly[i][0], regPoly[i][1]);
          }
          ctx.closePath();
          // Elegant dark parchment tint that dims the outer context while keeping it readable
          ctx.fillStyle = 'rgba(12, 10, 9, 0.52)';
          ctx.fill('evenodd');

          // Soft outer shadow/glow around the boundary to give depth
          ctx.beginPath();
          ctx.moveTo(regPoly[0][0], regPoly[0][1]);
          for (let i = 1; i < regPoly.length; i++) {
            ctx.lineTo(regPoly[i][0], regPoly[i][1]);
          }
          ctx.closePath();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.lineWidth = 6.0 / viewport.zoom;
          ctx.setLineDash([]);
          ctx.stroke();
        }

        // 2. Crisp, cartographic glowing boundary line along the region edge
        ctx.beginPath();
        ctx.moveTo(regPoly[0][0], regPoly[0][1]);
        for (let i = 1; i < regPoly.length; i++) {
          ctx.lineTo(regPoly[i][0], regPoly[i][1]);
        }
        ctx.closePath();
        ctx.strokeStyle = '#d97706'; // Rich amber
        ctx.lineWidth = 2.4 / viewport.zoom;
        ctx.setLineDash([]);
        ctx.stroke();

        // Inner dashed highlight line for antique map cartography feel
        ctx.strokeStyle = '#fef3c7'; // Light ivory/gold
        ctx.lineWidth = 1.2 / viewport.zoom;
        ctx.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);

        // 3. Elegant floating badge tag at top-most point of boundary
        let topPt = regPoly[0];
        for (let i = 1; i < regPoly.length; i++) {
          if (regPoly[i][1] < topPt[1]) {
            topPt = regPoly[i];
          }
        }

        const tagText = `📍 地域範囲: ${activeRegionalMap.name}`;
        ctx.font = `bold ${Math.max(10, 11 / viewport.zoom)}px sans-serif`;
        const textMetrics = ctx.measureText(tagText);
        const tagPadX = 7 / viewport.zoom;
        const tagPadY = 3.5 / viewport.zoom;
        const tagW = textMetrics.width + tagPadX * 2;
        const tagH = 17 / viewport.zoom;
        const tagX = Math.max(8, Math.min(currentWidth - tagW - 8, topPt[0] - tagW / 2));
        const tagY = Math.max(8, topPt[1] - tagH - 5 / viewport.zoom);

        ctx.fillStyle = 'rgba(28, 25, 23, 0.92)';
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 1.0 / viewport.zoom;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(tagX, tagY, tagW, tagH, 3.5 / viewport.zoom);
        } else {
          ctx.rect(tagX, tagY, tagW, tagH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fef3c7';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(tagText, tagX + tagPadX, tagY + tagH / 2);

        ctx.restore();
      }
    }
    townPerf.end('boundary');

    // 1. Nautical Navigation Rhumb Lines (Loxodromes)
    townPerf.start('rhumb');
    if (showCompass) {
      drawRhumbLines(
        ctx,
        currentWidth,
        currentHeight,
        cPos,
        [{ x: currentWidth * 0.62, y: currentHeight * 0.62 }],
        viewport.zoom * dpr
      );
    }
    townPerf.end('rhumb');

    // 2. Region Selection Visuals: Selection Box / Polygon / Freehand / Confirmed Shape
    if (selectionBox && !(selectMethod === 'rect2' && followCoastline)) {
      const minX = Math.min(selectionBox.startX, selectionBox.currentX);
      const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
      const minY = Math.min(selectionBox.startY, selectionBox.currentY);
      const maxY = Math.max(selectionBox.startY, selectionBox.currentY);

      ctx.save();
      ctx.fillStyle = 'rgba(235, 160, 40, 0.15)';
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      ctx.strokeStyle = '#e6a122';
      ctx.lineWidth = 2.0 / viewport.zoom;
      ctx.setLineDash([8 / viewport.zoom, 6 / viewport.zoom]);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.restore();
    }

    // Live 2-point coastline preview when in rect2 mode with followCoastline
    if (brushSettings.mode === 'selectRegion' && selectMethod === 'rect2' && followCoastline && rect2Start) {
      const curPos = cursorPosRef.current;
      if (curPos) {
        const startPt: [number, number] = [rect2Start.x, rect2Start.y];
        const endPt: [number, number] = (snappedCoastRef.current && (snapCoastline || followCoastline))
          ? [snappedCoastRef.current.point[0], snappedCoastRef.current.point[1]]
          : [curPos.x, curPos.y];
        const traced = traceCoastlinePath(
          startPt,
          endPt,
          currentElevation,
          currentCols,
          currentRows,
          currentWidth,
          currentHeight,
          currentSeaLevel,
          40 / viewport.zoom
        );

        ctx.save();
        if (traced.length > 2) {
          // Fill inside closed coastal polygon
          ctx.beginPath();
          ctx.moveTo(traced[0][0], traced[0][1]);
          for (let i = 1; i < traced.length; i++) {
            ctx.lineTo(traced[i][0], traced[i][1]);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(34, 211, 238, 0.14)';
          ctx.fill();

          // Traced coastline stroke (cyan glowing dashed line)
          ctx.beginPath();
          ctx.moveTo(traced[0][0], traced[0][1]);
          for (let i = 1; i < traced.length; i++) {
            ctx.lineTo(traced[i][0], traced[i][1]);
          }
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2.4 / viewport.zoom;
          ctx.setLineDash([5 / viewport.zoom, 3 / viewport.zoom]);
          ctx.stroke();

          // Straight closing chord
          ctx.beginPath();
          ctx.moveTo(endPt[0], endPt[1]);
          ctx.lineTo(startPt[0], startPt[1]);
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
          ctx.lineWidth = 1.4 / viewport.zoom;
          ctx.setLineDash([3 / viewport.zoom, 3 / viewport.zoom]);
          ctx.stroke();
        }

        // Start point marker
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(startPt[0], startPt[1], 5.5 / viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#22d3ee';
        ctx.fill();
        ctx.strokeStyle = '#08111c';
        ctx.lineWidth = 1.2 / viewport.zoom;
        ctx.stroke();

        ctx.restore();
      }
    }

    // In-progress Polygon / Coastline vertices and live rubber-band line
    if (polygonPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.0 / viewport.zoom;
      ctx.beginPath();
      ctx.moveTo(polygonPoints[0][0], polygonPoints[0][1]);
      for (let i = 1; i < polygonPoints.length; i++) {
        ctx.lineTo(polygonPoints[i][0], polygonPoints[i][1]);
      }
      ctx.stroke();

      const curPos = cursorPosRef.current;
      if (curPos) {
        const lastPt = polygonPoints[polygonPoints.length - 1];
        const isCurCoastSnapped = !!(followCoastline && snapCoastline && snappedCoastRef.current);
        let rubberPath: [number, number][] = [[lastPt[0], lastPt[1]], [curPos.x, curPos.y]];

        if (selectMethod === 'polygon' && followCoastline && isCurCoastSnapped) {
          const snapLast = findNearestCoastlinePoint(
            lastPt[0],
            lastPt[1],
            currentElevation,
            currentCols,
            currentRows,
            currentWidth,
            currentHeight,
            currentSeaLevel,
            COASTLINE_SNAP_PX / viewport.zoom
          );
          if (snapLast && snapLast.contourIndex === snappedCoastRef.current!.contourIndex) {
            rubberPath = traceCoastlinePath(
              lastPt,
              [curPos.x, curPos.y],
              currentElevation,
              currentCols,
              currentRows,
              currentWidth,
              currentHeight,
              currentSeaLevel,
              COASTLINE_SNAP_PX / viewport.zoom
            );
          }
        }

        ctx.beginPath();
        ctx.moveTo(rubberPath[0][0], rubberPath[0][1]);
        for (let i = 1; i < rubberPath.length; i++) {
          ctx.lineTo(rubberPath[i][0], rubberPath[i][1]);
        }
        if (rubberPath.length > 2) {
          // Coastline-following path: cyan glowing dashed line
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2.4 / viewport.zoom;
          ctx.setLineDash([5 / viewport.zoom, 3 / viewport.zoom]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          // Straight rubberband line
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.8 / viewport.zoom;
          ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Vertex handles
      for (let i = 0; i < polygonPoints.length; i++) {
        const [vx, vy] = polygonPoints[i];
        ctx.beginPath();
        ctx.arc(vx, vy, (i === 0 ? 5.5 : 3.5) / viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#fbbf24' : '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#1c1917';
        ctx.lineWidth = 1.0 / viewport.zoom;
        ctx.stroke();
      }

      // Snapping circle when hovering near start vertex to close
      if (curPos && polygonPoints.length >= 3) {
        const distToP0 = Math.hypot(curPos.x - polygonPoints[0][0], curPos.y - polygonPoints[0][1]);
        if (distToP0 <= 18 / viewport.zoom) {
          ctx.beginPath();
          ctx.arc(polygonPoints[0][0], polygonPoints[0][1], 10 / viewport.zoom, 0, Math.PI * 2);
          ctx.strokeStyle = '#34d399';
          ctx.lineWidth = 2.0 / viewport.zoom;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Coastline Snap cursor indicator & Auto-island tooltip
    if (brushSettings.mode === 'selectRegion') {
      const curPos = cursorPosRef.current;
      if (snappedCoastRef.current) {
        const sp = snappedCoastRef.current.point;
        ctx.save();
        ctx.beginPath();
        ctx.arc(sp[0], sp[1], 5.5 / viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.35)';
        ctx.fill();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1.8 / viewport.zoom;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(sp[0], sp[1], 1.8 / viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.font = `bold ${Math.max(9, 10 / viewport.zoom)}px sans-serif`;
        ctx.fillStyle = '#67e8f9';
        ctx.fillText('海岸線', sp[0] + 8 / viewport.zoom, sp[1] - 4 / viewport.zoom);
        ctx.restore();
      }

      if (isAutoSelectingIsland && curPos) {
        ctx.save();
        ctx.font = `bold ${Math.max(10, 11 / viewport.zoom)}px sans-serif`;
        ctx.fillStyle = '#22d3ee';
        ctx.fillText('⚡ 島・陸地をクリックで自動選択', curPos.x + 12 / viewport.zoom, curPos.y + 16 / viewport.zoom);
        ctx.restore();
      }
    }

    // In-progress Freehand line
    if (freehandPoints.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.2 / viewport.zoom;
      ctx.beginPath();
      ctx.moveTo(freehandPoints[0][0], freehandPoints[0][1]);
      for (let i = 1; i < freehandPoints.length; i++) {
        ctx.lineTo(freehandPoints[i][0], freehandPoints[i][1]);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Confirmed Shape: Dim area outside the shape, draw dashed bounding box & solid outline
    if (confirmedShape) {
      ctx.save();
      const b = confirmedShape.bounds;
      const poly = confirmedShape.polygon;

      // Dim region outside shape (even-odd clipping on outer box)
      ctx.fillStyle = 'rgba(10, 15, 25, 0.55)';
      ctx.beginPath();
      ctx.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      if (poly.length >= 3) {
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1]);
        }
        ctx.closePath();
      }
      ctx.fill('evenodd');

      // Dashed bounding box
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.6 / viewport.zoom;
      ctx.setLineDash([6 / viewport.zoom, 5 / viewport.zoom]);
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

      // Solid outline
      if (poly.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1]);
        }
        ctx.closePath();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.4 / viewport.zoom;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      ctx.fillStyle = '#fef3c7';
      ctx.font = `bold ${Math.max(10, 12 / viewport.zoom)}px sans-serif`;
      ctx.fillText('選択確定 (外接枠 + 余白)', b.minX + 4 / viewport.zoom, Math.max(14, b.minY - 4 / viewport.zoom));
      ctx.restore();
    }

    // 2.5 Town Map placement preview when in selectRegion mode with 'town' method
    if (brushSettings.mode === 'selectRegion' && selectMethod === 'town') {
      const curPos = cursorPosRef.current;
      if (curPos) {
        const tb = computeTownBounds(
          { width: currentWidth, height: currentHeight, widthKm: effectiveWidthKm },
          curPos.x,
          curPos.y,
          townConfig.realWidthM,
          townConfig.aspect
        );
        const wScreen = (tb.maxX - tb.minX) * viewport.zoom;
        const hScreen = (tb.maxY - tb.minY) * viewport.zoom;

        ctx.save();
        if (Math.max(wScreen, hScreen) >= 12) {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
          ctx.fillRect(tb.minX, tb.minY, tb.maxX - tb.minX, tb.maxY - tb.minY);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.8 / viewport.zoom;
          ctx.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);
          ctx.strokeRect(tb.minX, tb.minY, tb.maxX - tb.minX, tb.maxY - tb.minY);

          // Center cross
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
          ctx.lineWidth = 1.0 / viewport.zoom;
          const cx = (tb.minX + tb.maxX) / 2;
          const cy = (tb.minY + tb.maxY) / 2;
          const crossLen = Math.max(2, Math.min(tb.maxX - tb.minX, tb.maxY - tb.minY) * 0.25);
          ctx.beginPath();
          ctx.moveTo(cx - crossLen, cy);
          ctx.lineTo(cx + crossLen, cy);
          ctx.moveTo(cx, cy - crossLen);
          ctx.lineTo(cx, cy + crossLen);
          ctx.stroke();

          ctx.fillStyle = '#fef3c7';
          ctx.font = `bold ${Math.max(10, 12 / viewport.zoom)}px sans-serif`;
          ctx.fillText(
            `${townConfig.name} (${townConfig.realWidthM}m)`,
            tb.minX + 4 / viewport.zoom,
            Math.max(14, tb.minY - 4 / viewport.zoom)
          );
        } else {
          // Screen size < 12px fallback crosshair & indicator
          const cx = (tb.minX + tb.maxX) / 2;
          const cy = (tb.minY + tb.maxY) / 2;
          const s = 10 / viewport.zoom;

          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.6 / viewport.zoom;
          ctx.strokeRect(cx - s, cy - s, s * 2, s * 2);
          ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
          ctx.fillRect(cx - s, cy - s, s * 2, s * 2);

          ctx.beginPath();
          ctx.moveTo(cx - s * 1.8, cy);
          ctx.lineTo(cx + s * 1.8, cy);
          ctx.moveTo(cx, cy - s * 1.8);
          ctx.lineTo(cx, cy + s * 1.8);
          ctx.stroke();

          ctx.fillStyle = '#fbbf24';
          ctx.font = `bold ${Math.max(10, 11 / viewport.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('クリックして配置', cx, cy + s + 12 / viewport.zoom);
          ctx.textAlign = 'left';
        }
        ctx.restore();
      }
    }

    // 3. Child Regional Map outlines on the currently viewed map (World or Parent Region)
    if (mapData.regionalMaps) {
      const currentMapId = activeRegionalMap ? activeRegionalMap.id : null;
      const childRegions = Object.values(mapData.regionalMaps).filter(
        (reg) => (reg.parentId ?? null) === currentMapId
      );

      if (childRegions.length > 0) {
        ctx.save();
        for (const reg of childRegions) {
          const b = reg.bounds;
          const screenW = (b.maxX - b.minX) * viewport.zoom;
          const screenH = (b.maxY - b.minY) * viewport.zoom;
          const maxScreenDim = Math.max(screenW, screenH);
          const isTown = reg.kind === 'town';

          if (isTown && maxScreenDim < 24) {
            // Render house icon / town marker when small on screen
            const cx = (b.minX + b.maxX) / 2;
            const cy = (b.minY + b.maxY) / 2;
            const s = 7 / viewport.zoom;

            ctx.save();
            ctx.translate(cx, cy);

            // House roof (triangle)
            ctx.beginPath();
            ctx.moveTo(0, -s * 1.3);
            ctx.lineTo(s * 1.2, -s * 0.2);
            ctx.lineTo(-s * 1.2, -s * 0.2);
            ctx.closePath();
            ctx.fillStyle = '#d97706';
            ctx.fill();
            ctx.strokeStyle = '#292524';
            ctx.lineWidth = 1.2 / viewport.zoom;
            ctx.stroke();

            // House body (square)
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(-s * 0.8, -s * 0.2, s * 1.6, s * 1.2);
            ctx.strokeRect(-s * 0.8, -s * 0.2, s * 1.6, s * 1.2);

            // Door
            ctx.fillStyle = '#78350f';
            ctx.fillRect(-s * 0.25, s * 0.3, s * 0.5, s * 0.7);

            // Name label
            ctx.fillStyle = '#fef3c7';
            ctx.font = `bold ${Math.max(10, 11 / viewport.zoom)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(reg.name, 0, s + 3 / viewport.zoom);

            ctx.restore();
          } else {
            // Screen size >= 24px (or non-town): dashed line + name
            const strokeColor = isTown ? 'rgba(245, 158, 11, 0.9)' : 'rgba(70, 180, 240, 0.8)';
            const fillColor = isTown ? 'rgba(245, 158, 11, 0.12)' : 'rgba(70, 180, 240, 0.1)';
            const textColor = isTown ? '#fde68a' : '#93c5fd';

            if (reg.outline && reg.outline.length >= 3) {
              ctx.beginPath();
              ctx.moveTo(reg.outline[0][0], reg.outline[0][1]);
              for (let i = 1; i < reg.outline.length; i++) {
                ctx.lineTo(reg.outline[i][0], reg.outline[i][1]);
              }
              ctx.closePath();
              ctx.strokeStyle = strokeColor;
              ctx.lineWidth = 1.8 / viewport.zoom;
              ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);
              ctx.stroke();

              ctx.fillStyle = fillColor;
              ctx.fill();

              ctx.fillStyle = textColor;
              ctx.font = `${Math.max(10, 13 / viewport.zoom)}px sans-serif`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'alphabetic';
              ctx.fillText(reg.name, b.minX + 4 / viewport.zoom, b.minY + 14 / viewport.zoom);
            } else {
              ctx.strokeStyle = strokeColor;
              ctx.lineWidth = 1.8 / viewport.zoom;
              ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);
              ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

              ctx.fillStyle = fillColor;
              ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

              ctx.fillStyle = textColor;
              ctx.font = `${Math.max(10, 13 / viewport.zoom)}px sans-serif`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'alphabetic';
              ctx.fillText(reg.name, b.minX + 4 / viewport.zoom, b.minY + 14 / viewport.zoom);
            }
          }
        }
        ctx.restore();
      }
    }

    // 3.4. Water Bodies (Rivers and Lakes)
    townPerf.start('water');
    const activeRivers = effectiveRivers;
    const activeLakes = effectiveLakes;
    if (activeRivers.length > 0 || activeLakes.length > 0) {
      drawWaterBodies(ctx, activeRivers, activeLakes, {
        zoom: viewport.zoom * dpr,
        dpr,
        selectedId: selectedWaterId,
        selectedVertexIndex: activeWaterVertexIndex,
        showLabels: true,
      });
    }
    townPerf.end('water');

    // 3.5. Town Objects (Districts, Roads, Piers, Buildings, Fortified Walls)
    townPerf.start('townObjects');
    if (
      showTownObjects &&
      townObjects &&
      townObjects.length > 0 &&
      activeRegionalMap?.kind === 'town'
    ) {
      const containerW = glCanvasRef.current ? glCanvasRef.current.width / dpr : currentWidth;
      const containerH = glCanvasRef.current ? glCanvasRef.current.height / dpr : currentHeight;
      const viewBounds = {
        minX: -viewport.x / viewport.zoom,
        minY: -viewport.y / viewport.zoom,
        maxX: (containerW - viewport.x) / viewport.zoom,
        maxY: (containerH - viewport.y) / viewport.zoom,
      };

      const metersPerUnit = (effectiveWidthKm * 1000) / currentWidth;
      const textures = activeRegionalMap?.townStyle?.textures;
      drawTownObjects(ctx, townObjects, {
        metersPerUnit,
        zoomPx: viewport.zoom * dpr,
        viewBounds,
        selectedId: selectedTownObjectId,
        selectedIds: effectiveTownSelectedIds,
        roofTheme: activeRegionalMap?.townStyle?.roofTheme ?? 'terracotta',
        textures,
        textureResolver: (slot, extra) =>
          resolveTextureFill(ctx, slot, textures, metersPerUnit, viewport.zoom * dpr, extra, townTextureCache),
      });
    }
    townPerf.end('townObjects');

    // 4. Cartographic Tolkien-style Symbols (Mountains, Forests, Settlements, Maritime)
    townPerf.start('symbols');
    const effectiveSymbols = isSymbolStrokeActiveRef.current
      ? activeStrokeSymbolsRef.current
      : (symbols || []);
    if (showSymbols && effectiveSymbols.length > 0) {
      const containerW = glCanvasRef.current ? glCanvasRef.current.width / dpr : currentWidth;
      const containerH = glCanvasRef.current ? glCanvasRef.current.height / dpr : currentHeight;
      const viewBounds = {
        minX: -viewport.x / viewport.zoom,
        minY: -viewport.y / viewport.zoom,
        maxX: (containerW - viewport.x) / viewport.zoom,
        maxY: (containerH - viewport.y) / viewport.zoom,
      };
      drawSortedSymbols(
        ctx,
        effectiveSymbols,
        viewport.zoom * dpr,
        viewBounds,
        selectedSymbolId,
        customAssets,
        symbolToolSettings?.colorTheme
      );
    }
    townPerf.end('symbols');

    // 5. Antique Brass & Crimson Compass Rose
    townPerf.start('compassAndFrame');
    if (showCompass) {
      drawCompassRose(ctx, cPos.x, cPos.y, 72, viewport.zoom * dpr);
    }

    // 6. Map boundary frame
    ctx.strokeStyle = '#3d2e20';
    ctx.lineWidth = 3 / (viewport.zoom * dpr);
    ctx.strokeRect(0, 0, currentWidth, currentHeight);

    ctx.restore();
    townPerf.end('compassAndFrame');
    townPerf.end('renderOverlay_total');
  }, [
    viewport,
    selectionBox,
    confirmedShape,
    isRegion,
    activeRegionalMap,
    mapData.regionalMaps,
    currentWidth,
    currentHeight,
    showCompass,
    compassPos,
    effectiveWidthKm,
    symbols,
    showSymbols,
    selectedSymbolId,
    customAssets,
    brushSettings.mode,
    biomeSettings?.showBiome,
    biomeSettings?.opacity,
    currentBiomeGrid,
    dimOutsideRegion,
    townObjects,
    showTownObjects,
    selectedTownObjectId,
    selectedTownObjectIds,
    activeRegionalMap?.townStyle?.roofTheme,
    activeRegionalMap?.townStyle?.textures,
    textureCacheVersion,
    effectiveRivers,
    effectiveLakes,
    selectedWaterId,
    selectedWaterType,
    activeWaterVertexIndex,
    waterSettings,
  ]);

  renderOverlayRef.current = renderOverlay;

  // Keep water bodies overlay in sync
  useEffect(() => {
    scheduleOverlayRender();
  }, [effectiveRivers, effectiveLakes, selectedWaterId, selectedWaterType, activeWaterVertexIndex, scheduleOverlayRender]);

  // Keep town objects overlay in sync
  useEffect(() => {
    scheduleOverlayRender();
  }, [
    showTownObjects,
    townObjects,
    selectedTownObjectId,
    selectedTownObjectIds,
    activeRegionalMap?.townStyle?.roofTheme,
    activeRegionalMap?.townStyle?.textures,
    textureCacheVersion,
    scheduleOverlayRender,
  ]);

  // Keep offscreen biome canvas in sync when map switches or biomeGrid reference updates
  useEffect(() => {
    rebuildBiomeCanvas(currentBiomeGrid, currentCols, currentRows);
    scheduleOverlayRender();
  }, [currentBiomeGrid, currentCols, currentRows, rebuildBiomeCanvas, scheduleOverlayRender]);

  // Finalize River Drawing
  const finalizeRiverDrawing = useCallback(
    (points: [number, number][]) => {
      if (points.length < 2) {
        setDrawingRiverPoints([]);
        renderOverlay();
        return;
      }
      const smoothed = smoothRiverPath(points);
      const id = `river_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newRiver: RiverData = {
        id,
        name: `河川 ${effectiveRivers.length + 1}`,
        points: smoothed,
        widthStart: waterSettings?.riverWidthStart ?? 1.5,
        widthEnd: waterSettings?.riverWidthEnd ?? 4.5,
      };
      const nextRivers = [...effectiveRivers, newRiver];
      onCommitHistory({
        description: '河川を追加',
        timestamp: Date.now(),
        waterChanges: {
          prevRivers: effectiveRivers,
          newRivers: nextRivers,
        },
      });
      onUpdateRivers?.(nextRivers);
      onSelectWater?.(newRiver.id, 'river');
      setDrawingRiverPoints([]);
      renderOverlay();
    },
    [effectiveRivers, waterSettings, onCommitHistory, onUpdateRivers, onSelectWater, renderOverlay]
  );

  // Finalize Lake Polygon Drawing
  const finalizeLakePolygon = useCallback(
    (points: [number, number][]) => {
      if (points.length < 3) {
        setDrawingLakePolygon([]);
        renderOverlay();
        return;
      }
      const id = `lake_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newLake: LakeData = {
        id,
        name: `湖 ${effectiveLakes.length + 1}`,
        polygon: points,
      };
      const nextLakes = [...effectiveLakes, newLake];
      onCommitHistory({
        description: '湖を追加',
        timestamp: Date.now(),
        waterChanges: {
          prevLakes: effectiveLakes,
          newLakes: nextLakes,
        },
      });
      onUpdateLakes?.(nextLakes);
      onSelectWater?.(newLake.id, 'lake');
      setDrawingLakePolygon([]);
      renderOverlay();
    },
    [effectiveLakes, waterSettings, onCommitHistory, onUpdateLakes, onSelectWater, renderOverlay]
  );

  // Auto Generate Water using Topographic Hydrology
  const handleAutoGenerateWater = useCallback(
    async (opts: {
      riverDensity: number;
      meander: number;
      riverCount: number;
      lakeCount: number;
      onProgress?: (percent: number, message: string) => void;
      signal?: AbortSignal;
    }) => {
      const seed = mapData.seed || 12345;
      const prevRivers = effectiveRivers;
      const prevLakes = effectiveLakes;

      let worker: Worker | null = null;
      let result: { rivers: RiverData[]; lakes: LakeData[]; stats: any } | null = null;

      try {
        result = await new Promise((resolve, reject) => {
          if (opts.signal?.aborted) {
            return reject(new DOMException('Aborted', 'AbortError'));
          }

          try {
            worker = new Worker(new URL('../workers/terrainWorker.ts', import.meta.url), { type: 'module' });
          } catch {
            worker = null;
          }

          if (!worker) {
            const res = generateRiversAndLakes(
              currentElevation,
              currentCols,
              currentRows,
              currentWidth,
              currentHeight,
              currentSeaLevel ?? 35.0,
              seed,
              {
                riverDensity: opts.riverDensity,
                meander: opts.meander,
                riverCount: opts.riverCount,
                lakeCount: opts.lakeCount,
                worldWidthKm: effectiveWidthKm,
                onProgress: opts.onProgress,
              }
            );
            return resolve(res);
          }

          const onAbort = () => {
            if (worker) {
              worker.terminate();
              worker = null;
            }
            reject(new DOMException('Aborted', 'AbortError'));
          };

          opts.signal?.addEventListener('abort', onAbort);

          worker.onmessage = (e) => {
            const data = e.data;
            if (data.type === 'progress') {
              opts.onProgress?.(data.progress, data.message);
            } else if (data.type === 'successWater') {
              opts.signal?.removeEventListener('abort', onAbort);
              worker?.terminate();
              worker = null;
              resolve({ rivers: data.rivers, lakes: data.lakes, stats: data.stats });
            } else if (data.type === 'error') {
              opts.signal?.removeEventListener('abort', onAbort);
              worker?.terminate();
              worker = null;
              reject(new Error(data.error));
            }
          };

          worker.onerror = (err) => {
            opts.signal?.removeEventListener('abort', onAbort);
            worker?.terminate();
            worker = null;
            reject(err);
          };

          worker.postMessage({
            action: 'generateWater',
            elevationGrid: currentElevation,
            cols: currentCols,
            rows: currentRows,
            mapWidth: currentWidth,
            mapHeight: currentHeight,
            seaLevel: currentSeaLevel ?? 35.0,
            seed,
            waterOptions: {
              riverDensity: opts.riverDensity,
              meander: opts.meander,
              riverCount: opts.riverCount,
              lakeCount: opts.lakeCount,
              worldWidthKm: effectiveWidthKm,
            },
          });
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return;
        }
        result = generateRiversAndLakes(
          currentElevation,
          currentCols,
          currentRows,
          currentWidth,
          currentHeight,
          currentSeaLevel ?? 35.0,
          seed,
          {
            riverDensity: opts.riverDensity,
            meander: opts.meander,
            riverCount: opts.riverCount,
            lakeCount: opts.lakeCount,
            worldWidthKm: effectiveWidthKm,
            onProgress: opts.onProgress,
          }
        );
      }

      if (result) {
        onCommitHistory({
          description: '水系の自動生成',
          timestamp: Date.now(),
          waterChanges: {
            prevRivers,
            newRivers: result.rivers,
            prevLakes,
            newLakes: result.lakes,
          },
        });

        onUpdateRivers?.(result.rivers);
        onUpdateLakes?.(result.lakes);
        onSelectWater?.(null, null);
        renderOverlay();

        return result.stats;
      }
    },
    [
      mapData.seed,
      effectiveRivers,
      effectiveLakes,
      currentElevation,
      currentCols,
      currentRows,
      currentWidth,
      currentHeight,
      currentSeaLevel,
      effectiveWidthKm,
      onCommitHistory,
      onUpdateRivers,
      onUpdateLakes,
      onSelectWater,
      renderOverlay,
    ]
  );

  // Finalize polygon building drawing
  const finalizeTownBuildingPolygon = useCallback(
    (pts: Pt[]) => {
      if (pts.length < 3) {
        showToast('頂点は3点以上必要です');
        return;
      }
      if (!isSimplePolygon(pts)) {
        showToast('辺が交差しています');
        return;
      }
      if (hasEdgeLessThanM(pts, 1.5, metersPerUnit)) {
        showToast('辺の長さが1.5m未満のため作成できません');
        setDrawingTownPoints([]);
        triggerPreviewOverlay();
        return;
      }

      const now = Date.now();
      const id = `building_${now}_${Math.random().toString(36).substring(2, 7)}`;
      const tone = townToolConfig.buildingRoofToneRandom
        ? deterministicRoofTone(id)
        : townToolConfig.buildingRoofToneFixed;

      const newBuilding: TownBuilding = {
        id,
        name: `${BUILDING_KIND_LABELS[townToolConfig.buildingKind] || '建物'} ${
          townObjects.filter((o) => o.kind === 'building').length + 1
        }`,
        kind: 'building',
        buildingKind: townToolConfig.buildingKind,
        polygon: pts,
        heightM: townToolConfig.buildingHeightM,
        tone,
      };

      const next = [...townObjects, newBuilding];
      townPerf.startConfirmation('建物を追加');
      onCommitHistory({
        description: '建物を追加',
        timestamp: Date.now(),
        townChanges: {
          prevObjects: townObjects,
          newObjects: next,
        },
      });
      onUpdateTownObjects?.(next);
      onSelectTownObjectIds?.([newBuilding.id]);
      onSelectTownObjectId?.(newBuilding.id);
      setDrawingTownPoints([]);
      scheduleOverlayRender();
      triggerPreviewOverlay();
    },
    [
      townObjects,
      townToolConfig,
      metersPerUnit,
      onCommitHistory,
      onUpdateTownObjects,
      onSelectTownObjectIds,
      onSelectTownObjectId,
      showToast,
      scheduleOverlayRender,
      triggerPreviewOverlay,
    ]
  );

  // Finalize district drawing
  const finalizeTownDistrict = useCallback(
    (pts: Pt[]) => {
      if (pts.length < 3) {
        showToast('頂点は3点以上必要です');
        return;
      }
      if (!isSimplePolygon(pts)) {
        showToast('辺が交差しています');
        return;
      }

      const now = Date.now();
      const id = `district_${now}_${Math.random().toString(36).substring(2, 7)}`;
      const newDistrict: TownDistrict = {
        id,
        name: `${DISTRICT_KIND_LABELS[townToolConfig.districtKind] || '区画'} ${
          townObjects.filter((o) => o.kind === 'district').length + 1
        }`,
        kind: 'district',
        districtKind: townToolConfig.districtKind,
        polygon: pts,
      };

      const next = [...townObjects, newDistrict];
      townPerf.startConfirmation('区画を追加');
      onCommitHistory({
        description: '区画を追加',
        timestamp: Date.now(),
        townChanges: {
          prevObjects: townObjects,
          newObjects: next,
        },
      });
      onUpdateTownObjects?.(next);
      onSelectTownObjectIds?.([newDistrict.id]);
      onSelectTownObjectId?.(newDistrict.id);
      setDrawingTownPoints([]);
      scheduleOverlayRender();
      triggerPreviewOverlay();
    },
    [
      townObjects,
      townToolConfig,
      onCommitHistory,
      onUpdateTownObjects,
      onSelectTownObjectIds,
      onSelectTownObjectId,
      showToast,
      scheduleOverlayRender,
      triggerPreviewOverlay,
    ]
  );

  // 3. Render 2D Preview Overlay on cursorCanvas (brush circle, rubberband lines, placement previews, draft dragging - ultra-fast)
  const renderPreviewOverlay = useCallback(() => {
    const cursorCanvas = cursorCanvasRef.current;
    if (!cursorCanvas) return;
    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    townPerf.start('previewOverlay');

    const dpr = cursorCanvas.clientWidth > 0
      ? cursorCanvas.width / cursorCanvas.clientWidth
      : Math.min(window.devicePixelRatio || 1, 2.0);
    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    const curPos = cursorPosRef.current;
    const zoomPx = viewport.zoom * dpr;

    ctx.save();
    ctx.setTransform(viewport.zoom * dpr, 0, 0, viewport.zoom * dpr, viewport.x * dpr, viewport.y * dpr);

    const isTownMode =
      brushSettings.mode === 'townSelect' ||
      brushSettings.mode === 'townRoad' ||
      brushSettings.mode === 'townWall' ||
      brushSettings.mode === 'townPier' ||
      brushSettings.mode === 'townBuilding' ||
      brushSettings.mode === 'townDistrict';

    // 1. Terrain / Symbol brush circle
    if (!isTownMode && curPos && brushSettings.mode !== 'pan' && brushSettings.mode !== 'selectRegion') {
      const { x, y } = curPos;
      const isSymbolTool = brushSettings.mode === 'symbolBrush' || brushSettings.mode === 'symbolEraser';
      const radius = isSymbolTool
        ? (symbolToolSettings?.scatterRadius ?? 60)
        : brushSettings.radius;
      const active = isMouseDownRef.current && !isPanningRef.current;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = active
        ? 'rgba(215, 65, 35, 0.95)'
        : isSymbolTool
        ? 'rgba(245, 158, 11, 0.85)'
        : 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = (active ? 2.5 : 1.5) / viewport.zoom;
      ctx.stroke();

      ctx.fillStyle = active
        ? 'rgba(215, 65, 35, 0.16)'
        : isSymbolTool
        ? 'rgba(245, 158, 11, 0.08)'
        : 'rgba(255, 255, 255, 0.05)';
      ctx.fill();
    }

    // 2. Region Selection previews
    if (brushSettings.mode === 'selectRegion') {
      if (selectMethod === 'rect2' && followCoastline && rect2Start && curPos) {
        const startPt: [number, number] = [rect2Start.x, rect2Start.y];
        const endPt: [number, number] = (snappedCoastRef.current && (snapCoastline || followCoastline))
          ? [snappedCoastRef.current.point[0], snappedCoastRef.current.point[1]]
          : [curPos.x, curPos.y];
        const traced = traceCoastlinePath(
          startPt,
          endPt,
          currentElevation,
          currentCols,
          currentRows,
          currentWidth,
          currentHeight,
          currentSeaLevel,
          40 / viewport.zoom
        );

        ctx.save();
        if (traced.length > 2) {
          ctx.beginPath();
          ctx.moveTo(traced[0][0], traced[0][1]);
          for (let i = 1; i < traced.length; i++) ctx.lineTo(traced[i][0], traced[i][1]);
          ctx.closePath();
          ctx.fillStyle = 'rgba(34, 211, 238, 0.14)';
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(traced[0][0], traced[0][1]);
          for (let i = 1; i < traced.length; i++) ctx.lineTo(traced[i][0], traced[i][1]);
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2.4 / viewport.zoom;
          ctx.setLineDash([5 / viewport.zoom, 3 / viewport.zoom]);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(endPt[0], endPt[1]);
          ctx.lineTo(startPt[0], startPt[1]);
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
          ctx.lineWidth = 1.4 / viewport.zoom;
          ctx.setLineDash([3 / viewport.zoom, 3 / viewport.zoom]);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(startPt[0], startPt[1], 5.5 / viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#22d3ee';
        ctx.fill();
        ctx.strokeStyle = '#08111c';
        ctx.lineWidth = 1.2 / viewport.zoom;
        ctx.stroke();
        ctx.restore();
      }

      if (polygonPoints.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.0 / viewport.zoom;
        ctx.beginPath();
        ctx.moveTo(polygonPoints[0][0], polygonPoints[0][1]);
        for (let i = 1; i < polygonPoints.length; i++) {
          ctx.lineTo(polygonPoints[i][0], polygonPoints[i][1]);
        }
        ctx.stroke();

        if (curPos) {
          const lastPt = polygonPoints[polygonPoints.length - 1];
          const isCurCoastSnapped = !!(followCoastline && snapCoastline && snappedCoastRef.current);
          let rubberPath: [number, number][] = [[lastPt[0], lastPt[1]], [curPos.x, curPos.y]];

          if (selectMethod === 'polygon' && followCoastline && isCurCoastSnapped) {
            const snapLast = findNearestCoastlinePoint(
              lastPt[0],
              lastPt[1],
              currentElevation,
              currentCols,
              currentRows,
              currentWidth,
              currentHeight,
              currentSeaLevel,
              COASTLINE_SNAP_PX / viewport.zoom
            );
            if (snapLast && snapLast.contourIndex === snappedCoastRef.current!.contourIndex) {
              rubberPath = traceCoastlinePath(
                lastPt,
                [curPos.x, curPos.y],
                currentElevation,
                currentCols,
                currentRows,
                currentWidth,
                currentHeight,
                currentSeaLevel,
                COASTLINE_SNAP_PX / viewport.zoom
              );
            }
          }

          ctx.beginPath();
          ctx.moveTo(rubberPath[0][0], rubberPath[0][1]);
          for (let i = 1; i < rubberPath.length; i++) {
            ctx.lineTo(rubberPath[i][0], rubberPath[i][1]);
          }
          if (rubberPath.length > 2) {
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2.4 / viewport.zoom;
            ctx.setLineDash([5 / viewport.zoom, 3 / viewport.zoom]);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1.8 / viewport.zoom;
            ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        for (let i = 0; i < polygonPoints.length; i++) {
          const [vx, vy] = polygonPoints[i];
          ctx.beginPath();
          ctx.arc(vx, vy, (i === 0 ? 5.5 : 3.5) / viewport.zoom, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 ? '#fbbf24' : '#f59e0b';
          ctx.fill();
          ctx.strokeStyle = '#1c1917';
          ctx.lineWidth = 1.0 / viewport.zoom;
          ctx.stroke();
        }

        if (curPos && polygonPoints.length >= 3) {
          const distToP0 = Math.hypot(curPos.x - polygonPoints[0][0], curPos.y - polygonPoints[0][1]);
          if (distToP0 <= 18 / viewport.zoom) {
            ctx.beginPath();
            ctx.arc(polygonPoints[0][0], polygonPoints[0][1], 10 / viewport.zoom, 0, Math.PI * 2);
            ctx.strokeStyle = '#34d399';
            ctx.lineWidth = 2.0 / viewport.zoom;
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      if (snappedCoastRef.current) {
        const sp = snappedCoastRef.current.point;
        ctx.save();
        ctx.beginPath();
        ctx.arc(sp[0], sp[1], 5.5 / viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.35)';
        ctx.fill();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1.8 / viewport.zoom;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(sp[0], sp[1], 1.8 / viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.font = `bold ${Math.max(9, 10 / viewport.zoom)}px sans-serif`;
        ctx.fillStyle = '#67e8f9';
        ctx.fillText('海岸線', sp[0] + 8 / viewport.zoom, sp[1] - 4 / viewport.zoom);
        ctx.restore();
      }
    }

    // 3. Water In-Progress Previews
    if (brushSettings.mode === 'river' && drawingRiverPoints.length > 0) {
      const pts = curPos ? [...drawingRiverPoints, [curPos.x, curPos.y] as [number, number]] : drawingRiverPoints;
      ctx.save();
      ctx.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.strokeStyle = '#2b7fb3';
      ctx.lineWidth = Math.max(2, (waterSettings?.riverWidthStart || 2.5) / zoomPx);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      pts.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 4 / zoomPx, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
        ctx.strokeStyle = '#0369a1';
        ctx.lineWidth = 1.5 / zoomPx;
        ctx.stroke();
      });
      ctx.restore();
    }

    if (brushSettings.mode === 'lake') {
      if (drawingLakeStart && curPos) {
        const rad = Math.hypot(curPos.x - drawingLakeStart[0], curPos.y - drawingLakeStart[1]);
        ctx.save();
        ctx.beginPath();
        ctx.arc(drawingLakeStart[0], drawingLakeStart[1], Math.max(4, rad), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2 / zoomPx;
        ctx.setLineDash([6 / zoomPx, 4 / zoomPx]);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else if (drawingLakePolygon.length > 0) {
        const pts = curPos ? [...drawingLakePolygon, [curPos.x, curPos.y] as [number, number]] : drawingLakePolygon;
        ctx.save();
        ctx.beginPath();
        pts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2 / zoomPx;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // 4. Town Mode In-Progress Previews & Overlays
    if (activeRegionalMap?.kind === 'town') {
      const metersPerUnit = (effectiveWidthKm * 1000) / currentWidth;

      // 4a. Auto-Fill Preview Buildings
      if (showTownObjects && autoFillPreviewBuildings && autoFillPreviewBuildings.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
        ctx.lineWidth = Math.max(1, 1.5 / zoomPx);
        ctx.setLineDash([4 / zoomPx, 4 / zoomPx]);

        for (const bld of autoFillPreviewBuildings) {
          if (!bld.polygon || bld.polygon.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(bld.polygon[0][0], bld.polygon[0][1]);
          for (let i = 1; i < bld.polygon.length; i++) {
            ctx.lineTo(bld.polygon[i][0], bld.polygon[i][1]);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // 4b. Template Placement Preview
      if (showTownObjects && templatePlacement && curPos) {
        ctx.save();
        const curPt: Pt = [curPos.x, curPos.y];
        const previewObjs = instantiateTemplate(
          templatePlacement.template,
          curPt,
          metersPerUnit,
          {
            angleDeg: templatePlacement.angleDeg,
            flipX: templatePlacement.flipX,
          }
        );

        ctx.strokeStyle = '#f59e0b';
        ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';
        ctx.lineWidth = Math.max(1, 1.5 / zoomPx);
        ctx.setLineDash([4 / zoomPx, 4 / zoomPx]);

        for (const obj of previewObjs) {
          if (obj.kind === 'building' || obj.kind === 'district') {
            if (!obj.polygon || obj.polygon.length < 3) continue;
            ctx.beginPath();
            ctx.moveTo(obj.polygon[0][0], obj.polygon[0][1]);
            for (let i = 1; i < obj.polygon.length; i++) ctx.lineTo(obj.polygon[i][0], obj.polygon[i][1]);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          } else if (obj.kind === 'road' || obj.kind === 'wall' || obj.kind === 'pier') {
            if (!obj.points || obj.points.length < 2) continue;
            const wM = obj.kind === 'wall' ? obj.thicknessM : obj.widthM;
            ctx.lineWidth = Math.max(2 / zoomPx, metersToUnits(wM || 3, metersPerUnit));
            ctx.beginPath();
            ctx.moveTo(obj.points[0][0], obj.points[0][1]);
            for (let i = 1; i < obj.points.length; i++) ctx.lineTo(obj.points[i][0], obj.points[i][1]);
            if (obj.kind === 'wall' && obj.closed) ctx.closePath();
            ctx.stroke();
          }
        }

        const crossSize = 6 / zoomPx;
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5 / zoomPx;
        ctx.strokeStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(curPt[0] - crossSize, curPt[1]);
        ctx.lineTo(curPt[0] + crossSize, curPt[1]);
        ctx.moveTo(curPt[0], curPt[1] - crossSize);
        ctx.lineTo(curPt[0], curPt[1] + crossSize);
        ctx.stroke();
        ctx.restore();
      }

      // 4c. Town Dragging Draft
      if (townDragRef.current && townDragRef.current.draftObjects) {
        const selectedSet = new Set(effectiveTownSelectedIds);
        const draftSelected = townDragRef.current.draftObjects.filter((o) => selectedSet.has(o.id));
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.lineWidth = 2.0 / zoomPx;
        ctx.setLineDash([4 / zoomPx, 4 / zoomPx]);

        for (const obj of draftSelected) {
          const pts = obj.kind === 'district' || obj.kind === 'building' ? obj.polygon : obj.points;
          if (!pts || pts.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          if (obj.kind === 'district' || obj.kind === 'building' || (obj.kind === 'wall' && obj.closed)) {
            ctx.closePath();
            ctx.fill();
          }
          ctx.stroke();
        }
        ctx.restore();

        if (townDragRef.current.type === 'vertex' && townToolConfig.snapEnabled && curPos) {
          const snapRes = snapPoint([curPos.x, curPos.y], townSnapCandidates, 8 / zoomPx);
          if (snapRes.didSnap) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(snapRes.snapped[0], snapRes.snapped[1], 5 / zoomPx, 0, Math.PI * 2);
            ctx.strokeStyle = '#06b6d4';
            ctx.lineWidth = 2.0 / zoomPx;
            ctx.fillStyle = 'rgba(6, 182, 212, 0.35)';
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 4d. Selection Handles
      if (brushSettings.mode === 'townSelect' && effectiveTownSelectedIds.length > 0 && !townDragRef.current?.draftObjects) {
        const selectedSet = new Set(effectiveTownSelectedIds);
        const selectedObjs = townObjects.filter((o) => selectedSet.has(o.id));
        const midpointRadius = 3.5 / zoomPx;

        for (const obj of selectedObjs) {
          const pts = obj.kind === 'district' || obj.kind === 'building' ? obj.polygon : obj.points;
          const isClosed =
            obj.kind === 'district' ||
            obj.kind === 'building' ||
            (obj.kind === 'wall' && obj.closed);

          const numEdges = isClosed ? pts.length : pts.length - 1;
          for (let eIdx = 0; eIdx < numEdges; eIdx++) {
            const p0 = pts[eIdx];
            const p1 = pts[(eIdx + 1) % pts.length];
            const mx = (p0[0] + p1[0]) * 0.5;
            const my = (p0[1] + p1[1]) * 0.5;

            ctx.save();
            ctx.beginPath();
            ctx.arc(mx, my, midpointRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 1.2 / zoomPx;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }

          for (let vIdx = 0; vIdx < pts.length; vIdx++) {
            const p = pts[vIdx];
            const isVertexSelected =
              selectedVertex?.objectId === obj.id && selectedVertex?.index === vIdx;
            const sz = (isVertexSelected ? 9 : 7) / zoomPx;
            ctx.save();
            ctx.fillStyle = isVertexSelected ? '#ffffff' : '#f59e0b';
            ctx.strokeStyle = isVertexSelected ? '#2563eb' : '#1c1917';
            ctx.lineWidth = (isVertexSelected ? 2.5 : 1.5) / zoomPx;
            ctx.fillRect(p[0] - sz * 0.5, p[1] - sz * 0.5, sz, sz);
            ctx.strokeRect(p[0] - sz * 0.5, p[1] - sz * 0.5, sz, sz);
            ctx.restore();
          }

          if (obj.kind === 'wall') {
            for (let gIdx = 0; gIdx < obj.gates.length; gIdx++) {
              const g = obj.gates[gIdx];
              const gp = getGateWorldPosition(obj, g);
              const isGateSelected =
                selectedGate?.objectId === obj.id && selectedGate?.index === gIdx;
              const gs = (isGateSelected ? 11 : 8) / zoomPx;
              ctx.save();
              ctx.translate(gp[0], gp[1]);
              ctx.rotate(Math.PI / 4);
              ctx.fillStyle = isGateSelected ? '#ffffff' : '#38bdf8';
              ctx.strokeStyle = isGateSelected ? '#2563eb' : '#0f172a';
              ctx.lineWidth = (isGateSelected ? 2.5 : 1.5) / zoomPx;
              ctx.fillRect(-gs * 0.5, -gs * 0.5, gs, gs);
              ctx.strokeRect(-gs * 0.5, -gs * 0.5, gs, gs);
              ctx.restore();
            }
          }
        }

        if (townRotationHandle) {
          const { handlePos, stemTop } = townRotationHandle;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(stemTop[0], stemTop[1]);
          ctx.lineTo(handlePos[0], handlePos[1]);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5 / zoomPx;
          ctx.setLineDash([3 / zoomPx, 3 / zoomPx]);
          ctx.stroke();

          const handleR = 6 / zoomPx;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(handlePos[0], handlePos[1], handleR, 0, Math.PI * 2);
          ctx.fillStyle = '#0284c7';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8 / zoomPx;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(handlePos[0], handlePos[1], handleR * 0.55, -Math.PI * 0.7, Math.PI * 0.7);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.2 / zoomPx;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 4e. Marquee Box
      if (townMarqueeBox) {
        const minX = Math.min(townMarqueeBox.startX, townMarqueeBox.currentX);
        const maxX = Math.max(townMarqueeBox.startX, townMarqueeBox.currentX);
        const minY = Math.min(townMarqueeBox.startY, townMarqueeBox.currentY);
        const maxY = Math.max(townMarqueeBox.startY, townMarqueeBox.currentY);

        ctx.save();
        ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5 / zoomPx;
        ctx.setLineDash([5 / zoomPx, 4 / zoomPx]);
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        ctx.restore();
      }

      // 4f. In-progress Line Drawing (Road, Wall, Pier)
      if (
        (brushSettings.mode === 'townRoad' ||
          brushSettings.mode === 'townWall' ||
          brushSettings.mode === 'townPier') &&
        drawingTownPoints.length > 0
      ) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(drawingTownPoints[0][0], drawingTownPoints[0][1]);
        for (let i = 1; i < drawingTownPoints.length; i++) {
          ctx.lineTo(drawingTownPoints[i][0], drawingTownPoints[i][1]);
        }

        let activeEndPt: Pt | null = null;
        let didSnapActive = false;
        let snappedCoord: Pt = [0, 0];
        if (curPos) {
          let targetPt: Pt = [curPos.x, curPos.y];
          const snapTol = 8 / zoomPx;
          if (townToolConfig.snapEnabled) {
            const snapRes = snapPoint(targetPt, townSnapCandidates, snapTol);
            if (snapRes.didSnap) {
              targetPt = snapRes.snapped;
              didSnapActive = true;
              snappedCoord = snapRes.snapped;
            }
          }
          activeEndPt = targetPt;
          ctx.lineTo(targetPt[0], targetPt[1]);
        }

        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.0 / zoomPx;
        ctx.setLineDash([5 / zoomPx, 4 / zoomPx]);
        ctx.stroke();

        if (didSnapActive) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(snappedCoord[0], snappedCoord[1], 5 / zoomPx, 0, Math.PI * 2);
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 2.0 / zoomPx;
          ctx.fillStyle = 'rgba(6, 182, 212, 0.35)';
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        for (let i = 0; i < drawingTownPoints.length; i++) {
          const pt = drawingTownPoints[i];
          const isStartWall = i === 0 && brushSettings.mode === 'townWall';
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], (isStartWall ? 5.5 : 3.5) / zoomPx, 0, Math.PI * 2);
          ctx.fillStyle = isStartWall ? '#34d399' : '#f59e0b';
          ctx.fill();
          ctx.strokeStyle = '#1c1917';
          ctx.lineWidth = 1.0 / zoomPx;
          ctx.stroke();
        }

        if (activeEndPt && townToolConfig.showLengths) {
          const lastPt = drawingTownPoints[drawingTownPoints.length - 1];
          const segDistM = Math.round(
            Math.hypot(activeEndPt[0] - lastPt[0], activeEndPt[1] - lastPt[1]) * metersPerUnit
          );
          const totalDistM = Math.round(
            (polylineLength(drawingTownPoints) +
              Math.hypot(activeEndPt[0] - lastPt[0], activeEndPt[1] - lastPt[1])) *
              metersPerUnit
          );

          const midX = (lastPt[0] + activeEndPt[0]) * 0.5;
          const midY = (lastPt[1] + activeEndPt[1]) * 0.5;
          const label = `${segDistM}m (計 ${totalDistM}m)`;
          ctx.font = `bold ${Math.max(10, 11 / viewport.zoom)}px sans-serif`;
          ctx.setLineDash([]);
          const textMetrics = ctx.measureText(label);
          const pad = 3.5 / viewport.zoom;
          ctx.fillStyle = 'rgba(28, 25, 23, 0.9)';
          ctx.fillRect(
            midX - pad,
            midY - 12 / viewport.zoom - pad,
            textMetrics.width + pad * 2,
            14 / viewport.zoom
          );
          ctx.fillStyle = '#fef3c7';
          ctx.fillText(label, midX, midY - 2 / viewport.zoom);
        }
        ctx.restore();
      }

      // 4g. Town Building Drawing Overlays
      if (brushSettings.mode === 'townBuilding') {
        if (townToolConfig.buildingDrawMode === 'preset' && curPos) {
          const angleRad =
            townToolConfig.buildingOrientationMode === 'auto'
              ? (nearestSegmentDirection(townObjects, [curPos.x, curPos.y], 40, metersPerUnit)?.angleRad ?? 0)
              : ((townToolConfig.buildingFixedAngleDeg || 0) * Math.PI) / 180;

          const poly = generatePresetPolygon(
            [curPos.x, curPos.y],
            townToolConfig.buildingKind,
            townToolConfig.buildingPresetWidthM,
            townToolConfig.buildingPresetDepthM,
            angleRad,
            metersPerUnit
          );

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(poly[0][0], poly[0][1]);
          for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
          ctx.closePath();
          ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
          ctx.fill();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.8 / zoomPx;
          ctx.setLineDash([4 / zoomPx, 4 / zoomPx]);
          ctx.stroke();

          const label =
            townToolConfig.buildingKind === 'tower'
              ? `塔 φ${townToolConfig.buildingPresetWidthM}m (クリックで配置)`
              : `${BUILDING_KIND_LABELS[townToolConfig.buildingKind] || '建物'} ${townToolConfig.buildingPresetWidthM}×${townToolConfig.buildingPresetDepthM}m`;
          ctx.font = `bold ${Math.max(10, 11 / viewport.zoom)}px sans-serif`;
          ctx.setLineDash([]);
          const tm = ctx.measureText(label);
          const pad = 3.5 / zoomPx;
          ctx.fillStyle = 'rgba(28, 25, 23, 0.88)';
          ctx.fillRect(curPos.x - tm.width / 2 - pad, curPos.y - 18 / zoomPx - pad, tm.width + pad * 2, 15 / zoomPx);
          ctx.fillStyle = '#fef3c7';
          ctx.textAlign = 'center';
          ctx.fillText(label, curPos.x, curPos.y - 7 / zoomPx);
          ctx.restore();
        }

        if (townToolConfig.buildingDrawMode === '3point') {
          if (drawingTownPoints.length === 1 && curPos) {
            const p0 = drawingTownPoints[0];
            let p1: Pt = [curPos.x, curPos.y];
            if (townToolConfig.snapEnabled) {
              const snapRes = snapPoint(p1, townSnapCandidates, 8 / zoomPx);
              if (snapRes.didSnap) p1 = snapRes.snapped;
            }
            const lenM = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * metersPerUnit;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(p0[0], p0[1]);
            ctx.lineTo(p1[0], p1[1]);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2.0 / zoomPx;
            ctx.setLineDash([4 / zoomPx, 4 / zoomPx]);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(p0[0], p0[1], 4.5 / zoomPx, 0, Math.PI * 2);
            ctx.fillStyle = '#f59e0b';
            ctx.fill();
            ctx.strokeStyle = '#1c1917';
            ctx.lineWidth = 1.0 / zoomPx;
            ctx.stroke();

            const label = `辺: ${lenM.toFixed(1)}m (Shiftで15°固定)`;
            ctx.font = `bold ${Math.max(10, 11 / viewport.zoom)}px sans-serif`;
            ctx.setLineDash([]);
            const midX = (p0[0] + p1[0]) * 0.5;
            const midY = (p0[1] + p1[1]) * 0.5;
            const tm = ctx.measureText(label);
            const pad = 3.5 / zoomPx;
            ctx.fillStyle = 'rgba(28, 25, 23, 0.88)';
            ctx.fillRect(midX - pad, midY - 14 / zoomPx - pad, tm.width + pad * 2, 14 / zoomPx);
            ctx.fillStyle = '#fef3c7';
            ctx.fillText(label, midX, midY - 3 / zoomPx);
            ctx.restore();
          } else if (drawingTownPoints.length === 2 && curPos) {
            const p0 = drawingTownPoints[0];
            const p1 = drawingTownPoints[1];
            const rect = rectangleFrom3Points(p0, p1, [curPos.x, curPos.y]);
            const edgeM = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * metersPerUnit;
            const vx = p1[0] - p0[0];
            const vy = p1[1] - p0[1];
            const elen = Math.hypot(vx, vy) || 1;
            const nx = -vy / elen;
            const ny = vx / elen;
            const depthM = Math.abs((curPos.x - p0[0]) * nx + (curPos.y - p0[1]) * ny) * metersPerUnit;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(rect[0][0], rect[0][1]);
            for (let i = 1; i < 4; i++) ctx.lineTo(rect[i][0], rect[i][1]);
            ctx.closePath();
            ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
            ctx.fill();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1.8 / zoomPx;
            ctx.setLineDash([4 / zoomPx, 4 / zoomPx]);
            ctx.stroke();

            for (const pt of [p0, p1]) {
              ctx.beginPath();
              ctx.arc(pt[0], pt[1], 4 / zoomPx, 0, Math.PI * 2);
              ctx.fillStyle = '#f59e0b';
              ctx.fill();
              ctx.strokeStyle = '#1c1917';
              ctx.lineWidth = 1.0 / zoomPx;
              ctx.stroke();
            }

            const label = `幅: ${edgeM.toFixed(1)}m × 奥行: ${depthM.toFixed(1)}m (クリックで確定)`;
            ctx.font = `bold ${Math.max(10, 11 / viewport.zoom)}px sans-serif`;
            ctx.setLineDash([]);
            const cx = (rect[0][0] + rect[2][0]) * 0.5;
            const cy = (rect[0][1] + rect[2][1]) * 0.5;
            const tm = ctx.measureText(label);
            const pad = 3.5 / zoomPx;
            ctx.fillStyle = 'rgba(28, 25, 23, 0.88)';
            ctx.fillRect(cx - tm.width / 2 - pad, cy - 8 / zoomPx - pad, tm.width + pad * 2, 16 / zoomPx);
            ctx.fillStyle = '#fef3c7';
            ctx.textAlign = 'center';
            ctx.fillText(label, cx, cy + 4 / zoomPx);
            ctx.restore();
          }
        }

        if (townToolConfig.buildingDrawMode === 'polygon' && drawingTownPoints.length > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(drawingTownPoints[0][0], drawingTownPoints[0][1]);
          for (let i = 1; i < drawingTownPoints.length; i++) ctx.lineTo(drawingTownPoints[i][0], drawingTownPoints[i][1]);
          if (curPos) ctx.lineTo(curPos.x, curPos.y);

          if (drawingTownPoints.length >= 2 && curPos) {
            ctx.closePath();
            ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
            ctx.fill();
          }

          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.8 / zoomPx;
          ctx.setLineDash([4 / zoomPx, 4 / zoomPx]);
          ctx.stroke();

          for (let i = 0; i < drawingTownPoints.length; i++) {
            const pt = drawingTownPoints[i];
            ctx.beginPath();
            ctx.arc(pt[0], pt[1], (i === 0 ? 5 : 3.5) / zoomPx, 0, Math.PI * 2);
            ctx.fillStyle = i === 0 ? '#34d399' : '#f59e0b';
            ctx.fill();
            ctx.strokeStyle = '#1c1917';
            ctx.lineWidth = 1.0 / zoomPx;
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // 4h. Town District Drawing Overlay
      if (brushSettings.mode === 'townDistrict' && drawingTownPoints.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(drawingTownPoints[0][0], drawingTownPoints[0][1]);
        for (let i = 1; i < drawingTownPoints.length; i++) ctx.lineTo(drawingTownPoints[i][0], drawingTownPoints[i][1]);
        if (curPos) ctx.lineTo(curPos.x, curPos.y);

        if (drawingTownPoints.length >= 2 && curPos) {
          ctx.closePath();
          ctx.fillStyle = 'rgba(168, 85, 247, 0.25)';
          ctx.fill();
        }

        ctx.strokeStyle = '#c084fc';
        ctx.lineWidth = 2.0 / zoomPx;
        ctx.setLineDash([4 / zoomPx, 4 / zoomPx]);
        ctx.stroke();

        for (let i = 0; i < drawingTownPoints.length; i++) {
          const pt = drawingTownPoints[i];
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], (i === 0 ? 5.5 : 3.5) / zoomPx, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 ? '#34d399' : '#c084fc';
          ctx.fill();
          ctx.strokeStyle = '#1c1917';
          ctx.lineWidth = 1.0 / zoomPx;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    townPerf.end('previewOverlay');
    ctx.restore();
  }, [
    viewport,
    brushSettings.mode,
    brushSettings.radius,
    symbolToolSettings?.scatterRadius,
    activeRegionalMap?.kind,
    effectiveWidthKm,
    currentWidth,
    currentHeight,
    currentElevation,
    currentCols,
    currentRows,
    currentSeaLevel,
    showTownObjects,
    townObjects,
    effectiveTownSelectedIds,
    selectedVertex,
    selectedGate,
    townRotationHandle,
    townSnapCandidates,
    townToolConfig,
    drawingTownPoints,
    townMarqueeBox,
    templatePlacement,
    autoFillPreviewBuildings,
    selectMethod,
    followCoastline,
    snapCoastline,
    rect2Start,
    polygonPoints,
    drawingRiverPoints,
    drawingLakeStart,
    drawingLakePolygon,
    waterSettings,
  ]);

  renderPreviewOverlayRef.current = renderPreviewOverlay;
  const renderCursorOverlay = renderPreviewOverlay;

  // Keep preview overlay in sync whenever selection, preview, or tool states change
  useEffect(() => {
    renderPreviewOverlay();
  }, [
    selectedTownObjectId,
    selectedTownObjectIds,
    selectedVertex,
    selectedGate,
    templatePlacement,
    autoFillPreviewBuildings,
    drawingTownPoints,
    townMarqueeBox,
    renderPreviewOverlay,
  ]);

  // Unified redraw
  const redraw = useCallback(() => {
    renderWebGL();
    scheduleOverlayRender();
    renderPreviewOverlay();
  }, [renderWebGL, scheduleOverlayRender, renderPreviewOverlay]);

  // Load background image when mapBackgroundUrl changes
  useEffect(() => {
    if (!mapBackgroundUrl) {
      bgImageRef.current = null;
      scheduleOverlayRender();
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = mapBackgroundUrl;
    img.onload = () => {
      bgImageRef.current = img;
      scheduleOverlayRender();
    };
  }, [mapBackgroundUrl, scheduleOverlayRender]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Redraw overlay whenever a newly referenced custom pixel asset finishes loading
  useEffect(() => {
    setCustomImageLoadedCallback(() => {
      scheduleOverlayRender();
    });
    return () => {
      setCustomImageLoadedCallback(null);
    };
  }, [scheduleOverlayRender]);

  // Handle Resize & Canvas Initialization
  useEffect(() => {
    const container = containerRef.current;
    const glCanvas = glCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const cursorCanvas = cursorCanvasRef.current;
    if (!container || !glCanvas || !overlayCanvas || !cursorCanvas) return;

    const applyCanvasSize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.0);

      glCanvas.width = Math.round(width * dpr);
      glCanvas.height = Math.round(height * dpr);
      overlayCanvas.width = Math.round(width * dpr);
      overlayCanvas.height = Math.round(height * dpr);
      cursorCanvas.width = Math.round(width * dpr);
      cursorCanvas.height = Math.round(height * dpr);

      redraw();
      renderCursorOverlay();
    };

    // Immediate layout check
    const initialRect = container.getBoundingClientRect();
    if (initialRect.width > 0 && initialRect.height > 0) {
      applyCanvasSize(initialRect.width, initialRect.height);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        applyCanvasSize(width, height);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [redraw, renderCursorOverlay]);

  // Keyboard navigation & symbol deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard against typing inside input, textarea, select, or contentEditable elements
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space' && !e.repeat) setIsSpacePressed(true);

      if (brushSettings.mode === 'selectRegion') {
        if (
          e.key === 'Backspace' &&
          selectMethod === 'polygon' &&
          polygonPoints.length > 0
        ) {
          e.preventDefault();
          setPolygonPoints((prev) => prev.slice(0, prev.length - 1));
          return;
        }
        if (
          e.key === 'Enter' &&
          selectMethod === 'polygon' &&
          polygonPoints.length >= 3
        ) {
          e.preventDefault();
          const p0 = polygonPoints[0];
          const lastPt = polygonPoints[polygonPoints.length - 1];
          const snapLast = (followCoastline && snapCoastline)
            ? findNearestCoastlinePoint(
                lastPt[0],
                lastPt[1],
                currentElevation,
                currentCols,
                currentRows,
                currentWidth,
                currentHeight,
                currentSeaLevel,
                COASTLINE_SNAP_PX / viewport.zoom
              )
            : null;
          const snapFirst = (followCoastline && snapCoastline)
            ? findNearestCoastlinePoint(
                p0[0],
                p0[1],
                currentElevation,
                currentCols,
                currentRows,
                currentWidth,
                currentHeight,
                currentSeaLevel,
                COASTLINE_SNAP_PX / viewport.zoom
              )
            : null;
          const canTraceClose = !!(snapLast && snapFirst && snapLast.contourIndex === snapFirst.contourIndex);
          const closingTrace = canTraceClose
            ? traceCoastlinePath(
                lastPt,
                p0,
                currentElevation,
                currentCols,
                currentRows,
                currentWidth,
                currentHeight,
                currentSeaLevel,
                COASTLINE_SNAP_PX / viewport.zoom
              )
            : [];
          const fullLoop = closingTrace.length > 2 ? [...polygonPoints, ...closingTrace.slice(1)] : polygonPoints;
          commitShapeSelection(fullLoop);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setIsAutoSelectingIsland(false);
          snappedCoastRef.current = null;
          setPolygonPoints([]);
          setFreehandPoints([]);
          freehandPointsRef.current = [];
          setRect2Start(null);
          setSelectionBox(null);
          setConfirmedShape(null);
          return;
        }
      }

      // Town Tools Keyboard Controls
      if (activeRegionalMap?.kind === 'town') {
        // Template placement keyboard controls: Esc to exit, [ / ] to rotate (15 deg, shift 5 deg), F to flip
        if (templatePlacement) {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancelTemplatePlacement?.();
            renderOverlay();
            return;
          }
          if (e.key === '[' || e.key === ']') {
            e.preventDefault();
            const step = e.shiftKey ? 5 : 15;
            const delta = e.key === '[' ? -step : step;
            const newAngle = (templatePlacement.angleDeg + delta + 360) % 360;
            onUpdateTemplatePlacement?.({ angleDeg: newAngle });
            renderOverlay();
            return;
          }
          if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            onUpdateTemplatePlacement?.({ flipX: !templatePlacement.flipX });
            renderOverlay();
            return;
          }
        }

        // Drawing tools: Enter to finish, Escape to cancel, Backspace to pop point
        if (
          brushSettings.mode === 'townRoad' ||
          brushSettings.mode === 'townWall' ||
          brushSettings.mode === 'townPier' ||
          brushSettings.mode === 'townBuilding' ||
          brushSettings.mode === 'townDistrict'
        ) {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (brushSettings.mode === 'townBuilding') {
              if (townToolConfig.buildingDrawMode === 'polygon') {
                finalizeTownBuildingPolygon(drawingTownPoints);
              } else if (townToolConfig.buildingDrawMode === '3point' && drawingTownPoints.length === 2 && cursorPosRef.current) {
                const p0 = drawingTownPoints[0];
                const p1 = drawingTownPoints[1];
                const rect = rectangleFrom3Points(p0, p1, [cursorPosRef.current.x, cursorPosRef.current.y]);
                if (hasEdgeLessThanM(rect, 1.5, metersPerUnit)) {
                  showToast('辺の長さが1.5m未満のため作成できません');
                  setDrawingTownPoints([]);
                  renderPreviewOverlay();
                  return;
                }
                const now = Date.now();
                const id = `building_${now}_${Math.random().toString(36).substring(2, 7)}`;
                const tone = townToolConfig.buildingRoofToneRandom
                  ? deterministicRoofTone(id)
                  : townToolConfig.buildingRoofToneFixed;
                const newBuilding: TownBuilding = {
                  id,
                  name: `${BUILDING_KIND_LABELS[townToolConfig.buildingKind] || '建物'} ${
                    townObjects.filter((o) => o.kind === 'building').length + 1
                  }`,
                  kind: 'building',
                  buildingKind: townToolConfig.buildingKind,
                  polygon: rect,
                  heightM: townToolConfig.buildingHeightM,
                  tone,
                };
                const next = [...townObjects, newBuilding];
                townPerf.startConfirmation('建物を追加');
                onCommitHistory({
                  description: '建物を追加',
                  timestamp: Date.now(),
                  townChanges: {
                    prevObjects: townObjects,
                    newObjects: next,
                  },
                });
                onUpdateTownObjects?.(next);
                onSelectTownObjectIds?.([newBuilding.id]);
                onSelectTownObjectId?.(newBuilding.id);
                setDrawingTownPoints([]);
                scheduleOverlayRender();
                renderPreviewOverlay();
              }
            } else if (brushSettings.mode === 'townDistrict') {
              finalizeTownDistrict(drawingTownPoints);
            } else if (drawingTownPoints.length >= 2) {
              finalizeTownDrawing(drawingTownPoints);
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setDrawingTownPoints([]);
            renderPreviewOverlay();
            return;
          }
          if (e.key === 'Backspace' && drawingTownPoints.length > 0) {
            e.preventDefault();
            setDrawingTownPoints((prev) => prev.slice(0, prev.length - 1));
            renderPreviewOverlay();
            return;
          }
        }

        // Town Select tool: Del/Backspace to delete, Ctrl+A to select all, Esc to deselect, Arrows to nudge, [ / ] to rotate, Ctrl+D to duplicate, Ctrl+C to copy, Ctrl+V to paste
        if (brushSettings.mode === 'townSelect') {
          if (e.key === 'Escape') {
            e.preventDefault();
            setSelectedVertex(null);
            setSelectedGate(null);
            onSelectTownObjectIds?.([]);
            onSelectTownObjectId?.(null);
            onToggleAddingGateMode?.(false);
            renderOverlay();
            return;
          }

          // Keyboard rotation: [ (CCW) and ] (CW) 5 deg (Shift: 15 deg)
          if ((e.key === '[' || e.key === ']') && effectiveTownSelectedIds.length > 0) {
            e.preventDefault();
            const selectedSet = new Set(effectiveTownSelectedIds);
            const selectedObjs = townObjects.filter((o) => selectedSet.has(o.id));
            if (selectedObjs.length > 0) {
              const center = getObjectsCentroid(selectedObjs);
              const deg = e.key === '[' ? (e.shiftKey ? -15 : -5) : (e.shiftKey ? 15 : 5);
              const rad = (deg * Math.PI) / 180;
              const next = townObjects.map((o) =>
                selectedSet.has(o.id) ? rotateObject(o, center, rad) : o
              );
              onCommitHistory({
                description: `町部品の回転 (${deg > 0 ? `+${deg}` : deg}°)`,
                timestamp: Date.now(),
                townChanges: {
                  prevObjects: townObjects,
                  newObjects: next,
                },
              });
              onUpdateTownObjects?.(next);
              renderOverlay();
              return;
            }
          }

          // Duplicate: Ctrl+D / Cmd+D (offset 3 meters)
          if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
            if (effectiveTownSelectedIds.length > 0) {
              e.preventDefault();
              const selectedSet = new Set(effectiveTownSelectedIds);
              const selectedObjs = townObjects.filter((o) => selectedSet.has(o.id));
              if (selectedObjs.length > 0) {
                const shiftUnits = (3 / metersPerUnit) * 0.7071;
                const now = Date.now();
                const duplicated = selectedObjs.map((o) => {
                  const newId = `${o.kind}_${now}_${Math.random().toString(36).substring(2, 7)}`;
                  const shifted = translateObject(o, shiftUnits, shiftUnits);
                  return { ...shifted, id: newId };
                });
                const next = [...townObjects, ...duplicated];
                const newIds = duplicated.map((o) => o.id);
                onCommitHistory({
                  description: '町部品の複製',
                  timestamp: Date.now(),
                  townChanges: {
                    prevObjects: townObjects,
                    newObjects: next,
                  },
                });
                onUpdateTownObjects?.(next);
                onSelectTownObjectIds?.(newIds);
                onSelectTownObjectId?.(newIds[0] ?? null);
                renderOverlay();
                return;
              }
            }
          }

          // Copy: Ctrl+C / Cmd+C
          if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            if (effectiveTownSelectedIds.length > 0) {
              e.preventDefault();
              const selectedSet = new Set(effectiveTownSelectedIds);
              const selectedObjs = townObjects.filter((o) => selectedSet.has(o.id));
              if (selectedObjs.length > 0) {
                const clip = objectsToClipboard(selectedObjs, metersPerUnit);
                setTownClipboard(clip);
                showToast(`${selectedObjs.length}件の町部品をコピーしました`);
                return;
              }
            }
          }

          // Paste: Ctrl+V / Cmd+V
          if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
            if (townClipboard && townClipboard.objects.length > 0) {
              e.preventDefault();
              const anchor: Pt = cursorPosRef.current
                ? [cursorPosRef.current.x, cursorPosRef.current.y]
                : [currentWidth * 0.5, currentHeight * 0.5];
              const pasted = clipboardToObjects(townClipboard, anchor, metersPerUnit);
              const next = [...townObjects, ...pasted];
              const newIds = pasted.map((o) => o.id);
              onCommitHistory({
                description: '町部品の貼り付け',
                timestamp: Date.now(),
                townChanges: {
                  prevObjects: townObjects,
                  newObjects: next,
                },
              });
              onUpdateTownObjects?.(next);
              onSelectTownObjectIds?.(newIds);
              onSelectTownObjectId?.(newIds[0] ?? null);
              showToast(`${pasted.length}件の町部品を貼り付けました`);
              renderOverlay();
              return;
            }
          }

          if (e.key === 'Delete' || e.key === 'Backspace') {
            // A. If a specific gate is selected, delete that gate
            if (selectedGate) {
              e.preventDefault();
              const targetObj = townObjects.find((o) => o.id === selectedGate.objectId);
              if (targetObj && targetObj.kind === 'wall') {
                const updatedWall = removeGate(targetObj, selectedGate.index);
                const next = townObjects.map((o) => (o.id === targetObj.id ? updatedWall : o));
                onCommitHistory({
                  description: '城門の削除',
                  timestamp: Date.now(),
                  townChanges: {
                    prevObjects: townObjects,
                    newObjects: next,
                  },
                });
                onUpdateTownObjects?.(next);
                setSelectedGate(null);
                renderOverlay();
                return;
              }
            }

            // B. If a specific vertex is selected, delete that vertex
            if (selectedVertex) {
              e.preventDefault();
              const targetObj = townObjects.find((o) => o.id === selectedVertex.objectId);
              if (targetObj) {
                const pts = targetObj.kind === 'district' || targetObj.kind === 'building' ? targetObj.polygon : targetObj.points;
                const minPts = targetObj.kind === 'district' || targetObj.kind === 'building' || (targetObj.kind === 'wall' && targetObj.closed) ? 3 : 2;
                if (pts.length > minPts) {
                  const updated = removeVertex(targetObj, selectedVertex.index);
                  if (updated) {
                    const next = townObjects.map((o) => (o.id === targetObj.id ? updated : o));
                    onCommitHistory({
                      description: '頂点の削除',
                      timestamp: Date.now(),
                      townChanges: {
                        prevObjects: townObjects,
                        newObjects: next,
                      },
                    });
                    onUpdateTownObjects?.(next);
                    setSelectedVertex(null);
                    renderOverlay();
                    return;
                  }
                }
              }
            }

            // C. Delete Selected Whole Objects
            if (effectiveTownSelectedIds.length > 0) {
              e.preventDefault();
              const toDelete = new Set(effectiveTownSelectedIds);
              const next = townObjects.filter((o) => !toDelete.has(o.id));
              onCommitHistory({
                description: effectiveTownSelectedIds.length === 1 ? '町部品の削除' : '町部品の一括削除',
                timestamp: Date.now(),
                townChanges: {
                  prevObjects: townObjects,
                  newObjects: next,
                },
              });
              onUpdateTownObjects?.(next);
              setSelectedVertex(null);
              setSelectedGate(null);
              onSelectTownObjectIds?.([]);
              onSelectTownObjectId?.(null);
              renderOverlay();
              return;
            }
          }

          if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            const allIds = townObjects.map((o) => o.id);
            onSelectTownObjectIds?.(allIds);
            onSelectTownObjectId?.(allIds[0] ?? null);
            renderOverlay();
            return;
          }

          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
            effectiveTownSelectedIds.length > 0
          ) {
            e.preventDefault();
            const stepM = e.shiftKey ? 5 : 1;
            const stepUnits = (stepM * currentWidth) / Math.max(1, effectiveWidthKm * 1000);
            let dx = 0;
            let dy = 0;
            if (e.key === 'ArrowLeft') dx = -stepUnits;
            if (e.key === 'ArrowRight') dx = stepUnits;
            if (e.key === 'ArrowUp') dy = -stepUnits;
            if (e.key === 'ArrowDown') dy = stepUnits;

            const selectedSet = new Set(effectiveTownSelectedIds);
            const next = townObjects.map((o) =>
              selectedSet.has(o.id) ? translateObject(o, dx, dy) : o
            );
            onCommitHistory({
              description: '町部品の微調整移動',
              timestamp: Date.now(),
              townChanges: {
                prevObjects: townObjects,
                newObjects: next,
              },
            });
            onUpdateTownObjects?.(next);
            renderOverlay();
            return;
          }
        }
      }

      // Water Tools Keyboard Handling
      if (brushSettings.mode === 'river') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (drawingRiverPoints.length >= 2) {
            finalizeRiverDrawing(drawingRiverPoints);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setDrawingRiverPoints([]);
          renderOverlay();
          return;
        }
        if (e.key === 'Backspace' && drawingRiverPoints.length > 0) {
          e.preventDefault();
          setDrawingRiverPoints((prev) => prev.slice(0, prev.length - 1));
          renderOverlay();
          return;
        }
      }

      if (brushSettings.mode === 'lake') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (drawingLakePolygon.length >= 3) {
            finalizeLakePolygon(drawingLakePolygon);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setDrawingLakePolygon([]);
          setDrawingLakeStart(null);
          renderOverlay();
          return;
        }
        if (e.key === 'Backspace' && drawingLakePolygon.length > 0) {
          e.preventDefault();
          setDrawingLakePolygon((prev) => prev.slice(0, prev.length - 1));
          renderOverlay();
          return;
        }
      }

      if (brushSettings.mode === 'waterEdit') {
        if (e.key === 'Escape') {
          e.preventDefault();
          onSelectWater?.(null, null);
          setActiveWaterVertexIndex(null);
          renderOverlay();
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWaterId) {
          e.preventDefault();
          if (selectedWaterType === 'river') {
            const curRiver = effectiveRivers.find((r) => r.id === selectedWaterId);
            if (curRiver && activeWaterVertexIndex !== null && curRiver.points.length > 2) {
              const nextPts = curRiver.points.filter((_, idx) => idx !== activeWaterVertexIndex);
              const next = effectiveRivers.map((r) => (r.id === curRiver.id ? { ...r, points: nextPts } : r));
              onCommitHistory({
                description: '河川頂点の削除',
                timestamp: Date.now(),
                waterChanges: {
                  prevRivers: effectiveRivers,
                  newRivers: next,
                },
              });
              onUpdateRivers?.(next);
              setActiveWaterVertexIndex(null);
              renderOverlay();
              return;
            } else {
              const next = effectiveRivers.filter((r) => r.id !== selectedWaterId);
              onCommitHistory({
                description: '河川の削除',
                timestamp: Date.now(),
                waterChanges: {
                  prevRivers: effectiveRivers,
                  newRivers: next,
                },
              });
              onUpdateRivers?.(next);
              onSelectWater?.(null, null);
              setActiveWaterVertexIndex(null);
              renderOverlay();
              return;
            }
          } else if (selectedWaterType === 'lake') {
            const curLake = effectiveLakes.find((l) => l.id === selectedWaterId);
            if (curLake && curLake.polygon && activeWaterVertexIndex !== null && curLake.polygon.length > 3) {
              const nextPoly = curLake.polygon.filter((_, idx) => idx !== activeWaterVertexIndex);
              const next = effectiveLakes.map((l) => (l.id === curLake.id ? { ...l, polygon: nextPoly } : l));
              onCommitHistory({
                description: '湖頂点の削除',
                timestamp: Date.now(),
                waterChanges: {
                  prevLakes: effectiveLakes,
                  newLakes: next,
                },
              });
              onUpdateLakes?.(next);
              setActiveWaterVertexIndex(null);
              renderOverlay();
              return;
            } else {
              const next = effectiveLakes.filter((l) => l.id !== selectedWaterId);
              onCommitHistory({
                description: '湖の削除',
                timestamp: Date.now(),
                waterChanges: {
                  prevLakes: effectiveLakes,
                  newLakes: next,
                },
              });
              onUpdateLakes?.(next);
              onSelectWater?.(null, null);
              setActiveWaterVertexIndex(null);
              renderOverlay();
              return;
            }
          }
        }
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSymbolId) {
        const symList = symbols || [];
        const nextSymbols = symList.filter((s) => s.id !== selectedSymbolId);
        onCommitHistory({
          description: 'シンボル削除',
          timestamp: Date.now(),
          symbolChanges: {
            prevSymbols: symList,
            newSymbols: nextSymbols,
          },
        });
        onUpdateSymbols?.(nextSymbols);
        onSelectSymbolId?.(null);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpacePressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    selectedSymbolId,
    symbols,
    onCommitHistory,
    onUpdateSymbols,
    onSelectSymbolId,
    brushSettings.mode,
    selectMethod,
    polygonPoints,
    followCoastline,
    currentElevation,
    currentCols,
    currentRows,
    currentWidth,
    currentHeight,
    currentSeaLevel,
    viewport.zoom,
    commitShapeSelection,
    activeRegionalMap?.kind,
    drawingTownPoints,
    finalizeTownDrawing,
    renderOverlay,
    effectiveTownSelectedIds,
    selectedVertex,
    selectedGate,
    townObjects,
    onSelectTownObjectIds,
    onSelectTownObjectId,
    onToggleAddingGateMode,
    onUpdateTownObjects,
    effectiveWidthKm,
    drawingRiverPoints,
    finalizeRiverDrawing,
    drawingLakePolygon,
    finalizeLakePolygon,
    effectiveRivers,
    effectiveLakes,
    selectedWaterId,
    selectedWaterType,
    activeWaterVertexIndex,
    onSelectWater,
    onUpdateRivers,
    onUpdateLakes,
  ]);

  // Mouse wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;

      if (!pendingWheelZoomRef.current) {
        pendingWheelZoomRef.current = { mouseX, mouseY, factor: zoomFactor };
      } else {
        pendingWheelZoomRef.current.factor *= zoomFactor;
        pendingWheelZoomRef.current.mouseX = mouseX;
        pendingWheelZoomRef.current.mouseY = mouseY;
      }

      if (!wheelRafRef.current) {
        wheelRafRef.current = requestAnimationFrame(() => {
          wheelRafRef.current = null;
          if (!pendingWheelZoomRef.current) return;
          const { mouseX: mx, mouseY: my, factor } = pendingWheelZoomRef.current;
          pendingWheelZoomRef.current = null;

          const currentMaxZoom = maxZoom ?? 12.0;
          const newZoom = Math.max(0.15, Math.min(currentMaxZoom, viewport.zoom * factor));
          const newX = mx - (mx - viewport.x) * (newZoom / viewport.zoom);
          const newY = my - (my - viewport.y) * (newZoom / viewport.zoom);

          onUpdateViewport({
            x: newX,
            y: newY,
            zoom: newZoom,
          });
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
    };
  }, [viewport, onUpdateViewport, maxZoom]);

  // Execute Brush Stroke (subregion upload for near-zero latency)
  const executeBrushStroke = useCallback(
    (wx: number, wy: number, dragLine?: { prevX: number; prevY: number }) => {
      const changes = applyBrushToElevationGrid(
        currentElevation,
        currentCols,
        currentRows,
        currentWidth,
        currentHeight,
        wx,
        wy,
        brushSettings,
        currentSeaLevel,
        dragLine
      );

      for (const ch of changes) {
        const existing = activeStrokeChangesRef.current.get(ch.gridIndex);
        if (!existing) {
          activeStrokeChangesRef.current.set(ch.gridIndex, {
            prev: ch.prevElevation,
            curr: ch.newElevation,
          });
        } else {
          existing.curr = ch.newElevation;
        }
      }

      const b = (changes as any).bounds;
      if (rendererRef.current) {
        if (b) {
          rendererRef.current.updateElevationSubRegion(
            currentElevation,
            currentCols,
            currentRows,
            b.minC,
            b.minR,
            b.maxC,
            b.maxR
          );
        } else {
          rendererRef.current.updateGridTextures(
            currentElevation,
            currentCols,
            currentRows
          );
        }
      }

      renderWebGL();
      renderOverlay();
    },
    [
      currentElevation,
      currentCols,
      currentRows,
      currentWidth,
      currentHeight,
      brushSettings,
      currentSeaLevel,
      renderWebGL,
      renderOverlay,
    ]
  );

  // Mouse Down
  const handleMouseDown = (e: React.MouseEvent) => {
    isMouseDownRef.current = true;
    onInteractingChange?.(true);
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    const worldPos = screenToWorld(e.clientX, e.clientY);

    // Town Tools: Line Drawing (townRoad, townWall, townPier) and Selection (townSelect)
    if (activeRegionalMap?.kind === 'town') {
      // 0. Town Template Placement
      if (templatePlacement) {
        if (isSpacePressed || e.button === 1) {
          // Allow panning with Space + drag or middle click without placing template
        } else if (e.button === 2) {
          e.preventDefault();
          onCancelTemplatePlacement?.();
          renderPreviewOverlay();
          return;
        } else if (e.button === 0) {
          const anchor: Pt = [worldPos.x, worldPos.y];
          const { prevObjects, newObjects, placedIds } = placeTemplate(
            townObjects,
            templatePlacement.template,
            anchor,
            metersPerUnit,
            {
              angleDeg: templatePlacement.angleDeg,
              flipX: templatePlacement.flipX,
            }
          );

          townPerf.startConfirmation(`テンプレート「${templatePlacement.template.name}」を配置`);
          onCommitHistory({
            description: `テンプレート「${templatePlacement.template.name}」を配置`,
            timestamp: Date.now(),
            townChanges: {
              prevObjects,
              newObjects,
            },
          });
          onUpdateTownObjects?.(newObjects);
          onSelectTownObjectIds?.(placedIds);
          onSelectTownObjectId?.(placedIds[0] ?? null);
          showToast(`テンプレート「${templatePlacement.template.name}」を配置しました`);
          scheduleOverlayRender();
          renderPreviewOverlay();
          return;
        }
      }

      const dpr = glCanvasRef.current ? glCanvasRef.current.width / (glCanvasRef.current.clientWidth || 1) : 1;
      const zoomPx = viewport.zoom * dpr;
      const toleranceUnits = 8 / zoomPx;

      // 1. Line Drawing Tools
      if (
        brushSettings.mode === 'townRoad' ||
        brushSettings.mode === 'townWall' ||
        brushSettings.mode === 'townPier'
      ) {
        // Right-click to finalize line drawing (or cancel if less than 2 points)
        if (e.button === 2) {
          e.preventDefault();
          if (drawingTownPoints.length >= 2) {
            finalizeTownDrawing(drawingTownPoints);
          } else {
            setDrawingTownPoints([]);
            renderPreviewOverlay();
          }
          return;
        }

        let clickPt: Pt = [worldPos.x, worldPos.y];

        // Snapping candidate check (unless Alt held)
        if (townToolConfig.snapEnabled && !e.altKey) {
          const snapRes = snapPoint(clickPt, townSnapCandidates, toleranceUnits);
          if (snapRes.didSnap) {
            clickPt = snapRes.snapped;
          }
        }

        // 15-degree constraint if Shift held
        if (e.shiftKey && drawingTownPoints.length > 0) {
          clickPt = snapAngle(drawingTownPoints[drawingTownPoints.length - 1], clickPt, 15);
        }

        if (drawingTownPoints.length > 0) {
          // If wall and clicked on start point: close wall loop!
          if (
            brushSettings.mode === 'townWall' &&
            Math.hypot(clickPt[0] - drawingTownPoints[0][0], clickPt[1] - drawingTownPoints[0][1]) <= toleranceUnits &&
            drawingTownPoints.length >= 2
          ) {
            finalizeTownDrawing(drawingTownPoints, true);
            return;
          }

          // If clicked very close to last point (double-click to finish)
          const lastPt = drawingTownPoints[drawingTownPoints.length - 1];
          if (Math.hypot(clickPt[0] - lastPt[0], clickPt[1] - lastPt[1]) <= 2 / viewport.zoom) {
            finalizeTownDrawing(drawingTownPoints);
            return;
          }
        }

        setDrawingTownPoints((prev) => [...prev, clickPt]);
        renderPreviewOverlay();
        return;
      }

      // 1.5 Town Building Tool (3point, preset, polygon)
      if (brushSettings.mode === 'townBuilding') {
        if (e.button === 2) {
          e.preventDefault();
          setDrawingTownPoints([]);
          renderPreviewOverlay();
          return;
        }

        // A. Preset Mode (1 click placement)
        if (townToolConfig.buildingDrawMode === 'preset') {
          const clickPt: Pt = [worldPos.x, worldPos.y];
          const angleRad =
            townToolConfig.buildingOrientationMode === 'auto'
              ? (nearestSegmentDirection(townObjects, clickPt, 40, metersPerUnit)?.angleRad ?? 0)
              : ((townToolConfig.buildingFixedAngleDeg || 0) * Math.PI) / 180;

          const poly = generatePresetPolygon(
            clickPt,
            townToolConfig.buildingKind,
            townToolConfig.buildingPresetWidthM,
            townToolConfig.buildingPresetDepthM,
            angleRad,
            metersPerUnit
          );

          if (hasEdgeLessThanM(poly, 1.5, metersPerUnit)) {
            showToast('辺の長さが1.5m未満のため作成できません');
            return;
          }

          const now = Date.now();
          const id = `building_${now}_${Math.random().toString(36).substring(2, 7)}`;
          const tone = townToolConfig.buildingRoofToneRandom
            ? deterministicRoofTone(id)
            : townToolConfig.buildingRoofToneFixed;

          const newBuilding: TownBuilding = {
            id,
            name: `${BUILDING_KIND_LABELS[townToolConfig.buildingKind] || '建物'} ${
              townObjects.filter((o) => o.kind === 'building').length + 1
            }`,
            kind: 'building',
            buildingKind: townToolConfig.buildingKind,
            polygon: poly,
            heightM: townToolConfig.buildingHeightM,
            tone,
          };

          const next = [...townObjects, newBuilding];
          townPerf.startConfirmation('建物を追加');
          onCommitHistory({
            description: '建物を追加',
            timestamp: Date.now(),
            townChanges: {
              prevObjects: townObjects,
              newObjects: next,
            },
          });
          onUpdateTownObjects?.(next);
          onSelectTownObjectIds?.([newBuilding.id]);
          onSelectTownObjectId?.(newBuilding.id);
          scheduleOverlayRender();
          renderPreviewOverlay();
          return;
        }

        // B. 3-Point Rectangle Mode
        if (townToolConfig.buildingDrawMode === '3point') {
          let clickPt: Pt = [worldPos.x, worldPos.y];
          if (townToolConfig.snapEnabled && !e.altKey) {
            const snapRes = snapPoint(clickPt, townSnapCandidates, toleranceUnits);
            if (snapRes.didSnap) clickPt = snapRes.snapped;
          }

          if (drawingTownPoints.length === 0) {
            setDrawingTownPoints([clickPt]);
            renderPreviewOverlay();
            return;
          }

          if (drawingTownPoints.length === 1) {
            if (e.shiftKey) {
              clickPt = snapAngle(drawingTownPoints[0], clickPt, 15);
            }
            const edgeLenM =
              Math.hypot(clickPt[0] - drawingTownPoints[0][0], clickPt[1] - drawingTownPoints[0][1]) *
              metersPerUnit;
            if (edgeLenM < 1.5) {
              showToast('辺の長さが1.5m未満のため作成できません');
              return;
            }
            setDrawingTownPoints([drawingTownPoints[0], clickPt]);
            renderPreviewOverlay();
            return;
          }

          if (drawingTownPoints.length === 2) {
            const p0 = drawingTownPoints[0];
            const p1 = drawingTownPoints[1];
            const rect = rectangleFrom3Points(p0, p1, clickPt);

            if (hasEdgeLessThanM(rect, 1.5, metersPerUnit)) {
              showToast('辺の長さが1.5m未満のため作成できません');
              setDrawingTownPoints([]);
              renderPreviewOverlay();
              return;
            }

            const now = Date.now();
            const id = `building_${now}_${Math.random().toString(36).substring(2, 7)}`;
            const tone = townToolConfig.buildingRoofToneRandom
              ? deterministicRoofTone(id)
              : townToolConfig.buildingRoofToneFixed;

            const newBuilding: TownBuilding = {
              id,
              name: `${BUILDING_KIND_LABELS[townToolConfig.buildingKind] || '建物'} ${
                townObjects.filter((o) => o.kind === 'building').length + 1
              }`,
              kind: 'building',
              buildingKind: townToolConfig.buildingKind,
              polygon: rect,
              heightM: townToolConfig.buildingHeightM,
              tone,
            };

            const next = [...townObjects, newBuilding];
            townPerf.startConfirmation('建物を追加');
            onCommitHistory({
              description: '建物を追加',
              timestamp: Date.now(),
              townChanges: {
                prevObjects: townObjects,
                newObjects: next,
              },
            });
            onUpdateTownObjects?.(next);
            onSelectTownObjectIds?.([newBuilding.id]);
            onSelectTownObjectId?.(newBuilding.id);
            setDrawingTownPoints([]);
            scheduleOverlayRender();
            renderPreviewOverlay();
            return;
          }
        }

        // C. Polygon Mode
        if (townToolConfig.buildingDrawMode === 'polygon') {
          let clickPt: Pt = [worldPos.x, worldPos.y];
          if (townToolConfig.snapEnabled && !e.altKey) {
            const snapRes = snapPoint(clickPt, townSnapCandidates, toleranceUnits);
            if (snapRes.didSnap) clickPt = snapRes.snapped;
          }
          if (e.shiftKey && drawingTownPoints.length > 0) {
            clickPt = snapAngle(drawingTownPoints[drawingTownPoints.length - 1], clickPt, 15);
          }

          if (
            drawingTownPoints.length >= 3 &&
            Math.hypot(clickPt[0] - drawingTownPoints[0][0], clickPt[1] - drawingTownPoints[0][1]) <= toleranceUnits
          ) {
            finalizeTownBuildingPolygon(drawingTownPoints);
            return;
          }

          if (drawingTownPoints.length >= 12) {
            showToast('頂点数の上限(12点)に達しました。Enterで確定してください');
            return;
          }

          setDrawingTownPoints((prev) => [...prev, clickPt]);
          renderPreviewOverlay();
          return;
        }
      }

      // 1.6 Town District Tool (polygon)
      if (brushSettings.mode === 'townDistrict') {
        if (e.button === 2) {
          e.preventDefault();
          setDrawingTownPoints([]);
          renderPreviewOverlay();
          return;
        }

        let clickPt: Pt = [worldPos.x, worldPos.y];
        if (townToolConfig.snapEnabled && !e.altKey) {
          const snapRes = snapPoint(clickPt, townSnapCandidates, toleranceUnits);
          if (snapRes.didSnap) clickPt = snapRes.snapped;
        }
        if (e.shiftKey && drawingTownPoints.length > 0) {
          clickPt = snapAngle(drawingTownPoints[drawingTownPoints.length - 1], clickPt, 15);
        }

        if (
          drawingTownPoints.length >= 3 &&
          Math.hypot(clickPt[0] - drawingTownPoints[0][0], clickPt[1] - drawingTownPoints[0][1]) <= toleranceUnits
        ) {
          finalizeTownDistrict(drawingTownPoints);
          return;
        }

        setDrawingTownPoints((prev) => [...prev, clickPt]);
        renderPreviewOverlay();
        return;
      }

      // 2. Selection & Edit Tool (townSelect)
      if (brushSettings.mode === 'townSelect') {
        // Rotation handle click test (priority before other handles)
        if (townRotationHandle) {
          const distToRot = Math.hypot(
            worldPos.x - townRotationHandle.handlePos[0],
            worldPos.y - townRotationHandle.handlePos[1]
          );
          if (distToRot <= 10 / zoomPx) {
            townDragRef.current = {
              type: 'rotate',
              startWorldPos: [worldPos.x, worldPos.y],
              centroid: townRotationHandle.center,
              initialObjects: [...townObjects],
              hasMoved: false,
            };
            renderOverlay();
            return;
          }
        }

        const handle = findTownHandleUnderCursor([worldPos.x, worldPos.y], toleranceUnits);

        // A. Adding Gate Mode
        if (isAddingGateMode) {
          const wallHit = hitTestTownObjects(
            townObjects.filter((o) => o.kind === 'wall'),
            [worldPos.x, worldPos.y],
            toleranceUnits * 1.5,
            metersPerUnit
          ) as TownWall | null;
          if (wallHit) {
            const nearest = nearestPointOnPolyline(wallHit.points, [worldPos.x, worldPos.y], wallHit.closed);
            const updated = addGate(wallHit, nearest.segmentIndex, nearest.t, 4);
            const next = townObjects.map((o) => (o.id === wallHit.id ? updated : o));
            onCommitHistory({
              description: '城門の追加',
              timestamp: Date.now(),
              townChanges: {
                prevObjects: townObjects,
                newObjects: next,
              },
            });
            onUpdateTownObjects?.(next);
            onToggleAddingGateMode?.(false);
            renderOverlay();
            return;
          }
        }

        // B. Gate Handle Drag & Selection
        if (handle && handle.type === 'gate') {
          setSelectedGate({ objectId: handle.objectId, index: handle.gateIndex });
          setSelectedVertex(null);
          townDragRef.current = {
            type: 'gate',
            startWorldPos: [worldPos.x, worldPos.y],
            objectId: handle.objectId,
            gateIndex: handle.gateIndex,
            initialObjects: [...townObjects],
            hasMoved: false,
          };
          renderOverlay();
          return;
        }

        // C. Vertex Handle Drag & Selection
        if (handle && handle.type === 'vertex') {
          setSelectedVertex({ objectId: handle.objectId, index: handle.vertexIndex });
          setSelectedGate(null);
          townDragRef.current = {
            type: 'vertex',
            startWorldPos: [worldPos.x, worldPos.y],
            objectId: handle.objectId,
            vertexIndex: handle.vertexIndex,
            initialObjects: [...townObjects],
            hasMoved: false,
          };
          renderOverlay();
          return;
        }

        // D. Midpoint Handle Click (Insert new vertex and start dragging it)
        if (handle && handle.type === 'midpoint') {
          const targetObj = townObjects.find((o) => o.id === handle.objectId);
          if (targetObj) {
            const inserted = insertVertex(targetObj, handle.segmentIndex!, handle.p);
            const next = townObjects.map((o) => (o.id === targetObj.id ? inserted : o));
            onUpdateTownObjects?.(next);
            const newVIdx = handle.segmentIndex! + 1;
            setSelectedVertex({ objectId: targetObj.id, index: newVIdx });
            setSelectedGate(null);
            townDragRef.current = {
              type: 'vertex',
              startWorldPos: [worldPos.x, worldPos.y],
              objectId: targetObj.id,
              vertexIndex: newVIdx,
              initialObjects: [...townObjects],
              hasMoved: true,
            };
            renderOverlay();
            return;
          }
        }

        // E. Object Hit Test
        const hit = hitTestTownObjects(townObjects, [worldPos.x, worldPos.y], toleranceUnits, metersPerUnit);
        if (hit) {
          setSelectedVertex(null);
          setSelectedGate(null);
          if (e.shiftKey) {
            // Toggle selection
            const currentSelected = new Set(effectiveTownSelectedIds);
            if (currentSelected.has(hit.id)) {
              currentSelected.delete(hit.id);
            } else {
              currentSelected.add(hit.id);
            }
            const nextList = Array.from(currentSelected);
            onSelectTownObjectIds?.(nextList);
            onSelectTownObjectId?.(nextList[0] ?? null);
          } else {
            // If already part of multi-selection, keep selection and drag all
            if (!effectiveTownSelectedIds.includes(hit.id)) {
              onSelectTownObjectIds?.([hit.id]);
              onSelectTownObjectId?.(hit.id);
            }
            townDragRef.current = {
              type: 'translate',
              startWorldPos: [worldPos.x, worldPos.y],
              initialObjects: [...townObjects],
              hasMoved: false,
            };
          }
          renderOverlay();
          return;
        }

        // F. Empty space clicked -> Marquee selection or Deselect
        setSelectedVertex(null);
        setSelectedGate(null);
        if (!e.shiftKey) {
          onSelectTownObjectIds?.([]);
          onSelectTownObjectId?.(null);
        }
        townDragRef.current = {
          type: 'marquee',
          startWorldPos: [worldPos.x, worldPos.y],
          initialObjects: [...townObjects],
          hasMoved: false,
        };
        setTownMarqueeBox({
          startX: worldPos.x,
          startY: worldPos.y,
          currentX: worldPos.x,
          currentY: worldPos.y,
        });
        renderOverlay();
        return;
      }
    }

    // Water Tools: River drawing, Lake drawing, Water Edit
    if (brushSettings.mode === 'river') {
      const dpr = glCanvasRef.current ? glCanvasRef.current.width / (glCanvasRef.current.clientWidth || 1) : 1;
      const zoom = viewport.zoom * dpr;
      const toleranceUnits = 10 / zoom;
      if (e.button === 2) {
        e.preventDefault();
        if (drawingRiverPoints.length >= 2) {
          finalizeRiverDrawing(drawingRiverPoints);
        } else {
          setDrawingRiverPoints([]);
        }
        renderOverlay();
        return;
      }
      const clickPt: [number, number] = [worldPos.x, worldPos.y];
      if (drawingRiverPoints.length > 0) {
        const lastPt = drawingRiverPoints[drawingRiverPoints.length - 1];
        if (Math.hypot(clickPt[0] - lastPt[0], clickPt[1] - lastPt[1]) <= toleranceUnits) {
          finalizeRiverDrawing(drawingRiverPoints);
          return;
        }
      }
      setDrawingRiverPoints((prev) => [...prev, clickPt]);
      renderOverlay();
      return;
    }

    if (brushSettings.mode === 'lake') {
      const dpr = glCanvasRef.current ? glCanvasRef.current.width / (glCanvasRef.current.clientWidth || 1) : 1;
      const zoom = viewport.zoom * dpr;
      const toleranceUnits = 10 / zoom;
      if (waterSettings?.lakeMode === 'polygon') {
        if (e.button === 2) {
          e.preventDefault();
          if (drawingLakePolygon.length >= 3) {
            finalizeLakePolygon(drawingLakePolygon);
          } else {
            setDrawingLakePolygon([]);
          }
          renderOverlay();
          return;
        }
        const clickPt: [number, number] = [worldPos.x, worldPos.y];
        if (drawingLakePolygon.length >= 3) {
          const firstPt = drawingLakePolygon[0];
          if (Math.hypot(clickPt[0] - firstPt[0], clickPt[1] - firstPt[1]) <= toleranceUnits) {
            finalizeLakePolygon(drawingLakePolygon);
            return;
          }
        }
        setDrawingLakePolygon((prev) => [...prev, clickPt]);
        renderOverlay();
        return;
      } else {
        // Drag circle / organic placement
        if (e.button === 0) {
          setDrawingLakeStart([worldPos.x, worldPos.y]);
          renderOverlay();
          return;
        }
      }
    }

    if (brushSettings.mode === 'waterEdit') {
      const dpr = glCanvasRef.current ? glCanvasRef.current.width / (glCanvasRef.current.clientWidth || 1) : 1;
      const zoom = viewport.zoom * dpr;
      const toleranceUnits = 10 / zoom;

      // Check vertex handles of selected water body first
      if (selectedWaterType === 'river' && selectedWaterId) {
        const curRiver = effectiveRivers.find((r) => r.id === selectedWaterId);
        if (curRiver) {
          const vIdx = findNearestRiverVertex(worldPos.x, worldPos.y, curRiver, toleranceUnits);
          if (vIdx !== null) {
            setActiveWaterVertexIndex(vIdx);
            waterDragRef.current = {
              type: 'vertex',
              waterType: 'river',
              id: curRiver.id,
              vertexIndex: vIdx,
              startWorldPos: [worldPos.x, worldPos.y],
              initialRiver: { ...curRiver, points: curRiver.points.map((p) => [...p]) },
              hasMoved: false,
            };
            renderOverlay();
            return;
          }
        }
      } else if (selectedWaterType === 'lake' && selectedWaterId) {
        const curLake = effectiveLakes.find((l) => l.id === selectedWaterId);
        if (curLake) {
          const vIdx = findNearestLakeVertex(worldPos.x, worldPos.y, curLake, toleranceUnits);
          if (vIdx !== null) {
            setActiveWaterVertexIndex(vIdx);
            waterDragRef.current = {
              type: 'vertex',
              waterType: 'lake',
              id: curLake.id,
              vertexIndex: vIdx,
              startWorldPos: [worldPos.x, worldPos.y],
              initialLake: { ...curLake, polygon: curLake.polygon?.map((p) => [...p]) },
              hasMoved: false,
            };
            renderOverlay();
            return;
          }
        }
      }

      // Hit-test water bodies
      const hit = findWaterAtPoint(worldPos.x, worldPos.y, effectiveRivers, effectiveLakes, toleranceUnits);
      if (hit) {
        onSelectWater?.(hit.id, hit.type);
        setActiveWaterVertexIndex(null);
        const hitRiver = hit.type === 'river' ? effectiveRivers.find((r) => r.id === hit.id) : undefined;
        const hitLake = hit.type === 'lake' ? effectiveLakes.find((l) => l.id === hit.id) : undefined;
        waterDragRef.current = {
          type: 'translate',
          waterType: hit.type,
          id: hit.id,
          startWorldPos: [worldPos.x, worldPos.y],
          initialRiver: hitRiver ? { ...hitRiver, points: hitRiver.points.map((p) => [...p]) } : undefined,
          initialLake: hitLake ? { ...hitLake, polygon: hitLake.polygon?.map((p) => [...p]) } : undefined,
          hasMoved: false,
        };
        renderOverlay();
        return;
      } else {
        // Deselect if clicked empty space
        onSelectWater?.(null, null);
        setActiveWaterVertexIndex(null);
        renderOverlay();
      }
    }

    // 0. Click to navigate into a child region on Parent Map (Pan mode)
    if (brushSettings.mode === 'pan' && !isSpacePressed && onSelectRegionMap && mapData.regionalMaps) {
      const currentMapId = activeRegionalMap ? activeRegionalMap.id : null;
      const childRegions = Object.values(mapData.regionalMaps).filter(
        (reg) => (reg.parentId ?? null) === currentMapId
      );
      for (let i = childRegions.length - 1; i >= 0; i--) {
        const child = childRegions[i];
        let hit = false;
        if (child.outline && child.outline.length >= 3) {
          hit = pointInPolygon([worldPos.x, worldPos.y], child.outline);
        } else {
          hit =
            worldPos.x >= child.bounds.minX &&
            worldPos.x <= child.bounds.maxX &&
            worldPos.y >= child.bounds.minY &&
            worldPos.y <= child.bounds.maxY;
        }
        if (hit) {
          onSelectRegionMap(child.id);
          return;
        }
      }
    }

    // 1. Check if clicking on the Compass Rose to drag it (Pan mode or with Left-Click)
    const cPos = compassPos || { x: currentWidth * 0.12, y: currentHeight * 0.28 };
    const distToCompass = Math.hypot(worldPos.x - cPos.x, worldPos.y - cPos.y);
    if (showCompass && distToCompass <= 75 && !isSpacePressed && (brushSettings.mode === 'pan' || e.shiftKey)) {
      isDraggingCompassRef.current = true;
      compassDragOffsetRef.current = { x: worldPos.x - cPos.x, y: worldPos.y - cPos.y };
      return;
    }

    // 2. Symbol Stamp / Drag / Brush / Eraser modes
    if (brushSettings.mode === 'stamp') {
      const symList = symbols || [];
      // Hit test existing symbols in reverse order (forefront first)
      let hit: MapSymbolInstance | null = null;
      for (let i = symList.length - 1; i >= 0; i--) {
        const s = symList[i];
        // Ensure even very small symbols have a comfortable hit target (min 12px)
        const hitR = Math.max(12, 24 * (s.scale ?? 1.0));
        if (Math.hypot(worldPos.x - s.x, worldPos.y - s.y) <= hitR) {
          hit = s;
          break;
        }
      }

      if (hit) {
        onSelectSymbolId?.(hit.id);
        isDraggingSymbolRef.current = true;
        draggedSymbolOffsetRef.current = { x: worldPos.x - hit.x, y: worldPos.y - hit.y };
        symbolStrokeSnapshotRef.current = [...symList];
        renderOverlay();
      } else {
        // Place new single stamp symbol
        onSelectSymbolId?.(null);
        const isCustom = symbolToolSettings?.selectedType === 'custom' || !!symbolToolSettings?.selectedCustomAssetId;
        const type = isCustom ? 'custom' : (symbolToolSettings?.selectedType || 'mountain_snow');
        const customAssetId = isCustom ? (symbolToolSettings?.selectedCustomAssetId || customAssets?.[0]?.id) : undefined;
        const newSym: MapSymbolInstance = {
          id: `sym_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type,
          customAssetId,
          x: Math.round(worldPos.x),
          y: Math.round(worldPos.y),
          scale: symbolToolSettings?.scale ?? 1.0,
          rotation: (Math.random() - 0.5) * 0.12,
          flipX: Math.random() < 0.5,
          variant: Math.floor(Math.random() * 3),
        };
        const nextSymbols = [...symList, newSym];
        onUpdateSymbols?.(nextSymbols);
        onCommitHistory({
          description: `シンボル配置 (${newSym.type})`,
          timestamp: Date.now(),
          symbolChanges: {
            prevSymbols: symList,
            newSymbols: nextSymbols,
          },
        });
      }
      return;
    }

    if (brushSettings.mode === 'symbolBrush') {
      isSymbolStrokeActiveRef.current = true;
      activeStrokeSymbolsRef.current = [...(symbols || [])];
      symbolStrokeSnapshotRef.current = [...activeStrokeSymbolsRef.current];
      const symList = activeStrokeSymbolsRef.current;
      const isCustom = symbolToolSettings?.selectedType === 'custom' || !!symbolToolSettings?.selectedCustomAssetId;
      const type = isCustom ? 'custom' : (symbolToolSettings?.selectedType || 'tree_pine_cluster');
      const customAssetId = isCustom ? (symbolToolSettings?.selectedCustomAssetId || customAssets?.[0]?.id) : undefined;
      const scatterRadius = symbolToolSettings?.scatterRadius ?? 60;
      const density = symbolToolSettings?.density ?? 3;
      const baseScale = symbolToolSettings?.scale ?? 1.0;
      const randomVar = symbolToolSettings?.randomScaleVar ?? 0.15;

      const added = scatterSymbolsUnderBrush(
        worldPos.x,
        worldPos.y,
        type,
        scatterRadius,
        density,
        symList,
        customAssetId,
        baseScale,
        randomVar,
        terrainContext
      );
      if (added.length > 0) {
        onUpdateSymbols?.([...symList]);
      }
      renderOverlay();
      return;
    }

    if (brushSettings.mode === 'symbolEraser') {
      isSymbolStrokeActiveRef.current = true;
      activeStrokeSymbolsRef.current = [...(symbols || [])];
      symbolStrokeSnapshotRef.current = [...activeStrokeSymbolsRef.current];
      const rad = symbolToolSettings?.scatterRadius ?? brushSettings.radius;
      const remaining = activeStrokeSymbolsRef.current.filter((s) => Math.hypot(s.x - worldPos.x, s.y - worldPos.y) > rad);
      if (remaining.length !== activeStrokeSymbolsRef.current.length) {
        activeStrokeSymbolsRef.current = remaining;
        onUpdateSymbols?.(remaining);
      }
      renderOverlay();
      return;
    }

    // Biome Fill Mode
    if (brushSettings.mode === 'biomeFill') {
      const grid = getOrCreateBiomeGrid();
      const cellW = currentWidth / (currentCols - 1);
      const cellH = currentHeight / (currentRows - 1);
      const startC = Math.max(0, Math.min(currentCols - 1, Math.round(worldPos.x / cellW)));
      const startR = Math.max(0, Math.min(currentRows - 1, Math.round(worldPos.y / cellH)));
      const startIndex = startR * currentCols + startC;

      const biomeId = biomeSettings?.selectedBiomeId ?? 1;
      const options = {
        softness: 0,
        landOnly: biomeSettings?.landOnly ?? true,
        elevationGrid: currentElevation,
        seaLevel: currentSeaLevel,
      };

      const result = floodFillBiome(
        grid,
        currentCols,
        currentRows,
        startIndex,
        biomeId,
        options
      );

      if (result.changes.length > 0) {
        updateBiomeSubRegion(result.changes, result.bounds);

        const activeList = biomeTypes || mapData.biomeTypes || DEFAULT_BIOME_TYPES;
        const activeBiome = activeList.find((b) => b.slot === biomeId);
        const bName = activeBiome?.name || '';

        let nextSymbols = symbols || [];
        let symbolChanges: { prevSymbols: MapSymbolInstance[]; newSymbols: MapSymbolInstance[] } | undefined = undefined;

        if (activeBiome && activeBiome.symbols && activeBiome.symbols.length > 0 && (activeBiome.density ?? 50) > 0) {
          const prevSymbols = [...nextSymbols];
          const workingSymbols = [...nextSymbols];
          const changedIndices = result.changes.map((ch) => ch.gridIndex);
          const added = populateSymbolsForBiomeFill(
            changedIndices,
            activeBiome,
            workingSymbols,
            currentCols,
            currentRows,
            currentWidth,
            currentHeight,
            currentElevation,
            currentSeaLevel,
            options.landOnly,
            customAssets
          );
          if (added.length > 0) {
            nextSymbols = workingSymbols;
            onUpdateSymbols?.(nextSymbols);
            symbolChanges = {
              prevSymbols,
              newSymbols: nextSymbols,
            };
          }
        }

        renderOverlay();

        onCommitHistory({
          description: `地形タイプ塗りつぶし (${bName})`,
          timestamp: Date.now(),
          biomeChanges: result.changes,
          symbolChanges,
        });
      }
      return;
    }

    // Biome Paint & Erase Mode
    if (brushSettings.mode === 'biomePaint' || brushSettings.mode === 'biomeErase') {
      const grid = getOrCreateBiomeGrid();
      activeBiomeStrokeRef.current.clear();
      isSymbolStrokeActiveRef.current = true;
      activeStrokeSymbolsRef.current = [...(symbols || [])];
      symbolStrokeSnapshotRef.current = [...activeStrokeSymbolsRef.current];
      lastSymbolWorldPosRef.current = worldPos;
      lastWorldPosRef.current = worldPos;

      const isErase = brushSettings.mode === 'biomeErase';
      const biomeId = isErase ? 0 : (biomeSettings?.selectedBiomeId ?? 1);
      const softness = isErase ? 0 : (biomeSettings?.softness ?? 40);
      const options = {
        softness,
        landOnly: isErase ? false : (biomeSettings?.landOnly ?? true),
        elevationGrid: currentElevation,
        seaLevel: currentSeaLevel,
      };

      const result = paintBiomeCircle(
        grid,
        currentCols,
        currentRows,
        currentWidth,
        currentHeight,
        worldPos.x,
        worldPos.y,
        brushSettings.radius,
        biomeId,
        softness,
        options
      );

      for (const ch of result.changes) {
        activeBiomeStrokeRef.current.set(ch.gridIndex, { prev: ch.prev, next: ch.next });
      }

      if (result.changes.length > 0) {
        updateBiomeSubRegion(result.changes, result.bounds);
      }

      const activeList = biomeTypes || mapData.biomeTypes || DEFAULT_BIOME_TYPES;
      const activeBiome = activeList.find((b) => b.slot === biomeId);

      if (!isErase && activeBiome && activeBiome.symbols && activeBiome.symbols.length > 0 && (activeBiome.density ?? 50) > 0) {
        const added = scatterSymbolsForBiomeStroke(
          worldPos.x,
          worldPos.y,
          brushSettings.radius,
          activeBiome,
          activeStrokeSymbolsRef.current,
          grid,
          currentCols,
          currentRows,
          currentWidth,
          currentHeight,
          currentElevation,
          currentSeaLevel,
          options.landOnly,
          customAssets
        );
        if (added.length > 0) {
          onUpdateSymbols?.([...activeStrokeSymbolsRef.current]);
        }
      } else if (isErase && activeStrokeSymbolsRef.current.length > 0) {
        const filtered = activeStrokeSymbolsRef.current.filter((s) => {
          if (s.autoBiomeSlot !== undefined) {
            return Math.hypot(s.x - worldPos.x, s.y - worldPos.y) > brushSettings.radius;
          }
          return true;
        });
        if (filtered.length !== activeStrokeSymbolsRef.current.length) {
          activeStrokeSymbolsRef.current = filtered;
          onUpdateSymbols?.(filtered);
        }
      }

      renderOverlay();
      return;
    }

    // Direct click on child town marker or child region to open it
    if (mapData.regionalMaps && (brushSettings.mode === 'pan' || brushSettings.mode === 'selectRegion')) {
      const currentMapId = activeRegionalMap ? activeRegionalMap.id : null;
      const childRegions = Object.values(mapData.regionalMaps).filter(
        (reg) => (reg.parentId ?? null) === currentMapId
      );
      for (const child of childRegions) {
        const b = child.bounds;
        const screenW = (b.maxX - b.minX) * viewport.zoom;
        const screenH = (b.maxY - b.minY) * viewport.zoom;
        const maxScreenDim = Math.max(screenW, screenH);
        const isTown = child.kind === 'town';

        if (isTown && maxScreenDim < 24) {
          const cx = (b.minX + b.maxX) / 2;
          const cy = (b.minY + b.maxY) / 2;
          const dist = Math.hypot(worldPos.x - cx, worldPos.y - cy) * viewport.zoom;
          if (dist <= 16) {
            onSelectRegionMap?.(child.id);
            return;
          }
        }
      }
    }

    const isPanAction =
      brushSettings.mode === 'pan' ||
      isSpacePressed ||
      e.button === 1 ||
      e.button === 2;

    if (isPanAction) {
      isPanningRef.current = true;
    } else if (brushSettings.mode === 'selectRegion') {
      if (isAutoSelectingIsland) {
        const island = findEnclosingIslandContour(
          worldPos.x,
          worldPos.y,
          currentElevation,
          currentCols,
          currentRows,
          currentWidth,
          currentHeight,
          currentSeaLevel
        );
        if (island && island.length >= 3) {
          commitShapeSelection(island);
        }
        setIsAutoSelectingIsland(false);
        return;
      }

      if (selectMethod === 'town') {
        const townBounds = computeTownBounds(
          { width: currentWidth, height: currentHeight, widthKm: effectiveWidthKm },
          worldPos.x,
          worldPos.y,
          townConfig.realWidthM,
          townConfig.aspect
        );
        onSelectRegionBounds?.(townBounds, false, undefined, {
          kind: 'town',
          name: townConfig.name,
          detailScale: townConfig.detailScale,
        });
        return;
      } else if (selectMethod === 'rect') {
        setConfirmedShape(null);
        isSelectingRef.current = true;
        setSelectionBox({
          startX: worldPos.x,
          startY: worldPos.y,
          currentX: worldPos.x,
          currentY: worldPos.y,
        });
      } else if (selectMethod === 'rect2') {
        setConfirmedShape(null);
        const clickPt: [number, number] = (followCoastline && snappedCoastRef.current)
          ? [snappedCoastRef.current.point[0], snappedCoastRef.current.point[1]]
          : [worldPos.x, worldPos.y];

        if (!rect2Start) {
          setRect2Start({ x: clickPt[0], y: clickPt[1] });
          setSelectionBox({
            startX: clickPt[0],
            startY: clickPt[1],
            currentX: clickPt[0],
            currentY: clickPt[1],
          });
        } else {
          // 2nd click:
          if (followCoastline) {
            const startPt: [number, number] = [rect2Start.x, rect2Start.y];
            const endPt: [number, number] = clickPt;
            const traced = traceCoastlinePath(
              startPt,
              endPt,
              currentElevation,
              currentCols,
              currentRows,
              currentWidth,
              currentHeight,
              currentSeaLevel,
              40 / viewport.zoom
            );

            if (traced.length >= 3) {
              const shape: [number, number][] = [...traced, startPt];
              commitShapeSelection(shape);
              setRect2Start(null);
              setSelectionBox(null);
              return;
            }
          }

          // 2nd click standard rectangle: commit 2-point rectangle
          const sx = rect2Start.x;
          const sy = rect2Start.y;
          const cx = selectionBox ? selectionBox.currentX : worldPos.x;
          const cy = selectionBox ? selectionBox.currentY : worldPos.y;

          const minX = Math.max(0, Math.min(sx, cx));
          const maxX = Math.min(currentWidth, Math.max(sx, cx));
          const minY = Math.max(0, Math.min(sy, cy));
          const maxY = Math.min(currentHeight, Math.max(sy, cy));

          const rawW = maxX - minX;
          const rawH = maxY - minY;
          const minThreshold = Math.max(10, currentWidth * 0.02);

          if (rawW >= minThreshold && rawH >= 5) {
            const fitResult = fitBoundsToLimits(
              { minX, minY, maxX, maxY },
              currentWidth,
              currentHeight
            );
            onSelectRegionBounds?.(fitResult.bounds, fitResult.adjusted);
          }
          setRect2Start(null);
          setSelectionBox(null);
        }
      } else if (selectMethod === 'polygon') {
        setConfirmedShape(null);
        const isCurCoastSnapped = !!(followCoastline && snapCoastline && snappedCoastRef.current);
        const clickPt: [number, number] = isCurCoastSnapped
          ? [snappedCoastRef.current!.point[0], snappedCoastRef.current!.point[1]]
          : [worldPos.x, worldPos.y];

        // If clicking near first vertex and length >= 3, close and commit
        if (polygonPoints.length >= 3) {
          const p0 = polygonPoints[0];
          const distToFirst = Math.hypot(clickPt[0] - p0[0], clickPt[1] - p0[1]);
          if (distToFirst <= 18 / viewport.zoom) {
            const lastPt = polygonPoints[polygonPoints.length - 1];
            const snapLast = (followCoastline && snapCoastline)
              ? findNearestCoastlinePoint(
                  lastPt[0],
                  lastPt[1],
                  currentElevation,
                  currentCols,
                  currentRows,
                  currentWidth,
                  currentHeight,
                  currentSeaLevel,
                  COASTLINE_SNAP_PX / viewport.zoom
                )
              : null;
            const snapFirst = (followCoastline && snapCoastline)
              ? findNearestCoastlinePoint(
                  p0[0],
                  p0[1],
                  currentElevation,
                  currentCols,
                  currentRows,
                  currentWidth,
                  currentHeight,
                  currentSeaLevel,
                  COASTLINE_SNAP_PX / viewport.zoom
                )
              : null;
            const canTraceClose = !!(snapLast && snapFirst && snapLast.contourIndex === snapFirst.contourIndex);
            const closingTrace = canTraceClose
              ? traceCoastlinePath(
                  lastPt,
                  p0,
                  currentElevation,
                  currentCols,
                  currentRows,
                  currentWidth,
                  currentHeight,
                  currentSeaLevel,
                  COASTLINE_SNAP_PX / viewport.zoom
                )
              : [];
            const fullLoop = closingTrace.length > 2 ? [...polygonPoints, ...closingTrace.slice(1)] : polygonPoints;
            commitShapeSelection(fullLoop);
            return;
          }
        }

        if (polygonPoints.length === 0) {
          setPolygonPoints([clickPt]);
        } else {
          const lastPt = polygonPoints[polygonPoints.length - 1];
          let traced: [number, number][] | null = null;
          if (followCoastline && isCurCoastSnapped) {
            const snapLast = findNearestCoastlinePoint(
              lastPt[0],
              lastPt[1],
              currentElevation,
              currentCols,
              currentRows,
              currentWidth,
              currentHeight,
              currentSeaLevel,
              COASTLINE_SNAP_PX / viewport.zoom
            );
            if (snapLast && snapLast.contourIndex === snappedCoastRef.current!.contourIndex) {
              traced = traceCoastlinePath(
                lastPt,
                clickPt,
                currentElevation,
                currentCols,
                currentRows,
                currentWidth,
                currentHeight,
                currentSeaLevel,
                COASTLINE_SNAP_PX / viewport.zoom
              );
            }
          }

          if (traced && traced.length > 1) {
            setPolygonPoints((prev) => [...prev, ...traced.slice(1)]);
          } else {
            setPolygonPoints((prev) => [...prev, clickPt]);
          }
        }
      } else if (selectMethod === 'freehand') {
        setConfirmedShape(null);
        isSelectingRef.current = true;
        const startPt: [number, number] = (snapCoastline && snappedCoastRef.current)
          ? [snappedCoastRef.current.point[0], snappedCoastRef.current.point[1]]
          : [worldPos.x, worldPos.y];
        freehandPointsRef.current = [startPt];
        setFreehandPoints([startPt]);
      }
    } else if (e.button === 0) {
      isPanningRef.current = false;
      activeStrokeChangesRef.current.clear();
      executeBrushStroke(worldPos.x, worldPos.y);
    }
  };

  // Mouse Move (lightweight: only draws 2D cursor overlay without triggering WebGL or React renders)
  const handleMouseMove = (e: React.MouseEvent) => {
    const worldPos = screenToWorld(e.clientX, e.clientY);
    cursorPosRef.current = worldPos;

    // Town Dragging (Marquee / Translate / Vertex / Gate / Rotate)
    if (activeRegionalMap?.kind === 'town') {
      if (townDragRef.current) {
        townDragRef.current.hasMoved = true;
        const drag = townDragRef.current;

        if (drag.type === 'marquee') {
          setTownMarqueeBox({
            startX: drag.startWorldPos[0],
            startY: drag.startWorldPos[1],
            currentX: worldPos.x,
            currentY: worldPos.y,
          });
          renderPreviewOverlay();
          return;
        }

        if (drag.type === 'translate') {
          const dx = worldPos.x - drag.startWorldPos[0];
          const dy = worldPos.y - drag.startWorldPos[1];
          const selectedSet = new Set(effectiveTownSelectedIds);
          const next = drag.initialObjects.map((o) =>
            selectedSet.has(o.id) ? translateObject(o, dx, dy) : o
          );
          drag.draftObjects = next;
          renderPreviewOverlay();
          return;
        }

        if (drag.type === 'vertex') {
          let targetP: Pt = [worldPos.x, worldPos.y];
          if (townToolConfig.snapEnabled && !e.altKey) {
            const snapRes = snapPoint(targetP, townSnapCandidates, 8 / viewport.zoom);
            if (snapRes.didSnap) {
              targetP = snapRes.snapped;
            }
          }
          if (e.shiftKey) {
            const initialObj = drag.initialObjects.find((o) => o.id === drag.objectId);
            const pts = initialObj
              ? initialObj.kind === 'district' || initialObj.kind === 'building'
                ? initialObj.polygon
                : initialObj.points
              : [];
            const adjIdx = drag.vertexIndex! > 0 ? drag.vertexIndex! - 1 : 1;
            if (pts[adjIdx]) {
              targetP = snapAngle(pts[adjIdx], targetP, 15);
            }
          }
          const objId = drag.objectId!;
          const vIdx = drag.vertexIndex!;
          const next = drag.initialObjects.map((o) =>
            o.id === objId ? moveVertex(o, vIdx, targetP) : o
          );
          drag.draftObjects = next;
          renderPreviewOverlay();
          return;
        }

        if (drag.type === 'gate') {
          const objId = drag.objectId!;
          const gIdx = drag.gateIndex!;
          const wall = drag.initialObjects.find((o) => o.id === objId) as TownWall | undefined;
          if (wall) {
            const nearest = nearestPointOnPolyline(wall.points, [worldPos.x, worldPos.y], wall.closed);
            const updatedWall = moveGate(wall, gIdx, nearest.segmentIndex, nearest.t);
            const next = drag.initialObjects.map((o) => (o.id === objId ? updatedWall : o));
            drag.draftObjects = next;
            renderPreviewOverlay();
            return;
          }
        }

        if (drag.type === 'rotate') {
          const center = drag.centroid!;
          const startAngle = Math.atan2(drag.startWorldPos[1] - center[1], drag.startWorldPos[0] - center[0]);
          const curAngle = Math.atan2(worldPos.y - center[1], worldPos.x - center[0]);
          let delta = curAngle - startAngle;
          if (e.shiftKey) {
            const step = Math.PI / 12; // 15 degrees
            delta = Math.round(delta / step) * step;
          }
          const selectedSet = new Set(effectiveTownSelectedIds);
          const next = drag.initialObjects.map((o) =>
            selectedSet.has(o.id) ? rotateObject(o, center, delta) : o
          );
          drag.draftObjects = next;
          renderPreviewOverlay();
          return;
        }
      }

      // Update rubberband line, preset preview, or handles when mouse moves
      if (
        templatePlacement ||
        brushSettings.mode === 'townSelect' ||
        ((brushSettings.mode === 'townRoad' ||
          brushSettings.mode === 'townWall' ||
          brushSettings.mode === 'townPier' ||
          brushSettings.mode === 'townBuilding' ||
          brushSettings.mode === 'townDistrict') &&
        (drawingTownPoints.length > 0 || (brushSettings.mode === 'townBuilding' && townToolConfig.buildingDrawMode === 'preset')))
      ) {
        renderPreviewOverlay();
      }
    }

    // Water dragging (vertex or translate)
    if (waterDragRef.current) {
      waterDragRef.current.hasMoved = true;
      const drag = waterDragRef.current;
      if (drag.type === 'translate') {
        const dx = worldPos.x - drag.startWorldPos[0];
        const dy = worldPos.y - drag.startWorldPos[1];
        if (drag.waterType === 'river' && drag.initialRiver) {
          const nextPts = drag.initialRiver.points.map(([x, y]) => [x + dx, y + dy] as [number, number]);
          const next = effectiveRivers.map((r) => (r.id === drag.id ? { ...r, points: nextPts } : r));
          onUpdateRivers?.(next);
        } else if (drag.waterType === 'lake' && drag.initialLake) {
          const nextPoly = drag.initialLake.polygon.map(([x, y]) => [x + dx, y + dy] as [number, number]);
          const next = effectiveLakes.map((l) => (l.id === drag.id ? { ...l, polygon: nextPoly } : l));
          onUpdateLakes?.(next);
        }
        scheduleOverlayRender();
        return;
      } else if (drag.type === 'vertex') {
        const vIdx = drag.vertexIndex!;
        if (drag.waterType === 'river' && drag.initialRiver) {
          const nextPts = drag.initialRiver.points.map((p, idx) =>
            idx === vIdx ? ([worldPos.x, worldPos.y] as [number, number]) : ([...p] as [number, number])
          );
          const next = effectiveRivers.map((r) => (r.id === drag.id ? { ...r, points: nextPts } : r));
          onUpdateRivers?.(next);
        } else if (drag.waterType === 'lake' && drag.initialLake) {
          const nextPoly = drag.initialLake.polygon.map((p, idx) =>
            idx === vIdx ? ([worldPos.x, worldPos.y] as [number, number]) : ([...p] as [number, number])
          );
          const next = effectiveLakes.map((l) => (l.id === drag.id ? { ...l, polygon: nextPoly } : l));
          onUpdateLakes?.(next);
        }
        scheduleOverlayRender();
        return;
      }
    }

    // Update in-progress river / lake preview on mouse move
    if (
      (brushSettings.mode === 'river' && drawingRiverPoints.length > 0) ||
      (brushSettings.mode === 'lake' && (drawingLakeStart !== null || drawingLakePolygon.length > 0))
    ) {
      renderPreviewOverlay();
    }

    const isCoastlineAssisted = (
      brushSettings.mode === 'selectRegion' && (
        isAutoSelectingIsland ||
        ((selectMethod === 'rect2' || selectMethod === 'polygon') && followCoastline && snapCoastline) ||
        (selectMethod === 'freehand' && snapCoastline)
      )
    );

    if (isCoastlineAssisted) {
      const snap = findNearestCoastlinePoint(
        worldPos.x,
        worldPos.y,
        currentElevation,
        currentCols,
        currentRows,
        currentWidth,
        currentHeight,
        currentSeaLevel,
        COASTLINE_SNAP_PX / viewport.zoom
      );
      snappedCoastRef.current = snap;
      if (snap) {
        cursorPosRef.current = { x: snap.point[0], y: snap.point[1] };
      }
    } else {
      snappedCoastRef.current = null;
    }

    if (isDraggingCompassRef.current) {
      const newPos = {
        x: Math.max(60, Math.min(currentWidth - 60, worldPos.x - compassDragOffsetRef.current.x)),
        y: Math.max(60, Math.min(currentHeight - 60, worldPos.y - compassDragOffsetRef.current.y)),
      };
      onUpdateCompassPos?.(newPos);
      scheduleOverlayRender();
      return;
    }

    if (isDraggingSymbolRef.current && selectedSymbolId) {
      const symList = symbols || [];
      const newX = Math.round(worldPos.x - draggedSymbolOffsetRef.current.x);
      const newY = Math.round(worldPos.y - draggedSymbolOffsetRef.current.y);
      const nextSymbols = symList.map((s) => {
        if (s.id === selectedSymbolId) {
          const { autoBiomeSlot, ...rest } = s;
          return { ...rest, x: newX, y: newY };
        }
        return s;
      });
      onUpdateSymbols?.(nextSymbols);
      scheduleOverlayRender();
      return;
    }

    if (!isMouseDownRef.current) {
      if (brushSettings.mode === 'selectRegion') {
        if (selectMethod === 'rect2' && rect2Start && selectionBox) {
          const sx = selectionBox.startX;
          const sy = selectionBox.startY;
          const dx = worldPos.x - sx;
          const dy = worldPos.y - sy;
          const signX = dx >= 0 ? 1 : -1;
          const signY = dy >= 0 ? 1 : -1;

          let currentX = Math.max(0, Math.min(currentWidth, worldPos.x));
          let currentY = Math.max(0, Math.min(currentHeight, worldPos.y));

          if (regionAspect !== 'free') {
            let targetAspect = 2.0;
            if (regionAspect === '2:1') targetAspect = 2.0;
            else if (regionAspect === '1:1') targetAspect = 1.0;
            else if (regionAspect === 'current') targetAspect = currentWidth / currentHeight;

            const maxW = signX > 0 ? Math.max(0, currentWidth - sx) : Math.max(0, sx);
            const maxH = signY > 0 ? Math.max(0, currentHeight - sy) : Math.max(0, sy);
            const maxWFromH = maxH * targetAspect;

            const allowedW = Math.min(maxW, maxWFromH);
            const w = Math.min(Math.abs(dx), allowedW);
            const h = w / targetAspect;

            currentX = sx + signX * w;
            currentY = sy + signY * h;
          }

          setSelectionBox((prev) => (prev ? { ...prev, currentX, currentY } : null));
          renderPreviewOverlay();
        } else if (selectMethod === 'polygon' && polygonPoints.length > 0) {
          renderPreviewOverlay();
        } else if (isCoastlineAssisted) {
          renderPreviewOverlay();
        }
      }
      renderCursorOverlay();
      return;
    }

    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    if (isPanningRef.current) {
      pendingPanDeltaRef.current.dx += dx;
      pendingPanDeltaRef.current.dy += dy;

      if (!panRafRef.current) {
        panRafRef.current = requestAnimationFrame(() => {
          panRafRef.current = null;
          const curDx = pendingPanDeltaRef.current.dx;
          const curDy = pendingPanDeltaRef.current.dy;
          pendingPanDeltaRef.current = { dx: 0, dy: 0 };
          onUpdateViewport({
            ...viewport,
            x: viewport.x + curDx,
            y: viewport.y + curDy,
          });
        });
      }
    } else if (brushSettings.mode === 'selectRegion' && selectMethod === 'freehand' && isSelectingRef.current) {
      const pt: [number, number] = (snapCoastline && snappedCoastRef.current)
        ? [snappedCoastRef.current.point[0], snappedCoastRef.current.point[1]]
        : [worldPos.x, worldPos.y];
      const last = freehandPointsRef.current[freehandPointsRef.current.length - 1];
      if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 4 / viewport.zoom) {
        freehandPointsRef.current.push(pt);
        setFreehandPoints([...freehandPointsRef.current]);
        scheduleOverlayRender();
      }
    } else if (isSelectingRef.current && selectionBox && selectMethod === 'rect') {
      const sx = selectionBox.startX;
      const sy = selectionBox.startY;
      const dx = worldPos.x - sx;
      const dy = worldPos.y - sy;
      const signX = dx >= 0 ? 1 : -1;
      const signY = dy >= 0 ? 1 : -1;

      let currentX = Math.max(0, Math.min(currentWidth, worldPos.x));
      let currentY = Math.max(0, Math.min(currentHeight, worldPos.y));

      if (regionAspect !== 'free') {
        let targetAspect = 2.0;
        if (regionAspect === '2:1') targetAspect = 2.0;
        else if (regionAspect === '1:1') targetAspect = 1.0;
        else if (regionAspect === 'current') targetAspect = currentWidth / currentHeight;

        // Base width on horizontal drag distance, clamped to borders
        const maxW = signX > 0 ? Math.max(0, currentWidth - sx) : Math.max(0, sx);
        const maxH = signY > 0 ? Math.max(0, currentHeight - sy) : Math.max(0, sy);
        const maxWFromH = maxH * targetAspect;

        const allowedW = Math.min(maxW, maxWFromH);
        const w = Math.min(Math.abs(dx), allowedW);
        const h = w / targetAspect;

        currentX = sx + signX * w;
        currentY = sy + signY * h;
      }

      setSelectionBox({
        ...selectionBox,
        currentX,
        currentY,
      });
      scheduleOverlayRender();
    } else if (brushSettings.mode === 'symbolBrush') {
      const scatterRadius = symbolToolSettings?.scatterRadius ?? 60;
      const minStep = Math.max(8, Math.min(24, scatterRadius * 0.25));
      if (Math.hypot(worldPos.x - lastWorldPosRef.current.x, worldPos.y - lastWorldPosRef.current.y) >= minStep) {
        const symList = activeStrokeSymbolsRef.current;
        const isCustom = symbolToolSettings?.selectedType === 'custom' || !!symbolToolSettings?.selectedCustomAssetId;
        const type = isCustom ? 'custom' : (symbolToolSettings?.selectedType || 'tree_pine_cluster');
        const customAssetId = isCustom ? (symbolToolSettings?.selectedCustomAssetId || customAssets?.[0]?.id) : undefined;
        const density = symbolToolSettings?.density ?? 3;
        const baseScale = symbolToolSettings?.scale ?? 1.0;
        const randomVar = symbolToolSettings?.randomScaleVar ?? 0.15;
        const added = scatterSymbolsUnderBrush(
          worldPos.x,
          worldPos.y,
          type,
          scatterRadius,
          density,
          symList,
          customAssetId,
          baseScale,
          randomVar,
          terrainContext
        );
        if (added.length > 0) {
          onUpdateSymbols?.([...symList]);
        }
        lastWorldPosRef.current = worldPos;
      }
      scheduleOverlayRender();
    } else if (brushSettings.mode === 'symbolEraser') {
      const symList = activeStrokeSymbolsRef.current;
      const rad = symbolToolSettings?.scatterRadius ?? brushSettings.radius;
      const remaining = symList.filter((s) => Math.hypot(s.x - worldPos.x, s.y - worldPos.y) > rad);
      if (remaining.length !== symList.length) {
        activeStrokeSymbolsRef.current = remaining;
        onUpdateSymbols?.(remaining);
      }
      scheduleOverlayRender();
    } else if (brushSettings.mode === 'biomePaint' || brushSettings.mode === 'biomeErase') {
      const grid = getOrCreateBiomeGrid();
      const isErase = brushSettings.mode === 'biomeErase';
      const biomeId = isErase ? 0 : (biomeSettings?.selectedBiomeId ?? 1);
      const softness = isErase ? 0 : (biomeSettings?.softness ?? 40);
      const options = {
        softness,
        landOnly: isErase ? false : (biomeSettings?.landOnly ?? true),
        elevationGrid: currentElevation,
        seaLevel: currentSeaLevel,
      };

      const result = paintBiomeCircle(
        grid,
        currentCols,
        currentRows,
        currentWidth,
        currentHeight,
        worldPos.x,
        worldPos.y,
        brushSettings.radius,
        biomeId,
        softness,
        options,
        { prevX: lastWorldPosRef.current.x, prevY: lastWorldPosRef.current.y }
      );

      for (const ch of result.changes) {
        const existing = activeBiomeStrokeRef.current.get(ch.gridIndex);
        if (!existing) {
          activeBiomeStrokeRef.current.set(ch.gridIndex, { prev: ch.prev, next: ch.next });
        } else {
          existing.next = ch.next;
        }
      }

      if (result.changes.length > 0) {
        updateBiomeSubRegion(result.changes, result.bounds);
      }

      const activeList = biomeTypes || mapData.biomeTypes || DEFAULT_BIOME_TYPES;
      const activeBiome = activeList.find((b) => b.slot === biomeId);

      if (!isErase && activeBiome && activeBiome.symbols && activeBiome.symbols.length > 0 && (activeBiome.density ?? 50) > 0) {
        const minDist = Math.max(2, activeBiome.minDistance ?? 8);
        const minStep = Math.max(6, Math.min(24, minDist * 0.75));
        if (Math.hypot(worldPos.x - lastSymbolWorldPosRef.current.x, worldPos.y - lastSymbolWorldPosRef.current.y) >= minStep) {
          const added = scatterSymbolsForBiomeStroke(
            worldPos.x,
            worldPos.y,
            brushSettings.radius,
            activeBiome,
            activeStrokeSymbolsRef.current,
            grid,
            currentCols,
            currentRows,
            currentWidth,
            currentHeight,
            currentElevation,
            currentSeaLevel,
            options.landOnly,
            customAssets
          );
          if (added.length > 0) {
            onUpdateSymbols?.([...activeStrokeSymbolsRef.current]);
          }
          lastSymbolWorldPosRef.current = worldPos;
        }
      } else if (isErase && activeStrokeSymbolsRef.current.length > 0) {
        const filtered = activeStrokeSymbolsRef.current.filter((s) => {
          if (s.autoBiomeSlot !== undefined) {
            return Math.hypot(s.x - worldPos.x, s.y - worldPos.y) > brushSettings.radius;
          }
          return true;
        });
        if (filtered.length !== activeStrokeSymbolsRef.current.length) {
          activeStrokeSymbolsRef.current = filtered;
          onUpdateSymbols?.(filtered);
        }
      }

      renderOverlay();
      lastWorldPosRef.current = worldPos;
    } else if (brushSettings.mode === 'biomeFill') {
      // Flood fill is triggered on click (mouseDown)
    } else {
      executeBrushStroke(worldPos.x, worldPos.y, {
        prevX: lastWorldPosRef.current.x,
        prevY: lastWorldPosRef.current.y,
      });
      lastWorldPosRef.current = worldPos;
    }
  };

  // Mouse Up
  const handleMouseUp = (e?: React.MouseEvent) => {
    // Town Drag End / Marquee Commit
    if (activeRegionalMap?.kind === 'town' && townDragRef.current) {
      const drag = townDragRef.current;
      townDragRef.current = null;

      if (drag.type === 'marquee') {
        if (townMarqueeBox) {
          const minX = Math.min(townMarqueeBox.startX, townMarqueeBox.currentX);
          const maxX = Math.max(townMarqueeBox.startX, townMarqueeBox.currentX);
          const minY = Math.min(townMarqueeBox.startY, townMarqueeBox.currentY);
          const maxY = Math.max(townMarqueeBox.startY, townMarqueeBox.currentY);

          if (maxX - minX > 2 || maxY - minY > 2) {
            const inRect = objectsInRect(townObjects, { minX, minY, maxX, maxY });
            const foundIds = inRect.map((o) => o.id);
            const finalIds = e?.shiftKey
              ? Array.from(new Set([...effectiveTownSelectedIds, ...foundIds]))
              : foundIds;
            onSelectTownObjectIds?.(finalIds);
            onSelectTownObjectId?.(finalIds[0] ?? null);
          }
          setTownMarqueeBox(null);
        }
        renderPreviewOverlay();
        return;
      }

      if (drag.hasMoved && drag.draftObjects) {
        const desc =
          drag.type === 'translate'
            ? '町部品の移動'
            : drag.type === 'vertex'
            ? '頂点の編集'
            : drag.type === 'rotate'
            ? '町部品の回転'
            : '城門の移動';

        townPerf.startConfirmation(desc);
        onCommitHistory({
          description: desc,
          timestamp: Date.now(),
          townChanges: {
            prevObjects: drag.initialObjects,
            newObjects: drag.draftObjects,
          },
        });
        onUpdateTownObjects?.(drag.draftObjects);
        scheduleOverlayRender();
        renderPreviewOverlay();
        return;
      }
      scheduleOverlayRender();
      renderPreviewOverlay();
      return;
    }

    if (isDraggingCompassRef.current) {
      isDraggingCompassRef.current = false;
      renderOverlay();
    }

    if (isDraggingSymbolRef.current) {
      isDraggingSymbolRef.current = false;
      if (symbolStrokeSnapshotRef.current.length > 0) {
        onCommitHistory({
          description: 'シンボル移動',
          timestamp: Date.now(),
          symbolChanges: {
            prevSymbols: symbolStrokeSnapshotRef.current,
            newSymbols: symbols || [],
          },
        });
      }
      renderOverlay();
    }

    if (brushSettings.mode === 'symbolBrush' || brushSettings.mode === 'symbolEraser') {
      if (symbolStrokeSnapshotRef.current.length > 0) {
        const committedSymbols = activeStrokeSymbolsRef.current.length > 0
          ? activeStrokeSymbolsRef.current
          : (symbols || []);
        onCommitHistory({
          description: brushSettings.mode === 'symbolBrush' ? 'シンボル散布ペイント' : 'シンボル消去',
          timestamp: Date.now(),
          symbolChanges: {
            prevSymbols: symbolStrokeSnapshotRef.current,
            newSymbols: committedSymbols,
          },
        });
      }
      symbolStrokeSnapshotRef.current = [];
      isSymbolStrokeActiveRef.current = false;
      activeStrokeSymbolsRef.current = [];
    }

    // Commit active biome stroke & auto-scattered symbols
    if (brushSettings.mode === 'biomePaint' || brushSettings.mode === 'biomeErase') {
      const biomeChanges: { gridIndex: number; prev: number; next: number }[] = [];
      if (activeBiomeStrokeRef.current.size > 0) {
        for (const [gridIndex, { prev, next }] of activeBiomeStrokeRef.current.entries()) {
          if (prev !== next) {
            biomeChanges.push({ gridIndex, prev, next });
          }
        }
      }

      let symbolChanges: { prevSymbols: MapSymbolInstance[]; newSymbols: MapSymbolInstance[] } | undefined = undefined;
      if (symbolStrokeSnapshotRef.current.length > 0) {
        const prevSyms = symbolStrokeSnapshotRef.current;
        const currSyms = activeStrokeSymbolsRef.current.length > 0
          ? activeStrokeSymbolsRef.current
          : (symbols || []);
        if (prevSyms.length !== currSyms.length || prevSyms.some((s, idx) => s !== currSyms[idx])) {
          symbolChanges = {
            prevSymbols: prevSyms,
            newSymbols: currSyms,
          };
        }
      }

      if (biomeChanges.length > 0 || symbolChanges) {
        const isErase = brushSettings.mode === 'biomeErase';
        const activeList = biomeTypes || mapData.biomeTypes || DEFAULT_BIOME_TYPES;
        const bName = activeList.find((b) => b.slot === (biomeSettings?.selectedBiomeId ?? 1))?.name || '';
        onCommitHistory({
          description: isErase ? '地形タイプ消去' : `地形タイプ塗り (${bName})`,
          timestamp: Date.now(),
          biomeChanges: biomeChanges.length > 0 ? biomeChanges : undefined,
          symbolChanges,
        });
      }

      activeBiomeStrokeRef.current.clear();
      isSymbolStrokeActiveRef.current = false;
      symbolStrokeSnapshotRef.current = [];
      activeStrokeSymbolsRef.current = [];
    }

    // Commit water dragging history
    if (waterDragRef.current) {
      const drag = waterDragRef.current;
      if (drag.hasMoved) {
        if (drag.waterType === 'river') {
          onCommitHistory({
            description: drag.type === 'vertex' ? '河川頂点の移動' : '河川の移動',
            timestamp: Date.now(),
            waterChanges: {
              prevRivers: drag.initialRiver
                ? effectiveRivers.map((r) => (r.id === drag.id ? drag.initialRiver! : r))
                : effectiveRivers,
              newRivers: effectiveRivers,
            },
          });
        } else {
          onCommitHistory({
            description: drag.type === 'vertex' ? '湖頂点の移動' : '湖の移動',
            timestamp: Date.now(),
            waterChanges: {
              prevLakes: drag.initialLake
                ? effectiveLakes.map((l) => (l.id === drag.id ? drag.initialLake! : l))
                : effectiveLakes,
              newLakes: effectiveLakes,
            },
          });
        }
      }
      waterDragRef.current = null;
    }

    // Organic Lake drag-drop placement
    if (brushSettings.mode === 'lake' && drawingLakeStart && waterSettings.lakeMode === 'drag') {
      const start = drawingLakeStart;
      setDrawingLakeStart(null);
      const worldPos = cursorPosRef.current || (e ? screenToWorld(e.clientX, e.clientY) : { x: start[0], y: start[1] });
      const dragDist = Math.hypot(worldPos.x - start[0], worldPos.y - start[1]);
      const radius = dragDist >= 6 ? dragDist : (waterSettings.lakeRadius || 18);
      const lakeSeed = Date.now();
      const polygon = createOrganicLake(start[0], start[1], radius, lakeSeed);
      const newLake: LakeData = {
        id: `lake_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: `湖 ${effectiveLakes.length + 1}`,
        polygon,
      };
      const nextLakes = [...effectiveLakes, newLake];
      onCommitHistory({
        description: '湖を配置',
        timestamp: Date.now(),
        waterChanges: {
          prevLakes: effectiveLakes,
          newLakes: nextLakes,
        },
      });
      onUpdateLakes?.(nextLakes);
      onSelectWater?.(newLake.id, 'lake');
      renderOverlay();
    }

    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;
    onInteractingChange?.(false);

    if (isSelectingRef.current && brushSettings.mode === 'selectRegion') {
      isSelectingRef.current = false;
      if (selectMethod === 'rect' && selectionBox) {
        const minX = Math.max(0, Math.min(selectionBox.startX, selectionBox.currentX));
        const maxX = Math.min(currentWidth, Math.max(selectionBox.startX, selectionBox.currentX));
        const minY = Math.max(0, Math.min(selectionBox.startY, selectionBox.currentY));
        const maxY = Math.min(currentHeight, Math.max(selectionBox.startY, selectionBox.currentY));

        const rawW = maxX - minX;
        const rawH = maxY - minY;
        const minThreshold = Math.max(10, currentWidth * 0.02);

        // Minimum selection threshold aligned with fitBoundsToLimits
        if (rawW >= minThreshold && rawH >= 5) {
          const fitResult = fitBoundsToLimits(
            { minX, minY, maxX, maxY },
            currentWidth,
            currentHeight
          );
          onSelectRegionBounds?.(fitResult.bounds, fitResult.adjusted);
        }
        setSelectionBox(null);
      } else if (selectMethod === 'freehand') {
        const pts = freehandPointsRef.current;
        if (pts.length >= 3) {
          const simplified = simplifyPolyline(pts, 3.0);
          if (simplified.length >= 3) {
            commitShapeSelection(simplified);
          }
        }
        setFreehandPoints([]);
        freehandPointsRef.current = [];
      }
    } else if (!isPanningRef.current && activeStrokeChangesRef.current.size > 0) {
      const changesList: { gridIndex: number; prevElevation: number; newElevation: number }[] = [];
      for (const [gIdx, record] of activeStrokeChangesRef.current.entries()) {
        changesList.push({
          gridIndex: gIdx,
          prevElevation: record.prev,
          newElevation: record.curr,
        });
      }

      onCommitHistory({
        description: `ブラシ編集 (${brushSettings.mode})`,
        timestamp: Date.now(),
        changes: changesList,
      });
    }

    if (panRafRef.current) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
    isPanningRef.current = false;
    activeStrokeChangesRef.current.clear();
    isSymbolStrokeActiveRef.current = false;
    activeStrokeSymbolsRef.current = [];
    symbolStrokeSnapshotRef.current = [];
    redraw();
  };

  const cursorClass = templatePlacement
    ? 'cursor-crosshair'
    : isDraggingCompassRef.current || isDraggingSymbolRef.current
    ? 'cursor-move'
    : isPanningRef.current
    ? 'cursor-grabbing'
    : isSpacePressed || brushSettings.mode === 'pan'
    ? 'cursor-grab'
    : brushSettings.mode === 'townSelect'
    ? 'cursor-default'
    : brushSettings.mode === 'townRoad' ||
      brushSettings.mode === 'townWall' ||
      brushSettings.mode === 'townPier' ||
      brushSettings.mode === 'townBuilding' ||
      brushSettings.mode === 'townDistrict'
    ? 'cursor-crosshair'
    : brushSettings.mode === 'stamp'
    ? 'cursor-pointer'
    : brushSettings.mode === 'symbolBrush'
    ? 'cursor-cell'
    : brushSettings.mode === 'symbolEraser'
    ? 'cursor-not-allowed'
    : 'cursor-crosshair';

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none bg-[#08111c] ${cursorClass}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        handleMouseUp();
        cursorPosRef.current = null;
        renderCursorOverlay();
      }}
      onDoubleClick={(e) => {
        if (activeRegionalMap?.kind === 'town') {
          if (
            brushSettings.mode === 'townRoad' ||
            brushSettings.mode === 'townWall' ||
            brushSettings.mode === 'townPier'
          ) {
            e.preventDefault();
            e.stopPropagation();
            if (drawingTownPoints.length >= 2) {
              let pts = drawingTownPoints;
              // If the last two points are nearly duplicate from double-clicking, discard the redundant end
              if (pts.length >= 3) {
                const pLast = pts[pts.length - 1];
                const pPrev = pts[pts.length - 2];
                if (Math.hypot(pLast[0] - pPrev[0], pLast[1] - pPrev[1]) < 12 / viewport.zoom) {
                  pts = pts.slice(0, pts.length - 1);
                }
              }
              finalizeTownDrawing(pts);
              renderOverlay();
              return;
            }
          } else if (brushSettings.mode === 'townBuilding' && townToolConfig.buildingDrawMode === 'polygon') {
            e.preventDefault();
            e.stopPropagation();
            let pts = drawingTownPoints;
            if (pts.length >= 4) {
              const pLast = pts[pts.length - 1];
              const pPrev = pts[pts.length - 2];
              if (Math.hypot(pLast[0] - pPrev[0], pLast[1] - pPrev[1]) < 12 / viewport.zoom) {
                pts = pts.slice(0, pts.length - 1);
              }
            }
            finalizeTownBuildingPolygon(pts);
            renderOverlay();
            return;
          } else if (brushSettings.mode === 'townDistrict') {
            e.preventDefault();
            e.stopPropagation();
            let pts = drawingTownPoints;
            if (pts.length >= 4) {
              const pLast = pts[pts.length - 1];
              const pPrev = pts[pts.length - 2];
              if (Math.hypot(pLast[0] - pPrev[0], pLast[1] - pPrev[1]) < 12 / viewport.zoom) {
                pts = pts.slice(0, pts.length - 1);
              }
            }
            finalizeTownDistrict(pts);
            renderOverlay();
            return;
          }
        }
        if (brushSettings.mode === 'selectRegion' && selectMethod === 'polygon' && polygonPoints.length >= 3) {
          const p0 = polygonPoints[0];
          const lastPt = polygonPoints[polygonPoints.length - 1];
          const closingTrace = followCoastline
            ? traceCoastlinePath(
                lastPt,
                p0,
                currentElevation,
                currentCols,
                currentRows,
                currentWidth,
                currentHeight,
                currentSeaLevel,
                40 / viewport.zoom
              )
            : [];
          const fullLoop = closingTrace.length > 2 ? [...polygonPoints, ...closingTrace.slice(1)] : polygonPoints;
          commitShapeSelection(fullLoop);
        }
        if (brushSettings.mode === 'river') {
          e.preventDefault();
          e.stopPropagation();
          let pts = drawingRiverPoints;
          if (pts.length >= 3) {
            const pLast = pts[pts.length - 1];
            const pPrev = pts[pts.length - 2];
            if (Math.hypot(pLast[0] - pPrev[0], pLast[1] - pPrev[1]) < 12 / viewport.zoom) {
              pts = pts.slice(0, pts.length - 1);
            }
          }
          if (pts.length >= 2) {
            finalizeRiverDrawing(pts);
            renderOverlay();
            return;
          }
        }
        if (brushSettings.mode === 'lake' && waterSettings?.lakeMode === 'polygon') {
          e.preventDefault();
          e.stopPropagation();
          let pts = drawingLakePolygon;
          if (pts.length >= 4) {
            const pLast = pts[pts.length - 1];
            const pPrev = pts[pts.length - 2];
            if (Math.hypot(pLast[0] - pPrev[0], pLast[1] - pPrev[1]) < 12 / viewport.zoom) {
              pts = pts.slice(0, pts.length - 1);
            }
          }
          if (pts.length >= 3) {
            finalizeLakePolygon(pts);
            renderOverlay();
            return;
          }
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={glCanvasRef} className="absolute inset-0 block w-full h-full" />
      <canvas ref={overlayCanvasRef} className="absolute inset-0 block w-full h-full pointer-events-none" />
      <canvas ref={cursorCanvasRef} className="absolute inset-0 block w-full h-full pointer-events-none" />

      {/* Water Panel (Rivers & Lakes) */}
      {(brushSettings.mode === 'river' ||
        brushSettings.mode === 'lake' ||
        brushSettings.mode === 'waterEdit') && (
        <WaterPanel
          mode={brushSettings.mode}
          onChangeMode={(newMode) => onUpdateBrush?.({ mode: newMode })}
          waterSettings={waterSettings}
          onChangeWaterSettings={onChangeWaterSettings || (() => {})}
          rivers={effectiveRivers}
          lakes={effectiveLakes}
          selectedWaterId={selectedWaterId}
          selectedWaterType={selectedWaterType}
          onSelectWater={onSelectWater || (() => {})}
          onUpdateRiver={(updatedRiver) => {
            const next = effectiveRivers.map((r) => (r.id === updatedRiver.id ? updatedRiver : r));
            onCommitHistory({
              description: '河川の更新',
              timestamp: Date.now(),
              waterChanges: { prevRivers: effectiveRivers, newRivers: next },
            });
            onUpdateRivers?.(next);
            renderOverlay();
          }}
          onUpdateLake={(updatedLake) => {
            const next = effectiveLakes.map((l) => (l.id === updatedLake.id ? updatedLake : l));
            onCommitHistory({
              description: '湖の更新',
              timestamp: Date.now(),
              waterChanges: { prevLakes: effectiveLakes, newLakes: next },
            });
            onUpdateLakes?.(next);
            renderOverlay();
          }}
          onDeleteWater={(id, type) => {
            if (type === 'river') {
              const next = effectiveRivers.filter((r) => r.id !== id);
              onCommitHistory({
                description: '河川の削除',
                timestamp: Date.now(),
                waterChanges: { prevRivers: effectiveRivers, newRivers: next },
              });
              onUpdateRivers?.(next);
            } else {
              const next = effectiveLakes.filter((l) => l.id !== id);
              onCommitHistory({
                description: '湖の削除',
                timestamp: Date.now(),
                waterChanges: { prevLakes: effectiveLakes, newLakes: next },
              });
              onUpdateLakes?.(next);
            }
            onSelectWater?.(null, null);
            renderOverlay();
          }}
          onClearAllWater={onClearAllWater || (() => {})}
          onClose={() => onUpdateBrush?.({ mode: 'pan' })}
          inProgressCount={brushSettings.mode === 'river' ? drawingRiverPoints.length : drawingLakePolygon.length}
          onCommitRiverDrawing={() => {
            if (brushSettings.mode === 'river' && drawingRiverPoints.length >= 2) {
              finalizeRiverDrawing(drawingRiverPoints);
            } else if (brushSettings.mode === 'lake' && drawingLakePolygon.length >= 3) {
              finalizeLakePolygon(drawingLakePolygon);
            }
          }}
          onCancelRiverDrawing={() => {
            setDrawingRiverPoints([]);
            setDrawingLakePolygon([]);
            setDrawingLakeStart(null);
            renderOverlay();
          }}
          onAutoGenerateWater={handleAutoGenerateWater}
        />
      )}

      {/* Region Shape & Selection Mode Tools Toolbar */}
      {brushSettings.mode === 'selectRegion' && (
        <RegionShapeTools
          method={selectMethod}
          onChangeMethod={(m) => {
            setSelectMethod(m);
            setPolygonPoints([]);
            setFreehandPoints([]);
            freehandPointsRef.current = [];
            setRect2Start(null);
            setSelectionBox(null);
            setConfirmedShape(null);
            setIsAutoSelectingIsland(false);
            renderOverlay();
          }}
          followCoastline={followCoastline}
          onToggleFollowCoastline={(f) => {
            setFollowCoastline(f);
            setRect2Start(null);
            setSelectionBox(null);
            setPolygonPoints([]);
            renderOverlay();
          }}
          isRect2Active={!!rect2Start}
          snapCoastline={snapCoastline}
          onToggleSnapCoastline={setSnapCoastline}
          isAutoSelectingIsland={isAutoSelectingIsland}
          onAutoSelectIsland={() => {
            setIsAutoSelectingIsland((prev) => !prev);
            renderOverlay();
          }}
          aspect={regionAspect}
          onChangeAspect={(a) => {
            setRegionAspect(a);
            renderOverlay();
          }}
          smooth={smoothShape}
          onToggleSmooth={(s) => {
            setSmoothShape(s);
            renderOverlay();
          }}
          marginPercent={marginPercent}
          onChangeMargin={(m) => {
            setMarginPercent(m);
            renderOverlay();
          }}
          polygonPointCount={polygonPoints.length}
          onFinishPolygon={() => {
            if (polygonPoints.length >= 3) {
              const p0 = polygonPoints[0];
              const lastPt = polygonPoints[polygonPoints.length - 1];
              const snapLast = (followCoastline && snapCoastline)
                ? findNearestCoastlinePoint(
                    lastPt[0],
                    lastPt[1],
                    currentElevation,
                    currentCols,
                    currentRows,
                    currentWidth,
                    currentHeight,
                    currentSeaLevel,
                    COASTLINE_SNAP_PX / viewport.zoom
                  )
                : null;
              const snapFirst = (followCoastline && snapCoastline)
                ? findNearestCoastlinePoint(
                    p0[0],
                    p0[1],
                    currentElevation,
                    currentCols,
                    currentRows,
                    currentWidth,
                    currentHeight,
                    currentSeaLevel,
                    COASTLINE_SNAP_PX / viewport.zoom
                  )
                : null;
              const canTraceClose = !!(snapLast && snapFirst && snapLast.contourIndex === snapFirst.contourIndex);
              const closingTrace = canTraceClose
                ? traceCoastlinePath(
                    lastPt,
                    p0,
                    currentElevation,
                    currentCols,
                    currentRows,
                    currentWidth,
                    currentHeight,
                    currentSeaLevel,
                    COASTLINE_SNAP_PX / viewport.zoom
                  )
                : [];
              const fullLoop = closingTrace.length > 2 ? [...polygonPoints, ...closingTrace.slice(1)] : polygonPoints;
              commitShapeSelection(fullLoop);
            }
          }}
          onCancelPolygon={() => {
            setPolygonPoints([]);
            setFreehandPoints([]);
            freehandPointsRef.current = [];
            setRect2Start(null);
            setSelectionBox(null);
            setConfirmedShape(null);
            setIsAutoSelectingIsland(false);
            renderOverlay();
          }}
          townConfig={townConfig}
          onChangeTownConfig={(patch) => {
            setTownConfig((prev) => ({ ...prev, ...patch }));
            renderOverlay();
          }}
          parentWidthKm={effectiveWidthKm}
        />
      )}

      {/* Cartographic Scale Bar (Bottom-Left) */}
      <div className="absolute bottom-3 left-4 z-20">
        <ScaleBar
          worldWidthKm={effectiveWidthKm}
          mapWidth={currentWidth}
          viewport={viewport}
        />
      </div>

      {/* Map Background Indicator Badge */}
      {mapBackgroundUrl && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-slate-900/90 border border-amber-600/60 rounded-lg px-3 py-1.5 shadow-xl text-xs text-amber-200 backdrop-blur-md pointer-events-auto">
          <span>🖼️ ドット絵背景表示中</span>
          {onClearMapBackground && (
            <button
              onClick={onClearMapBackground}
              className="ml-1 text-slate-400 hover:text-red-400 font-bold px-1.5 py-0.5 rounded hover:bg-slate-800 transition cursor-pointer"
              title="背景を解除"
            >
              ✕ 解除
            </button>
          )}
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-4 py-2 bg-slate-900/95 border border-amber-500/80 text-amber-200 text-xs font-semibold rounded-lg shadow-2xl backdrop-blur-md flex items-center gap-2">
          <span>⚠️</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
