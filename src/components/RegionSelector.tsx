import React, { useState } from 'react';
import { Layers, Sparkles, X, Check, MapPin } from 'lucide-react';
import { RegionalBounds } from '../types/map';

interface RegionSelectorProps {
  bounds: RegionalBounds;
  worldWidthKm: number;
  mapWidth: number;
  onGenerate: (bounds: RegionalBounds, zoomScale: 4 | 16, name: string) => void;
  onCancel: () => void;
}

export const RegionSelector: React.FC<RegionSelectorProps> = ({
  bounds,
  worldWidthKm,
  mapWidth,
  onGenerate,
  onCancel,
}) => {
  const [zoomScale, setZoomScale] = useState<4 | 16>(4);
  const [regionName, setRegionName] = useState<string>('新地域マップ');

  const widthWorld = Math.abs(bounds.maxX - bounds.minX);
  const heightWorld = Math.abs(bounds.maxY - bounds.minY);

  const kmPerPx = worldWidthKm / mapWidth;
  const widthKm = Math.round(widthWorld * kmPerPx);
  const heightKm = Math.round(heightWorld * kmPerPx);

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-stone-900/95 backdrop-blur-md border border-amber-600/70 rounded-xl shadow-2xl p-5 text-stone-200 w-96 flex flex-col gap-4 text-xs">
      <div className="flex justify-between items-center border-b border-stone-800 pb-2.5">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-amber-400" />
          <h3 className="font-bold text-sm text-stone-100">選択範囲から地域マップを生成</h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-stone-950/70 p-3 rounded-lg border border-stone-800 flex justify-between items-center">
        <span className="text-stone-400">実寸換算サイズ:</span>
        <span className="font-mono text-amber-300 font-bold">
          {widthKm.toLocaleString()} km × {heightKm.toLocaleString()} km
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="region-name-input" className="font-medium text-stone-300">地域マップの名前</label>
        <input
          id="region-name-input"
          type="text"
          value={regionName}
          onChange={(e) => setRegionName(e.target.value)}
          placeholder="例: 北部連峰・諸島海域"
          className="bg-stone-800 border border-stone-700 px-3 py-1.5 rounded text-xs text-stone-100 focus:outline-none focus:border-amber-500"
        />
      </div>

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
          ※ 海岸線や山脈の大枠は世界マップから正確に引き継がれます。
        </p>
      </div>

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
          onClick={() => onGenerate(bounds, zoomScale, regionName)}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-lg transition active:scale-95"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>地域マップを生成して開く</span>
        </button>
      </div>
    </div>
  );
};
