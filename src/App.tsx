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
  ViewMode,
  Viewport,
} from './types/map';
import { generateTectonicWorld, generateBlankOceanWorld } from './utils/tectonicGenerator';
import { generateRegionalMap, toParentMapSource } from './utils/regionGenerator';
import { SpatialIndex } from './utils/terrainEditor';
import { Toolbar } from './components/Toolbar';
import { GeneratorPanel } from './components/GeneratorPanel';
import { MapCanvas } from './components/MapCanvas';
import { InspectorBar } from './components/InspectorBar';
import { SupabaseModal } from './components/SupabaseModal';
import { RegionSelector } from './components/RegionSelector';
import { SymbolPalette } from './components/SymbolPalette';
import { PixelArtStudioModal } from './components/PixelArtStudioModal';
import { ImageToPixelModal } from './components/ImageToPixelModal';
import {
  MapSymbolInstance,
  SymbolToolSettings,
  CustomMapAsset,
  CustomSymbolCategory,
  DEFAULT_CUSTOM_CATEGORIES,
  DEFAULT_SYMBOL_COLOR_THEME,
} from './types/symbols';

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
  const [pendingRegionBounds, setPendingRegionBounds] = useState<RegionalBounds | null>(null);

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

  // Custom Categories (Persisted in localStorage)
  const [categories, setCategories] = useState<CustomSymbolCategory[]>(() => {
    try {
      const saved = localStorage.getItem('fantasy_map_custom_categories');
      return saved ? JSON.parse(saved) : DEFAULT_CUSTOM_CATEGORIES;
    } catch {
      return DEFAULT_CUSTOM_CATEGORIES;
    }
  });

  const handleAddCategory = useCallback((cat: CustomSymbolCategory) => {
    setCategories((prev) => {
      const next = [...prev, cat];
      try {
        localStorage.setItem('fantasy_map_custom_categories', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const handleUpdateCategory = useCallback((cat: CustomSymbolCategory) => {
    setCategories((prev) => {
      const next = prev.map((c) => (c.id === cat.id ? cat : c));
      try {
        localStorage.setItem('fantasy_map_custom_categories', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const handleDeleteCategory = useCallback((catId: string) => {
    setCategories((prev) => {
      const next = prev.filter((c) => c.id !== catId);
      try {
        localStorage.setItem('fantasy_map_custom_categories', JSON.stringify(next));
      } catch {}
      return next;
    });
    setCustomAssets((prev) => {
      const next = prev.map((a) => (a.category === catId ? { ...a, category: 'cat_village' } : a));
      try {
        localStorage.setItem('fantasy_map_custom_assets', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // User-created Custom Map Pixel Assets (Starts empty - user creates their own)
  const [customAssets, setCustomAssets] = useState<CustomMapAsset[]>(() => {
    try {
      const saved = localStorage.getItem('fantasy_map_custom_assets');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((a: any) => a && !a.id.startsWith('starter_'));
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  // Ensure clean state on mount (purge any previous starter symbols)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('fantasy_map_custom_assets');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const userOnly = parsed.filter((a: any) => a && !a.id.startsWith('starter_'));
          localStorage.setItem('fantasy_map_custom_assets', JSON.stringify(userOnly));
        }
      }
    } catch {}
  }, []);

  const [symbolToolSettings, setSymbolToolSettings] = useState<SymbolToolSettings>(() => {
    return {
      selectedType: 'custom',
      selectedCustomAssetId: null,
      category: 'cat_village',
      scale: 1.0,
      density: 3,
      scatterRadius: 75,
      randomScaleVar: 0.2,
      colorTheme: DEFAULT_SYMBOL_COLOR_THEME,
    };
  });

  const [isPixelStudioOpen, setIsPixelStudioOpen] = useState<boolean>(false);
  const [editingPixelAsset, setEditingPixelAsset] = useState<CustomMapAsset | null>(null);
  const [isImageToPixelOpen, setIsImageToPixelOpen] = useState<boolean>(false);
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
          setMapData({ ...data.mapData, symbols: [] });
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
          setMapData({ ...nextMap, symbols: [] });
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
  }, [config]);

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
          setMapData({ ...blankMap, symbols: [] });
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
  }, [config]);

  // Create Regional Map from selection
  const handleCreateRegionalMap = useCallback(
    (bounds: RegionalBounds, zoomScale: 4 | 16, name: string) => {
      setPendingRegionBounds(null);
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
        });
      } else {
        setTimeout(() => {
          try {
            const newRegion = generateRegionalMap(parentMapInput, bounds, zoomScale, name);
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

    if (nextRecord.symbolChanges) {
      handleUpdateSymbols(nextRecord.symbolChanges.newSymbols);
      setSelectedSymbolId(null);
    }

    setRedoStack((prev) => prev.slice(0, prev.length - 1));
    setUndoStack((prev) => [...prev, nextRecord]);
    setMapData((prev) => ({ ...prev }));
  }, [redoStack, activeRegionalMap, mapData, handleUpdateSymbols]);

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
      <div className="relative flex-1 w-full h-[calc(100vh-3rem-2.5rem)] overflow-hidden">
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
          onCommitHistory={handleCommitHistory}
          onHoverCell={setHoveredCell}
          onSelectRegionBounds={(bounds) => setPendingRegionBounds(bounds)}
          mapBackgroundUrl={mapBackgroundUrl}
          onClearMapBackground={() => setMapBackgroundUrl(null)}
        />

        {/* Floating Toolbar (Top Left) */}
        <div className="absolute top-4 left-4 z-30 max-w-2xl">
          <Toolbar
            brushSettings={brushSettings}
            onUpdateBrush={(patch) => setBrushSettings((prev) => ({ ...prev, ...patch }))}
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
                zoom: Math.max(0.15, Math.min(12.0, v.zoom + delta)),
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
          />
        </div>

        {/* Symbol Palette Panel (Top Right) */}
        {isSymbolPaletteOpen && (
          <div className={`absolute top-4 ${isGeneratorOpen && !activeRegionalMap ? 'right-96' : 'right-4'} z-30`}>
            <SymbolPalette
              brushMode={brushSettings.mode}
              onChangeBrushMode={(mode) => setBrushSettings((prev) => ({ ...prev, mode }))}
              toolSettings={symbolToolSettings}
              onUpdateToolSettings={(patch) => setSymbolToolSettings((prev) => ({ ...prev, ...patch }))}
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

        {/* Region Selector Modal */}
        {pendingRegionBounds && (
          <RegionSelector
            bounds={pendingRegionBounds}
            worldWidthKm={activeRegionalMap ? activeRegionalMap.widthKm : (mapData.worldWidthKm || 40000)}
            mapWidth={activeRegionalMap ? activeRegionalMap.width : mapData.width}
            onGenerate={handleCreateRegionalMap}
            onCancel={() => setPendingRegionBounds(null)}
          />
        )}
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
      <SupabaseModal
        isOpen={isStorageOpen}
        onClose={() => setIsStorageOpen(false)}
        mapData={mapData}
        onLoadMap={(loadedMap) => {
          setMapData(loadedMap);
          setConfig(loadedMap.config);
          setActiveRegionId(null);
          setSelectedSymbolId(null);
          setUndoStack([]);
          setRedoStack([]);
          handleResetView();
        }}
      />
    </div>
  );
}
