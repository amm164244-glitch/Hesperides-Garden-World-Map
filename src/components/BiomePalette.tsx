import React, { useState } from 'react';
import {
  Paintbrush,
  PaintBucket,
  Eraser,
  Trash2,
  X,
  Eye,
  EyeOff,
  Sliders,
  Check,
  AlertTriangle,
  Palette,
} from 'lucide-react';
import { BiomeType, DEFAULT_BIOME_TYPES } from '../types/biome';
import { BrushMode, Viewport } from '../types/map';
import { CustomMapAsset, MapSymbolInstance } from '../types/symbols';
import { BiomePlacePanel } from './BiomePlacePanel';

export interface BiomePaletteProps {
  brushMode: BrushMode;
  onChangeBrushMode: (mode: BrushMode) => void;
  selectedBiomeId: number;
  onSelectBiomeId: (id: number) => void;
  softness: number; // 0 - 100
  onChangeSoftness: (softness: number) => void;
  brushRadius: number;
  onChangeRadius: (radius: number) => void;
  landOnly: boolean;
  onToggleLandOnly: (landOnly: boolean) => void;
  showBiome: boolean;
  onToggleShowBiome: (show: boolean) => void;
  opacity: number; // 10 - 90
  onChangeOpacity: (opacity: number) => void;
  onClearBiomeGrid: () => void;
  onClose: () => void;
  biomeTypes?: BiomeType[];
  onOpenEditor?: () => void;

  // Auto-placement props
  customAssets?: CustomMapAsset[];
  activeBiomeGrid?: Uint8Array;
  elevationGrid?: Float32Array;
  seaLevel?: number;
  gridCols?: number;
  gridRows?: number;
  mapWidth?: number;
  mapHeight?: number;
  viewport?: Viewport;
  existingSymbols?: MapSymbolInstance[];
  onApplySymbols?: (symbols: MapSymbolInstance[], description: string) => void;
  activeRegionId?: string | null;
}

