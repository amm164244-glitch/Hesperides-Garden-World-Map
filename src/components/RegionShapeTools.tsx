import React from 'react';
import { Square, MousePointerClick, Hexagon, PenTool, Check, X, Home, Waves, Magnet, Wand2 } from 'lucide-react';
import { formatDistance } from '../utils/regionLayout';

export type RegionSelectMethod = 'rect' | 'rect2' | 'polygon' | 'freehand' | 'town';

export interface TownConfig {
  name: string;
  realWidthM: number;
  aspect: number;
  detailScale: number;
}

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
  followCoastline?: boolean;
  onToggleFollowCoastline?: (f: boolean) => void;
  snapCoastline?: boolean;
  onToggleSnapCoastline?: (s: boolean) => void;
  onAutoSelectIsland?: () => void;
  isAutoSelectingIsland?: boolean;
  townConfig?: TownConfig;
  onChangeTownConfig?: (patch: Partial<TownConfig>) => void;
  parentWidthKm?: number;
  isRect2Active?: boolean;
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
  followCoastline = true,
  onToggleFollowCoastline,
  snapCoastline = true,
  onToggleSnapCoastline,
  onAutoSelectIsland,
  isAutoSelectingIsland = false,
  townConfig,
  onChangeTownConfig,
  parentWidthKm = 40000,
  isRect2Active = false,
}) => {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-stone-900/95 backdrop-blur-md border border-amber-600/70 rounded-xl px-3.5 py-2 shadow-2xl flex flex-col gap-2 text-xs text-stone-200 pointer-events-auto animate-in fade-in slide-in-from-top-2 max-w-[95vw]">
      {/* Top row: Selection mode switcher */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-amber-300 shrink-0">選択方法:</span>
        <div className="flex items-center gap-1 bg-stone-950/80 p-0.5 rounded-lg border border-stone-800 flex-wrap">
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
            title="2点をクリックして指定 (海岸線沿いオプション対応)"
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
            title="クリックで頂点を結んで多角形を作成 (海岸線沿いオプション対応)"
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

          {/* Direct Town Map Creation Option */}
          <button
            type="button"
            onClick={() => onChangeMethod('town')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 ${
              method === 'town'
                ? 'bg-amber-500 text-stone-950 font-bold shadow ring-1 ring-amber-300'
                : 'text-amber-300 hover:text-amber-100 hover:bg-stone-800'
            }`}
            title="町・砦などの小規模マップを実寸メートル指定で直接作成"
          >
            <Home className="w-3.5 h-3.5 text-amber-400" />
            <span>町マップ</span>
          </button>
        </div>

        {/* Rectangle Drag Aspect Ratio Controls */}
        {method === 'rect' && (
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

        {/* 2-Point Click Options: Coastline-follow toggle OR Aspect Ratio */}
        {method === 'rect2' && (
          <div className="flex items-center gap-2.5 ml-2 border-l border-stone-700/80 pl-2.5 flex-wrap">
            {onToggleFollowCoastline && (
              <label
                className={`flex items-center gap-1.5 cursor-pointer text-[11px] select-none px-2 py-0.5 rounded-md transition border ${
                  followCoastline
                    ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/80 font-bold shadow-sm'
                    : 'bg-stone-950/70 text-stone-400 border-stone-800 hover:text-stone-200 hover:border-stone-700'
                }`}
                title="海岸線沿いオプション: 海岸線に沿って自動追従・抽出します"
              >
                <input
                  type="checkbox"
                  checked={followCoastline}
                  onChange={(e) => onToggleFollowCoastline(e.target.checked)}
                  className="rounded accent-cyan-500 cursor-pointer"
                />
                <Waves className={`w-3.5 h-3.5 ${followCoastline ? 'text-cyan-400' : 'text-stone-500'}`} />
                <span className={followCoastline ? 'text-cyan-300 font-bold' : ''}>海岸線沿い</span>
              </label>
            )}

            {!followCoastline ? (
              <div className="flex items-center gap-1">
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
            ) : (
              <>
                {onToggleSnapCoastline && (
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] select-none text-stone-300 hover:text-cyan-300">
                    <input
                      type="checkbox"
                      checked={snapCoastline}
                      onChange={(e) => onToggleSnapCoastline(e.target.checked)}
                      className="rounded accent-cyan-500 cursor-pointer"
                    />
                    <Magnet className="w-3 h-3 text-cyan-400" />
                    <span>スナップ</span>
                  </label>
                )}

                {onAutoSelectIsland && (
                  <button
                    type="button"
                    onClick={onAutoSelectIsland}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer border ${
                      isAutoSelectingIsland
                        ? 'bg-cyan-500 text-stone-950 border-cyan-400 font-bold animate-pulse'
                        : 'bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 hover:text-white border-cyan-700/80'
                    }`}
                    title="島または陸地をクリックしてその海岸線全体を一発で選択"
                  >
                    <Wand2 className="w-3 h-3 text-cyan-400" />
                    <span>{isAutoSelectingIsland ? '島をクリック…' : '島・陸地を一括選択'}</span>
                  </button>
                )}

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
              </>
            )}
          </div>
        )}

        {/* Polygon Options: Coastline-follow toggle, Snap, Auto-Island, Smooth, Margin */}
        {method === 'polygon' && (
          <div className="flex items-center gap-2.5 ml-2 border-l border-stone-700/80 pl-2.5 flex-wrap">
            {onToggleFollowCoastline && (
              <label
                className={`flex items-center gap-1.5 cursor-pointer text-[11px] select-none px-2 py-0.5 rounded-md transition border ${
                  followCoastline
                    ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/80 font-bold shadow-sm'
                    : 'bg-stone-950/70 text-stone-400 border-stone-800 hover:text-stone-200 hover:border-stone-700'
                }`}
                title="海岸線沿いオプション: 海岸線に沿って自動追従・抽出します"
              >
                <input
                  type="checkbox"
                  checked={followCoastline}
                  onChange={(e) => onToggleFollowCoastline(e.target.checked)}
                  className="rounded accent-cyan-500 cursor-pointer"
                />
                <Waves className={`w-3.5 h-3.5 ${followCoastline ? 'text-cyan-400' : 'text-stone-500'}`} />
                <span className={followCoastline ? 'text-cyan-300 font-bold' : ''}>海岸線沿い</span>
              </label>
            )}

            {followCoastline && onToggleSnapCoastline && (
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] select-none text-stone-300 hover:text-cyan-300">
                <input
                  type="checkbox"
                  checked={snapCoastline}
                  onChange={(e) => onToggleSnapCoastline(e.target.checked)}
                  className="rounded accent-cyan-500 cursor-pointer"
                />
                <Magnet className="w-3 h-3 text-cyan-400" />
                <span>スナップ</span>
              </label>
            )}

            {followCoastline && onAutoSelectIsland && (
              <button
                type="button"
                onClick={onAutoSelectIsland}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer border ${
                  isAutoSelectingIsland
                    ? 'bg-cyan-500 text-stone-950 border-cyan-400 font-bold animate-pulse'
                    : 'bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 hover:text-white border-cyan-700/80'
                }`}
                title="島または陸地をクリックしてその海岸線全体を一発で選択"
              >
                <Wand2 className="w-3 h-3 text-cyan-400" />
                <span>{isAutoSelectingIsland ? '島をクリック…' : '島・陸地を一括選択'}</span>
              </button>
            )}

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

        {/* Freehand Options: Snap, Auto-Island, Smooth, Margin */}
        {method === 'freehand' && (
          <div className="flex items-center gap-2.5 ml-2 border-l border-stone-700/80 pl-2.5 flex-wrap">
            {onToggleSnapCoastline && (
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] select-none text-stone-300 hover:text-cyan-300">
                <input
                  type="checkbox"
                  checked={snapCoastline}
                  onChange={(e) => onToggleSnapCoastline(e.target.checked)}
                  className="rounded accent-cyan-500 cursor-pointer"
                />
                <Magnet className="w-3 h-3 text-cyan-400" />
                <span>スナップ</span>
              </label>
            )}

            {onAutoSelectIsland && (
              <button
                type="button"
                onClick={onAutoSelectIsland}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer border ${
                  isAutoSelectingIsland
                    ? 'bg-cyan-500 text-stone-950 border-cyan-400 font-bold animate-pulse'
                    : 'bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 hover:text-white border-cyan-700/80'
                }`}
                title="島または陸地をクリックしてその海岸線全体を一発で選択"
              >
                <Wand2 className="w-3 h-3 text-cyan-400" />
                <span>{isAutoSelectingIsland ? '島をクリック…' : '島・陸地を一括選択'}</span>
              </button>
            )}

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

      {/* Town Configuration Panel */}
      {method === 'town' && townConfig && onChangeTownConfig && (
        <div className="flex flex-col gap-2 border-t border-stone-800/90 pt-2 text-[11px]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Town Name */}
            <div className="flex items-center gap-1.5">
              <span className="text-stone-400 shrink-0">名前:</span>
              <input
                type="text"
                value={townConfig.name}
                onChange={(e) => onChangeTownConfig({ name: e.target.value })}
                placeholder="街道の宿場町"
                className="bg-stone-950/80 border border-stone-700 rounded px-2 py-0.5 text-stone-100 text-xs w-36 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Scale Comparison Indicator */}
            <div className="flex items-center gap-1.5 bg-stone-950/70 border border-stone-800 px-2 py-0.5 rounded text-[10px] text-stone-400">
              <span>親: <strong className="text-amber-300 font-mono">{formatDistance(parentWidthKm)}</strong></span>
              <span className="text-stone-600">/</span>
              <span>町: <strong className="text-amber-400 font-mono">{townConfig.realWidthM} m</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Real Width in Meters */}
            <div className="flex items-center gap-2">
              <span className="text-stone-400 shrink-0">実寸幅:</span>
              <input
                type="range"
                min={100}
                max={5000}
                step={50}
                value={townConfig.realWidthM}
                onChange={(e) => onChangeTownConfig({ realWidthM: Number(e.target.value) })}
                className="w-24 accent-amber-500 h-1.5 bg-stone-800 rounded-lg cursor-pointer"
              />
              <span className="font-mono text-amber-300 font-bold w-14">{townConfig.realWidthM} m</span>

              {/* Quick Presets */}
              <div className="flex items-center gap-1 ml-1">
                {[300, 600, 1200, 2500].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onChangeTownConfig({ realWidthM: m })}
                    className={`px-1.5 py-0.5 rounded text-[10px] transition ${
                      townConfig.realWidthM === m
                        ? 'bg-amber-600 text-stone-950 font-bold'
                        : 'bg-stone-800 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {m < 1000 ? `${m}m` : `${m / 1000}km`}
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio */}
            <div className="flex items-center gap-1 border-l border-stone-800 pl-2">
              <span className="text-stone-400 shrink-0">縦横比:</span>
              <div className="flex items-center gap-0.5 bg-stone-950/80 p-0.5 rounded border border-stone-800">
                {[
                  { label: '1:1', val: 1 },
                  { label: '4:3', val: 4 / 3 },
                  { label: '3:2', val: 1.5 },
                  { label: '2:1', val: 2 },
                ].map((asp) => (
                  <button
                    key={asp.label}
                    type="button"
                    onClick={() => onChangeTownConfig({ aspect: asp.val })}
                    className={`px-1.5 py-0.5 rounded text-[10px] transition ${
                      Math.abs(townConfig.aspect - asp.val) < 0.01
                        ? 'bg-amber-600 text-stone-950 font-bold'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {asp.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Detail Scale / Relief */}
            <div className="flex items-center gap-1.5 border-l border-stone-800 pl-2">
              <span className="text-stone-400 shrink-0" title="町内の標高起伏・微小フラクタルノイズの振幅">起伏の強さ:</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={townConfig.detailScale}
                onChange={(e) => onChangeTownConfig({ detailScale: Number(e.target.value) })}
                className="w-16 accent-amber-500 h-1.5 bg-stone-800 rounded-lg cursor-pointer"
              />
              <span className="font-mono text-amber-300 text-[10px] w-7">{Math.round(townConfig.detailScale * 100)}%</span>
              <span className="text-[10px] text-stone-500">
                {townConfig.detailScale <= 0.2 ? '(なだらか)' : townConfig.detailScale <= 0.6 ? '(標準)' : '(起伏あり)'}
              </span>
            </div>
          </div>

          <div className="text-[10px] text-amber-300/80 pt-0.5 flex items-center gap-1">
            <Home className="w-3 h-3 text-amber-400 shrink-0" />
            <span>地図上の希望の場所をクリックして配置してください (マウス移動でプレビュー)</span>
          </div>
        </div>
      )}

      {/* Guide message & actions for polygon / freehand / rect2 */}
      {method === 'polygon' && (
        <div className="flex justify-between items-center text-[10px] text-stone-400 border-t border-stone-800/80 pt-1.5">
          <span>
            {polygonPointCount === 0
              ? followCoastline
                ? '地図上をクリックして開始（海岸線近くでは沿岸を自動追従）。Escで取消'
                : '地図上をクリックして最初の頂点を配置してください'
              : followCoastline
              ? `沿岸頂点 ${polygonPointCount}個配置中 (始点クリック・ダブルクリック・Enterで確定、BackSpaceで戻る、Escで取消)`
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
          {followCoastline ? (
            <span>
              {isRect2Active
                ? '2点目の海岸線をクリックして確定します (Escで取消)'
                : '海岸線の1点目をクリックし、2点目で終点をクリックして海岸線沿いの範囲を作成します (Escで取消)'}
            </span>
          ) : (
            <span>
              {isRect2Active
                ? '対角の2点目をクリックして矩形を決定します (Escで取消)'
                : '1点目をクリックして対角の始点を決め、2点目で終点を決定します (Escで取消)'}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
