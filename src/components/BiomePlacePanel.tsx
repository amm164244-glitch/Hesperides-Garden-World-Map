import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Sparkles,
  Shuffle,
  Trash2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Layers,
  MapPin,
  ChevronDown,
  ChevronUp,
  Wand2,
  Mountain,
  Plus,
  Sliders,
  X,
  Image as ImageIcon,
} from 'lucide-react';
import { BiomeSymbolRule, BiomeType } from '../types/biome';
import { CustomMapAsset, CustomSymbolCategory, MapSymbolInstance } from '../types/symbols';
import { Viewport } from '../types/map';
import {
  placeBiomeSymbols,
  removeAutoBiomeSymbols,
  countAutoBiomeSymbols,
  PlaceBiomeSymbolsStats,
  PlaceBiomeSymbolsResult,
} from '../utils/biomeSymbolPlacer';
import {
  PlacementWorkerRequest,
  PlacementWorkerResponse,
} from '../workers/placementWorker';
import {
  generateBiomeGridFromTerrain,
  calculateLandElevPercentiles,
} from '../utils/biomeAutoGenerator';
import { applyDefaultRulesToBiomeTypes } from '../utils/biomeTypes';

export interface BiomePlacePanelProps {
  selectedBiomeId: number;
  biomeTypes: BiomeType[];
  customAssets?: CustomMapAsset[];
  customCategories?: CustomSymbolCategory[];
  activeBiomeGrid?: Uint8Array;
  elevationGrid?: Float32Array;
  seaLevel: number;
  gridCols: number;
  gridRows: number;
  mapWidth: number;
  mapHeight: number;
  viewport: Viewport;
  existingSymbols: MapSymbolInstance[];
  onApplySymbols: (symbols: MapSymbolInstance[], description: string) => void;
  activeRegionId: string | null;
  waterGrid?: Uint8Array;
  onApplyBiomeAndSymbols?: (
    newBiomeGrid: Uint8Array,
    newSymbols: MapSymbolInstance[],
    description: string
  ) => void;
  onUpdateBiomeTypes?: (updated: BiomeType[]) => void;
}

