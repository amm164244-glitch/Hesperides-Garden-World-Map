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
  drawDecorativeBorder,
  drawAntiqueScaleBar,
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
} from '../utils/regionShape';
import {
  findNearestCoastlinePoint,
  traceCoastlinePath,
  findEnclosingIslandContour,
  CoastlineSnapResult,
} from '../utils/coastlineSelection';
import { TownObject } from '../types/town';
import { drawTownObjects } from '../utils/town/townRenderer';

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
  showBorder?: boolean;
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
    options?: { kind?: 'region' | 'town'; name?: string; detailScale?: number }
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
  onUpdateTownObjects?: (objects: TownObject[]) => void;
}

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
  showBorder = true,
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
  onUpdateTownObjects,
  biomeSettings,
  onCommitHistory,
  onHoverCell,
  onSelectRegionBounds,
  onSelectRegionMap,
  mapBackgroundUrl,
  onClearMapBackground,
  maxZoom,
  onInteractingChange,
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
  const [followCoastline, setFollowCoastline] = useState<boolean>(true);
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

  // Commits a shape (polygon / freehand) selection, calculates bounds with margin, and fits to limits
  const commitShapeSelection = useCallback(
    (rawPolygon: [number, number][]) => {
      if (rawPolygon.length < 3) return;
      const poly = smoothShape ? smoothPolygon(rawPolygon, 4) : [...rawPolygon];
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

    const dpr = overlayCanvas.clientWidth > 0
      ? overlayCanvas.width / overlayCanvas.clientWidth
      : Math.min(window.devicePixelRatio || 1, 2.0);
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    ctx.save();
    ctx.setTransform(viewport.zoom * dpr, 0, 0, viewport.zoom * dpr, viewport.x * dpr, viewport.y * dpr);

    const cPos = compassPos || { x: currentWidth * 0.12, y: currentHeight * 0.28 };

    // 0. Pixel Art Scenic Backdrop or Map Reference Image
    if (bgImageRef.current && bgImageRef.current.complete && bgImageRef.current.naturalWidth > 0) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(bgImageRef.current, 0, 0, currentWidth, currentHeight);
      ctx.restore();
    }

    // 0.5. Semi-transparent Biome Grid Overlay
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

    // 1. Nautical Navigation Rhumb Lines (Loxodromes)
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
        const shouldTraceCoast = selectMethod === 'polygon' && followCoastline;
        const rubberPath = shouldTraceCoast
          ? traceCoastlinePath(
              lastPt,
              [curPos.x, curPos.y],
              currentElevation,
              currentCols,
              currentRows,
              currentWidth,
              currentHeight,
              currentSeaLevel,
              35 / viewport.zoom
            )
          : [[lastPt[0], lastPt[1]], [curPos.x, curPos.y]];

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

    // 3.5. Town Objects (Districts, Roads, Piers, Buildings, Fortified Walls)
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
      drawTownObjects(ctx, townObjects, {
        metersPerUnit,
        zoomPx: viewport.zoom * dpr,
        viewBounds,
        selectedId: selectedTownObjectId,
      });
    }

    // 4. Cartographic Tolkien-style Symbols (Mountains, Forests, Settlements, Maritime)
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

    // 5. Antique Brass & Crimson Compass Rose
    if (showCompass) {
      drawCompassRose(ctx, cPos.x, cPos.y, 72, viewport.zoom * dpr);
    }

    // 6. Antique Double Border with Filigree Corners & Scale Bar
    if (showBorder) {
      drawDecorativeBorder(ctx, currentWidth, currentHeight, viewport.zoom * dpr);
      drawAntiqueScaleBar(
        ctx,
        42,
        currentHeight - 56,
        currentWidth,
        effectiveWidthKm,
        viewport.zoom * dpr
      );
    } else {
      ctx.strokeStyle = '#3d2e20';
      ctx.lineWidth = 3 / (viewport.zoom * dpr);
      ctx.strokeRect(0, 0, currentWidth, currentHeight);
    }

    ctx.restore();
  }, [
    viewport,
    selectionBox,
    polygonPoints,
    freehandPoints,
    confirmedShape,
    isRegion,
    activeRegionalMap,
    mapData.regionalMaps,
    currentWidth,
    currentHeight,
    showCompass,
    showBorder,
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
  ]);

  // Keep offscreen biome canvas in sync when map switches or biomeGrid reference updates
  useEffect(() => {
    rebuildBiomeCanvas(currentBiomeGrid, currentCols, currentRows);
    renderOverlay();
  }, [currentBiomeGrid, currentCols, currentRows, rebuildBiomeCanvas, renderOverlay]);

  // 3. Render 2D Cursor Overlay (brush circle, stamp ghost - ultra-fast, only on mouse position update)
  const renderCursorOverlay = useCallback(() => {
    const cursorCanvas = cursorCanvasRef.current;
    if (!cursorCanvas) return;
    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    const dpr = cursorCanvas.clientWidth > 0
      ? cursorCanvas.width / cursorCanvas.clientWidth
      : Math.min(window.devicePixelRatio || 1, 2.0);
    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    const curPos = cursorPosRef.current;
    if (!curPos || brushSettings.mode === 'pan' || brushSettings.mode === 'selectRegion') {
      return;
    }

    ctx.save();
    ctx.setTransform(viewport.zoom * dpr, 0, 0, viewport.zoom * dpr, viewport.x * dpr, viewport.y * dpr);

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

    ctx.restore();
  }, [viewport, brushSettings.mode, brushSettings.radius, symbolToolSettings?.scatterRadius]);

  // Unified redraw
  const redraw = useCallback(() => {
    renderWebGL();
    renderOverlay();
    renderCursorOverlay();
  }, [renderWebGL, renderOverlay, renderCursorOverlay]);

  // Load background image when mapBackgroundUrl changes
  useEffect(() => {
    if (!mapBackgroundUrl) {
      bgImageRef.current = null;
      renderOverlay();
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = mapBackgroundUrl;
    img.onload = () => {
      bgImageRef.current = img;
      renderOverlay();
    };
  }, [mapBackgroundUrl, renderOverlay]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Redraw overlay whenever a newly referenced custom pixel asset finishes loading
  useEffect(() => {
    setCustomImageLoadedCallback(() => {
      renderOverlay();
    });
    return () => {
      setCustomImageLoadedCallback(null);
    };
  }, [renderOverlay]);

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
        const clickPt: [number, number] = ((snapCoastline || followCoastline) && snappedCoastRef.current)
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
        const clickPt: [number, number] = ((snapCoastline || followCoastline) && snappedCoastRef.current)
          ? [snappedCoastRef.current.point[0], snappedCoastRef.current.point[1]]
          : [worldPos.x, worldPos.y];

        // If clicking near first vertex and length >= 3, close and commit
        if (polygonPoints.length >= 3) {
          const p0 = polygonPoints[0];
          const distToFirst = Math.hypot(clickPt[0] - p0[0], clickPt[1] - p0[1]);
          if (distToFirst <= 18 / viewport.zoom) {
            const closingTrace = followCoastline
              ? traceCoastlinePath(
                  polygonPoints[polygonPoints.length - 1],
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
            return;
          }
        }

        if (polygonPoints.length === 0) {
          setPolygonPoints([clickPt]);
        } else {
          if (followCoastline) {
            const lastPt = polygonPoints[polygonPoints.length - 1];
            const traced = traceCoastlinePath(
              lastPt,
              clickPt,
              currentElevation,
              currentCols,
              currentRows,
              currentWidth,
              currentHeight,
              currentSeaLevel,
              40 / viewport.zoom
            );
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

    const isCoastlineAssisted = (
      brushSettings.mode === 'selectRegion' && (
        snapCoastline ||
        ((selectMethod === 'rect2' || selectMethod === 'polygon') && followCoastline) ||
        isAutoSelectingIsland
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
        28 / viewport.zoom
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
      renderOverlay();
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
      renderOverlay();
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
          renderOverlay();
        } else if (selectMethod === 'polygon' && polygonPoints.length > 0) {
          renderOverlay();
        } else if (isCoastlineAssisted) {
          renderOverlay();
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
        renderOverlay();
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
      renderOverlay();
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
      renderOverlay();
    } else if (brushSettings.mode === 'symbolEraser') {
      const symList = activeStrokeSymbolsRef.current;
      const rad = symbolToolSettings?.scatterRadius ?? brushSettings.radius;
      const remaining = symList.filter((s) => Math.hypot(s.x - worldPos.x, s.y - worldPos.y) > rad);
      if (remaining.length !== symList.length) {
        activeStrokeSymbolsRef.current = remaining;
        onUpdateSymbols?.(remaining);
      }
      renderOverlay();
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
  const handleMouseUp = () => {
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

  const cursorClass = isDraggingCompassRef.current || isDraggingSymbolRef.current
    ? 'cursor-move'
    : isPanningRef.current
    ? 'cursor-grabbing'
    : isSpacePressed || brushSettings.mode === 'pan'
    ? 'cursor-grab'
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
      onDoubleClick={() => {
        if (brushSettings.mode === 'selectRegion' && (selectMethod === 'polygon' || selectMethod === 'coastline') && polygonPoints.length >= 3) {
          commitShapeSelection(polygonPoints);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={glCanvasRef} className="absolute inset-0 block w-full h-full" />
      <canvas ref={overlayCanvasRef} className="absolute inset-0 block w-full h-full pointer-events-none" />
      <canvas ref={cursorCanvasRef} className="absolute inset-0 block w-full h-full pointer-events-none" />

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
              commitShapeSelection(polygonPoints);
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

      {/* Cartographic Scale Bar (Bottom-Left) if outer border is turned off */}
      {!showBorder && (
        <div className="absolute bottom-3 left-4 z-20">
          <ScaleBar
            worldWidthKm={effectiveWidthKm}
            mapWidth={currentWidth}
            viewport={viewport}
          />
        </div>
      )}

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
    </div>
  );
};
