import React from 'react';
import {
  Mountain,
  Waves,
  Trees,
  TrendingUp,
  TrendingDown,
  Minimize2,
  Maximize2,
  Minus,
  RotateCcw,
  RotateCw,
  Hand,
  Sliders,
  Layers,
  Sun,
  Eye,
  Grid,
  Compass,
  Square,
  Sparkles,
  MapPin,
} from 'lucide-react';
import { BrushMode, BrushSettings, ViewMode } from '../types/map';

interface ToolbarProps {
  brushSettings: BrushSettings;
  onUpdateBrush: (newSettings: Partial<BrushSettings>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  undoCount: number;
  redoCount: number;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  showMesh: boolean;
  onToggleMesh: () => void;
  showShading: boolean;
  onToggleShading: () => void;
  showRipples: boolean;
  onToggleRipples: () => void;
  showCompass: boolean;
  onToggleCompass: () => void;
  showBorder: boolean;
  onToggleBorder: () => void;
  isSymbolPaletteOpen: boolean;
  onToggleSymbolPalette: () => void;
  onOpenImageToPixel?: () => void;
  symbolCount: number;
  onResetView: () => void;
  zoom: number;
  onZoomChange: (delta: number) => void;
  onToggleGenerator: () => void;
  isGeneratorOpen: boolean;
  onOpenStorage: () => void;
  activeRegionName?: string;
  onExitRegion?: () => void;
  regionList?: { id: string; name: string }[];
  onSelectRegionMap?: (id: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  brushSettings,
  onUpdateBrush,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoCount,
  redoCount,
  viewMode,
  onChangeViewMode,
  showMesh,
  onToggleMesh,
  showShading,
  onToggleShading,
  showRipples,
  onToggleRipples,
  showCompass,
  onToggleCompass,
  showBorder,
  onToggleBorder,
  isSymbolPaletteOpen,
  onToggleSymbolPalette,
  onOpenImageToPixel,
  symbolCount,
  onResetView,
  zoom,
  onZoomChange,
  onToggleGenerator,
  isGeneratorOpen,
  onOpenStorage,
  activeRegionName,
  onExitRegion,
  regionList,
  onSelectRegionMap,
  isCollapsed,
  onToggleCollapse,
}) => {
  const tools: { id: BrushMode; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'pan', label: '視点移動', icon: <Hand className="w-4 h-4" />, desc: '地図をドラッグして移動 (Spaceキーでも可能)' },
    { id: 'elevate', label: '隆起', icon: <TrendingUp className="w-4 h-4" />, desc: '標高を高く盛り上げる' },
    { id: 'depress', label: '沈降', icon: <TrendingDown className="w-4 h-4" />, desc: '標高を低く掘り下げる' },
    { id: 'smooth', label: '平滑化', icon: <Minimize2 className="w-4 h-4" />, desc: '周囲の標高となじませてなだらかにする' },
    { id: 'flatten', label: '平坦化', icon: <Sliders className="w-4 h-4" />, desc: '指定した標高に揃える' },
    { id: 'mountain', label: '山脈描画', icon: <Mountain className="w-4 h-4" />, desc: 'ドラッグした軌跡に沿って鋭い連峰を作る' },
    { id: 'makeLand', label: '陸地化', icon: <Trees className="w-4 h-4" />, desc: '海面上の陸地へ一気に持ち上げる' },
    { id: 'makeSea', label: '海洋化', icon: <Waves className="w-4 h-4" />, desc: '海面下の海・水域へ沈める' },
    { id: 'selectRegion', label: '地域範囲選択', icon: <Layers className="w-4 h-4" />, desc: '範囲をドラッグ選択して4倍/16倍の地域マップを生成' },
  ];

