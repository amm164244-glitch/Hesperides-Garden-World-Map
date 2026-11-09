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
} from 'lucide-react';
import { BiomeType } from '../types/biome';
import { CustomMapAsset, MapSymbolInstance } from '../types/symbols';
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

export interface BiomePlacePanelProps {
  selectedBiomeId: number;
  biomeTypes: BiomeType[];
  customAssets?: CustomMapAsset[];
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
}) => {
  // Panel collapsed state
  const [isSectionOpen, setIsSectionOpen] = useState<boolean>(true);

  // Settings State
  const [targetType, setTargetType] = useState<'all' | 'selected'>('all');
  const [rangeType, setRangeType] = useState<'all' | 'viewport'>('all');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [edgeFade, setEdgeFade] = useState<number>(6);
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 900000) + 100000);
  const [maxCount, setMaxCount] = useState<number>(20000);

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

      if (worker) {
        // Safe transferable copy of grids to prevent detachment of caller arrays
        const biomeCopy = new Uint8Array(activeBiomeGrid);
        const elevCopy = elevationGrid ? new Float32Array(elevationGrid) : undefined;
        const transferables: Transferable[] = [biomeCopy.buffer];
        if (elevCopy) transferables.push(elevCopy.buffer);

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
            biomeTypes,
            customAssets,
            targetSlots,
            region,
            existingSymbols,
            mode,
            seed,
            edgeFade,
            maxCount,
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
            biomeTypes,
            customAssets,
            targetSlots,
            region,
            existingSymbols,
            mode,
            seed,
            edgeFade,
            maxCount,
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

      const worker = getOrCreateWorker();

      if (worker) {
        // Transferable copies
        const biomeCopy = new Uint8Array(activeBiomeGrid);
        const elevCopy = elevationGrid ? new Float32Array(elevationGrid) : undefined;
        const transferables: Transferable[] = [biomeCopy.buffer];
        if (elevCopy) transferables.push(elevCopy.buffer);

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
            biomeTypes,
            customAssets,
            targetSlots,
            region,
            existingSymbols,
            mode,
            seed,
            edgeFade,
            maxCount,
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
              biomeTypes,
              customAssets,
              targetSlots,
              region,
              existingSymbols,
              mode,
              seed,
              edgeFade,
              maxCount,
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
      estimatedStats,
      getOrCreateWorker,
      onApplySymbols,
    ]
  );

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
          {/* Missing Biome Grid Warning */}
          {!hasBiomeGrid && (
            <div className="bg-amber-950/50 border border-amber-600/70 p-2 rounded-lg flex items-start gap-1.5 text-amber-200 text-[11px] leading-relaxed">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">このマップには地形タイプが塗られていません</span>
                <span>上部のブラシやバケツで地形タイプを塗ってから実行してください。</span>
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

          {/* 4. Edge Fade Slider */}
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
                  <span>配置する (Undo可能)</span>
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
    </div>
  );
};

export const BiomePlacePanel = React.memo(BiomePlacePanelComponent);
