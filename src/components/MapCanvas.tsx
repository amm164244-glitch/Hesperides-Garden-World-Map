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
import { drawSortedSymbols } from '../utils/symbolRenderer';
import { scatterSymbolsUnderBrush } from '../utils/symbolGenerator';
import { MapSymbolInstance, SymbolToolSettings, CustomMapAsset } from '../types/symbols';
import { ScaleBar } from './ScaleBar';

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
  onCommitHistory: (record: HistoryRecord) => void;
  onHoverCell: (cell: MapCell | null) => void;
  onSelectRegionBounds?: (bounds: RegionalBounds) => void;
  mapBackgroundUrl?: string | null;
  onClearMapBackground?: () => void;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({
  mapData,
  activeRegionalMap,
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
  onCommitHistory,
  onHoverCell,
  onSelectRegionBounds,
  mapBackgroundUrl,
  onClearMapBackground,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLMapRenderer | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

  // High performance RAF coalescing refs
  const panRafRef = useRef<number | null>(null);
  const pendingPanDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const wheelRafRef = useRef<number | null>(null);
  const pendingWheelZoomRef = useRef<{ mouseX: number; mouseY: number; factor: number } | null>(null);

  const [hoveredCellId, setHoveredCellId] = useState<number | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const cursorPosRef = useRef<{ x: number; y: number } | null>(null);

  // Region selection rectangle drag
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Active map properties (Regional vs World)
  const isRegion = activeRegionalMap !== null;
  const currentWidth = isRegion ? activeRegionalMap.width : mapData.width;
  const currentHeight = isRegion ? activeRegionalMap.height : mapData.height;
  const currentCols = isRegion ? activeRegionalMap.gridCols : mapData.gridCols;
  const currentRows = isRegion ? activeRegionalMap.gridRows : mapData.gridRows;
  const currentElevation = isRegion ? activeRegionalMap.elevationGrid : mapData.elevationGrid;
  const currentTemperature = isRegion ? activeRegionalMap.temperatureGrid : mapData.temperatureGrid;
  const currentSeaLevel = isRegion ? activeRegionalMap.seaLevel : mapData.seaLevel;

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
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastWorldPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const activeStrokeChangesRef = useRef<Map<number, { prev: number; curr: number }>>(new Map());

  // Initialize WebGL Renderer
  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;

    try {
      rendererRef.current = new WebGLMapRenderer(glCanvas);
      rendererRef.current.updateGridTextures(
        currentElevation,
        currentTemperature,
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
        currentTemperature,
        currentCols,
        currentRows
      );
    }
  }, [currentElevation, currentTemperature, currentCols, currentRows]);

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
        currentTemperature,
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
    currentTemperature,
    currentSeaLevel,
    viewport,
    viewMode,
    showShading,
    showRipples,
  ]);

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

    // 2. Region Selection Box (if selecting)
    if (selectionBox) {
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
          ctx.strokeStyle = 'rgba(70, 180, 240, 0.8)';
          ctx.lineWidth = 1.8 / viewport.zoom;
          ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);
          ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

          ctx.fillStyle = 'rgba(70, 180, 240, 0.1)';
          ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

          ctx.fillStyle = '#93c5fd';
          ctx.font = `${Math.max(10, 13 / viewport.zoom)}px sans-serif`;
          ctx.fillText(reg.name, b.minX + 4 / viewport.zoom, b.minY + 14 / viewport.zoom);
        }
        ctx.restore();
      }
    }

    // 4. Cartographic Tolkien-style Symbols (Mountains, Forests, Settlements, Maritime)
    if (showSymbols && symbols && symbols.length > 0) {
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
        symbols,
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
  ]);

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
    const radius = brushSettings.radius;
    const active = isMouseDownRef.current && !isPanningRef.current;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = active ? 'rgba(215, 65, 35, 0.95)' : 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = (active ? 2.5 : 1.5) / viewport.zoom;
    ctx.stroke();

    ctx.fillStyle = active ? 'rgba(215, 65, 35, 0.16)' : 'rgba(255, 255, 255, 0.05)';
    ctx.fill();

    ctx.restore();
  }, [viewport, brushSettings.mode, brushSettings.radius]);

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
  }, [selectedSymbolId, symbols, onCommitHistory, onUpdateSymbols, onSelectSymbolId]);

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

          const newZoom = Math.max(0.15, Math.min(12.0, viewport.zoom * factor));
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
  }, [viewport, onUpdateViewport]);

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
            currentTemperature,
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
      currentTemperature,
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
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    const worldPos = screenToWorld(e.clientX, e.clientY);
    lastWorldPosRef.current = worldPos;

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
        const hitR = 24 * (s.scale || 1.0);
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
        const isCustom = symbolToolSettings?.selectedType === 'custom';
        const newSym: MapSymbolInstance = {
          id: `sym_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type: symbolToolSettings?.selectedType || 'mountain_snow',
          customAssetId: isCustom ? symbolToolSettings?.selectedCustomAssetId || undefined : undefined,
          x: Math.round(worldPos.x),
          y: Math.round(worldPos.y),
          scale: symbolToolSettings?.scale || 1.0,
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
      const symList = [...(symbols || [])];
      symbolStrokeSnapshotRef.current = symList;
      const type = symbolToolSettings?.selectedType || 'tree_pine_cluster';
      const customAssetId = type === 'custom' ? symbolToolSettings?.selectedCustomAssetId || undefined : undefined;
      const added = scatterSymbolsUnderBrush(
        worldPos.x,
        worldPos.y,
        type,
        brushSettings.radius,
        symbolToolSettings?.density || 3,
        symList,
        customAssetId
      );
      if (added.length > 0) {
        onUpdateSymbols?.(symList);
      }
      return;
    }

    if (brushSettings.mode === 'symbolEraser') {
      const symList = symbols || [];
      symbolStrokeSnapshotRef.current = [...symList];
      const rad = brushSettings.radius;
      const remaining = symList.filter((s) => Math.hypot(s.x - worldPos.x, s.y - worldPos.y) > rad);
      if (remaining.length !== symList.length) {
        onUpdateSymbols?.(remaining);
      }
      return;
    }

    const isPanAction =
      brushSettings.mode === 'pan' ||
      isSpacePressed ||
      e.button === 1 ||
      e.button === 2;

    if (isPanAction) {
      isPanningRef.current = true;
    } else if (brushSettings.mode === 'selectRegion') {
      isSelectingRef.current = true;
      setSelectionBox({
        startX: worldPos.x,
        startY: worldPos.y,
        currentX: worldPos.x,
        currentY: worldPos.y,
      });
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
      const nextSymbols = symList.map((s) =>
        s.id === selectedSymbolId ? { ...s, x: newX, y: newY } : s
      );
      onUpdateSymbols?.(nextSymbols);
      renderOverlay();
      return;
    }

    if (!isMouseDownRef.current) {
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
    } else if (isSelectingRef.current && selectionBox) {
      setSelectionBox({
        ...selectionBox,
        currentX: worldPos.x,
        currentY: worldPos.y,
      });
      renderOverlay();
    } else if (brushSettings.mode === 'symbolBrush') {
      if (Math.hypot(worldPos.x - lastWorldPosRef.current.x, worldPos.y - lastWorldPosRef.current.y) >= 16) {
        const symList = [...(symbols || [])];
        const isCustom = symbolToolSettings?.selectedType === 'custom' || !!symbolToolSettings?.selectedCustomAssetId;
        const type = isCustom ? 'custom' : (symbolToolSettings?.selectedType || 'custom');
        const customAssetId = isCustom ? (symbolToolSettings?.selectedCustomAssetId || customAssets?.[0]?.id) : undefined;
        const added = scatterSymbolsUnderBrush(
          worldPos.x,
          worldPos.y,
          type,
          brushSettings.radius,
          symbolToolSettings?.density || 3,
          symList,
          customAssetId
        );
        if (added.length > 0) {
          onUpdateSymbols?.(symList);
        }
        lastWorldPosRef.current = worldPos;
      }
      renderOverlay();
    } else if (brushSettings.mode === 'symbolEraser') {
      const symList = symbols || [];
      const rad = brushSettings.radius;
      const remaining = symList.filter((s) => Math.hypot(s.x - worldPos.x, s.y - worldPos.y) > rad);
      if (remaining.length !== symList.length) {
        onUpdateSymbols?.(remaining);
      }
      renderOverlay();
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
        onCommitHistory({
          description: brushSettings.mode === 'symbolBrush' ? 'シンボル散布ペイント' : 'シンボル消去',
          timestamp: Date.now(),
          symbolChanges: {
            prevSymbols: symbolStrokeSnapshotRef.current,
            newSymbols: symbols || [],
          },
        });
      }
      symbolStrokeSnapshotRef.current = [];
    }

    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;

    if (isSelectingRef.current && selectionBox) {
      isSelectingRef.current = false;
      const minX = Math.max(0, Math.min(selectionBox.startX, selectionBox.currentX));
      const maxX = Math.min(currentWidth, Math.max(selectionBox.startX, selectionBox.currentX));
      const minY = Math.max(0, Math.min(selectionBox.startY, selectionBox.currentY));
      const maxY = Math.min(currentHeight, Math.max(selectionBox.startY, selectionBox.currentY));

      // Minimum selection threshold 40px
      if (maxX - minX > 40 && maxY - minY > 20) {
        onSelectRegionBounds?.({ minX, minY, maxX, maxY });
      }
      setSelectionBox(null);
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
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={glCanvasRef} className="absolute inset-0 block w-full h-full" />
      <canvas ref={overlayCanvasRef} className="absolute inset-0 block w-full h-full pointer-events-none" />
      <canvas ref={cursorCanvasRef} className="absolute inset-0 block w-full h-full pointer-events-none" />

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
