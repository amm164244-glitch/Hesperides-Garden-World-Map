import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Sparkles, Map as MapIcon, Sliders, Globe, Layers } from 'lucide-react';
import {
  BrushMode,
  BrushSettings,
  GeneratorConfig,
  HistoryRecord,
  MapCell,
  MapData,
  RegionalBounds,
  RegionalMapData,
  ShapeMaskConfig,
  ViewMode,
  Viewport,
} from './types/map';
import { generateTectonicWorld, generateBlankOceanWorld } from './utils/tectonicGenerator';
import { generateRegionalMap, toParentMapSource } from './utils/regionGenerator';
import {
  isUniformChild,
  parentToChildViewport,
  childToParentViewport,
  findChildToEnter,
  shouldExitToParent,
  getMaxZoomForMap,
} from './utils/regionNavigation';
import { SpatialIndex } from './utils/terrainEditor';
import { Toolbar } from './components/Toolbar';
import { GeneratorPanel } from './components/GeneratorPanel';
import { MapCanvas } from './components/MapCanvas';
import { InspectorBar } from './components/InspectorBar';
import { MapStorageModal } from './components/MapStorageModal';
import { RegionSelector } from './components/RegionSelector';
import { SymbolPalette } from './components/SymbolPalette';
import { BiomePalette } from './components/BiomePalette';
import { PixelArtStudioModal } from './components/PixelArtStudioModal';
import { ImageToPixelModal } from './components/ImageToPixelModal';
import { ImageToTerrainModal, CroppedTerrainResult } from './components/ImageToTerrainModal';
import { BiomeTypeEditor } from './components/BiomeTypeEditor';
import { BiomeType, DEFAULT_BIOME_TYPES } from './types/biome';
import {
  MapSymbolInstance,
  SymbolToolSettings,
  CustomMapAsset,
  CustomSymbolCategory,
  DEFAULT_CUSTOM_CATEGORIES,
  DEFAULT_SYMBOL_COLOR_THEME,
} from './types/symbols';
import {
  getInitialAssetsFromLocalStorage,
  getInitialCategoriesFromLocalStorage,
  loadPersistentAssets,
  persistCustomAssets,
  persistCustomCategories,
  exportSymbolLibraryToJson,
} from './utils/assetStorage';

// Global Planetary 2:1 Aspect Ratio
export const getResolutionDimensions = (gridRes: string) => {
  switch (gridRes) {
    case '8192x4096':
      return { width: 8192, height: 4096 };
    case '4096x2048':
      return { width: 4096, height: 2048 };
    case '2048x1024':
      return { width: 2048, height: 1024 };
    case '1024x512':
    default:
      return { width: 2000, height: 1000 };
  }
};