  // Collapsed Mode: slim floating bar with icons only
  if (isCollapsed) {
    return (
      <div className="flex flex-col gap-1.5 bg-stone-900/85 backdrop-blur-md text-stone-200 p-2 rounded-xl border border-stone-700/80 shadow-2xl animate-in fade-in duration-200">
        {/* Expand button */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-2 bg-stone-800 hover:bg-stone-700 text-amber-400 hover:text-amber-300 rounded-lg text-xs flex items-center justify-center transition shadow"
          title="操作パネルを展開 (Tab)"
          aria-label="操作パネルを展開"
        >
          <Maximize2 className="w-4 h-4" />
        </button>

        {/* Symbol Palette button in collapsed mode */}
        <button
          type="button"
          onClick={onToggleSymbolPalette}
          className={`p-2 rounded-lg text-xs flex items-center justify-center transition-all ${
            isSymbolPaletteOpen
              ? 'bg-amber-500 text-stone-950 font-bold shadow-md ring-2 ring-amber-300'
              : 'bg-stone-800/80 hover:bg-stone-700 text-amber-300'
          }`}
          title="スタンプ・シンボルパネル"
          aria-label="スタンプ・シンボル"
        >
          <Sparkles className="w-4 h-4" />
        </button>

        <div className="w-full h-px bg-stone-800 my-0.5" />

        {/* Brush Tool Icons */}
        {tools.map((t) => {
          const isActive = brushSettings.mode === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onUpdateBrush({ mode: t.id })}
              className={`p-2 rounded-lg text-xs flex items-center justify-center transition-all ${
                isActive
                  ? 'bg-amber-500 text-stone-950 font-bold shadow-md ring-2 ring-amber-300 scale-105'
                  : 'bg-stone-800/80 hover:bg-stone-700 text-stone-300'
              }`}
              title={`${t.label}: ${t.desc}`}
              aria-label={t.label}
            >
              {t.icon}
            </button>
          );
        })}

        <div className="w-full h-px bg-stone-800 my-0.5" />

        {/* Quick Undo / Redo */}
        <button
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
          className={`p-2 rounded-lg text-xs flex items-center justify-center transition-all ${
            canUndo ? 'bg-stone-800 hover:bg-stone-700 text-stone-200' : 'text-stone-600 bg-stone-900 cursor-not-allowed'
          }`}
          title={`元に戻す (Ctrl+Z) [残り ${undoCount}回]`}
          aria-label="元に戻す"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          disabled={!canRedo}
          onClick={onRedo}
          className={`p-2 rounded-lg text-xs flex items-center justify-center transition-all ${
            canRedo ? 'bg-stone-800 hover:bg-stone-700 text-stone-200' : 'text-stone-600 bg-stone-900 cursor-not-allowed'
          }`}
          title={`やり直し (Ctrl+Y) [残り ${redoCount}回]`}
          aria-label="やり直し"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 bg-stone-900/90 backdrop-blur-md text-stone-200 p-2.5 rounded-xl border border-stone-700/80 shadow-2xl">
      {/* Regional Map active banner or Region selector */}
      {activeRegionName ? (
        <div className="flex items-center justify-between bg-amber-950/80 border border-amber-600/70 rounded-lg px-2.5 py-1 text-xs">
          <div className="flex items-center gap-1.5 text-amber-200">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-semibold truncate max-w-[200px]">{activeRegionName}</span>
          </div>
          <button
            type="button"
            onClick={onExitRegion}
            className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold rounded text-[11px] transition shadow shrink-0"
          >
            世界マップに戻る
          </button>
        </div>
      ) : regionList && regionList.length > 0 ? (
        <div className="flex items-center justify-between bg-stone-950/70 border border-stone-800 rounded-lg px-2.5 py-1 text-xs">
          <span className="text-stone-400 text-[11px] flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-stone-400" />
            生成済み地域:
          </span>
          <select
            onChange={(e) => {
              if (e.target.value) onSelectRegionMap?.(e.target.value);
            }}
            defaultValue=""
            className="bg-stone-800 text-stone-200 text-xs border border-stone-700 rounded px-2 py-0.5 focus:outline-none"
          >
            <option value="" disabled>地域マップを選択...</option>
            {regionList.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {/* Top action row */}
      <div className="flex items-center justify-between gap-2 border-b border-stone-800 pb-2">
        <div className="flex items-center gap-1.5">
          {/* Generator Toggle */}
          <button
            type="button"
            onClick={onToggleGenerator}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              isGeneratorOpen
                ? 'bg-amber-600 text-stone-950 font-semibold shadow-md'
                : 'bg-stone-800 hover:bg-stone-700 text-amber-300'
            }`}
            title="地形生成パラメータの表示/非表示"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>地形生成</span>
          </button>

          {/* Symbol Palette Toggle */}
          <button
            type="button"
            onClick={onToggleSymbolPalette}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              isSymbolPaletteOpen
                ? 'bg-amber-500 text-stone-950 font-bold shadow-md'
                : 'bg-stone-800 hover:bg-stone-700 text-amber-200'
            }`}
            title="ドット絵シンボルの自作・カテゴリ分類・配置と編集"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>ドット絵シンボル</span>
            {symbolCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-stone-900/80 text-amber-300 font-mono">
                {symbolCount}
              </span>
            )}
          </button>

          {/* Image to Pixel Art Studio Modal Trigger */}
          {onOpenImageToPixel && (
            <button
              type="button"
              onClick={onOpenImageToPixel}
              className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 bg-gradient-to-r from-amber-700/80 to-orange-700/80 hover:from-amber-600 hover:to-orange-600 text-amber-100 border border-amber-500/40 shadow-sm transition-all"
              title="風景や写真を高密度ピクセルアートに変換 (カタコンベ等)"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>画像変換</span>
            </button>
          )}
        </div>

        {/* Undo / Redo */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-all ${
              canUndo
                ? 'bg-stone-800 hover:bg-stone-700 text-stone-200'
                : 'text-stone-600 cursor-not-allowed bg-stone-900'
            }`}
            title={`元に戻す (Ctrl+Z) [残り ${undoCount}回]`}
            aria-label="元に戻す"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">戻す</span>
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-all ${
              canRedo
                ? 'bg-stone-800 hover:bg-stone-700 text-stone-200'
                : 'text-stone-600 cursor-not-allowed bg-stone-900'
            }`}
            title={`やり直し (Ctrl+Y) [残り ${redoCount}回]`}
            aria-label="やり直し"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">直す</span>
          </button>
        </div>

        {/* Save & Load Modal Trigger */}
        <button
          type="button"
          onClick={onOpenStorage}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 flex items-center gap-1.5 border border-emerald-600/50 transition-all shadow-sm"
          title="JSON保存/読込、Supabase連携"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>保存 / 読込</span>
        </button>

        {/* Minimize Button */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition flex items-center justify-center shrink-0 border border-stone-800 hover:border-stone-700 ml-1"
          title="操作パネルを縮小 (Tab)"
          aria-label="操作パネルを縮小"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* Brush tools grid */}
      <div>
        <div className="text-[11px] font-semibold text-stone-400 mb-1 px-1">地形編集ブラシ</div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
          {tools.map((t) => {
            const isActive = brushSettings.mode === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onUpdateBrush({ mode: t.id })}
                className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs transition-all ${
                  isActive
                    ? 'bg-amber-500 text-stone-950 font-bold shadow-lg scale-102 ring-2 ring-amber-300'
                    : 'bg-stone-800/90 hover:bg-stone-700 text-stone-300'
                }`}
                title={t.desc}
              >
                {t.icon}
                <span className="mt-1 text-[11px]">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Brush parameters (when not in pan mode) */}
      {brushSettings.mode !== 'pan' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-stone-950/60 p-2.5 rounded-lg border border-stone-800 text-xs">
          {/* Radius */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-stone-400">
              <span>ブラシ半径:</span>
              <span className="font-mono text-amber-400">{brushSettings.radius} px</span>
            </div>
            <input
              type="range"
              min={15}
              max={220}
              step={5}
              value={brushSettings.radius}
              onChange={(e) => onUpdateBrush({ radius: Number(e.target.value) })}
              className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
            />
          </div>

          {/* Strength */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-stone-400">
              <span>ブラシ強度:</span>
              <span className="font-mono text-amber-400">{Math.round(brushSettings.strength * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={1.0}
              step={0.05}
              value={brushSettings.strength}
              onChange={(e) => onUpdateBrush({ strength: Number(e.target.value) })}
              className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
            />
          </div>

          {/* Flatten Target (only if flatten tool active) */}
          {brushSettings.mode === 'flatten' ? (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-stone-400">
                <span>平坦化の目標標高:</span>
                <span className="font-mono text-amber-400">{brushSettings.flattenTarget}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={brushSettings.flattenTarget}
                onChange={(e) => onUpdateBrush({ flattenTarget: Number(e.target.value) })}
                className="accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
              />
            </div>
          ) : (
            <div className="hidden lg:flex items-center text-[11px] text-stone-500 pl-2">
              ※ Shift+ドラッグで逆効果（隆起時は掘り下げ）
            </div>
          )}
        </div>
      )}

      {/* View Options & Zoom Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-800 pt-2 text-xs">
        {/* View Mode */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-stone-400 mr-1 flex items-center gap-1">
            <Eye className="w-3.5 h-3.5" />
            表示:
          </span>
          {(
            [
              { id: 'elevation', label: '標高' },
              { id: 'temperature', label: '気温' },
              { id: 'moisture', label: '湿度' },
              { id: 'landSea', label: '陸/海' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChangeViewMode(m.id)}
              className={`px-2 py-1 rounded text-xs transition-all ${
                viewMode === m.id
                  ? 'bg-amber-700 text-amber-100 font-medium'
                  : 'bg-stone-800 hover:bg-stone-700 text-stone-400'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Toggles: Mesh & Shading */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleShading}
            className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-all ${
              showShading
                ? 'bg-amber-900/60 text-amber-300 border border-amber-600/60'
                : 'bg-stone-800 text-stone-500'
            }`}
            title="起伏の陰影（立体シェーディング）切り替え"
          >
            <Sun className="w-3.5 h-3.5" />
            <span>陰影起伏</span>
          </button>

          <button
            type="button"
            onClick={onToggleMesh}
            className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-all ${
              showMesh
                ? 'bg-amber-900/60 text-amber-300 border border-amber-600/60'
                : 'bg-stone-800 text-stone-500'
            }`}
            title="ボロノイセルの分割枠線を表示"
          >
            <Grid className="w-3.5 h-3.5" />
            <span>セル枠線</span>
          </button>

          <button
            type="button"
            onClick={onToggleRipples}
            className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-all ${
              showRipples
                ? 'bg-sky-900/60 text-sky-300 border border-sky-600/60'
                : 'bg-stone-800 text-stone-500'
            }`}
            title="海岸線沿いの同心円波紋線の表示切り替え"
          >
            <Waves className="w-3.5 h-3.5" />
            <span>波紋線</span>
          </button>

          <button
            type="button"
            onClick={onToggleCompass}
            className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-all ${
              showCompass
                ? 'bg-amber-900/60 text-amber-300 border border-amber-600/60'
                : 'bg-stone-800 text-stone-500'
            }`}
            title="アンティーク羅針盤と航海線（ドラッグ移動可）の表示切り替え"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>羅針盤</span>
          </button>

          <button
            type="button"
            onClick={onToggleBorder}
            className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-all ${
              showBorder
                ? 'bg-amber-900/60 text-amber-300 border border-amber-600/60'
                : 'bg-stone-800 text-stone-500'
            }`}
            title="アンティーク二重装飾枠とコーナー金具の表示切り替え"
          >
            <Square className="w-3.5 h-3.5" />
            <span>装飾枠</span>
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onZoomChange(-0.25)}
            className="w-6 h-6 rounded bg-stone-800 hover:bg-stone-700 flex items-center justify-center font-bold text-stone-300"
            title="ズームアウト"
          >
            -
          </button>
          <span className="font-mono text-[11px] text-stone-400 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => onZoomChange(0.25)}
            className="w-6 h-6 rounded bg-stone-800 hover:bg-stone-700 flex items-center justify-center font-bold text-stone-300"
            title="ズームイン"
          >
            +
          </button>
          <button
            type="button"
            onClick={onResetView}
            className="px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-400 text-[11px]"
            title="表示位置と倍率を初期化"
          >
            初期位置
          </button>
        </div>
      </div>
    </div>
  );
};
