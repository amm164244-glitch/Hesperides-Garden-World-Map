import React, { useMemo, useState } from 'react';
import { Sparkles, X, MapPin, AlertCircle, Grid, Waves, Home } from 'lucide-react';
import { RegionalBounds, ShapeMaskConfig } from '../types/map';
import { computeRegionLayout, formatDistance } from '../utils/regionLayout';

interface RegionSelectorProps {
  bounds: RegionalBounds;
  worldWidthKm: number;
  mapWidth: number;
  wasAdjusted?: boolean;
  shapePolygon?: [number, number][];
  initialName?: string;
  options?: { kind?: 'region' | 'town'; detailScale?: number };
  onGenerate: (
    bounds: RegionalBounds,
    zoomScale: 4 | 16,
    name: string,
    shapeMask?: ShapeMaskConfig,
    options?: { kind?: 'region' | 'town'; detailScale?: number }
  ) => void;
  onCancel: () => void;
}

export const RegionSelector: React.FC<RegionSelectorProps> = ({
  bounds,
  worldWidthKm,
  mapWidth,
  wasAdjusted = false,
  shapePolygon,
  initialName,
  options,
  onGenerate,
  onCancel,
}) => {
  const isTown = options?.kind === 'town';
  const [zoomScale, setZoomScale] = useState<4 | 16>(4);
  const [regionName, setRegionName] = useState<string>(
    initialName || (isTown ? '街道の宿場町' : '新地域マップ')
  );
  const [outsideSea, setOutsideSea] = useState<boolean>(false);
  const [featherPercent, setFeatherPercent] = useState<number>(3.0);
  const [detailScale, setDetailScale] = useState<number>(
    typeof options?.detailScale === 'number' ? options.detailScale : (isTown ? 0.15 : 1.0)
  );

  const isShapeSelection = !!(shapePolygon && shapePolygon.length >= 3);

  const widthWorld = Math.abs(bounds.maxX - bounds.minX);
  const heightWorld = Math.abs(bounds.maxY - bounds.minY);

  const kmPerPx = worldWidthKm / Math.max(1, mapWidth);
  const widthKm = widthWorld * kmPerPx;
  const heightKm = heightWorld * kmPerPx;

  // Compute dynamic layout based on current zoomScale and bounds
  const layout = useMemo(
    () => computeRegionLayout(bounds, zoomScale),
    [bounds, zoomScale]
  );

  const totalCells = layout.gridCols * layout.gridRows;

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-stone-900/95 backdrop-blur-md border border-amber-600/70 rounded-xl shadow-2xl p-5 text-stone-200 w-96 max-w-[calc(100vw-2rem)] flex flex-col gap-4 text-xs animate-in fade-in zoom-in-95 duration-150">
      <div className="flex justify-between items-center border-b border-stone-800 pb-2.5">
        <div className="flex items-center gap-2">
          {isTown ? (
            <Home className="w-4 h-4 text-amber-400" />
          ) : (
            <MapPin className="w-4 h-4 text-amber-400" />
          )}
          <h3 className="font-bold text-sm text-stone-100">
            {isTown ? '町マップを生成' : '選択範囲から地域マップを生成'}
          </h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition"
          title="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Adjusted Aspect Ratio Warning Notice */}
      {wasAdjusted && (
        <div className="bg-amber-950/80 border border-amber-600/70 p-2.5 rounded-lg text-amber-200 text-[11px] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>範囲を広げました(縦横比の制限のため)</span>
        </div>
      )}

      {/* Size & Grid Information Panel */}
      <div className="bg-stone-950/70 p-3 rounded-lg border border-stone-800 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-stone-400">実寸換算サイズ:</span>
          <span className="font-mono text-amber-300 font-bold">
            {formatDistance(widthKm)} × {formatDistance(heightKm)}
          </span>
        </div>
        <div className="flex justify-between items-center text-[11px]">
          <span className="text-stone-400">マップ座標寸法:</span>
          <span className="font-mono text-stone-300">
            {Math.round(layout.width)} × {Math.round(layout.height)}
          </span>
        </div>
        <div className="flex justify-between items-center text-[11px]">
          <span className="text-stone-400 flex items-center gap-1">
            <Grid className="w-3 h-3 text-stone-400" />
            グリッド解像度:
          </span>
          <span className="font-mono text-emerald-400 font-semibold">
            {layout.gridCols} × {layout.gridRows} ({totalCells.toLocaleString()} セル)
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="region-name-input" className="font-medium text-stone-300">
          {isTown ? '町マップの名前' : '地域マップの名前'}
        </label>
        <input
          id="region-name-input"
          type="text"
          value={regionName}
          onChange={(e) => setRegionName(e.target.value)}
          placeholder={isTown ? '例: 街道の宿場町、王都' : '例: 北部連峰・諸島海域'}
          className="bg-stone-800 border border-stone-700 px-3 py-1.5 rounded text-xs text-stone-100 focus:outline-none focus:border-amber-500"
        />
      </div>

      {isTown ? (
        <div className="flex flex-col gap-1.5 bg-stone-950/60 p-2.5 rounded-lg border border-stone-800">
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-stone-300 font-medium">起伏の強さ (微小フラクタル):</span>
            <span className="font-mono text-amber-300 font-bold">{Math.round(detailScale * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={detailScale}
            onChange={(e) => setDetailScale(parseFloat(e.target.value))}
            className="w-full accent-amber-500 h-1.5 bg-stone-800 rounded-lg cursor-pointer"
          />
          <span className="text-[10px] text-stone-400">
            ※ 町スケールでは親マップの傾斜をなだらかに引き伸ばすため、起伏を抑えて平坦化します
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-stone-300">再生成倍率 (細部ノイズ合成)</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setZoomScale(4)}
              className={`p-2.5 rounded-lg border text-center transition flex flex-col items-center gap-1 ${
                zoomScale === 4
                  ? 'bg-amber-950/80 border-amber-500 text-amber-200 font-bold'
                  : 'bg-stone-800/80 border-stone-700 text-stone-400 hover:bg-stone-800'
              }`}
            >
              <span className="text-sm">4倍 解像度</span>
              <span className="text-[10px] text-stone-400 font-normal">主要山脈・入江・丘陵の詳細化</span>
            </button>
            <button
              type="button"
              onClick={() => setZoomScale(16)}
              className={`p-2.5 rounded-lg border text-center transition flex flex-col items-center gap-1 ${
                zoomScale === 16
                  ? 'bg-amber-950/80 border-amber-500 text-amber-200 font-bold'
                  : 'bg-stone-800/80 border-stone-700 text-stone-400 hover:bg-stone-800'
              }`}
            >
              <span className="text-sm">16倍 超高精細</span>
              <span className="text-[10px] text-stone-400 font-normal">微細フィヨルド・峡谷の生成</span>
            </button>
          </div>
          <p className="text-[10px] text-stone-500 mt-0.5">
            ※ 選択した範囲の縦横比を歪めずにそのまま精密サンプリングします。
          </p>
        </div>
      )}

      {/* Shape Outside Sea Option (Only shown when selected with a shape) */}
      {isShapeSelection && (
        <div className="bg-stone-950/70 p-3 rounded-lg border border-stone-800 flex flex-col gap-2.5">
          <div className="flex justify-between items-center">
            <span className="font-medium text-stone-300 flex items-center gap-1.5">
              <Waves className="w-3.5 h-3.5 text-cyan-400" />
              形の外側の扱い
            </span>
            <span className="text-[10px] text-amber-400 font-mono">
              {shapePolygon.length} 頂点で指定
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOutsideSea(false)}
              className={`p-2 rounded-lg border text-center transition flex flex-col items-center gap-0.5 ${
                !outsideSea
                  ? 'bg-amber-950/80 border-amber-500 text-amber-200 font-bold'
                  : 'bg-stone-800/80 border-stone-700 text-stone-400 hover:bg-stone-800'
              }`}
            >
              <span className="text-xs">親のまま生成</span>
              <span className="text-[9px] text-stone-400 font-normal">親の地形をそのまま保持</span>
            </button>
            <button
              type="button"
              onClick={() => setOutsideSea(true)}
              className={`p-2 rounded-lg border text-center transition flex flex-col items-center gap-0.5 ${
                outsideSea
                  ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 font-bold'
                  : 'bg-stone-800/80 border-stone-700 text-stone-400 hover:bg-stone-800'
              }`}
            >
              <span className="text-xs">海にする</span>
              <span className="text-[9px] text-cyan-300 font-normal">枠外を深海へ沈降</span>
            </button>
          </div>

          {outsideSea && (
            <div className="flex flex-col gap-1.5 pt-1 border-t border-stone-800/60">
              <div className="flex justify-between text-[11px]">
                <span className="text-stone-400">境界ぼかし幅 (フェザー):</span>
                <span className="font-mono text-cyan-300 font-semibold">{featherPercent.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="6"
                step="0.5"
                value={featherPercent}
                onChange={(e) => setFeatherPercent(parseFloat(e.target.value))}
                className="w-full accent-cyan-500 h-1.5 bg-stone-800 rounded-lg cursor-pointer"
              />
              <span className="text-[9px] text-stone-500">※ 形の境界線を自然ななだらかな海に馴染ませます</span>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-xs transition"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => {
            const maskConfig: ShapeMaskConfig | undefined = isShapeSelection
              ? {
                  polygon: shapePolygon!,
                  outsideSea,
                  featherRatio: featherPercent / 100,
                }
              : undefined;
            onGenerate(bounds, zoomScale, regionName, maskConfig, {
              kind: isTown ? 'town' : 'region',
              detailScale,
            });
          }}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-lg transition active:scale-95"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isTown ? '町マップを生成して開く' : '地域マップを生成して開く'}</span>
        </button>
      </div>
    </div>
  );
};