export default function App() {
  // Planetary World configuration (1024x512 fast, high-performance Float32Array)
  const [config, setConfig] = useState<GeneratorConfig>({
    seed: 738491,
    gridResolution: '1024x512',
    worldWidthKm: 40000,
    plateCount: 12,
    seaRatio: 60,
    continentCount: 4, // Eurasia + N.America + Antarctica + Australia scale
    continentSize: 6,
    mountainStrength: 6,
    islandDensity: 5,
    minIslandArea: 15,
    erosionIterations: 15,
    erosionStrength: 5,
  });

  // Toolbar collapsed state persisted in localStorage
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fantasy_map_toolbar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleCollapse = useCallback(() => {
    setIsToolbarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('fantasy_map_toolbar_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  // World Map state
  const [mapData, setMapData] = useState<MapData>(() => {
    const dims = getResolutionDimensions('1024x512');
    const initial = generateTectonicWorld(dims.width, dims.height, {
      seed: 738491,
      gridResolution: '1024x512',
      worldWidthKm: 40000,
      plateCount: 12,
      seaRatio: 60,
      continentCount: 4,
      continentSize: 6,
      mountainStrength: 6,
      islandDensity: 5,
      minIslandArea: 15,
      erosionIterations: 15,
      erosionStrength: 5,
    });
    return {
      ...initial,
      symbols: [],
      biomeTypes: DEFAULT_BIOME_TYPES,
    };
  });

  // Active Hierarchical Map state: null = World Map, or region ID
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const activeRegionalMap = useMemo(() => {
    return activeRegionId && mapData.regionalMaps[activeRegionId]
      ? mapData.regionalMaps[activeRegionId]
      : null;
  }, [activeRegionId, mapData.regionalMaps]);

  // Current active map symbols (derived from active regional map or world map)
  const currentSymbols = useMemo(() => {
    if (activeRegionId && mapData.regionalMaps[activeRegionId]) {
      return mapData.regionalMaps[activeRegionId].symbols || [];
    }
    return mapData.symbols || [];
  }, [activeRegionId, mapData.regionalMaps, mapData.symbols]);

  // Biome Types (Custom terrain types, initialized from mapData or default 7 types)
  const [biomeTypes, setBiomeTypes] = useState<BiomeType[]>(() => {
    return mapData.biomeTypes && mapData.biomeTypes.length > 0
      ? mapData.biomeTypes
      : DEFAULT_BIOME_TYPES;
  });
  const [isBiomeTypeEditorOpen, setIsBiomeTypeEditorOpen] = useState<boolean>(false);

  const handleSaveBiomeTypes = useCallback((updated: BiomeType[], removedSlots: number[]) => {
    setBiomeTypes(updated);
    setMapData((prev) => {
      // If any slots were removed, sanitize grids across world and regional maps
      if (removedSlots.length > 0) {
        const removedSet = new Set(removedSlots);
        if (prev.biomeGrid) {
          const bg = prev.biomeGrid;
          for (let i = 0; i < bg.length; i++) {
            if (removedSet.has(bg[i])) {
              bg[i] = 0;
            }
          }
        }
        if (prev.regionalMaps) {
          for (const reg of Object.values(prev.regionalMaps)) {
            if (reg.biomeGrid) {
              const bg = reg.biomeGrid;
              for (let i = 0; i < bg.length; i++) {
                if (removedSet.has(bg[i])) {
                  bg[i] = 0;
                }
              }
            }
          }
        }
      }
      return {
        ...prev,
        biomeTypes: updated,
      };
    });

    // If active selectedBiomeId was removed, point to first available biome
    setBiomeSettings((prev) => {
      if (removedSlots.includes(prev.selectedBiomeId)) {
        return {
          ...prev,
          selectedBiomeId: updated[0]?.slot ?? 1,
        };
      }
      return prev;
    });

    // Clear history if slots were removed to prevent restoring invalid cells
    if (removedSlots.length > 0) {
      setUndoStack([]);
      setRedoStack([]);
    }
  }, []);

  // Update symbols for the currently active map (World or Regional)
  const handleUpdateSymbols = useCallback(
    (nextSymbols: MapSymbolInstance[]) => {
      setMapData((prev) => {
        if (activeRegionId && prev.regionalMaps[activeRegionId]) {
          return {
            ...prev,
            regionalMaps: {
              ...prev.regionalMaps,
              [activeRegionId]: {
                ...prev.regionalMaps[activeRegionId],
                symbols: nextSymbols,
              },
            },
          };
        }
        return {
          ...prev,
          symbols: nextSymbols,
        };
      });
    },
    [activeRegionId]
  );

  // Pending Region Selection Bounds for modal prompt
  const [pendingRegionInfo, setPendingRegionInfo] = useState<{
    bounds: RegionalBounds;
    adjusted: boolean;
    shapePolygon?: [number, number][];
  } | null>(null);

  // Spatial index for fast queries
  const spatialIndex = useMemo(() => new SpatialIndex(mapData.cells), [mapData.cells]);

  // Viewport (pan and zoom)
  const [viewport, setViewport] = useState<Viewport>(() => {
    const defaultDims = getResolutionDimensions('1024x512');
    const zoom = 0.65;
    const x = Math.max(20, (window.innerWidth - defaultDims.width * zoom) / 2);
    const y = Math.max(20, (window.innerHeight - defaultDims.height * zoom) / 2);
    return { x, y, zoom };
  });

  // Tool & Brush settings
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    mode: 'elevate',
    radius: 75,
    strength: 0.35,
    flattenTarget: 50,
  });

  // Display toggles
  const [viewMode, setViewMode] = useState<ViewMode>('elevation');
  const [showMesh, setShowMesh] = useState<boolean>(false);
  const [showShading, setShowShading] = useState<boolean>(true);
  const [showRipples, setShowRipples] = useState<boolean>(true);
  const [showCompass, setShowCompass] = useState<boolean>(true);
  const [showBorder, setShowBorder] = useState<boolean>(true);
  const [compassPos, setCompassPos] = useState<{ x: number; y: number }>({ x: 280, y: 320 });

  // Placed Map Symbols display settings and selection
  const [showSymbols, setShowSymbols] = useState<boolean>(true);
  const [isSymbolPaletteOpen, setIsSymbolPaletteOpen] = useState<boolean>(false);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);

  // Biome settings (terrain types: forest, grassland, desert, etc.)
  const [biomeSettings, setBiomeSettings] = useState({
    selectedBiomeId: 1, // 針葉樹林
    softness: 40,
    landOnly: true,
    showBiome: true,
    opacity: 55,
  });

  // Custom Categories (Persisted in IndexedDB + LocalStorage)
  const [categories, setCategories] = useState<CustomSymbolCategory[]>(() => {
    return getInitialCategoriesFromLocalStorage();
  });

  const handleAddCategory = useCallback((cat: CustomSymbolCategory) => {
    setCategories((prev) => {
      const next = [...prev, cat];
      persistCustomCategories(next);
      return next;
    });
  }, []);

  const handleUpdateCategory = useCallback((cat: CustomSymbolCategory) => {
    setCategories((prev) => {
      const next = prev.map((c) => (c.id === cat.id ? cat : c));
      persistCustomCategories(next);
      return next;
    });
  }, []);

  const handleDeleteCategory = useCallback((catId: string) => {
    setCategories((prev) => {
      const next = prev.filter((c) => c.id !== catId);
      persistCustomCategories(next);
      return next;
    });
    setCustomAssets((prev) => {
      const next = prev.map((a) => (a.category === catId ? { ...a, category: '' } : a));
      persistCustomAssets(next);
      return next;
    });
  }, []);

  // User-created Custom Map Pixel Assets (Persisted in IndexedDB + LocalStorage)
  const [customAssets, setCustomAssets] = useState<CustomMapAsset[]>(() => {
    return getInitialAssetsFromLocalStorage();
  });

  // Restore and sync full persistent assets from IndexedDB on startup
  useEffect(() => {
    loadPersistentAssets().then((assets) => {
      if (assets.length > 0) {
        setCustomAssets((prev) => {
          const map = new Map<string, CustomMapAsset>();
          for (const a of prev) map.set(a.id, a);
          for (const a of assets) map.set(a.id, a);
          return Array.from(map.values());
        });
      }
    });
  }, []);

  // Continuous background persistence whenever customAssets changes
  useEffect(() => {
    persistCustomAssets(customAssets);
  }, [customAssets]);

  // Continuous background persistence whenever categories changes
  useEffect(() => {
    persistCustomCategories(categories);
  }, [categories]);

  // Import custom symbol library handler (from standalone JSON backup or map file)
  const handleImportSymbols = useCallback((importedAssets: CustomMapAsset[], importedCategories: CustomSymbolCategory[]) => {
    setCustomAssets((prev) => {
      const map = new Map<string, CustomMapAsset>();
      for (const a of prev) map.set(a.id, a);
      for (const a of importedAssets) map.set(a.id, a);
      const merged = Array.from(map.values());
      persistCustomAssets(merged);
      return merged;
    });
    if (Array.isArray(importedCategories) && importedCategories.length > 0) {
      setCategories((prev) => {
        const map = new Map<string, CustomSymbolCategory>();
        for (const c of prev) map.set(c.id, c);
        for (const c of importedCategories) map.set(c.id, c);
        const merged = Array.from(map.values());
        persistCustomCategories(merged);
        return merged;
      });
    }
  }, []);

  const [symbolToolSettings, setSymbolToolSettings] = useState<SymbolToolSettings>(() => {
    return {
      selectedType: 'custom',
      selectedCustomAssetId: null,
      category: '',
      scale: 1.0,
      density: 3,
      scatterRadius: 75,
      randomScaleVar: 0.2,
      colorTheme: DEFAULT_SYMBOL_COLOR_THEME,
    };
  });

  const handleUpdateSymbolToolSettings = useCallback((patch: Partial<SymbolToolSettings>) => {
    setSymbolToolSettings((prev) => ({ ...prev, ...patch }));
    if (patch.scatterRadius !== undefined) {
      setBrushSettings((prev) => ({ ...prev, radius: patch.scatterRadius! }));
    }
  }, []);

  const [isPixelStudioOpen, setIsPixelStudioOpen] = useState<boolean>(false);
  const [editingPixelAsset, setEditingPixelAsset] = useState<CustomMapAsset | null>(null);
  const [isImageToPixelOpen, setIsImageToPixelOpen] = useState<boolean>(false);
  const [isImageToTerrainOpen, setIsImageToTerrainOpen] = useState<boolean>(false);
  const [segmentedTerrainResult, setSegmentedTerrainResult] = useState<CroppedTerrainResult | null>(null);
  const [mapBackgroundUrl, setMapBackgroundUrl] = useState<string | null>(null);

  const handleOpenPixelStudio = useCallback((asset?: CustomMapAsset) => {
    setEditingPixelAsset(asset || null);
    setIsPixelStudioOpen(true);
  }, []);

  const handleSaveCustomAsset = useCallback((asset: CustomMapAsset) => {
    setCustomAssets((prev) => {
      const next = [asset, ...prev.filter((a) => a.id !== asset.id)];
      try {
        localStorage.setItem('fantasy_map_custom_assets', JSON.stringify(next));
      } catch {}
      return next;
    });
    setSymbolToolSettings((prev) => ({
      ...prev,
      selectedType: 'custom',
      selectedCustomAssetId: asset.id,
      category: asset.category,
    }));
    setBrushSettings((prev) => ({ ...prev, mode: 'stamp' }));
  }, []);

  const handleDeleteCustomAsset = useCallback((assetId: string) => {
    setCustomAssets((prev) => {
      const next = prev.filter((a) => a.id !== assetId);
      try {
        localStorage.setItem('fantasy_map_custom_assets', JSON.stringify(next));
      } catch {}
      return next;
    });
    setSymbolToolSettings((prev) => {
      if (prev.selectedCustomAssetId === assetId) {
        return { ...prev, selectedCustomAssetId: null };
      }
      return prev;
    });
    // Also remove placed map symbols of this deleted custom asset
    setMapData((prev) => {
      const hasInWorld = prev.symbols?.some((s) => s.customAssetId === assetId);
      let regionalChanged = false;
      const updatedRegionalMaps = { ...prev.regionalMaps };
      for (const regId of Object.keys(updatedRegionalMaps)) {
        if (updatedRegionalMaps[regId].symbols?.some((s) => s.customAssetId === assetId)) {
          regionalChanged = true;
          updatedRegionalMaps[regId] = {
            ...updatedRegionalMaps[regId],
            symbols: updatedRegionalMaps[regId].symbols.filter((s) => s.customAssetId !== assetId),
          };
        }
      }
      if (!hasInWorld && !regionalChanged) return prev;
      return {
        ...prev,
        symbols: prev.symbols?.filter((s) => s.customAssetId !== assetId) || [],
        regionalMaps: updatedRegionalMaps,
      };
    });
  }, []);

  // UI Panels
  const [isGeneratorOpen, setIsGeneratorOpen] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  );
  const [isStorageOpen, setIsStorageOpen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<{ progress: number; message: string }>({
    progress: 0,
    message: '',
  });

  const [hoveredCell, setHoveredCell] = useState<MapCell | null>(null);

  // Undo / Redo history
  const [undoStack, setUndoStack] = useState<HistoryRecord[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryRecord[]>([]);

  // Auto region switch toggle (hierarchical zoom navigation)
  const [autoRegionSwitch, setAutoRegionSwitch] = useState<boolean>(true);
  const prevZoomRef = useRef<number>(viewport.zoom);
  const isInteractingRef = useRef<boolean>(false);
  const transitionCooldownRef = useRef<number>(0);
  const isTransitioningRef = useRef<boolean>(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Current active map dimensions
  const currentParentDim = useMemo(() => {
    return activeRegionalMap
      ? { width: activeRegionalMap.width, height: activeRegionalMap.height }
      : { width: mapData.width, height: mapData.height };
  }, [activeRegionalMap, mapData.width, mapData.height]);

  // Child regions belonging directly to the current view
  const currentChildRegions = useMemo(() => {
    const currentMapId = activeRegionalMap ? activeRegionalMap.id : null;
    return Object.values(mapData.regionalMaps).filter(
      (reg) => (reg.parentId ?? null) === currentMapId
    );
  }, [activeRegionalMap, mapData.regionalMaps]);

  // Dynamic maximum zoom to ensure deep regional maps can be entered
  const maxZoom = useMemo(() => {
    return getMaxZoomForMap(currentChildRegions, currentParentDim);
  }, [currentChildRegions, currentParentDim]);

  // Seamless auto hierarchical zoom transition
  useEffect(() => {
    const prevZoom = prevZoomRef.current;
    const currZoom = viewport.zoom;
    prevZoomRef.current = currZoom;

    // Only evaluate auto transition if zoom changed (not on pure pan)
    if (Math.abs(currZoom - prevZoom) < 1e-4) {
      return;
    }

    if (!autoRegionSwitch) return;
    if (isInteractingRef.current) return;
    if (Date.now() < transitionCooldownRef.current) return;
    if (isTransitioningRef.current) return;

    const screenW = workspaceRef.current?.clientWidth || window.innerWidth;
    const screenH =
      workspaceRef.current?.clientHeight || Math.max(400, window.innerHeight - 88);

    // Case 1: Active map is a child region, zooming OUT -> check if should exit to parent
    if (activeRegionalMap && shouldExitToParent(viewport)) {
      const parentMap = activeRegionalMap.parentId
        ? mapData.regionalMaps[activeRegionalMap.parentId]
        : null;
      const parentDim = parentMap
        ? { width: parentMap.width, height: parentMap.height }
        : { width: mapData.width, height: mapData.height };

      if (isUniformChild(activeRegionalMap, parentDim)) {
        isTransitioningRef.current = true;
        transitionCooldownRef.current = Date.now() + 400;

        const newVp = childToParentViewport(viewport, activeRegionalMap);
        setActiveRegionId(activeRegionalMap.parentId);
        setViewport(newVp);
        setUndoStack([]);
        setRedoStack([]);
        setSelectedSymbolId(null);

        setTimeout(() => {
          isTransitioningRef.current = false;
        }, 50);
        return;
      }
    }

    // Case 2: Zooming IN -> check if should enter any child region
    if (currZoom > prevZoom && currentChildRegions.length > 0) {
      const childToEnter = findChildToEnter(
        viewport,
        currentChildRegions,
        currentParentDim,
        screenW,
        screenH
      );

      if (childToEnter) {
        isTransitioningRef.current = true;
        transitionCooldownRef.current = Date.now() + 400;

        const newVp = parentToChildViewport(viewport, childToEnter);
        setActiveRegionId(childToEnter.id);
        setViewport(newVp);
        setUndoStack([]);
        setRedoStack([]);
        setSelectedSymbolId(null);

        setTimeout(() => {
          isTransitioningRef.current = false;
        }, 50);
        return;
      }
    }
  }, [
    viewport,
    autoRegionSwitch,
    activeRegionalMap,
    currentChildRegions,
    currentParentDim,
    mapData.width,
    mapData.height,
    mapData.regionalMaps,
  ]);

  // Web Worker
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL('./workers/terrainWorker.ts', import.meta.url), {
        type: 'module',
      });

      workerRef.current.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (data.type === 'progress') {
          setGenerationProgress({ progress: data.progress, message: data.message });
        } else if (data.type === 'success') {
          setMapData((prev) => ({
            ...data.mapData,
            symbols: [],
            biomeGrid: undefined,
            biomeTypes: prev.biomeTypes || biomeTypes,
          }));
          setSelectedSymbolId(null);
          setActiveRegionId(null);
          setUndoStack([]);
          setRedoStack([]);
          setIsGenerating(false);
        } else if (data.type === 'successRegion') {
          const newRegion: RegionalMapData = data.regionData;
          setMapData((prev) => ({
            ...prev,
            regionalMaps: {
              ...prev.regionalMaps,
              [newRegion.id]: {
                ...newRegion,
                symbols: newRegion.symbols || [],
                biomeGrid: undefined,
              },
            },
          }));
          setActiveRegionId(newRegion.id);
          // Center view on regional map
          setViewport({
            x: Math.max(20, (window.innerWidth - newRegion.width * 0.65) / 2),
            y: Math.max(20, (window.innerHeight - newRegion.height * 0.65) / 2),
            zoom: 0.65,
          });
          setUndoStack([]);
          setRedoStack([]);
          setIsGenerating(false);
          setBrushSettings((prev) => ({ ...prev, mode: 'elevate' }));
        } else if (data.type === 'error') {
          console.error('Worker error:', data.error);
          setIsGenerating(false);
        }
      };
    } catch (err) {
      console.warn('Web Worker fallback to main thread.', err);
    }

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Regenerate World Map in Web Worker
  const handleRegenerate = useCallback(() => {
    setIsGenerating(true);
    setGenerationProgress({ progress: 5, message: '世界マップ生成を開始...' });

    const { width, height } = getResolutionDimensions(config.gridResolution);

    if (workerRef.current) {
      workerRef.current.postMessage({
        action: 'generateWorld',
        width,
        height,
        config,
      });
    } else {
      setTimeout(() => {
        try {
          const nextMap = generateTectonicWorld(width, height, config);
          setMapData((prev) => ({
            ...nextMap,
            symbols: [],
            biomeGrid: undefined,
            biomeTypes: prev.biomeTypes || biomeTypes,
          }));
          setSelectedSymbolId(null);
          setActiveRegionId(null);
          setUndoStack([]);
          setRedoStack([]);
        } catch (err) {
          console.error('Generation error:', err);
        } finally {
          setIsGenerating(false);
        }
      }, 50);
    }
  }, [config, biomeTypes]);

  // Generate 100% Blank Ocean for pure manual sculpting
  const handleGenerateBlankOcean = useCallback(() => {
    setIsGenerating(true);
    setGenerationProgress({ progress: 30, message: '完全な海（白紙キャンバス）を構築中...' });

    const { width, height } = getResolutionDimensions(config.gridResolution);

    if (workerRef.current) {
      workerRef.current.postMessage({
        action: 'generateBlankOcean',
        width,
        height,
        config,
      });
    } else {
      setTimeout(() => {
        try {
          const blankMap = generateBlankOceanWorld(width, height, config);
          setMapData((prev) => ({
            ...blankMap,
            symbols: [],
            biomeGrid: undefined,
            biomeTypes: prev.biomeTypes || biomeTypes,
          }));
          setSelectedSymbolId(null);
          setActiveRegionId(null);
          setUndoStack([]);
          setRedoStack([]);
        } catch (err) {
          console.error('Blank ocean generation error:', err);
        } finally {
          setIsGenerating(false);
        }
      }, 50);
    }
  }, [config, biomeTypes]);

  // Apply world map directly from ImageToTerrainModal manual mask correction
  const handleApplyWorldMapFromImage = useCallback((newMapData: MapData) => {
    setMapData((prev) => ({
      ...newMapData,
      biomeGrid: undefined,
      biomeTypes: prev.biomeTypes || biomeTypes,
    }));
    setConfig(newMapData.config);
    setActiveRegionId(null);
    setSelectedSymbolId(null);
    setUndoStack([]);
    setRedoStack([]);
    const defaultDims = getResolutionDimensions(newMapData.config.gridResolution);
    const zoom = 0.65;
    const x = Math.max(20, (window.innerWidth - defaultDims.width * zoom) / 2);
    const y = Math.max(20, (window.innerHeight - defaultDims.height * zoom) / 2);
    setViewport({ x, y, zoom });
    setIsImageToTerrainOpen(false);
  }, []);

  // Create Regional Map from selection
  const handleCreateRegionalMap = useCallback(
    (bounds: RegionalBounds, zoomScale: 4 | 16, name: string, shapeMask?: ShapeMaskConfig) => {
      setPendingRegionInfo(null);
      setIsGenerating(true);
      setGenerationProgress({ progress: 10, message: '地域マップを4x/16x解像度で合成中...' });

      // Parent is active regional map if viewing one, otherwise the world map
      const parentSource = activeRegionalMap || mapData;
      const parentMapInput = toParentMapSource(parentSource);

      if (workerRef.current) {
        workerRef.current.postMessage({
          action: 'generateRegion',
          width: parentMapInput.width,
          height: parentMapInput.height,
          parentMap: parentMapInput,
          bounds,
          zoomScale,
          name,
          shapeMask,
        });
      } else {
        setTimeout(() => {
          try {
            const newRegion = generateRegionalMap(parentMapInput, bounds, zoomScale, name, shapeMask);
            setMapData((prev) => ({
              ...prev,
              regionalMaps: {
                ...prev.regionalMaps,
                [newRegion.id]: newRegion,
              },
            }));
            setActiveRegionId(newRegion.id);
            setViewport({
              x: Math.max(20, (window.innerWidth - newRegion.width * 0.65) / 2),
              y: Math.max(20, (window.innerHeight - newRegion.height * 0.65) / 2),
              zoom: 0.65,
            });
            setUndoStack([]);
            setRedoStack([]);
            setBrushSettings((prev) => ({ ...prev, mode: 'elevate' }));
          } catch (err) {
            console.error('Regional map error:', err);
          } finally {
            setIsGenerating(false);
          }
        }, 50);
      }
    },
    [mapData, activeRegionalMap]
  );

  // Commit history record
  const handleCommitHistory = useCallback((record: HistoryRecord) => {
    setUndoStack((prev) => {
      const next = [...prev, record];
      if (next.length > 30) next.shift();
      return next;
    });
    setRedoStack([]);
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const lastRecord = undoStack[undoStack.length - 1];

    if (lastRecord.changes) {
      const currentGrid = activeRegionalMap
        ? activeRegionalMap.elevationGrid
        : mapData.elevationGrid;

      for (const ch of lastRecord.changes) {
        if (ch.gridIndex !== undefined) {
          currentGrid[ch.gridIndex] = ch.prevElevation;
        }
      }
    }

    if (lastRecord.biomeChanges) {
      const currentBiome = activeRegionalMap
        ? activeRegionalMap.biomeGrid
        : mapData.biomeGrid;
      if (currentBiome) {
        for (const ch of lastRecord.biomeChanges) {
          currentBiome[ch.gridIndex] = ch.prev;
        }
      }
    }

    if (lastRecord.symbolChanges) {
      handleUpdateSymbols(lastRecord.symbolChanges.prevSymbols);
      setSelectedSymbolId(null);
    }

    setUndoStack((prev) => prev.slice(0, prev.length - 1));
    setRedoStack((prev) => [...prev, lastRecord]);
    setMapData((prev) => ({ ...prev }));
  }, [undoStack, activeRegionalMap, mapData, handleUpdateSymbols]);

  // Redo
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextRecord = redoStack[redoStack.length - 1];

    if (nextRecord.changes) {
      const currentGrid = activeRegionalMap
        ? activeRegionalMap.elevationGrid
        : mapData.elevationGrid;

      for (const ch of nextRecord.changes) {
        if (ch.gridIndex !== undefined) {
          currentGrid[ch.gridIndex] = ch.newElevation;
        }
      }
    }

    if (nextRecord.biomeChanges) {
      const currentBiome = activeRegionalMap
        ? activeRegionalMap.biomeGrid
        : mapData.biomeGrid;
      if (currentBiome) {
        for (const ch of nextRecord.biomeChanges) {
          currentBiome[ch.gridIndex] = ch.next;
        }
      }
    }

    if (nextRecord.symbolChanges) {
      handleUpdateSymbols(nextRecord.symbolChanges.newSymbols);
      setSelectedSymbolId(null);
    }

    setRedoStack((prev) => prev.slice(0, prev.length - 1));
    setUndoStack((prev) => [...prev, nextRecord]);
    setMapData((prev) => ({ ...prev }));
  }, [redoStack, activeRegionalMap, mapData, handleUpdateSymbols]);

  // Clear all biome grid data
  const handleClearBiomeGrid = useCallback(() => {
    const targetBiome = activeRegionalMap
      ? activeRegionalMap.biomeGrid
      : mapData.biomeGrid;
    if (!targetBiome) return;

    const changes: { gridIndex: number; prev: number; next: number }[] = [];
    for (let i = 0; i < targetBiome.length; i++) {
      if (targetBiome[i] !== 0) {
        changes.push({ gridIndex: i, prev: targetBiome[i], next: 0 });
        targetBiome[i] = 0;
      }
    }

    if (changes.length > 0) {
      handleCommitHistory({
        description: '地形タイプの全消去',
        timestamp: Date.now(),
        biomeChanges: changes,
      });
      setMapData((prev) => ({ ...prev }));
    }
  }, [activeRegionalMap, mapData, handleCommitHistory]);

  // Clear all symbols
  const handleClearSymbols = useCallback(() => {
    handleCommitHistory({
      description: '全シンボル消去',
      timestamp: Date.now(),
      symbolChanges: {
        prevSymbols: currentSymbols,
        newSymbols: [],
      },
    });
    handleUpdateSymbols([]);
    setSelectedSymbolId(null);
  }, [currentSymbols, handleCommitHistory, handleUpdateSymbols]);

  // Reset View
  const handleResetView = useCallback(() => {
    const targetW = activeRegionalMap ? activeRegionalMap.width : mapData.width;
    const targetH = activeRegionalMap ? activeRegionalMap.height : mapData.height;
    const zoom = 0.65;
    const x = Math.max(20, (window.innerWidth - targetW * zoom) / 2);
    const y = Math.max(20, (window.innerHeight - targetH * zoom) / 2);
    setViewport({ x, y, zoom });
  }, [activeRegionalMap, mapData.width, mapData.height]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        handleToggleCollapse();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }

      const keyMap: Record<string, BrushMode> = {
        '1': 'pan',
        '2': 'elevate',
        '3': 'depress',
        '4': 'smooth',
        '5': 'flatten',
        '6': 'mountain',
        '7': 'makeLand',
        '8': 'makeSea',
        '9': 'selectRegion',
      };

      if (keyMap[e.key]) {
        setBrushSettings((prev) => ({ ...prev, mode: keyMap[e.key] }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleToggleCollapse]);

  // Breadcrumb Trail from World -> Parent Regions -> Current Region
  const breadcrumbs = useMemo(() => {
    const trail: { id: string | null; name: string }[] = [{ id: null, name: '世界' }];
    if (!activeRegionId || !mapData.regionalMaps[activeRegionId]) return trail;

    const chain: RegionalMapData[] = [];
    const visited = new Set<string>();
    let currId: string | null = activeRegionId;

    while (currId && mapData.regionalMaps[currId] && !visited.has(currId)) {
      visited.add(currId);
      const reg: RegionalMapData = mapData.regionalMaps[currId];
      chain.unshift(reg);
      currId = reg.parentId;
    }

    for (const reg of chain) {
      trail.push({ id: reg.id, name: reg.name });
    }

    return trail;
  }, [activeRegionId, mapData.regionalMaps]);

  // Navigate to any hierarchical map level (resetting undo/redo and view)
  const handleNavigateToRegion = useCallback(
    (targetId: string | null) => {
      setActiveRegionId(targetId);
      setSelectedSymbolId(null);
      setUndoStack([]);
      setRedoStack([]);
      handleResetView();
    },
    [handleResetView]
  );

  // Return to direct parent map (1つ上の階層へ戻る)
  const handleGoBackOneLevel = useCallback(() => {
    if (!activeRegionalMap) return;
    handleNavigateToRegion(activeRegionalMap.parentId);
  }, [activeRegionalMap, handleNavigateToRegion]);

  // Child regions available under current map view
  const regionList = useMemo(() => {
    const currentId = activeRegionalMap ? activeRegionalMap.id : null;
    return Object.values(mapData.regionalMaps)
      .filter((r) => (r.parentId ?? null) === currentId)
      .map((r) => ({
        id: r.id,
        name: r.name,
      }));
  }, [activeRegionalMap, mapData.regionalMaps]);

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-[#08111c] text-stone-100 font-sans">
      {/* Top Header */}
      <header className="h-12 bg-stone-950/95 border-b border-stone-800/90 px-4 flex items-center justify-between z-20 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center shadow-inner border border-amber-500/40">
            <Globe className="w-4 h-4 text-amber-200" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide text-amber-100 flex items-center gap-2">
              <span>架空世界 地図エディタ</span>
              <span className="text-[10px] uppercase font-mono tracking-widest text-amber-400/90 px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-800/60">
                {activeRegionalMap ? `地域マップ (${activeRegionalMap.zoomScale}x)` : '惑星規模・プレート世界マップ (2:1)'}
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-stone-400">
          <span className="hidden md:inline text-[11px] text-stone-400 font-mono">
            {activeRegionalMap
              ? `地域解像度: ${activeRegionalMap.gridCols}×${activeRegionalMap.gridRows}`
              : `世界解像度: ${mapData.gridCols}×${mapData.gridRows} (${config.worldWidthKm?.toLocaleString()} km)`}
          </span>
          <button
            type="button"
            onClick={() => setIsStorageOpen(true)}
            className="px-3 py-1 bg-amber-700/80 hover:bg-amber-600 text-amber-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-amber-500/50 transition shadow-sm"
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>保存 / 読込</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div ref={workspaceRef} className="relative flex-1 w-full h-[calc(100vh-3rem-2.5rem)] overflow-hidden">
        {/* Interactive Canvas */}
        <MapCanvas
          mapData={mapData}
          activeRegionalMap={activeRegionalMap}
          viewport={viewport}
          onUpdateViewport={setViewport}
          brushSettings={brushSettings}
          spatialIndex={spatialIndex}
          viewMode={viewMode}
          showMesh={showMesh}
          showShading={showShading}
          showRipples={showRipples}
          showCompass={showCompass}
          showBorder={showBorder}
          compassPos={compassPos}
          onUpdateCompassPos={setCompassPos}
          symbols={currentSymbols}
          showSymbols={showSymbols}
          symbolToolSettings={symbolToolSettings}
          customAssets={customAssets}
          onUpdateSymbols={handleUpdateSymbols}
          selectedSymbolId={selectedSymbolId}
          onSelectSymbolId={setSelectedSymbolId}
          biomeSettings={biomeSettings}
          biomeTypes={biomeTypes}
          onCommitHistory={handleCommitHistory}
          onHoverCell={setHoveredCell}
          onSelectRegionBounds={(bounds, adjusted = false, shapePolygon) =>
            setPendingRegionInfo({ bounds, adjusted, shapePolygon })
          }
          mapBackgroundUrl={mapBackgroundUrl}
          onClearMapBackground={() => setMapBackgroundUrl(null)}
          maxZoom={maxZoom}
          onInteractingChange={(interacting) => {
            isInteractingRef.current = interacting;
          }}
        />

        {/* Floating Toolbar (Top Left) */}
        <div className="absolute top-3 left-3 z-30 max-w-2xl max-h-[calc(100vh-4.5rem)] flex flex-col min-h-0">
          <Toolbar
            brushSettings={brushSettings}
            onUpdateBrush={(patch) => setBrushSettings((prev) => ({ ...prev, ...patch }))}
            symbolToolSettings={symbolToolSettings}
            onUpdateSymbolToolSettings={handleUpdateSymbolToolSettings}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
            undoCount={undoStack.length}
            redoCount={redoStack.length}
            viewMode={viewMode}
            onChangeViewMode={setViewMode}
            showMesh={showMesh}
            onToggleMesh={() => setShowMesh((v) => !v)}
            showShading={showShading}
            onToggleShading={() => setShowShading((v) => !v)}
            showRipples={showRipples}
            onToggleRipples={() => setShowRipples((v) => !v)}
            showCompass={showCompass}
            onToggleCompass={() => setShowCompass((v) => !v)}
            showBorder={showBorder}
            onToggleBorder={() => setShowBorder((v) => !v)}
            isSymbolPaletteOpen={isSymbolPaletteOpen}
            onToggleSymbolPalette={() => setIsSymbolPaletteOpen((v) => !v)}
            onOpenImageToPixel={() => setIsImageToPixelOpen(true)}
            symbolCount={currentSymbols.length}
            onResetView={handleResetView}
            zoom={viewport.zoom}
            onZoomChange={(delta) =>
              setViewport((v) => ({
                ...v,
                zoom: Math.max(0.15, Math.min(maxZoom, v.zoom + delta)),
              }))
            }
            onToggleGenerator={() => setIsGeneratorOpen((v) => !v)}
            isGeneratorOpen={isGeneratorOpen}
            onOpenStorage={() => setIsStorageOpen(true)}
            activeRegionalMap={activeRegionalMap}
            activeRegionName={activeRegionalMap?.name}
            breadcrumbs={breadcrumbs}
            onNavigateBreadcrumb={handleNavigateToRegion}
            onGoBackOneLevel={handleGoBackOneLevel}
            onExitRegion={handleGoBackOneLevel}
            regionList={regionList}
            onSelectRegionMap={handleNavigateToRegion}
            isCollapsed={isToolbarCollapsed}
            onToggleCollapse={handleToggleCollapse}
            autoRegionSwitch={autoRegionSwitch}
            onToggleAutoRegionSwitch={() => setAutoRegionSwitch((v) => !v)}
          />
        </div>

        {/* Biome Palette Panel (Top Right - shown when biome tool is active) */}
        {(brushSettings.mode === 'biomePaint' ||
          brushSettings.mode === 'biomeFill' ||
          brushSettings.mode === 'biomeErase') && (
          <div
            className={`absolute top-4 ${
              isGeneratorOpen && !activeRegionalMap ? 'right-96' : 'right-4'
            } z-30`}
          >
            <BiomePalette
              brushMode={brushSettings.mode}
              onChangeBrushMode={(mode) =>
                setBrushSettings((prev) => ({ ...prev, mode }))
              }
              selectedBiomeId={biomeSettings.selectedBiomeId}
              onSelectBiomeId={(id) =>
                setBiomeSettings((prev) => ({ ...prev, selectedBiomeId: id }))
              }
              softness={biomeSettings.softness}
              onChangeSoftness={(softness) =>
                setBiomeSettings((prev) => ({ ...prev, softness }))
              }
              brushRadius={brushSettings.radius}
              onChangeRadius={(radius) =>
                setBrushSettings((prev) => ({ ...prev, radius }))
              }
              landOnly={biomeSettings.landOnly}
              onToggleLandOnly={(landOnly) =>
                setBiomeSettings((prev) => ({ ...prev, landOnly }))
              }
              showBiome={biomeSettings.showBiome}
              onToggleShowBiome={(show) =>
                setBiomeSettings((prev) => ({ ...prev, showBiome: show }))
              }
              opacity={biomeSettings.opacity}
              onChangeOpacity={(opacity) =>
                setBiomeSettings((prev) => ({ ...prev, opacity }))
              }
              onClearBiomeGrid={handleClearBiomeGrid}
              onClose={() =>
                setBrushSettings((prev) => ({ ...prev, mode: 'pan' }))
              }
              biomeTypes={biomeTypes}
              onOpenEditor={() => setIsBiomeTypeEditorOpen(true)}
            />
          </div>
        )}

        {/* Symbol Palette Panel (Top Right) */}
        {isSymbolPaletteOpen && (
          <div className={`absolute top-4 ${isGeneratorOpen && !activeRegionalMap ? 'right-96' : 'right-4'} z-30`}>
            <SymbolPalette
              brushMode={brushSettings.mode}
              onChangeBrushMode={(mode) => setBrushSettings((prev) => ({ ...prev, mode }))}
              toolSettings={symbolToolSettings}
              onUpdateToolSettings={handleUpdateSymbolToolSettings}
              symbolCount={currentSymbols.length}
              customAssets={customAssets}
              categories={categories}
              onAddCategory={handleAddCategory}
              onUpdateCategory={handleUpdateCategory}
              onDeleteCategory={handleDeleteCategory}
              onOpenPixelStudio={handleOpenPixelStudio}
              onOpenImageToPixel={() => setIsImageToPixelOpen(true)}
              onDeleteCustomAsset={handleDeleteCustomAsset}
              onClearSymbols={handleClearSymbols}
              showSymbols={showSymbols}
              onToggleShowSymbols={() => setShowSymbols((v) => !v)}
              onExportSymbols={() => exportSymbolLibraryToJson(customAssets, categories)}
              onImportSymbols={handleImportSymbols}
              onClose={() => setIsSymbolPaletteOpen(false)}
            />
          </div>
        )}

        {/* Generator Panel Drawer (Top Right) */}
        {isGeneratorOpen && !activeRegionalMap && (
          <div className="absolute top-4 right-4 z-30 animate-in fade-in slide-in-from-right-4 duration-200">
            <GeneratorPanel
              config={config}
              onUpdateConfig={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
              onRegenerate={handleRegenerate}
              onGenerateBlankOcean={handleGenerateBlankOcean}
              onOpenImageToTerrain={() => setIsImageToTerrainOpen(true)}
              isGenerating={isGenerating}
              generationProgress={generationProgress}
              onClose={() => setIsGeneratorOpen(false)}
            />
          </div>
        )}

        {/* Pixel Art Studio Modal */}
        <PixelArtStudioModal
          isOpen={isPixelStudioOpen}
          onClose={() => {
            setIsPixelStudioOpen(false);
            setEditingPixelAsset(null);
          }}
          categories={categories}
          onAddCategory={handleAddCategory}
          onSaveCustomAsset={handleSaveCustomAsset}
          onDeleteCustomAsset={handleDeleteCustomAsset}
          initialAsset={editingPixelAsset}
        />

        {/* Image to Pixel Art Converter Modal */}
        <ImageToPixelModal
          isOpen={isImageToPixelOpen}
          onClose={() => setIsImageToPixelOpen(false)}
          categories={categories}
          onAddCategory={handleAddCategory}
          onSaveCustomAsset={(asset) => {
            handleSaveCustomAsset(asset);
          }}
          onOpenInPixelEditor={(asset) => {
            handleSaveCustomAsset(asset);
            handleOpenPixelStudio(asset);
          }}
          onSetMapBackground={(dataUrl) => {
            setMapBackgroundUrl(dataUrl);
          }}
        />

        {/* Image to Terrain Crop Modal (Phase 1, 2 & 3: Crop, Segment, Manual Correction) */}
        <ImageToTerrainModal
          isOpen={isImageToTerrainOpen}
          onClose={() => setIsImageToTerrainOpen(false)}
          onCropped={(result) => {
            setSegmentedTerrainResult(result);
            console.log('Land/sea segmented terrain result saved to parent state:', result);
          }}
          onApplyToWorldMap={handleApplyWorldMapFromImage}
        />

        {/* Region Selector Modal */}
        {pendingRegionInfo && (
          <RegionSelector
            bounds={pendingRegionInfo.bounds}
            wasAdjusted={pendingRegionInfo.adjusted}
            shapePolygon={pendingRegionInfo.shapePolygon}
            worldWidthKm={activeRegionalMap ? activeRegionalMap.widthKm : (mapData.worldWidthKm || 40000)}
            mapWidth={activeRegionalMap ? activeRegionalMap.width : mapData.width}
            onGenerate={handleCreateRegionalMap}
            onCancel={() => setPendingRegionInfo(null)}
          />
        )}

        {/* Biome Type Editor Modal */}
        <BiomeTypeEditor
          isOpen={isBiomeTypeEditorOpen}
          onClose={() => setIsBiomeTypeEditorOpen(false)}
          biomeTypes={biomeTypes}
          onSave={handleSaveBiomeTypes}
          mapData={mapData}
          customAssets={customAssets}
          seaLevel={activeRegionalMap ? activeRegionalMap.seaLevel : mapData.seaLevel}
        />
      </div>

      {/* Bottom Inspector Bar */}
      <footer className="h-10 z-20">
        <InspectorBar
          mapData={mapData}
          hoveredCell={hoveredCell}
          viewport={viewport}
        />
      </footer>

      {/* Storage Modal */}
      <MapStorageModal
        isOpen={isStorageOpen}
        onClose={() => setIsStorageOpen(false)}
        mapData={mapData}
        customAssets={customAssets}
        categories={categories}
        onLoadMap={(loadedMap, loadedAssets, loadedCategories) => {
          setMapData(loadedMap);
          if (loadedMap.biomeTypes && loadedMap.biomeTypes.length > 0) {
            setBiomeTypes(loadedMap.biomeTypes);
          } else {
            setBiomeTypes(DEFAULT_BIOME_TYPES);
          }
          if (Array.isArray(loadedAssets) && loadedAssets.length > 0) {
            setCustomAssets((prev) => {
              const map = new Map<string, CustomMapAsset>();
              for (const a of prev) map.set(a.id, a);
              for (const a of loadedAssets) map.set(a.id, a);
              return Array.from(map.values());
            });
          }
          if (Array.isArray(loadedCategories) && loadedCategories.length > 0) {
            setCategories((prev) => {
              const map = new Map<string, CustomSymbolCategory>();
              for (const c of prev) map.set(c.id, c);
              for (const c of loadedCategories) map.set(c.id, c);
              return Array.from(map.values());
            });
          }
          setConfig(loadedMap.config);
          setActiveRegionId(null);
          setSelectedSymbolId(null);
          setUndoStack([]);
          setRedoStack([]);
          handleResetView();
        }}
        onImportSymbols={handleImportSymbols}
      />
    </div>
  );
}
