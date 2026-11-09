import React, { useState, useRef } from 'react';
import {
  Waves,
  MousePointer,
  PenTool,
  CircleDot,
  Trash2,
  X,
  Sliders,
  Eye,
  EyeOff,
  Sparkles,
  RefreshCw,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { RiverData, LakeData, WaterToolSettings } from '../types/water';
import { BrushMode } from '../types/map';

export interface AutoGenResult {
  riverCount: number;
  lakeCount: number;
  computationTimeMs?: number;
  longestRiverKm?: number;
  avgRiverLengthKm?: number;
}

interface WaterPanelProps {
  mode: BrushMode;
  onChangeMode: (mode: BrushMode) => void;
  waterSettings: WaterToolSettings;
  onChangeWaterSettings: (patch: Partial<WaterToolSettings>) => void;
  rivers: RiverData[];
  lakes: LakeData[];
  selectedWaterId: string | null;
  selectedWaterType: 'river' | 'lake' | null;
  onSelectWater: (id: string | null, type: 'river' | 'lake' | null) => void;
  onUpdateRiver: (river: RiverData) => void;
  onUpdateLake: (lake: LakeData) => void;
  onDeleteWater: (id: string, type: 'river' | 'lake') => void;
  onClearAllWater: () => void;
  onClose: () => void;
  inProgressCount?: number;
  onCommitRiverDrawing?: () => void;
  onCancelRiverDrawing?: () => void;
  kmPerUnit?: number;
  onAutoGenerateWater?: (options: {
    riverDensity: number;
    meander: number;
    riverCount: number;
    lakeCount: number;
    headExtension: number;
    onProgress?: (percent: number, message: string) => void;
    signal?: AbortSignal;
  }) => Promise<AutoGenResult | void> | void;
}

const WaterPanelComponent: React.FC<WaterPanelProps> = ({
  mode,
  onChangeMode,
  waterSettings,
  onChangeWaterSettings,
  rivers,
  lakes,
  selectedWaterId,
  selectedWaterType,
  onSelectWater,
  onUpdateRiver,
  onUpdateLake,
  onDeleteWater,
  onClearAllWater,
  onClose,
  inProgressCount = 0,
  onCommitRiverDrawing,
  onCancelRiverDrawing,
  kmPerUnit = 1.0,
  onAutoGenerateWater,
}) => {
  const selectedRiver = selectedWaterType === 'river' ? rivers.find((r) => r.id === selectedWaterId) : null;
  const selectedLake = selectedWaterType === 'lake' ? lakes.find((l) => l.id === selectedWaterId) : null;

  // Auto-generation UI states
  const [showAutoSection, setShowAutoSection] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ percent: number; message: string } | null>(null);
  const [lastResult, setLastResult] = useState<AutoGenResult | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const riverDensity = waterSettings.riverDensity ?? 40;
  const meander = waterSettings.meander ?? 60;
  const riverCount = waterSettings.riverCount ?? 14;
  const lakeCount = waterSettings.lakeCount ?? 6;
  const headExtension = waterSettings.headExtension ?? 80;

  // River length statistics
  const riverLengthsKm = rivers.map((r) => {
    let len = 0;
    for (let i = 0; i < r.points.length - 1; i++) {
      len += Math.hypot(r.points[i + 1][0] - r.points[i][0], r.points[i + 1][1] - r.points[i][1]);
    }
    return len * kmPerUnit;
  });

  const longestRiverKm = riverLengthsKm.length > 0 ? Math.max(...riverLengthsKm) : 0;
  const avgRiverLengthKm = riverLengthsKm.length > 0
    ? riverLengthsKm.reduce((a, b) => a + b, 0) / riverLengthsKm.length
    : 0;

  const handleStartAutoGenerate = async () => {
    if (!onAutoGenerateWater || isGenerating) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsGenerating(true);
    setGenProgress({ percent: 5, message: '水文解析の準備中...' });
    setLastResult(null);

    try {
      const res = await onAutoGenerateWater({
        riverDensity,
        meander,
        riverCount,
        lakeCount,
        headExtension,
        onProgress: (percent, message) => {
          setGenProgress({ percent, message });
        },
        signal: controller.signal,
      });

      if (res && typeof res.riverCount === 'number') {
        setLastResult(res);
      } else {
        setLastResult({ riverCount: rivers.length, lakeCount: lakes.length });
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('水系自動生成エラー:', err);
      }
    } finally {
      setIsGenerating(false);
      setGenProgress(null);
      abortControllerRef.current = null;
    }
  };

  const handleCancelAutoGenerate = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setGenProgress(null);
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-stone-900/95 backdrop-blur-md border border-cyan-600/70 rounded-xl px-4 py-2.5 shadow-2xl flex flex-col gap-2.5 text-xs text-stone-200 pointer-events-auto animate-in fade-in slide-in-from-top-2 max-w-[95vw] w-[580px]">
      {/* Header & Mode Switcher */}
      <div className="flex items-center justify-between border-b border-stone-800 pb-2">
        <div className="flex items-center gap-2">
          <Waves className="w-4 h-4 text-cyan-400" />
          <span className="font-bold text-stone-100 text-sm">水域編集 (川・湖)</span>
          <span className="text-[11px] text-cyan-300 font-mono bg-cyan-950/70 px-2 py-0.5 rounded border border-cyan-800/60">
            川 {rivers.length}本 / 湖 {lakes.length}個
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Show / Hide toggle */}
          <button
            type="button"
            onClick={() => onChangeWaterSettings({ showWater: !waterSettings.showWater })}
            className={`p-1.5 rounded-lg text-xs transition flex items-center justify-center ${
              waterSettings.showWater
                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-700/60'
                : 'bg-stone-800 text-stone-500 hover:text-stone-300'
            }`}
            title={`水域表示: ${waterSettings.showWater ? 'ON' : 'OFF'}`}
          >
            {waterSettings.showWater ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>

          {/* Close Panel */}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition"
            title="水域パネルを閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Auto-Generation Hydrology Section */}
      <div className="bg-stone-950/70 border border-cyan-900/60 rounded-lg p-2.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-cyan-300 font-semibold text-[11px]">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>地形水文シミュレーション (自動生成)</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAutoSection(!showAutoSection)}
            className="text-[10px] text-stone-400 hover:text-stone-200 transition"
          >
            {showAutoSection ? '折りたたむ' : '設定を展開'}
          </button>
        </div>

        {showAutoSection && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1 border-t border-stone-800/60 text-[11px]">
            {/* 1. River Density */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-stone-300">
                <span>川の密度:</span>
                <span className="font-mono text-cyan-300 font-bold">{riverDensity}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={riverDensity}
                disabled={isGenerating}
                onChange={(e) => onChangeWaterSettings({ riverDensity: Number(e.target.value) })}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>

            {/* 2. Meandering Strength */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-stone-300">
                <span>蛇行の強さ:</span>
                <span className="font-mono text-cyan-300 font-bold">{meander}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={meander}
                disabled={isGenerating}
                onChange={(e) => onChangeWaterSettings({ meander: Number(e.target.value) })}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>

            {/* 3. River Max Count */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-stone-300">
                <span>川の本数 (上限):</span>
                <span className="font-mono text-cyan-300 font-bold">{riverCount} 本</span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={riverCount}
                disabled={isGenerating}
                onChange={(e) => onChangeWaterSettings({ riverCount: Number(e.target.value) })}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>

            {/* 4. Lake Max Count */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-stone-300">
                <span>湖の数 (上限):</span>
                <span className="font-mono text-cyan-300 font-bold">{lakeCount} 個</span>
              </div>
              <input
                type="range"
                min={0}
                max={15}
                step={1}
                value={lakeCount}
                disabled={isGenerating}
                onChange={(e) => onChangeWaterSettings({ lakeCount: Number(e.target.value) })}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>

            {/* 5. Headwaters Extension */}
            <div className="flex flex-col gap-1 col-span-2">
              <div className="flex justify-between text-stone-300">
                <span title="大きいほど、川が上流(山の奥)まで延びます">源流の延長:</span>
                <span className="font-mono text-cyan-300 font-bold">{headExtension}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={headExtension}
                disabled={isGenerating}
                onChange={(e) => onChangeWaterSettings({ headExtension: Number(e.target.value) })}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
                title="大きいほど、川が上流(山の奥)まで延びます"
              />
              <span className="text-[10px] text-stone-400">大きいほど、川が上流(山の奥)まで延びます</span>
            </div>
          </div>
        )}

        {/* Generate Button & Progress State */}
        <div className="flex items-center justify-between gap-2 pt-1">
          {isGenerating ? (
            <div className="flex-1 flex items-center justify-between bg-cyan-950/80 border border-cyan-700/60 rounded-md px-3 py-1.5">
              <div className="flex items-center gap-2 text-cyan-200">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                <span className="text-[11px] font-medium">{genProgress?.message || '計算中...'}</span>
                <span className="text-[10px] text-cyan-400 font-mono font-bold">({genProgress?.percent ?? 0}%)</span>
              </div>
              <button
                type="button"
                onClick={handleCancelAutoGenerate}
                className="px-2 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-[10px] transition"
              >
                中止
              </button>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleStartAutoGenerate}
                disabled={!onAutoGenerateWater}
                className="flex-1 py-1.5 px-3 rounded-md bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-stone-950 font-bold flex items-center justify-center gap-1.5 shadow transition disabled:opacity-50 cursor-pointer"
                title="現在の標高地形から下流への水の流れを計算し、川と湖を再構築します"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>地形から水系を自動生成</span>
              </button>

              {lastResult && (
                <div className="flex flex-col gap-0.5 text-[11px] text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 px-2.5 py-1 rounded">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>
                      生成完了: 川 {lastResult.riverCount}本 / 湖 {lastResult.lakeCount}個
                      {lastResult.computationTimeMs ? ` (${lastResult.computationTimeMs}ms)` : ''}
                    </span>
                  </div>
                  {rivers.length > 0 && (
                    <div className="text-[10px] text-stone-300 pl-5 flex items-center gap-3">
                      <span>最長の川: {longestRiverKm.toFixed(1)} km</span>
                      <span>川の平均の長さ: {avgRiverLengthKm.toFixed(1)} km</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Manual Mode Selector Tabs */}
      <div className="flex items-center gap-1.5 bg-stone-950/80 p-1 rounded-lg border border-stone-800">
        <button
          type="button"
          onClick={() => onChangeMode('river')}
          className={`flex-1 py-1.5 px-2 rounded-md font-medium text-xs flex items-center justify-center gap-1.5 transition ${
            mode === 'river'
              ? 'bg-cyan-600 text-stone-950 font-bold shadow'
              : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
          }`}
          title="クリックで水源から河口へ川を描画"
        >
          <PenTool className="w-3.5 h-3.5" />
          <span>川を手描き</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeMode('lake')}
          className={`flex-1 py-1.5 px-2 rounded-md font-medium text-xs flex items-center justify-center gap-1.5 transition ${
            mode === 'lake'
              ? 'bg-cyan-600 text-stone-950 font-bold shadow'
              : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
          }`}
          title="ドラッグまたは多角形で湖を描画"
        >
          <CircleDot className="w-3.5 h-3.5" />
          <span>湖を手描き</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeMode('waterEdit')}
          className={`flex-1 py-1.5 px-2 rounded-md font-medium text-xs flex items-center justify-center gap-1.5 transition ${
            mode === 'waterEdit'
              ? 'bg-amber-500 text-stone-950 font-bold shadow'
              : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
          }`}
          title="川や湖をクリックして選択、頂点をドラッグして変形・削除"
        >
          <MousePointer className="w-3.5 h-3.5" />
          <span>選択・変形</span>
        </button>
      </div>

      {/* Mode Specific Controls */}
      {mode === 'river' && (
        <div className="flex flex-col gap-2 bg-stone-950/50 p-2.5 rounded-lg border border-stone-800">
          <div className="flex items-center justify-between text-stone-400 text-[11px]">
            <span>地図をクリックして頂点を配置。Enterまたはダブルクリックで完了</span>
            {inProgressCount > 0 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onCommitRiverDrawing}
                  disabled={inProgressCount < 2}
                  className="px-2 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-stone-950 font-bold disabled:opacity-50 transition cursor-pointer"
                >
                  完了 ({inProgressCount}点)
                </button>
                <button
                  type="button"
                  onClick={onCancelRiverDrawing}
                  className="px-2 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 transition cursor-pointer"
                >
                  取消
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-stone-300 text-[11px]">
                <span>水源の太さ (上流):</span>
                <span className="font-mono text-cyan-300 font-bold">{waterSettings.riverWidthStart} px</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={6}
                step={0.25}
                value={waterSettings.riverWidthStart}
                onChange={(e) => onChangeWaterSettings({ riverWidthStart: Number(e.target.value) })}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-stone-300 text-[11px]">
                <span>河口の太さ (下流):</span>
                <span className="font-mono text-cyan-300 font-bold">{waterSettings.riverWidthEnd} px</span>
              </div>
              <input
                type="range"
                min={1}
                max={12}
                step={0.25}
                value={waterSettings.riverWidthEnd}
                onChange={(e) => onChangeWaterSettings({ riverWidthEnd: Number(e.target.value) })}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {mode === 'lake' && (
        <div className="flex flex-col gap-2 bg-stone-950/50 p-2.5 rounded-lg border border-stone-800">
          <div className="flex items-center justify-between">
            <span className="text-stone-400 text-[11px]">
              {waterSettings.lakeMode === 'drag'
                ? '地図上をドラッグするとその位置に自然な湖が配置されます'
                : '地図をクリックして湖の輪郭多角形を描画。Enterで完了'}
            </span>
            <div className="flex items-center gap-1 bg-stone-900 p-0.5 rounded border border-stone-800">
              <button
                type="button"
                onClick={() => onChangeWaterSettings({ lakeMode: 'drag' })}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                  waterSettings.lakeMode === 'drag'
                    ? 'bg-cyan-600 text-stone-950 font-bold'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                ドラッグ配置
              </button>
              <button
                type="button"
                onClick={() => onChangeWaterSettings({ lakeMode: 'polygon' })}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                  waterSettings.lakeMode === 'polygon'
                    ? 'bg-cyan-600 text-stone-950 font-bold'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                多角形クリック
              </button>
            </div>
          </div>

          {waterSettings.lakeMode === 'drag' && (
            <div className="flex flex-col gap-1 pt-1">
              <div className="flex justify-between text-stone-300 text-[11px]">
                <span>湖の半径 (サイズ):</span>
                <span className="font-mono text-cyan-300 font-bold">{waterSettings.lakeRadius} px</span>
              </div>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={waterSettings.lakeRadius}
                onChange={(e) => onChangeWaterSettings({ lakeRadius: Number(e.target.value) })}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>
          )}
        </div>
      )}

      {mode === 'waterEdit' && (
        <div className="flex flex-col gap-2 bg-stone-950/50 p-2.5 rounded-lg border border-stone-800">
          {selectedRiver ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-300">選択中の川:</span>
                <button
                  type="button"
                  onClick={() => onDeleteWater(selectedRiver.id, 'river')}
                  className="px-2 py-1 rounded bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800/80 text-[11px] font-semibold flex items-center gap-1 transition"
                  title="川を削除 (Deleteキー)"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>川を削除</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-stone-400 text-[11px] shrink-0">名前:</span>
                <input
                  type="text"
                  value={selectedRiver.name || ''}
                  onChange={(e) => onUpdateRiver({ ...selectedRiver, name: e.target.value })}
                  placeholder="川の名前"
                  className="flex-1 bg-stone-900 border border-stone-700 px-2 py-1 rounded text-xs text-stone-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-stone-400 text-[10px]">
                    <span>上流幅:</span>
                    <span className="font-mono text-amber-300">{selectedRiver.widthStart ?? 2.5} px</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={0.5}
                    value={selectedRiver.widthStart ?? 2.5}
                    onChange={(e) => onUpdateRiver({ ...selectedRiver, widthStart: Number(e.target.value) })}
                    className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-stone-400 text-[10px]">
                    <span>下流幅:</span>
                    <span className="font-mono text-amber-300">{selectedRiver.widthEnd ?? 8.0} px</span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={40}
                    step={0.5}
                    value={selectedRiver.widthEnd ?? 8.0}
                    onChange={(e) => onUpdateRiver({ ...selectedRiver, widthEnd: Number(e.target.value) })}
                    className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
                  />
                </div>
              </div>
              <div className="text-[10px] text-stone-500">
                頂点数: {selectedRiver.points.length}点 (頂点をドラッグして流路を変更できます)
              </div>
            </div>
          ) : selectedLake ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-300">選択中の湖:</span>
                <button
                  type="button"
                  onClick={() => onDeleteWater(selectedLake.id, 'lake')}
                  className="px-2 py-1 rounded bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800/80 text-[11px] font-semibold flex items-center gap-1 transition"
                  title="湖を削除 (Deleteキー)"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>湖を削除</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-stone-400 text-[11px] shrink-0">名前:</span>
                <input
                  type="text"
                  value={selectedLake.name || ''}
                  onChange={(e) => onUpdateLake({ ...selectedLake, name: e.target.value })}
                  placeholder="湖の名前"
                  className="flex-1 bg-stone-900 border border-stone-700 px-2 py-1 rounded text-xs text-stone-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="text-[10px] text-stone-500">
                外周頂点数: {selectedLake.polygon.length}点 (頂点をドラッグして岸辺を変形できます)
              </div>
            </div>
          ) : (
            <div className="text-stone-400 text-[11px] py-1 text-center">
              川または湖をクリックすると選択され、頂点ドラッグ変形や名前・太さの変更ができます。
            </div>
          )}
        </div>
      )}

      {/* Bottom Actions: Clear & Quick Selector */}
      {(rivers.length > 0 || lakes.length > 0) && (
        <div className="flex items-center justify-between pt-1 border-t border-stone-800 text-[11px]">
          <button
            type="button"
            onClick={onClearAllWater}
            className="px-2 py-1 rounded bg-stone-800 hover:bg-red-950 text-stone-400 hover:text-red-300 transition text-[11px]"
            title="現在のマップの川・湖をすべて削除"
          >
            全消去
          </button>

          {/* Existing items dropdown quick selector */}
          <select
            value={selectedWaterId || ''}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                onSelectWater(null, null);
              } else if (val.startsWith('river_')) {
                onSelectWater(val, 'river');
              } else {
                onSelectWater(val, 'lake');
              }
            }}
            className="bg-stone-950 border border-stone-800 text-stone-300 text-[11px] px-2 py-1 rounded max-w-[180px] truncate"
          >
            <option value="">-- 水域を選択 --</option>
            {rivers.length > 0 && (
              <optgroup label="川">
                {rivers.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {r.name || `川 ${i + 1}`}
                  </option>
                ))}
              </optgroup>
            )}
            {lakes.length > 0 && (
              <optgroup label="湖">
                {lakes.map((l, i) => (
                  <option key={l.id} value={l.id}>
                    {l.name || `湖 ${i + 1}`}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}
    </div>
  );
};

export const WaterPanel = React.memo(WaterPanelComponent);
