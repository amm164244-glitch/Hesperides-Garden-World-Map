import React, { useState } from 'react';
import {
  Waves,
  MousePointer,
  PenTool,
  CircleDot,
  Trash2,
  X,
  Sparkles,
  Sliders,
  Eye,
  EyeOff,
  Plus,
} from 'lucide-react';
import { RiverData, LakeData, WaterToolSettings } from '../types/water';
import { BrushMode } from '../types/map';

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
  onAutoGenerateWater: (riverCount: number, lakeCount: number) => void;
  onClose: () => void;
  inProgressCount?: number;
  onCommitRiverDrawing?: () => void;
  onCancelRiverDrawing?: () => void;
}

export const WaterPanel: React.FC<WaterPanelProps> = ({
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
  onAutoGenerateWater,
  onClose,
  inProgressCount = 0,
  onCommitRiverDrawing,
  onCancelRiverDrawing,
}) => {
  const [showAutoModal, setShowAutoModal] = useState(false);
  const [autoRiverCount, setAutoRiverCount] = useState(waterSettings.autoRiverCount || 14);
  const [autoLakeCount, setAutoLakeCount] = useState(waterSettings.autoLakeCount || 6);

  const selectedRiver = selectedWaterType === 'river' ? rivers.find((r) => r.id === selectedWaterId) : null;
  const selectedLake = selectedWaterType === 'lake' ? lakes.find((l) => l.id === selectedWaterId) : null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-stone-900/95 backdrop-blur-md border border-cyan-600/70 rounded-xl px-4 py-2.5 shadow-2xl flex flex-col gap-2.5 text-xs text-stone-200 pointer-events-auto animate-in fade-in slide-in-from-top-2 max-w-[95vw] w-[560px]">
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

      {/* Mode Selector Tabs */}
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
          <span>川を描く</span>
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
          <span>湖を描く</span>
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
            <span>💡 地図をクリックして頂点を配置。Enterまたはダブルクリックで完了</span>
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
                ? '💡 地図上をドラッグするとその位置に自然な湖が配置されます'
                : '💡 地図をクリックして湖の輪郭多角形を描画。Enterで完了'}
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
                <span className="font-semibold text-amber-300">🌊 選択中の川:</span>
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
                <span className="font-semibold text-amber-300">🏞️ 選択中の湖:</span>
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

      {/* Bottom Actions: Auto Generate & Clear */}
      <div className="flex items-center justify-between pt-1 border-t border-stone-800 text-[11px]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAutoModal((prev) => !prev)}
            className="px-2.5 py-1 rounded bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 border border-cyan-700/80 font-medium flex items-center gap-1.5 transition shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>川と湖を自動生成</span>
          </button>

          {(rivers.length > 0 || lakes.length > 0) && (
            <button
              type="button"
              onClick={onClearAllWater}
              className="px-2 py-1 rounded bg-stone-800 hover:bg-red-950 text-stone-400 hover:text-red-300 transition text-[11px]"
              title="現在のマップの川・湖をすべて削除"
            >
              全消去
            </button>
          )}
        </div>

        {/* Existing items dropdown quick selector */}
        {(rivers.length > 0 || lakes.length > 0) && (
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
        )}
      </div>

      {/* Auto-Generation Settings Popout */}
      {showAutoModal && (
        <div className="bg-stone-950/90 border border-cyan-600/80 rounded-lg p-3 flex flex-col gap-2.5 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-cyan-300">標高地形から自動生成:</span>
            <button
              type="button"
              onClick={() => setShowAutoModal(false)}
              className="text-stone-500 hover:text-stone-300 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-stone-400">川の数:</span>
                <span className="font-mono text-cyan-300 font-bold">{autoRiverCount}</span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={autoRiverCount}
                onChange={(e) => setAutoRiverCount(Number(e.target.value))}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-stone-400">湖の数:</span>
                <span className="font-mono text-cyan-300 font-bold">{autoLakeCount}</span>
              </div>
              <input
                type="range"
                min={0}
                max={15}
                step={1}
                value={autoLakeCount}
                onChange={(e) => setAutoLakeCount(Number(e.target.value))}
                className="accent-cyan-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAutoModal(false)}
              className="px-2.5 py-1 rounded bg-stone-800 text-stone-300 hover:bg-stone-700 transition"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => {
                onAutoGenerateWater(autoRiverCount, autoLakeCount);
                setShowAutoModal(false);
              }}
              className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-stone-950 font-bold transition shadow"
            >
              生成を実行
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