const BiomePaletteComponent: React.FC<BiomePaletteProps> = ({
  brushMode,
  onChangeBrushMode,
  selectedBiomeId,
  onSelectBiomeId,
  softness,
  onChangeSoftness,
  brushRadius,
  onChangeRadius,
  landOnly,
  onToggleLandOnly,
  showBiome,
  onToggleShowBiome,
  opacity,
  onChangeOpacity,
  onClearBiomeGrid,
  onClose,
  biomeTypes,
  onOpenEditor,
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
  const [showConfirmClear, setShowConfirmClear] = useState<boolean>(false);
  const activeBiomeTypes = biomeTypes && biomeTypes.length > 0 ? biomeTypes : DEFAULT_BIOME_TYPES;
  const currentBiome = activeBiomeTypes.find((b) => b.slot === selectedBiomeId);

  return (
    <div className="w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2.5rem)] overflow-y-auto bg-stone-900/95 backdrop-blur-md text-stone-200 p-3 rounded-xl border border-stone-700/80 shadow-2xl flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-150">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-800 pb-2">
        <div className="flex items-center gap-1.5">
          <Paintbrush className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-xs text-amber-200">地形タイプ (バイオーム)</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded transition"
          title="閉じる"
          aria-label="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode Selector (Paint / Fill / Erase) */}
      <div className="grid grid-cols-3 gap-1 bg-stone-950/70 p-1 rounded-lg border border-stone-800/80">
        <button
          type="button"
          onClick={() => onChangeBrushMode('biomePaint')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-[11px] font-medium transition-all ${
            brushMode === 'biomePaint'
              ? 'bg-emerald-600 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:bg-stone-800'
          }`}
          title="ブラシで塗る"
        >
          <Paintbrush className="w-3.5 h-3.5" />
          <span>塗り</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeBrushMode('biomeFill')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-[11px] font-medium transition-all ${
            brushMode === 'biomeFill'
              ? 'bg-emerald-600 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:bg-stone-800'
          }`}
          title="同種領域を一括塗りつぶし"
        >
          <PaintBucket className="w-3.5 h-3.5" />
          <span>塗りつぶし</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeBrushMode('biomeErase')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-[11px] font-medium transition-all ${
            brushMode === 'biomeErase'
              ? 'bg-rose-600 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:bg-stone-800'
          }`}
          title="地形タイプを消去して透明に戻す"
        >
          <Eraser className="w-3.5 h-3.5" />
          <span>消去</span>
        </button>
      </div>

      {/* Biome Type Swatch Selection */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px] text-stone-400">
          <span>選択中の地形タイプ:</span>
          <span className="font-semibold text-emerald-300">
            {brushMode === 'biomeErase' ? '消去 (指定なし)' : (currentBiome?.name || '未設定')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
          {activeBiomeTypes.map((biome) => {
            const isSelected = selectedBiomeId === biome.slot && brushMode !== 'biomeErase';
            return (
              <button
                key={biome.slot}
                type="button"
                onClick={() => {
                  onSelectBiomeId(biome.slot);
                  if (brushMode === 'biomeErase') {
                    onChangeBrushMode('biomePaint');
                  }
                }}
                className={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-all ${
                  isSelected
                    ? 'bg-stone-800 border-emerald-400 ring-2 ring-emerald-400/50 shadow-md'
                    : 'bg-stone-950/60 border-stone-800 hover:bg-stone-800/80 hover:border-stone-700'
                }`}
              >
                <div
                  className="w-4 h-4 rounded-full shrink-0 border border-black/40 shadow-inner flex items-center justify-center"
                  style={{ backgroundColor: biome.color }}
                >
                  {isSelected && <Check className="w-2.5 h-2.5 text-stone-950 drop-shadow" />}
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[11px] font-medium text-stone-200 truncate leading-tight">
                    {biome.name}
                  </span>
                  {biome.symbols && biome.symbols.length > 0 && (
                    <span className="text-[9px] text-amber-400/80 truncate leading-none mt-0.5">
                      {biome.symbols.length} シンボル
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Button to open BiomeTypeEditor */}
        {onOpenEditor && (
          <button
            type="button"
            onClick={onOpenEditor}
            className="flex items-center justify-center gap-1.5 py-1.5 px-3 mt-1 bg-stone-950/80 hover:bg-stone-800 text-amber-300 hover:text-amber-200 border border-stone-800 hover:border-amber-500/50 rounded-lg text-xs font-medium transition shadow-sm"
          >
            <Palette className="w-3.5 h-3.5 text-emerald-400" />
            <span>🎨 地形タイプを編集…</span>
          </button>
        )}
      </div>

      {/* Brush Settings: Softness & Radius */}
      <div className="flex flex-col gap-2.5 bg-stone-950/60 p-2.5 rounded-lg border border-stone-800/80 text-xs">
        {/* Softness Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-400 text-[11px]">
            <span className="flex items-center gap-1">
              <Sliders className="w-3 h-3 text-stone-400" />
              縁のゆらぎ (Softness):
            </span>
            <span className="font-mono text-emerald-400">{softness}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={softness}
            onChange={(e) => onChangeSoftness(Number(e.target.value))}
            className="accent-emerald-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
          <div className="flex justify-between text-[9px] text-stone-500">
            <span>0% (くっきり)</span>
            <span>100% (自然な散布)</span>
          </div>
        </div>

        {/* Brush Radius Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-400 text-[11px]">
            <span>ブラシ半径:</span>
            <span className="font-mono text-emerald-400">{brushRadius} px</span>
          </div>
          <input
            type="range"
            min={15}
            max={220}
            step={5}
            value={brushRadius}
            onChange={(e) => onChangeRadius(Number(e.target.value))}
            className="accent-emerald-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
        </div>

        {/* Land Only Toggle Checkbox */}
        <label className="flex items-center gap-2 cursor-pointer pt-0.5 select-none text-[11px] text-stone-300 hover:text-stone-100">
          <input
            type="checkbox"
            checked={landOnly}
            onChange={(e) => onToggleLandOnly(e.target.checked)}
            className="rounded bg-stone-800 border-stone-700 text-emerald-500 focus:ring-0 w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
          />
          <span>陸地のみに塗る (海面下を除外)</span>
        </label>
      </div>

      {/* Display & Opacity Settings */}
      <div className="flex flex-col gap-2 bg-stone-950/60 p-2.5 rounded-lg border border-stone-800/80 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-stone-400 flex items-center gap-1">
            {showBiome ? <Eye className="w-3.5 h-3.5 text-emerald-400" /> : <EyeOff className="w-3.5 h-3.5 text-stone-500" />}
            地形タイプ表示:
          </span>
          <button
            type="button"
            onClick={() => onToggleShowBiome(!showBiome)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
              showBiome
                ? 'bg-emerald-900/60 text-emerald-200 border border-emerald-600/60'
                : 'bg-stone-800 text-stone-500'
            }`}
          >
            {showBiome ? '表示中 (ON)' : '非表示 (OFF)'}
          </button>
        </div>

        {/* Opacity Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-stone-400 text-[11px]">
            <span>不透明度:</span>
            <span className="font-mono text-emerald-400">{opacity}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={opacity}
            onChange={(e) => onChangeOpacity(Number(e.target.value))}
            className="accent-emerald-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
          />
        </div>
      </div>

      {/* Auto-Placement of Symbols Section */}
      {onApplySymbols && viewport && (
        <BiomePlacePanel
          selectedBiomeId={selectedBiomeId}
          biomeTypes={activeBiomeTypes}
          customAssets={customAssets}
          activeBiomeGrid={activeBiomeGrid}
          elevationGrid={elevationGrid}
          seaLevel={seaLevel ?? 35}
          gridCols={gridCols ?? 1024}
          gridRows={gridRows ?? 512}
          mapWidth={mapWidth ?? 2000}
          mapHeight={mapHeight ?? 1000}
          viewport={viewport}
          existingSymbols={existingSymbols ?? []}
          onApplySymbols={onApplySymbols}
          activeRegionId={activeRegionId ?? null}
        />
      )}

      {/* Clear Biome Grid Button with Confirm Dialog */}
      {!showConfirmClear ? (
        <button
          type="button"
          onClick={() => setShowConfirmClear(true)}
          className="w-full py-1.5 px-3 rounded-lg bg-stone-800 hover:bg-rose-950/60 hover:text-rose-300 text-stone-400 text-xs flex items-center justify-center gap-1.5 transition border border-stone-800 hover:border-rose-800/60"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>このマップの地形タイプを全消去</span>
        </button>
      ) : (
        <div className="bg-rose-950/80 border border-rose-600/70 p-2 rounded-lg flex flex-col gap-1.5 text-xs animate-in fade-in duration-150">
          <div className="flex items-center gap-1.5 text-rose-200 text-[11px]">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>本当に地形タイプを全消去しますか？</span>
          </div>
          <div className="flex items-center gap-1.5 justify-end">
            <button
              type="button"
              onClick={() => setShowConfirmClear(false)}
              className="px-2 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px]"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConfirmClear(false);
                onClearBiomeGrid();
              }}
              className="px-2.5 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-stone-950 font-bold text-[11px] shadow"
            >
              全消去する
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const BiomePalette = React.memo(BiomePaletteComponent);
