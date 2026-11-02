import React from 'react';
import { Square, MousePointerClick, Hexagon, PenTool, CornerUpLeft, Check, X } from 'lucide-react';

export type RegionSelectMethod = 'rect' | 'rect2' | 'polygon' | 'freehand';

interface RegionShapeToolsProps {
  method: RegionSelectMethod;
  onChangeMethod: (m: RegionSelectMethod) => void;
  aspect: 'free' | '2:1' | '1:1' | 'current';
  onChangeAspect: (a: 'free' | '2:1' | '1:1' | 'current') => void;
  smooth: boolean;
  onToggleSmooth: (s: boolean) => void;
  marginPercent: number;
  onChangeMargin: (m: number) => void;
  polygonPointCount: number;
  onFinishPolygon?: () => void;
  onCancelPolygon?: () => void;
}

export const RegionShapeTools: React.FC<RegionShapeToolsProps> = ({
  method,
  onChangeMethod,
  aspect,
  onChangeAspect,
  smooth,
  onToggleSmooth,
  marginPercent,
  onChangeMargin,
  polygonPointCount,
  onFinishPolygon,
  onCancelPolygon,
}) => {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-stone-900/95 backdrop-blur-md border border-amber-600/70 rounded-xl px-3.5 py-2 shadow-2xl flex flex-col gap-2 text-xs text-stone-200 pointer-events-auto animate-in fade-in slide-in-from-top-2 max-w-[95vw]">
      {/* Top row: Selection mode switcher */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-amber-300 shrink-0">選択方法:</span>
        <div className="flex items-center gap-1 bg-stone-950/80 p-0.5 rounded-lg border border-stone-800">
          <button
            type="button"
            onClick={() => onChangeMethod('rect')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 ${
              method === 'rect'
                ? 'bg-amber-600 text-stone-950 font-bold shadow'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
            }`}
            title="矩形ドラッグで範囲を選択"
          >
            <Square className="w-3 h-3" />
            <span>矩形ドラッグ</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeMethod('rect2')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 ${
              method === 'rect2'
                ? 'bg-amber-600 text-stone-950 font-bold shadow'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
            }`}
            title="対角の2点をクリックして矩形を選択"
          >
            <MousePointerClick className="w-3 h-3" />
            <span>2点クリック</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeMethod('polygon')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 ${
              method === 'polygon'
                ? 'bg-amber-600 text-stone-950 font-bold shadow'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
            }`}
            title="クリックで頂点を結んで多角形を作成"
          >
            <Hexagon className="w-3 h-3" />
            <span>多角形</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeMethod('freehand')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 ${
              method === 'freehand'
                ? 'bg-amber-600 text-stone-950 font-bold shadow'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
            }`}
            title="ドラッグして自由曲線で範囲を囲む"
          >
            <PenTool className="w-3 h-3" />
            <span>自由曲線</span>
          </button>
        </div>

        {/* Rectangle Aspect ratio controls */}
        {(method === 'rect' || method === 'rect2') && (
          <div className="flex items-center gap-1 ml-2 border-l border-stone-700/80 pl-2">
            <span className="text-[11px] text-stone-400 shrink-0">縦横比:</span>
            <div className="flex items-center gap-0.5 bg-stone-950/80 p-0.5 rounded-lg border border-stone-800">
              {(
                [
                  { id: 'free', label: 'なし' },
                  { id: '2:1', label: '2:1' },
                  { id: '1:1', label: '1:1' },
                  { id: 'current', label: '表示中' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeAspect(opt.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                    aspect === opt.id
                      ? 'bg-amber-600 text-stone-950 font-bold shadow'
                      : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Polygon / Freehand Options: Smooth & Margin */}
        {(method === 'polygon' || method === 'freehand') && (
          <div className="flex items-center gap-3 ml-2 border-l border-stone-700/80 pl-2.5 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] select-none text-stone-300 hover:text-amber-300">
              <input
                type="checkbox"
                checked={smooth}
                onChange={(e) => onToggleSmooth(e.target.checked)}
                className="rounded accent-amber-500 cursor-pointer"
              />
              <span>角を丸める</span>
            </label>

            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-stone-400">余白:</span>
              <input
                type="range"
                min="0"
                max="30"
                step="1"
                value={marginPercent}
                onChange={(e) => onChangeMargin(Number(e.target.value))}
                className="w-16 accent-amber-500 h-1.5 bg-stone-700 rounded-lg cursor-pointer"
              />
              <span className="font-mono text-amber-300 w-7 text-right">{marginPercent}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Guide message & actions for polygon / freehand */}
      {method === 'polygon' && (
        <div className="flex justify-between items-center text-[10px] text-stone-400 border-t border-stone-800/80 pt-1.5">
          <span>
            {polygonPointCount === 0
              ? '地図上をクリックして最初の頂点を配置してください'
              : `頂点 ${polygonPointCount}個配置済み (始点クリック・ダブルクリック・Enterで確定、BackSpaceで1つ戻る、Escで取消)`}
          </span>
          {polygonPointCount >= 3 && onFinishPolygon && (
            <div className="flex items-center gap-1.5 ml-2">
              {onCancelPolygon && (
                <button
                  type="button"
                  onClick={onCancelPolygon}
                  className="px-2 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 transition flex items-center gap-1"
                >
                  <X className="w-2.5 h-2.5" />
                  <span>取消</span>
                </button>
              )}
              <button
                type="button"
                onClick={onFinishPolygon}
                className="px-2.5 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold transition flex items-center gap-1"
              >
                <Check className="w-2.5 h-2.5" />
                <span>確定</span>
              </button>
            </div>
          )}
        </div>
      )}

      {method === 'freehand' && (
        <div className="text-[10px] text-stone-400 border-t border-stone-800/80 pt-1">
          <span>マウスをドラッグして希望の形状を囲んでください (指を離すと自動で閉じて確定します)</span>
        </div>
      )}

      {method === 'rect2' && (
        <div className="text-[10px] text-stone-400 border-t border-stone-800/80 pt-1">
          <span>1点目をクリックして対角の始点を決め、2点目で終点を決定します (Escでキャンセル)</span>
        </div>
      )}
    </div>
  );
};
