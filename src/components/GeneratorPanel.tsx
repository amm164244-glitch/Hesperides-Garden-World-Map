import React, { useState } from 'react';
import { RefreshCw, Shuffle, Sliders, X, Globe, Layers, Waves, FileImage, Sparkles } from 'lucide-react';
import { GeneratorConfig } from '../types/map';
import { hashStringToSeed } from '../utils/prng';

interface GeneratorPanelProps {
  config: GeneratorConfig;
  onUpdateConfig: (newConfig: Partial<GeneratorConfig>) => void;
  onRegenerate: () => void;
  onGenerateBlankOcean?: () => void;
  onOpenImageToTerrain?: () => void;
  onApplyCoastSmoothingToCurrentMap?: () => void;
  isWorldMapActive?: boolean;
  isGenerating: boolean;
  generationProgress?: { progress: number; message: string };
  onClose: () => void;
}

export const GeneratorPanel: React.FC<GeneratorPanelProps> = ({
  config,
  onUpdateConfig,
  onRegenerate,
  onGenerateBlankOcean,
  onOpenImageToTerrain,
  onApplyCoastSmoothingToCurrentMap,
  isWorldMapActive = true,
  isGenerating,
  generationProgress,
  onClose,
}) => {
  const [seedInput, setSeedInput] = useState<string>(String(config.seed));
  const [showSmoothingConfirm, setShowSmoothingConfirm] = useState(false);

  const handleRandomSeed = () => {
    const nextSeed = Math.floor(Math.random() * 90000000) + 10000000;
    setSeedInput(String(nextSeed));
    onUpdateConfig({ seed: nextSeed });
  };

  return (
    <div className="w-88 bg-stone-900/95 backdrop-blur-md text-stone-200 border border-stone-700/80 rounded-xl shadow-2xl p-4 flex flex-col gap-3.5 text-xs max-h-[88vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-800 pb-2">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-amber-400" />
          <h2 className="font-bold text-stone-100 text-sm">世界マップ生成パラメータ</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-stone-400 hover:text-stone-200 p-1 rounded-md hover:bg-stone-800 transition"
          aria-label="パネルを閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress display if generating */}
      {isGenerating && generationProgress && (
        <div className="p-2.5 rounded-lg bg-amber-950/70 border border-amber-700/60 space-y-1.5 animate-pulse">
          <div className="flex justify-between items-center text-[11px] text-amber-200 font-medium">
            <span>{generationProgress.message || '世界マップ生成中...'}</span>
            <span className="font-mono">{generationProgress.progress}%</span>
          </div>
          <div className="w-full bg-stone-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-amber-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${generationProgress.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Seed controls */}
      <div className="flex flex-col gap-1.5 bg-stone-950/60 p-2.5 rounded-lg border border-stone-800">
        <label htmlFor="seed-input" className="font-medium text-stone-300 flex items-center justify-between">
          <span>シード値 (Seed)</span>
          <span className="text-[10px] text-stone-500">同じシードで同一地形</span>
        </label>
        <div className="flex gap-1.5">
          <input
            id="seed-input"
            type="text"
            value={seedInput}
            onChange={(e) => {
              setSeedInput(e.target.value);
              const val = e.target.value.trim();
              if (val) {
                const numeric = /^\d+$/.test(val) ? Number(val) : hashStringToSeed(val);
                onUpdateConfig({ seed: numeric });
              }
            }}
            placeholder="数値または任意の単語"
            className="flex-1 bg-stone-800 border border-stone-700 px-2 py-1.5 rounded text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500"
          />
          <button
            type="button"
            onClick={handleRandomSeed}
            className="px-2.5 py-1.5 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded text-stone-300 flex items-center gap-1 transition"
            title="ランダムシードを生成"
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* World Grid Resolution (2:1 Ratio) */}
      <div className="flex flex-col gap-1.5 bg-stone-950/60 p-2.5 rounded-lg border border-stone-800">
        <div className="flex justify-between items-center">
          <label htmlFor="grid-resolution-select" className="font-medium text-stone-300">標高グリッド解像度 (縦横比 2:1)</label>
          <span className="font-mono text-amber-400 font-semibold">{config.gridResolution}</span>
        </div>
        <select
          id="grid-resolution-select"
          value={config.gridResolution}
          onChange={(e) => onUpdateConfig({ gridResolution: e.target.value as any })}
          className="bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
        >
          <option value="1024x512">1024 × 512 (軽量・高速)</option>
          <option value="2048x1024">2048 × 1024 【標準・高精細】</option>
          <option value="4096x2048">4096 × 2048 (4K超高精細)</option>
          <option value="8192x4096">8192 × 4096 (8K極大・超広大キャンバス)</option>
        </select>
        <div className="text-[10px] text-stone-500">
          ※ Float32Array標高データ。Web Workerでバックグラウンド生成されます。
        </div>
      </div>

      {/* World Width (km) Setting */}
      <div className="flex flex-col gap-1.5 bg-stone-950/60 p-2.5 rounded-lg border border-stone-800">
        <div className="flex justify-between items-center text-stone-300">
          <label htmlFor="world-width-slider">世界の横幅 (km)</label>
          <span className="font-mono text-amber-400 font-bold">
            {(config.worldWidthKm || 40000).toLocaleString()} km
          </span>
        </div>
        <input
          id="world-width-slider"
          type="range"
          min={10000}
          max={60000}
          step={2000}
          value={config.worldWidthKm || 40000}
          onChange={(e) => onUpdateConfig({ worldWidthKm: Number(e.target.value) })}
          className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
        />
        <div className="flex justify-between text-[10px] text-stone-500">
          <span>10,000 km (小惑星)</span>
          <span>40,000 km (地球規模)</span>
          <span>60,000 km</span>
        </div>
      </div>

      {/* Tectonic & Land Controls */}
      <div className="flex flex-col gap-3">
        {/* Plate Count (8 to 16) */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-300">
            <span>プレート数（テクトニクス構造）</span>
            <span className="font-mono text-amber-400">{config.plateCount} プレート</span>
          </div>
          <input
            type="range"
            min={8}
            max={16}
            step={1}
            value={config.plateCount}
            onChange={(e) => onUpdateConfig({ plateCount: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
          <div className="flex justify-between text-[10px] text-stone-500">
            <span>8 (大プレート)</span>
            <span>16 (複雑な微小プレート群)</span>
          </div>
        </div>

        {/* Continents count */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-300">
            <span>大陸プレートの数</span>
            <span className="font-mono text-amber-400">{config.continentCount} 大陸</span>
          </div>
          <input
            type="range"
            min={2}
            max={6}
            step={1}
            value={config.continentCount}
            onChange={(e) => onUpdateConfig({ continentCount: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
          <div className="flex justify-between text-[10px] text-stone-500">
            <span>2 (巨大連節大陸)</span>
            <span>6 (ユーラシア・米大陸・豪州相当)</span>
          </div>
        </div>

        {/* Continent size */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-300">
            <span>大陸の大きさ</span>
            <span className="font-mono text-amber-400">Lv {config.continentSize || 5}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={config.continentSize || 5}
            onChange={(e) => onUpdateConfig({ continentSize: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
        </div>

        {/* Mountain strength */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-300">
            <span>山脈の強さ（プレート衝突・褶曲山脈）</span>
            <span className="font-mono text-amber-400">Lv {config.mountainStrength}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={config.mountainStrength}
            onChange={(e) => onUpdateConfig({ mountainStrength: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
        </div>

        {/* Island Density */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-300">
            <span>島の多さ（弧状列島・海洋島）</span>
            <span className="font-mono text-amber-400">Lv {config.islandDensity}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={config.islandDensity}
            onChange={(e) => onUpdateConfig({ islandDensity: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
        </div>

        {/* Minimum Island Area */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-300">
            <span>小さな島の下限面積</span>
            <span className="font-mono text-amber-400">{config.minIslandArea} セル</span>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={config.minIslandArea}
            onChange={(e) => onUpdateConfig({ minIslandArea: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
          <div className="flex justify-between text-[10px] text-stone-500">
            <span>1 (微小島も残す)</span>
            <span>50 (小島ノイズを除去)</span>
          </div>
        </div>

        {/* Coastline Complexity */}
        <div className="flex flex-col gap-1 border-t border-stone-800 pt-2">
          <div className="flex justify-between text-stone-300">
            <span>海岸線の複雑さ・湾曲度</span>
            <span className="font-mono text-amber-400">Lv {config.coastlineComplexity ?? 4}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={config.coastlineComplexity ?? 4}
            onChange={(e) => onUpdateConfig({ coastlineComplexity: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
          <div className="flex justify-between text-[10px] text-stone-500">
            <span>Lv 1 (滑らか)</span>
            <span className="text-amber-400/90 font-medium">Lv 4 (標準・自然な海岸線)</span>
            <span>Lv 10 (極大フィヨルド・入り江)</span>
          </div>
        </div>

        {/* Coast Smoothing */}
        <div className="flex flex-col gap-1 border-t border-stone-800 pt-2">
          <div className="flex justify-between text-stone-300">
            <span>海岸線のなめらかさ</span>
            <span className="font-mono text-amber-400">
              {(config.coastSmoothing ?? 5) === 0 ? '無効 (0)' : `Lv ${config.coastSmoothing ?? 5}`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={config.coastSmoothing ?? 5}
            onChange={(e) => onUpdateConfig({ coastSmoothing: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
          <div className="flex justify-between text-[10px] text-stone-500">
            <span>0 (無効)</span>
            <span className="text-amber-400/90 font-medium">5 (標準・崖緩和)</span>
            <span>10 (最大平滑化)</span>
          </div>
          <div className="text-[10px] text-stone-400 leading-tight">
            ※ 大きいほど、海岸線が滑らかになります。小さな島や細い半島は、少し丸くなります
          </div>
        </div>

        {/* Plate Boundary Softness */}
        <div className="flex flex-col gap-1 border-t border-stone-800 pt-2">
          <div className="flex justify-between text-stone-300">
            <span>プレート境界のなめらかさ</span>
            <span className="font-mono text-amber-400">
              {(config.boundarySoftness ?? 5) === 0 ? '無効 (0)' : `Lv ${config.boundarySoftness ?? 5}`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={config.boundarySoftness ?? 5}
            onChange={(e) => onUpdateConfig({ boundarySoftness: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
          <div className="flex justify-between text-[10px] text-stone-500">
            <span>0 (急峻な段差)</span>
            <span className="text-amber-400/90 font-medium">5 (標準・なめらか)</span>
            <span>10 (最大平滑化)</span>
          </div>
          <div className="text-[10px] text-stone-400 leading-tight">
            ※ 0 にすると急峻な段差、値を大きくするとプレート境界がなめらかにつながります
          </div>
        </div>

        {/* Geomorphic Erosion (Thermal + Water Erosion) */}
        <div className="flex flex-col gap-1 border-t border-stone-800 pt-2">
          <div className="flex justify-between text-stone-300">
            <span>簡易侵食（熱侵食＋水侵食）</span>
            <span className="font-mono text-amber-400">
              {(config.erosionIterations ?? 20) === 0 ? 'オフ' : `${config.erosionIterations ?? 20} 回`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={config.erosionIterations ?? 20}
            onChange={(e) => onUpdateConfig({ erosionIterations: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
          <div className="flex justify-between text-[10px] text-stone-500">
            <span>0 (オフ)</span>
            <span>20 (標準)</span>
            <span>50 (深い谷・急崖の崩落)</span>
          </div>
        </div>

        {/* Erosion Strength */}
        {(config.erosionIterations ?? 20) > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-stone-300">
              <span>侵食強度</span>
              <span className="font-mono text-amber-400">Lv {config.erosionStrength ?? 5}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={config.erosionStrength ?? 5}
              onChange={(e) => onUpdateConfig({ erosionStrength: Number(e.target.value) })}
              className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
            />
          </div>
        )}

        {/* Sea Ratio */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-300">
            <span>海の割合</span>
            <span className="font-mono text-amber-400">{config.seaRatio}%</span>
          </div>
          <input
            type="range"
            min={40}
            max={75}
            step={1}
            value={config.seaRatio}
            onChange={(e) => onUpdateConfig({ seaRatio: Number(e.target.value) })}
            className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
        </div>
      </div>

      {/* Regenerate Button */}
      <button
        type="button"
        disabled={isGenerating}
        onClick={onRegenerate}
        className={`mt-2 py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer ${
          isGenerating
            ? 'bg-stone-700 text-stone-400 cursor-wait'
            : 'bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-500 text-stone-950 font-bold active:scale-98 shadow-amber-950/50 ring-1 ring-amber-400'
        }`}
      >
        <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
        <span>{isGenerating ? 'Web Workerで計算中...' : '地形を自動生成する'}</span>
      </button>

      {/* Apply Step & Coast Smoothing to Existing World Map Button */}
      {onApplyCoastSmoothingToCurrentMap && (
        <button
          type="button"
          disabled={!isWorldMapActive || isGenerating || (config.coastSmoothing ?? 5) === 0}
          onClick={() => setShowSmoothingConfirm(true)}
          className={`py-2 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-all border shadow cursor-pointer ${
            !isWorldMapActive || isGenerating || (config.coastSmoothing ?? 5) === 0
              ? 'bg-stone-800/60 text-stone-500 border-stone-800 cursor-not-allowed opacity-60'
              : 'bg-amber-950/70 hover:bg-amber-900/90 text-amber-200 border-amber-600/60 hover:border-amber-400'
          }`}
          title={
            !isWorldMapActive
              ? '世界マップ表示時のみ実行可能です'
              : (config.coastSmoothing ?? 5) === 0
              ? '「海岸線のなめらかさ」スライダーを1以上に設定してください'
              : '現在の世界マップの段差（崖・海岸線）をなめらかに平滑化します'
          }
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>いまの世界マップの段差(崖・海岸)をなめらかにする</span>
        </button>
      )}

      {/* Step & Coast Smoothing Confirmation Dialog */}
      {showSmoothingConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-stone-900 border border-amber-600/70 rounded-xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-3 text-stone-200">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>段差（崖・海岸）の平滑化の確認</span>
            </div>
            <div className="text-xs text-stone-300 space-y-2 leading-relaxed">
              <p className="text-amber-200 font-medium">
                標高が変更されます。この操作は取り消せません。先に保存することをおすすめします。水系(川・湖)や地域マップは、作り直さない限り、変わりません
              </p>
              <p className="text-stone-300 text-[11px]">
                適用強度: <span className="font-bold text-amber-300">Lv {config.coastSmoothing ?? 5}</span>
              </p>
              <p className="text-stone-400 text-[10px] bg-stone-950/80 p-2 rounded border border-stone-800">
                ※ 標高が変更されます。この操作は取り消せません。先に保存することをおすすめします。水系(川・湖)や地域マップは、作り直さない限り、変わりません
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-stone-800">
              <button
                type="button"
                onClick={() => setShowSmoothingConfirm(false)}
                className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs transition cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSmoothingConfirm(false);
                  onApplyCoastSmoothingToCurrentMap?.();
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold text-xs transition cursor-pointer shadow"
              >
                平滑化を実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image to Terrain Button */}
      {onOpenImageToTerrain && (
        <button
          type="button"
          disabled={isGenerating}
          onClick={onOpenImageToTerrain}
          className="py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border border-emerald-600/70 shadow-lg cursor-pointer hover:border-emerald-400 hover:text-white active:scale-98"
          title="既存の地図画像やイラストを2:1で切り抜いて世界マップの形状を作成します"
        >
          <FileImage className="w-4 h-4 text-emerald-400" />
          <span>🖼️ 画像から地形を作る</span>
        </button>
      )}

      {/* Blank Ocean Button for Pure Manual Sculpting */}
      {onGenerateBlankOcean && (
        <button
          type="button"
          disabled={isGenerating}
          onClick={onGenerateBlankOcean}
          className="py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all bg-sky-950/90 hover:bg-sky-900 text-sky-200 border border-sky-600/70 shadow-lg cursor-pointer hover:border-sky-400 hover:text-white active:scale-98"
          title="大陸や山脈のない100%完全な海から自由に描き始めます"
        >
          <Waves className="w-4 h-4 text-sky-400" />
          <span>🌊 完全な海（白紙キャンバス）を作成</span>
        </button>
      )}
    </div>
  );
};