const BiomePlacePanelComponent: React.FC<BiomePlacePanelProps> = ({
  selectedBiomeId,
  biomeTypes,
  customAssets = [],
  activeBiomeGrid,
  elevationGrid,
  seaLevel,
  gridCols,
  gridRows,
  mapWidth,
  mapHeight,
  viewport,
  existingSymbols,
  onApplySymbols,
  activeRegionId,
  waterGrid,
  onApplyBiomeAndSymbols,
  onUpdateBiomeTypes,
  customCategories = [],
}) => {
  // Panel collapsed state
  const [isSectionOpen, setIsSectionOpen] = useState<boolean>(true);
  const [regenerateBiomeFromTerrain, setRegenerateBiomeFromTerrain] = useState<boolean>(true);

  // Settings State
  const [targetType, setTargetType] = useState<'all' | 'selected'>('all');
  const [rangeType, setRangeType] = useState<'all' | 'viewport'>('all');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [edgeFade, setEdgeFade] = useState<number>(6);
  const [overallDensity, setOverallDensity] = useState<number>(40);
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 900000) + 100000);
  const [maxCount, setMaxCount] = useState<number>(20000);

  // Mountain Symbol Configuration State (Slot 7)
  const [isMountainPickerOpen, setIsMountainPickerOpen] = useState<boolean>(false);
  const [mountainScaleFactor, setMountainScaleFactor] = useState<number>(1.0);

  // Get current slot 7 biome
  const mountainBiome = useMemo(() => {
    return biomeTypes.find((b) => b.slot === 7) || null;
  }, [biomeTypes]);

  // Current mountain symbol rules (returns rules explicitly configured or added)
  const currentMountainRules: BiomeSymbolRule[] = useMemo(() => {
    return mountainBiome?.symbols || [];
  }, [mountainBiome]);

  // Handler to update mountain symbol rules (slot 7)
  const handleUpdateMountainRules = useCallback((newRules: BiomeSymbolRule[]) => {
    if (!onUpdateBiomeTypes) return;
    const updated = biomeTypes.map((b) => {
      if (b.slot === 7) {
        return {
          ...b,
          symbols: newRules,
          density: b.density || 90,
          minDistance: b.minDistance || 16,
          ridgeWeight: b.ridgeWeight !== undefined ? b.ridgeWeight : 0.25,
        };
      }
      return b;
    });
    onUpdateBiomeTypes(updated);
  }, [biomeTypes, onUpdateBiomeTypes]);

  // Handler to add a symbol rule to mountains
  const handleAddMountainSymbol = useCallback((rule: BiomeSymbolRule) => {
    const nextRules = [...currentMountainRules, rule];
    handleUpdateMountainRules(nextRules);
  }, [currentMountainRules, handleUpdateMountainRules]);

  // Handler to remove a symbol rule from mountains
  const handleRemoveMountainSymbol = useCallback((index: number) => {
    const nextRules = currentMountainRules.filter((_, i) => i !== index);
    handleUpdateMountainRules(nextRules);
  }, [currentMountainRules, handleUpdateMountainRules]);

  // Handler to clear mountain rules
  const handleClearMountainRules = useCallback(() => {
    handleUpdateMountainRules([]);
    setMountainScaleFactor(1.0);
  }, [handleUpdateMountainRules]);

  // Handler to scale mountain symbols
  const handleApplyMountainScaleMultiplier = useCallback((multiplier: number) => {
    setMountainScaleFactor(multiplier);
    const updatedRules = currentMountainRules.map((r) => {
      // Scale min & max proportionally, clamped between 0.3 and 3.0
      const baseMin = 0.8;
      const baseMax = 1.1;
      return {
        ...r,
        scaleMin: Number(Math.max(0.3, Math.min(3.0, (r.scaleMin || baseMin) * (multiplier / mountainScaleFactor))).toFixed(2)),
        scaleMax: Number(Math.max(0.35, Math.min(3.0, (r.scaleMax || baseMax) * (multiplier / mountainScaleFactor))).toFixed(2)),
      };
    });
    handleUpdateMountainRules(updatedRules);
  }, [currentMountainRules, mountainScaleFactor, handleUpdateMountainRules]);

  // Deletion target setting
  const [deleteTargetMode, setDeleteTargetMode] = useState<'selected' | 'all'>('selected');
  const [showConfirmDelete, setShowConfirmDelete] = useState<boolean>(false);

  // Confirmation for > 30,000 symbols
  const [showConfirmHeavy, setShowConfirmHeavy] = useState<boolean>(false);
  const [pendingHeavyPlacementResult, setPendingHeavyPlacementResult] = useState<PlaceBiomeSymbolsResult | null>(null);

  // Estimation State
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [estimatedStats, setEstimatedStats] = useState<PlaceBiomeSymbolsStats | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  // Execution State
  const [isPlacing, setIsPlacing] = useState<boolean>(false);
  const [progressInfo, setProgressInfo] = useState<{ progress: number; message: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'warning' | 'error';
  } | null>(null);

  // Web Worker reference
  const workerRef = useRef<Worker | null>(null);
  const activeReqIdRef = useRef<number>(0);

  // Clean up worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Helper to get or re-create worker
  const getOrCreateWorker = useCallback(() => {
    try {
      if (typeof Worker === 'undefined') return null;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      const w = new Worker(new URL('../workers/placementWorker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = w;
      return w;
    } catch (err) {
      console.warn('Web Worker creation failed:', err);
      return null;
    }
  }, []);

  // Reset estimates and messages on map change
  useEffect(() => {
    setEstimatedStats(null);
    setStatusMessage(null);
    setProgressInfo(null);
    setShowConfirmHeavy(false);
    setShowConfirmDelete(false);
    setPendingHeavyPlacementResult(null);
  }, [activeRegionId]);

  // Selected biome metadata
  const currentBiome = useMemo(
    () => biomeTypes.find((b) => b.slot === selectedBiomeId),
    [biomeTypes, selectedBiomeId]
  );

  // Target slots calculation
  const targetSlots = useMemo(() => {
    if (targetType === 'selected') {
      return [selectedBiomeId];
    }
    return [];
  }, [targetType, selectedBiomeId]);

  // Effective Biome Types
  const effectiveBiomeTypes = useMemo(() => {
    if (targetSlots.length === 0) return biomeTypes;
    return biomeTypes.filter((b) => targetSlots.includes(b.slot));
  }, [biomeTypes, targetSlots]);

  // Map viewport to map coordinates rectangle
  const computeVisibleRegion = useCallback(() => {
    if (rangeType === 'all') return undefined;
    const minX = Math.max(0, -viewport.x / viewport.zoom);
    const minY = Math.max(0, -viewport.y / viewport.zoom);
    const maxX = Math.min(mapWidth, (window.innerWidth - viewport.x) / viewport.zoom);
    const maxY = Math.min(mapHeight, (window.innerHeight - viewport.y) / viewport.zoom);
    return { minX, minY, maxX, maxY };
  }, [rangeType, viewport, mapWidth, mapHeight]);

  // Count of deletable auto-placed symbols
  const deleteTargetSlot = deleteTargetMode === 'selected' ? selectedBiomeId : undefined;
  const autoPlacedCountToDelete = useMemo(() => {
    return countAutoBiomeSymbols(existingSymbols, deleteTargetSlot);
  }, [existingSymbols, deleteTargetSlot]);

  // Total auto-placed symbols currently on map
  const totalAutoPlacedCount = useMemo(() => {
    return countAutoBiomeSymbols(existingSymbols);
  }, [existingSymbols]);

  // Counts of currently placed auto-symbols per biome slot
  const placedCountsPerSlot = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const sym of existingSymbols) {
      if (sym.autoBiomeSlot !== undefined) {
        counts[sym.autoBiomeSlot] = (counts[sym.autoBiomeSlot] || 0) + 1;
      }
    }
    return counts;
  }, [existingSymbols]);

  // Debounced estimation (dryRun)
  useEffect(() => {
    if (!activeBiomeGrid) {
      setEstimatedStats(null);
      setIsEstimating(false);
      return;
    }

    setIsEstimating(true);
    setEstimateError(null);

    const timer = setTimeout(() => {
      const reqId = ++activeReqIdRef.current;
      const region = computeVisibleRegion();

      const worker = getOrCreateWorker();
      const percentiles = elevationGrid ? calculateLandElevPercentiles(elevationGrid, seaLevel, waterGrid) : undefined;
      const populatedBiomeTypes = applyDefaultRulesToBiomeTypes(biomeTypes, seaLevel, percentiles);

      if (worker) {
        // Safe transferable copy of grids to prevent detachment of caller arrays
        const biomeCopy = new Uint8Array(activeBiomeGrid);
        const elevCopy = elevationGrid ? new Float32Array(elevationGrid) : undefined;
        const waterCopy = waterGrid ? new Uint8Array(waterGrid) : undefined;
        const transferables: Transferable[] = [biomeCopy.buffer];
        if (elevCopy) transferables.push(elevCopy.buffer);
        if (waterCopy) transferables.push(waterCopy.buffer);

        const req: PlacementWorkerRequest = {
          id: `dryRun_${reqId}`,
          params: {
            biomeGrid: biomeCopy,
            gridCols,
            gridRows,
            mapWidth,
            mapHeight,
            elevationGrid: elevCopy,
            seaLevel,
            waterGrid: waterCopy,
            biomeTypes: populatedBiomeTypes,
            customAssets,
            targetSlots,
            region,
            existingSymbols,
            mode,
            seed,
            edgeFade,
            maxCount,
            overallDensity: overallDensity / 100,
            dryRun: true,
          },
        };

        worker.onmessage = (e: MessageEvent<PlacementWorkerResponse>) => {
          if (activeReqIdRef.current !== reqId) return;
          const data = e.data;
          if (data.type === 'success') {
            setEstimatedStats(data.result.stats);
            setIsEstimating(false);
          } else if (data.type === 'error') {
            setEstimateError(data.error);
            setIsEstimating(false);
          }
        };

        worker.onerror = (err) => {
          if (activeReqIdRef.current !== reqId) return;
          console.warn('Worker estimate failed:', err);
          setEstimateError('見積もり計算中にエラーが発生しました');
          setIsEstimating(false);
        };

        worker.postMessage(req, transferables);
      } else {
        // Fallback for environments where Web Worker is unavailable
        try {
          const result = placeBiomeSymbols({
            biomeGrid: activeBiomeGrid,
            gridCols,
            gridRows,
            mapWidth,
            mapHeight,
            elevationGrid,
            seaLevel,
            waterGrid,
            biomeTypes: populatedBiomeTypes,
            customAssets,
            targetSlots,
            region,
            existingSymbols,
            mode,
            seed,
            edgeFade,
            maxCount,
            overallDensity: overallDensity / 100,
            dryRun: true,
          });
          if (activeReqIdRef.current === reqId) {
            setEstimatedStats(result.stats);
            setIsEstimating(false);
          }
        } catch (err: any) {
          if (activeReqIdRef.current === reqId) {
            setEstimateError(err?.message || '見積もり計算エラー');
            setIsEstimating(false);
          }
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [
    activeBiomeGrid,
    elevationGrid,
    seaLevel,
    waterGrid,
    gridCols,
    gridRows,
    mapWidth,
    mapHeight,
    biomeTypes,
    customAssets,
    targetSlots,
    computeVisibleRegion,
    existingSymbols,
    mode,
    seed,
    edgeFade,
    maxCount,
    overallDensity,
    getOrCreateWorker,
  ]);

  // Execute placement
  const executePlacement = useCallback(
    (skipConfirmCheck = false) => {
      if (!activeBiomeGrid) return;

      // Check for > 30000 total symbols check before running or applying
      if (!skipConfirmCheck) {
        const estimatedTotal =
          (mode === 'replace'
            ? existingSymbols.filter((s) => s.autoBiomeSlot === undefined || (targetSlots.length > 0 && !targetSlots.includes(s.autoBiomeSlot))).length
            : existingSymbols.length) + (estimatedStats?.totalPlaced ?? 0);

        if (estimatedTotal > 30000) {
          setShowConfirmHeavy(true);
          return;
        }
      }

      setShowConfirmHeavy(false);
      setIsPlacing(true);
      setProgressInfo({ progress: 0, message: '自動配置を開始中...' });
      setStatusMessage(null);

      const reqId = ++activeReqIdRef.current;
      const region = computeVisibleRegion();
      const percentiles = elevationGrid ? calculateLandElevPercentiles(elevationGrid, seaLevel, waterGrid) : undefined;
      const populatedBiomeTypes = applyDefaultRulesToBiomeTypes(biomeTypes, seaLevel, percentiles);

      const worker = getOrCreateWorker();

      if (worker) {
        // Transferable copies
        const biomeCopy = new Uint8Array(activeBiomeGrid);
        const elevCopy = elevationGrid ? new Float32Array(elevationGrid) : undefined;
        const waterCopy = waterGrid ? new Uint8Array(waterGrid) : undefined;
        const transferables: Transferable[] = [biomeCopy.buffer];
        if (elevCopy) transferables.push(elevCopy.buffer);
        if (waterCopy) transferables.push(waterCopy.buffer);

        const req: PlacementWorkerRequest = {
          id: `place_${reqId}`,
          params: {
            biomeGrid: biomeCopy,
            gridCols,
            gridRows,
            mapWidth,
            mapHeight,
            elevationGrid: elevCopy,
            seaLevel,
            waterGrid: waterCopy,
            biomeTypes: populatedBiomeTypes,
            customAssets,
            targetSlots,
            region,
            existingSymbols,
            mode,
            seed,
            edgeFade,
            maxCount,
            overallDensity: overallDensity / 100,
            dryRun: false,
          },
        };

        worker.onmessage = (e: MessageEvent<PlacementWorkerResponse>) => {
          if (activeReqIdRef.current !== reqId) return;
          const data = e.data;

          if (data.type === 'progress') {
            setProgressInfo({ progress: data.progress, message: data.message });
          } else if (data.type === 'success') {
            setIsPlacing(false);
            setProgressInfo(null);

            // Apply result
            const placedCount = data.result.stats.totalPlaced;
            onApplySymbols(data.result.symbols, `シンボルを自動配置 (${placedCount}個)`);

            // Build completion message
            const skippedEntries = Object.entries(data.result.stats.skippedReasons);
            let skipMsg = '';
            if (skippedEntries.length > 0) {
              const skippedNames = skippedEntries
                .map(([slotStr, reason]) => {
                  const b = biomeTypes.find((x) => x.slot === Number(slotStr));
                  return `${b?.name || `Slot ${slotStr}`}(${reason})`;
                })
                .join(', ');
              skipMsg = ` ※一部スキップ: ${skippedNames}`;
            }

            setStatusMessage({
              text: `配置完了: ${placedCount}個のシンボルを配置しました。${skipMsg}`,
              type: skippedEntries.length > 0 ? 'warning' : 'success',
            });
          } else if (data.type === 'error') {
            setIsPlacing(false);
            setProgressInfo(null);
            setStatusMessage({
              text: `配置エラー: ${data.error}`,
              type: 'error',
            });
          }
        };

        worker.onerror = (err) => {
          if (activeReqIdRef.current !== reqId) return;
          console.error('Placement worker failed:', err);
          setIsPlacing(false);
          setProgressInfo(null);
          setStatusMessage({
            text: 'シンボルの自動配置中にエラーが発生しました',
            type: 'error',
          });
        };

        worker.postMessage(req, transferables);
      } else {
        // Fallback for non-worker environments
        setTimeout(() => {
          try {
            const result = placeBiomeSymbols({
              biomeGrid: activeBiomeGrid,
              gridCols,
              gridRows,
              mapWidth,
              mapHeight,
              elevationGrid,
              seaLevel,
              waterGrid,
              biomeTypes: populatedBiomeTypes,
              customAssets,
              targetSlots,
              region,
              existingSymbols,
              mode,
              seed,
              edgeFade,
              maxCount,
              overallDensity: overallDensity / 100,
              dryRun: false,
            });

            const placedCount = result.stats.totalPlaced;
            onApplySymbols(result.symbols, `シンボルを自動配置 (${placedCount}個)`);

            setIsPlacing(false);
            setProgressInfo(null);
            setStatusMessage({
              text: `配置完了: ${placedCount}個のシンボルを配置しました。`,
              type: 'success',
            });
          } catch (err: any) {
            setIsPlacing(false);
            setProgressInfo(null);
            setStatusMessage({
              text: `配置エラー: ${err?.message || '不明なエラー'}`,
              type: 'error',
            });
          }
        }, 10);
      }
    },
    [
      activeBiomeGrid,
      elevationGrid,
      seaLevel,
      waterGrid,
      gridCols,
      gridRows,
      mapWidth,
      mapHeight,
      biomeTypes,
      customAssets,
      targetSlots,
      computeVisibleRegion,
      existingSymbols,
      mode,
      seed,
      edgeFade,
      maxCount,
      overallDensity,
      estimatedStats,
      getOrCreateWorker,
      onApplySymbols,
    ]
  );

  // One-Click: Auto-generate biome grid and place mountain and forest symbols from terrain
  const handleAutoGenerateTerrainSymbols = useCallback(() => {
    if (!elevationGrid) return;

    setIsPlacing(true);
    setProgressInfo({ progress: 10, message: '地形解析 & バイオーム準備中...' });
    setStatusMessage(null);

    setTimeout(() => {
      try {
        const percentiles = calculateLandElevPercentiles(elevationGrid, seaLevel, waterGrid);
        const populatedBiomeTypes = applyDefaultRulesToBiomeTypes(biomeTypes, seaLevel, percentiles);

        let targetBiomeGrid: Uint8Array;
        if (regenerateBiomeFromTerrain || !activeBiomeGrid) {
          setProgressInfo({ progress: 25, message: '地形からバイオームを自動分類中...' });
          targetBiomeGrid = generateBiomeGridFromTerrain({
            elevationGrid,
            gridCols,
            gridRows,
            seaLevel,
            mapWidth,
            mapHeight,
            waterGrid,
            seed,
            latitudeMode: activeRegionId ? 'uniform' : 'planet',
            availableSlots: populatedBiomeTypes.map((b) => b.slot),
            existingBiomeGrid: activeBiomeGrid,
            preservePainted: false,
          });
        } else {
          targetBiomeGrid = activeBiomeGrid;
        }

        // Target slots to place: only biomes with explicitly configured symbols
        const targetSlotsToPlace = populatedBiomeTypes
          .filter((b) => b.symbols && b.symbols.length > 0)
          .map((b) => b.slot);

        if (targetSlotsToPlace.length === 0) {
          // No symbols configured in any biome: update only the biome grid if requested
          if (regenerateBiomeFromTerrain && onApplyBiomeAndSymbols) {
            onApplyBiomeAndSymbols(
              targetBiomeGrid,
              existingSymbols,
              'バイオーム自動生成'
            );
          }
          setIsPlacing(false);
          setProgressInfo(null);
          setStatusMessage({
            text: 'バイオームの自動生成が完了しました。（シンボル未設定のためシンボルは配置していません）',
            type: 'success',
          });
          return;
        }

        setProgressInfo({ progress: 45, message: '設定済みシンボルを自動配置中...' });
        const region = computeVisibleRegion();

        const result = placeBiomeSymbols({
          biomeGrid: targetBiomeGrid,
          gridCols,
          gridRows,
          mapWidth,
          mapHeight,
          elevationGrid,
          seaLevel,
          waterGrid,
          biomeTypes: populatedBiomeTypes,
          customAssets,
          targetSlots: targetSlotsToPlace,
          region,
          existingSymbols,
          mode: 'replace',
          seed,
          edgeFade,
          maxCount,
          overallDensity: overallDensity / 100,
          dryRun: false,
          onProgress: (p, msg) => {
            setProgressInfo({ progress: 45 + Math.round(p * 0.5), message: msg });
          },
        });

        const placedCount = result.stats.totalPlaced;

        // Apply with atomic Undo history
        if (regenerateBiomeFromTerrain && onApplyBiomeAndSymbols) {
          onApplyBiomeAndSymbols(
            targetBiomeGrid,
            result.symbols,
            `自動配置 (${placedCount}個)`
          );
        } else {
          onApplySymbols(
            result.symbols,
            `自動配置 (${placedCount}個)`
          );
        }

        setIsPlacing(false);
        setProgressInfo(null);
        setStatusMessage({
          text: `自動配置完了: ${placedCount}個のシンボルを配置しました。(Undo可能)`,
          type: 'success',
        });
      } catch (err: any) {
        console.error('Auto terrain symbol placement failed:', err);
        setIsPlacing(false);
        setProgressInfo(null);
        setStatusMessage({
          text: `自動配置エラー: ${err?.message || '不明なエラー'}`,
          type: 'error',
        });
      }
    }, 20);
  }, [
    elevationGrid,
    seaLevel,
    waterGrid,
    biomeTypes,
    regenerateBiomeFromTerrain,
    activeBiomeGrid,
    gridCols,
    gridRows,
    mapWidth,
    mapHeight,
    seed,
    activeRegionId,
    computeVisibleRegion,
    customAssets,
    existingSymbols,
    edgeFade,
    maxCount,
    overallDensity,
    onApplyBiomeAndSymbols,
    onApplySymbols,
  ]);

  // Execute deletion of auto-placed symbols
  const handleExecuteDeleteAuto = useCallback(() => {
    setShowConfirmDelete(false);
    const { remainingSymbols, removedCount } = removeAutoBiomeSymbols(existingSymbols, {
      targetSlot: deleteTargetSlot,
    });

    if (removedCount === 0) {
      setStatusMessage({
        text: '削除対象の自動配置シンボルはありませんでした。',
        type: 'warning',
      });
      return;
    }

    const desc =
      deleteTargetSlot !== undefined
        ? `自動配置シンボル削除 (${currentBiome?.name || '指定タイプ'} ${removedCount}個)`
        : `自動配置シンボル全削除 (${removedCount}個)`;

    onApplySymbols(remainingSymbols, desc);
    setStatusMessage({
      text: `${removedCount}個の自動配置シンボルを削除しました。（手動配置は保持）`,
      type: 'success',
    });
  }, [existingSymbols, deleteTargetSlot, currentBiome, onApplySymbols]);

  const hasBiomeGrid = !!activeBiomeGrid;

  return (
    <div className="flex flex-col gap-2.5 bg-stone-950/70 p-2.5 rounded-lg border border-stone-800/90 text-xs">
      {/* Section Header */}
      <button
        type="button"
        onClick={() => setIsSectionOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left font-bold text-amber-300 hover:text-amber-200 transition"
      >
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>シンボルの自動配置</span>
        </div>
        {isSectionOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {isSectionOpen && (
        <div className="flex flex-col gap-2.5 pt-1">
          {/* One-Button Auto-Generate Terrain Symbols */}
          <div className="bg-gradient-to-b from-amber-950/70 to-stone-900/90 border border-amber-600/60 p-2.5 rounded-lg flex flex-col gap-2 shadow-inner">

            <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-stone-200 hover:text-white pt-0.5">
              <input
                type="checkbox"
                checked={regenerateBiomeFromTerrain}
                onChange={(e) => setRegenerateBiomeFromTerrain(e.target.checked)}
                className="rounded bg-stone-800 border-stone-600 text-amber-500 focus:ring-0 w-3.5 h-3.5 accent-amber-500 cursor-pointer"
              />
              <span>バイオームを地形から再生成</span>
            </label>

            {/* Mountain Symbols Specification & Size Slider */}
            <div className="mt-1 pt-2 border-t border-amber-700/40 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-amber-200 flex items-center gap-1">
                  <Mountain className="w-3.5 h-3.5 text-amber-400" />
                  <span>配置する山のシンボル ({currentMountainRules.length}種)</span>
                </span>
                <div className="flex items-center gap-1">
                  {currentMountainRules.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearMountainRules}
                      className="text-[10px] text-stone-400 hover:text-stone-200 px-1.5 py-0.5 rounded hover:bg-stone-800 transition"
                      title="山のシンボルを全消去して空にする"
                    >
                      クリア
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsMountainPickerOpen(true)}
                    className="text-[10px] text-amber-300 hover:text-amber-100 font-semibold px-1.5 py-0.5 rounded bg-amber-900/60 hover:bg-amber-800/80 border border-amber-600/60 transition flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>シンボル追加</span>
                  </button>
                </div>
              </div>

              {/* Symbol chips list */}
              {currentMountainRules.length === 0 ? (
                <div className="text-[10.5px] text-stone-400 py-2 px-2.5 bg-stone-900/70 rounded-lg border border-stone-800 text-center">
                  山のシンボルは設定されていません（「+ シンボル追加」から配置したいシンボルを追加できます）
                </div>
              ) : (
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-0.5">
                  {currentMountainRules.map((rule, idx) => {
                    let label = '山シンボル';
                    let iconThumb = '⛰️';
                    let assetUrl: string | undefined;

                    if (rule.kind === 'builtin') {
                      const typeMap: Record<string, string> = {
                        mountain_snow: '雪冠主峰',
                        mountain_rock: '岩峰',
                        mountain_ridge: '岩稜',
                        hill_mound: '丘陵群',
                        volcano: '火山',
                      };
                      label = typeMap[rule.symbolType || ''] || rule.symbolType || '山';
                      iconThumb = rule.symbolType === 'volcano' ? '🌋' : rule.symbolType === 'hill_mound' ? '🟢' : '⛰️';
                    } else if (rule.kind === 'custom') {
                      const asset = customAssets.find((a) => a.id === rule.customAssetId);
                      label = asset?.name || 'カスタム';
                      assetUrl = asset?.dataUrl;
                    }

                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-stone-900/90 border border-stone-700/80 text-[10.5px] text-stone-200 shadow-xs"
                      >
                        {assetUrl ? (
                          <img src={assetUrl} alt={label} className="w-3.5 h-3.5 object-contain rounded-xs" />
                        ) : (
                          <span className="text-[11px]">{iconThumb}</span>
                        )}
                        <span className="truncate max-w-[70px]">{label}</span>
                        <span className="text-[9px] text-amber-400 font-mono">w{rule.weight}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMountainSymbol(idx)}
                          className="text-stone-500 hover:text-rose-400 p-0.5 transition"
                          title="この山シンボルを除外"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Mountain Scale (Size) Slider */}
              <div className="flex flex-col gap-1 pt-1 border-t border-amber-900/40">
                <div className="flex justify-between items-center text-[10.5px]">
                  <span className="text-stone-300 font-medium flex items-center gap-1">
                    <Sliders className="w-3 h-3 text-amber-400" />
                    <span>山の大きさ (倍率):</span>
                  </span>
                  <span className="font-mono text-amber-400 font-bold bg-stone-900 px-1.5 py-0.2 rounded border border-stone-700 text-[10px]">
                    {mountainScaleFactor.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.8}
                  step={0.05}
                  value={mountainScaleFactor}
                  onChange={(e) => handleApplyMountainScaleMultiplier(Number(e.target.value))}
                  className="w-full h-1 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between text-[9px] text-stone-500">
                  <span>小 (0.6x)</span>
                  <span>標準 (1.0x)</span>
                  <span>大 (1.8x)</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={!elevationGrid || isPlacing}
              onClick={handleAutoGenerateTerrainSymbols}
              className={`w-full py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition ${
                !elevationGrid || isPlacing
                  ? 'bg-stone-800 text-stone-500 cursor-not-allowed border border-stone-800'
                  : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 active:from-amber-700 active:to-amber-600 text-stone-950 border border-amber-300 shadow-amber-950/40 cursor-pointer'
              }`}
            >
              {isPlacing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>地形解析 & 配置中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-stone-950" />
                  <span>自動配置</span>
                </>
              )}
            </button>
          </div>

          {/* Missing Biome Grid Warning for manual custom placement */}
          {!hasBiomeGrid && !regenerateBiomeFromTerrain && (
            <div className="bg-amber-950/50 border border-amber-600/70 p-2 rounded-lg flex items-start gap-1.5 text-amber-200 text-[11px] leading-relaxed">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">手動配置用の地形タイプが塗られていません</span>
                <span>上部の「自動配置」を実行するか、ブラシで塗ってください。</span>
              </div>
            </div>
          )}

          {/* 1. Target Selector */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-stone-400 font-medium">対象地形タイプ:</span>
            <div className="grid grid-cols-2 gap-1 bg-stone-900/80 p-0.5 rounded border border-stone-800">
              <button
                type="button"
                onClick={() => setTargetType('all')}
                className={`py-1 px-1.5 rounded text-[11px] font-medium transition ${
                  targetType === 'all'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                すべての地形タイプ
              </button>
              <button
                type="button"
                onClick={() => setTargetType('selected')}
                className={`py-1 px-1.5 rounded text-[11px] font-medium transition truncate ${
                  targetType === 'selected'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
                title={`選択中: ${currentBiome?.name || 'なし'}`}
              >
                選択中のみ ({currentBiome?.name || 'なし'})
              </button>
            </div>
          </div>

          {/* 2. Range Selector */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-stone-400 font-medium">配置範囲:</span>
            <div className="grid grid-cols-2 gap-1 bg-stone-900/80 p-0.5 rounded border border-stone-800">
              <button
                type="button"
                onClick={() => setRangeType('all')}
                className={`py-1 px-1.5 rounded text-[11px] font-medium transition ${
                  rangeType === 'all'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                マップ全体
              </button>
              <button
                type="button"
                onClick={() => setRangeType('viewport')}
                className={`py-1 px-1.5 rounded text-[11px] font-medium transition ${
                  rangeType === 'viewport'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
                title="現在画面に見えている範囲"
              >
                いま表示している範囲
              </button>
            </div>
          </div>

          {/* 3. Mode Selector */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-stone-400 font-medium">配置モード:</span>
            <div className="grid grid-cols-2 gap-1 bg-stone-900/80 p-0.5 rounded border border-stone-800">
              <button
                type="button"
                onClick={() => setMode('replace')}
                className={`py-1 px-1.5 rounded text-[11px] font-medium transition ${
                  mode === 'replace'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
                title="同タイプの古い自動配置を置換"
              >
                自動配置を置き換える
              </button>
              <button
                type="button"
                onClick={() => setMode('append')}
                className={`py-1 px-1.5 rounded text-[11px] font-medium transition ${
                  mode === 'append'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
                title="既存のシンボルを残して追加"
              >
                追加する
              </button>
            </div>
          </div>

          {/* 4. Overall Density Slider */}
          <div className="flex flex-col gap-1 bg-stone-900/60 p-2 rounded border border-stone-800/80">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-stone-300 font-medium">全体の配置量:</span>
              <span className="font-mono text-amber-400 font-bold bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/50">
                {overallDensity}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={overallDensity}
              onChange={(e) => setOverallDensity(Number(e.target.value))}
              className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg w-full"
            />
            <div className="flex justify-between text-[9px] text-stone-500">
              <span>10% (疎ら)</span>
              <span>40% (標準)</span>
              <span>100% (高密度)</span>
            </div>
          </div>

          {/* 5. Edge Fade Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-stone-400 text-[11px]">
              <span>境界を薄くする幅:</span>
              <span className="font-mono text-emerald-400">{edgeFade} px</span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={edgeFade}
              onChange={(e) => setEdgeFade(Number(e.target.value))}
              className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
            />
            <div className="flex justify-between text-[9px] text-stone-500">
              <span>0 (境界まで密集)</span>
              <span>30 (端を自然に薄く)</span>
            </div>
          </div>

          {/* Persistent Placed Symbols Breakdown */}
          <div className="bg-stone-900/80 border border-stone-800 p-2 rounded-lg flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-stone-300 font-medium">
                マップ上の自動配置シンボル:
              </span>
              <span className="font-mono font-bold text-xs text-amber-300">
                {totalAutoPlacedCount.toLocaleString()} 個
              </span>
            </div>
            <div className="text-[10px] text-stone-400 flex flex-wrap gap-x-2.5 gap-y-1">
              {biomeTypes.map((b) => {
                const count = placedCountsPerSlot[b.slot] || 0;
                return (
                  <span key={b.slot} className="inline-flex items-center gap-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: b.color }}
                    />
                    <span className="truncate max-w-[80px]">{b.name}</span>
                    <span className={`font-mono ${count > 0 ? 'text-amber-200 font-semibold' : 'text-stone-500'}`}>
                      {count}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* 5. Seed & Randomize */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-[11px] text-stone-400 shrink-0">シード:</span>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || 0)}
                className="w-full bg-stone-900 border border-stone-700 rounded px-1.5 py-0.5 text-xs text-amber-200 font-mono"
              />
            </div>
            <button
              type="button"
              onClick={() => setSeed(Math.floor(Math.random() * 900000) + 100000)}
              className="px-2 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded border border-stone-700 flex items-center gap-1 text-[11px] shrink-0 transition"
              title="乱数を変更"
            >
              <Shuffle className="w-3 h-3 text-amber-400" />
              <span>別パターン</span>
            </button>
          </div>

          {/* 6. Max Count */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-stone-400 shrink-0">上限数:</span>
            <input
              type="number"
              min={100}
              max={50000}
              step={500}
              value={maxCount}
              onChange={(e) => setMaxCount(Math.max(100, Math.min(50000, Number(e.target.value) || 20000)))}
              className="w-28 bg-stone-900 border border-stone-700 rounded px-1.5 py-0.5 text-xs text-amber-200 font-mono text-right"
            />
          </div>

          {/* 7. Estimate Display */}
          <div className="bg-stone-900/90 border border-stone-800 p-2 rounded-lg flex flex-col gap-1.5 min-h-[52px] justify-center">
            {isEstimating ? (
              <div className="flex items-center gap-2 text-stone-400 text-xs py-0.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
                <span>見積もり計算中…</span>
              </div>
            ) : estimateError ? (
              <div className="text-rose-400 text-[11px] flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>{estimateError}</span>
              </div>
            ) : estimatedStats ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-stone-300 font-medium text-[11px]">
                    配置予定:{' '}
                    <span className="text-emerald-400 font-bold text-xs">
                      {estimatedStats.totalPlaced.toLocaleString()}個
                    </span>
                  </span>
                  {estimatedStats.truncated && (
                    <span className="text-rose-400 font-bold text-[10px] animate-pulse">
                      ⚠️ 上限に達します
                    </span>
                  )}
                </div>

                {/* Per-slot count preview */}
                <div className="text-[10px] text-stone-400 flex flex-wrap gap-x-2 gap-y-0.5 max-h-24 overflow-y-auto pr-0.5">
                  {effectiveBiomeTypes.map((b) => {
                    const count = estimatedStats.placedPerSlot[b.slot] ?? 0;
                    return (
                      <span key={b.slot} className="inline-flex items-center gap-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: b.color }}
                        />
                        <span className="truncate max-w-[100px]">{b.name}</span>
                        <span className="font-mono text-stone-300">{count}</span>
                      </span>
                    );
                  })}
                </div>

                {/* Skipped reasons */}
                {Object.entries(estimatedStats.skippedReasons).map(([slotStr, reason]) => {
                  const slotNum = Number(slotStr);
                  const b = biomeTypes.find((x) => x.slot === slotNum);
                  return (
                    <div
                      key={slotStr}
                      className="text-[10px] text-amber-400/90 flex items-center gap-1 leading-tight"
                    >
                      <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                      <span>
                        {b?.name || `Slot ${slotNum}`}: {reason}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-stone-500 text-[11px]">
                {hasBiomeGrid ? '設定に合わせて配置数を見積もります' : '地形タイプを塗ると見積もりが表示されます'}
              </div>
            )}
          </div>

          {/* Progress Indicator when placing */}
          {isPlacing && progressInfo && (
            <div className="flex flex-col gap-1 bg-amber-950/40 border border-amber-600/50 p-2 rounded-lg animate-in fade-in">
              <div className="flex justify-between text-[11px] text-amber-300">
                <span className="truncate">{progressInfo.message}</span>
                <span className="font-mono">{progressInfo.progress}%</span>
              </div>
              <div className="w-full h-1.5 bg-stone-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-150"
                  style={{ width: `${progressInfo.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Status Message */}
          {statusMessage && (
            <div
              className={`p-2 rounded text-[11px] flex items-start gap-1.5 leading-tight ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/60 border border-emerald-600/60 text-emerald-200'
                  : statusMessage.type === 'warning'
                  ? 'bg-amber-950/60 border border-amber-600/60 text-amber-200'
                  : 'bg-rose-950/60 border border-rose-600/60 text-rose-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* 8. Placement Button & Confirm Heavy Dialog */}
          {showConfirmHeavy ? (
            <div className="bg-rose-950/80 border border-rose-600/70 p-2.5 rounded-lg flex flex-col gap-2 text-xs">
              <div className="flex items-start gap-1.5 text-rose-200 text-[11px] leading-relaxed">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">シンボル数が30,000個を超えます</span>
                  <span>シンボルが多く、描画や動作が重くなる可能性があります。配置を実行しますか？</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 justify-end">
                <button
                  type="button"
                  onClick={() => setShowConfirmHeavy(false)}
                  className="px-2.5 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => executePlacement(true)}
                  className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-stone-950 font-bold text-xs shadow"
                >
                  実行する
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!hasBiomeGrid || isPlacing}
              onClick={() => executePlacement(false)}
              className={`w-full py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition ${
                !hasBiomeGrid || isPlacing
                  ? 'bg-stone-800 text-stone-500 cursor-not-allowed border border-stone-800'
                  : 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-stone-950 border border-amber-400'
              }`}
            >
              {isPlacing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>配置を実行中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-stone-950" />
                  <span>配置する</span>
                </>
              )}
            </button>
          )}

          {/* 9. Delete Auto-placed symbols section */}
          <div className="border-t border-stone-800/80 pt-2 flex flex-col gap-1.5">
            <span className="text-[11px] text-stone-400 font-medium">自動配置シンボルの削除:</span>
            <div className="grid grid-cols-2 gap-1 bg-stone-900/80 p-0.5 rounded border border-stone-800">
              <button
                type="button"
                onClick={() => setDeleteTargetMode('selected')}
                className={`py-1 px-1.5 rounded text-[10px] font-medium transition truncate ${
                  deleteTargetMode === 'selected'
                    ? 'bg-stone-700 text-stone-200 border border-stone-600'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
                title={`選択中: ${currentBiome?.name || 'なし'}`}
              >
                選択中のみ ({currentBiome?.name || 'なし'})
              </button>
              <button
                type="button"
                onClick={() => setDeleteTargetMode('all')}
                className={`py-1 px-1.5 rounded text-[10px] font-medium transition ${
                  deleteTargetMode === 'all'
                    ? 'bg-stone-700 text-stone-200 border border-stone-600'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                すべての自動配置
              </button>
            </div>

            {showConfirmDelete ? (
              <div className="bg-rose-950/80 border border-rose-600/70 p-2 rounded-lg flex flex-col gap-1.5 text-xs">
                <div className="flex items-center gap-1.5 text-rose-200 text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>
                    自動配置されたシンボル <strong className="text-white">{autoPlacedCountToDelete}個</strong> を削除しますか？
                  </span>
                </div>
                <div className="text-[10px] text-stone-400">
                  ※手動で配置したシンボルは削除されません（Undo可能）。
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowConfirmDelete(false)}
                    className="px-2 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px]"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteDeleteAuto}
                    className="px-2.5 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-stone-950 font-bold text-[11px] shadow"
                  >
                    削除する
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={autoPlacedCountToDelete === 0}
                onClick={() => setShowConfirmDelete(true)}
                className={`w-full py-1.5 px-2.5 rounded bg-stone-900 border text-[11px] flex items-center justify-center gap-1.5 transition ${
                  autoPlacedCountToDelete === 0
                    ? 'border-stone-800 text-stone-600 cursor-not-allowed'
                    : 'border-stone-700 hover:border-rose-700/60 text-stone-300 hover:text-rose-300 hover:bg-rose-950/30'
                }`}
                title="自動配置シンボルのみ削除"
              >
                <Trash2 className="w-3 h-3 text-stone-400" />
                <span>
                  自動配置シンボルを削除 ({autoPlacedCountToDelete}個)
                </span>
              </button>
            )}
          </div>
        </div>
      )}
      {/* Mountain Symbol Picker Modal */}
      {isMountainPickerOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-stone-900 border border-stone-700 rounded-2xl max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl text-stone-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800 bg-stone-950/80">
              <div className="flex items-center gap-2">
                <Mountain className="w-4 h-4 text-amber-400" />
                <h4 className="font-bold text-sm text-amber-200">山脈に配置するシンボルを選択</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsMountainPickerOpen(false)}
                className="p-1 text-stone-400 hover:text-stone-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 text-xs">
              {/* Custom Registered / Imported Symbols */}
              {customAssets.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between font-bold text-emerald-300 border-b border-stone-800 pb-1">
                    <span className="flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5" />
                      登録・インポートしたシンボル ({customAssets.length})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {customAssets.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          handleAddMountainSymbol({
                            kind: 'custom',
                            customAssetId: asset.id,
                            weight: 5,
                            scaleMin: Number((0.8 * mountainScaleFactor).toFixed(2)),
                            scaleMax: Number((1.1 * mountainScaleFactor).toFixed(2)),
                            scaleByElevation: true,
                          });
                          setIsMountainPickerOpen(false);
                        }}
                        className="flex items-center gap-2 p-2 bg-stone-950/70 hover:bg-stone-800 border border-stone-800 hover:border-amber-500 rounded-lg text-left transition group cursor-pointer"
                      >
                        <img
                          src={asset.dataUrl}
                          alt={asset.name}
                          className="w-8 h-8 rounded bg-stone-900 object-contain p-0.5 border border-stone-700 shrink-0"
                        />
                        <div className="truncate">
                          <div className="font-semibold text-stone-200 group-hover:text-amber-200 truncate">
                            {asset.name}
                          </div>
                          <div className="text-[10px] text-stone-500">
                            {asset.category || 'カスタム'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-stone-400 bg-stone-950/50 border border-stone-800 rounded-xl space-y-2">
                  <p className="font-semibold text-stone-200">登録されたカスタムシンボルがありません</p>
                  <p className="text-[11px] text-stone-400 leading-relaxed">
                    シンボルスタジオや画像インポートからシンボルを登録すると、ここに表示されて山脈に配置できるようになります。
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const BiomePlacePanel = React.memo(BiomePlacePanelComponent);
