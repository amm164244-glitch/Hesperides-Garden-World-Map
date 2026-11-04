import React, { useState, useMemo } from 'react';
import {
  Castle,
  Eye,
  EyeOff,
  Trash2,
  Wand2,
  ChevronDown,
  ChevronUp,
  Building2,
  Milestone,
  Shield,
  Anchor,
  Layers,
  AlertTriangle,
  Palette,
  CheckCircle2,
  Plus,
  X,
  Magnet,
  Ruler,
  MousePointer,
} from 'lucide-react';
import { BrushMode } from '../types/map';
import {
  DEFAULT_TOWN_TOOL_CONFIG,
  TownObject,
  TownRoad,
  TownRoadStyle,
  TownRoofTheme,
  TownToolConfig,
  TownWall,
  TownPier,
} from '../types/town';
import {
  createTerrainWaterSampler,
  generateSampleTown,
  SampleTownStats,
} from '../utils/town/townSample';
import { polylineLength } from '../utils/town/townGeometry';
import { removeGate } from '../utils/town/townEdit';

interface TownObjectsPanelProps {
  mapWidth: number;
  mapHeight: number;
  metersPerUnit: number;
  townSeed?: number;
  townObjects: TownObject[];
  showTownObjects: boolean;
  onToggleShowTownObjects: (show: boolean) => void;
  onApplyTownObjects: (newObjects: TownObject[], description: string) => void;
  elevationGrid?: Float32Array;
  gridCols?: number;
  gridRows?: number;
  seaLevel?: number;
  roofTheme?: TownRoofTheme;
  onChangeRoofTheme?: (theme: TownRoofTheme) => void;

  // Town tool editing additions
  activeTool?: BrushMode;
  selectedTownObjectIds?: string[];
  onSelectTownObjectIds?: (ids: string[]) => void;
  townToolConfig?: TownToolConfig;
  onChangeTownToolConfig?: (patch: Partial<TownToolConfig>) => void;
  isAddingGateMode?: boolean;
  onToggleAddingGateMode?: (enabled: boolean) => void;
}

export const TownObjectsPanel: React.FC<TownObjectsPanelProps> = ({
  mapWidth,
  mapHeight,
  metersPerUnit,
  townSeed = 12345,
  townObjects,
  showTownObjects,
  onToggleShowTownObjects,
  onApplyTownObjects,
  elevationGrid,
  gridCols,
  gridRows,
  seaLevel,
  roofTheme = 'terracotta',
  onChangeRoofTheme,
  activeTool,
  selectedTownObjectIds = [],
  onSelectTownObjectIds,
  townToolConfig = DEFAULT_TOWN_TOOL_CONFIG,
  onChangeTownToolConfig,
  isAddingGateMode = false,
  onToggleAddingGateMode,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<'sample' | 'clear' | null>(null);
  const [lastPlacementStats, setLastPlacementStats] = useState<SampleTownStats | null>(null);

  // Group counts by object kind
  const counts = useMemo(() => {
    let districts = 0;
    let roads = 0;
    let buildings = 0;
    let walls = 0;
    let piers = 0;

    for (const obj of townObjects) {
      if (obj.kind === 'district') districts++;
      else if (obj.kind === 'road') roads++;
      else if (obj.kind === 'building') buildings++;
      else if (obj.kind === 'wall') walls++;
      else if (obj.kind === 'pier') piers++;
    }

    return {
      districts,
      roads,
      buildings,
      walls,
      piers,
      total: townObjects.length,
    };
  }, [townObjects]);

  // Selected object(s) lookup
  const selectedObjects = useMemo(() => {
    if (!selectedTownObjectIds || selectedTownObjectIds.length === 0) return [];
    const set = new Set(selectedTownObjectIds);
    return townObjects.filter((o) => set.has(o.id));
  }, [selectedTownObjectIds, townObjects]);

  const singleSelected = selectedObjects.length === 1 ? selectedObjects[0] : null;

  const handleConfirmSample = () => {
    const terrain =
      elevationGrid && gridCols && gridRows && seaLevel !== undefined
        ? createTerrainWaterSampler(
            elevationGrid,
            gridCols,
            gridRows,
            mapWidth,
            mapHeight,
            seaLevel
          )
        : undefined;

    const sample = generateSampleTown(
      mapWidth,
      mapHeight,
      metersPerUnit,
      townSeed || Math.floor(Math.random() * 100000),
      terrain
    );

    setLastPlacementStats(sample.stats);
    onApplyTownObjects(sample, 'サンプルの町を配置');
    onSelectTownObjectIds?.([]);
    setConfirmDialog(null);
  };

  const handleConfirmClear = () => {
    onApplyTownObjects([], '町の部品をすべて削除');
    setLastPlacementStats(null);
    onSelectTownObjectIds?.([]);
    setConfirmDialog(null);
  };

  // Update properties of single selected object
  const handleUpdateSingleObject = (updated: TownObject, desc: string) => {
    const nextObjects = townObjects.map((o) => (o.id === updated.id ? updated : o));
    onApplyTownObjects(nextObjects, desc);
  };

  // Delete currently selected object(s)
  const handleDeleteSelected = () => {
    if (selectedObjects.length === 0) return;
    const toDelete = new Set(selectedTownObjectIds);
    const nextObjects = townObjects.filter((o) => !toDelete.has(o.id));
    onApplyTownObjects(nextObjects, selectedObjects.length === 1 ? '町部品の削除' : `${selectedObjects.length}件の町部品を削除`);
    onSelectTownObjectIds?.([]);
  };

  const isTownToolActive =
    activeTool === 'townSelect' ||
    activeTool === 'townRoad' ||
    activeTool === 'townWall' ||
    activeTool === 'townPier';

  return (
    <>
      <div className="bg-stone-900/95 backdrop-blur-md border border-stone-800 text-stone-200 shadow-2xl rounded-t-lg transition-all text-xs select-none max-h-[85vh] overflow-y-auto">
        {/* Header Bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-1.5 border-b border-stone-800/80 bg-stone-950/90 rounded-t-lg">
          <div className="flex items-center gap-2">
            <Castle className="w-4 h-4 text-amber-400" />
            <span className="font-semibold tracking-wide text-amber-200">町の部品 (オブジェクト層)</span>
            <span className="bg-stone-800 text-stone-400 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
              計 {counts.total} 件
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer text-stone-300 hover:text-amber-300 transition-colors">
              <input
                type="checkbox"
                checked={showTownObjects}
                onChange={(e) => onToggleShowTownObjects(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-stone-700 bg-stone-800 text-amber-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-[11px] flex items-center gap-1">
                {showTownObjects ? <Eye className="w-3 h-3 text-emerald-400" /> : <EyeOff className="w-3 h-3 text-stone-500" />}
                表示
              </span>
            </label>

            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 hover:bg-stone-800 text-stone-400 hover:text-stone-200 rounded transition-colors"
              title={isCollapsed ? '展開' : '折りたたむ'}
            >
              {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Content Body */}
        {!isCollapsed && (
          <div className="p-3 space-y-2.5">
            {/* Active Town Tool Settings Bar */}
            {isTownToolActive && (
              <div className="bg-amber-950/40 border border-amber-600/50 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center justify-between border-b border-amber-800/40 pb-1.5">
                  <div className="flex items-center gap-1.5 text-amber-300 font-semibold text-xs">
                    {activeTool === 'townSelect' && <MousePointer className="w-3.5 h-3.5" />}
                    {activeTool === 'townRoad' && <Milestone className="w-3.5 h-3.5" />}
                    {activeTool === 'townWall' && <Shield className="w-3.5 h-3.5" />}
                    {activeTool === 'townPier' && <Anchor className="w-3.5 h-3.5" />}
                    <span>
                      {activeTool === 'townSelect' && 'ツール設定: 選択・変形'}
                      {activeTool === 'townRoad' && 'ツール設定: 道を描く'}
                      {activeTool === 'townWall' && 'ツール設定: 城壁を描く'}
                      {activeTool === 'townPier' && 'ツール設定: 桟橋/橋を描く'}
                    </span>
                  </div>

                  {/* Common Snapping & Length label toggles */}
                  <div className="flex items-center gap-2 text-[10px] text-stone-300">
                    <label className="flex items-center gap-1 cursor-pointer" title="端点や頂点への8px自動吸着 (Altキーで一時解除)">
                      <input
                        type="checkbox"
                        checked={townToolConfig.snapEnabled}
                        onChange={(e) => onChangeTownToolConfig?.({ snapEnabled: e.target.checked })}
                        className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                      />
                      <Magnet className="w-3 h-3 text-sky-400" />
                      <span>吸着</span>
                    </label>

                    <label className="flex items-center gap-1 cursor-pointer" title="描画中に実距離(m)ラベルを表示">
                      <input
                        type="checkbox"
                        checked={townToolConfig.showLengths}
                        onChange={(e) => onChangeTownToolConfig?.({ showLengths: e.target.checked })}
                        className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                      />
                      <Ruler className="w-3 h-3 text-emerald-400" />
                      <span>距離表示</span>
                    </label>
                  </div>
                </div>

                {/* Road tool options */}
                {activeTool === 'townRoad' && (
                  <div className="grid grid-cols-3 gap-2 items-center text-[11px]">
                    <div>
                      <span className="text-stone-400 block mb-0.5">種別:</span>
                      <select
                        value={townToolConfig.roadStyle}
                        onChange={(e) => onChangeTownToolConfig?.({ roadStyle: e.target.value as TownRoadStyle })}
                        className="w-full bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-200 text-xs"
                      >
                        <option value="main">大通り (石畳)</option>
                        <option value="street">街路 (舗装)</option>
                        <option value="path">小道 (未舗装)</option>
                      </select>
                    </div>

                    <div>
                      <span className="text-stone-400 block mb-0.5">幅: {townToolConfig.roadWidthM}m</span>
                      <input
                        type="range"
                        min={2}
                        max={16}
                        step={1}
                        value={townToolConfig.roadWidthM}
                        onChange={(e) => onChangeTownToolConfig?.({ roadWidthM: Number(e.target.value) })}
                        className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                    </div>

                    <div className="pt-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={townToolConfig.roadSmooth}
                          onChange={(e) => onChangeTownToolConfig?.({ roadSmooth: e.target.checked })}
                          className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                        />
                        <span className="text-stone-300">滑らかな曲線</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Wall tool options */}
                {activeTool === 'townWall' && (
                  <div className="space-y-1.5 text-[11px]">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-stone-400 block mb-0.5">厚み: {townToolConfig.wallThicknessM}m</span>
                        <input
                          type="range"
                          min={2}
                          max={10}
                          step={1}
                          value={townToolConfig.wallThicknessM}
                          onChange={(e) => onChangeTownToolConfig?.({ wallThicknessM: Number(e.target.value) })}
                          className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                      </div>

                      <div>
                        <span className="text-stone-400 block mb-0.5">見張り塔半径: {townToolConfig.wallTowerRadiusM}m</span>
                        <input
                          type="range"
                          min={2}
                          max={8}
                          step={0.5}
                          value={townToolConfig.wallTowerRadiusM}
                          onChange={(e) => onChangeTownToolConfig?.({ wallTowerRadiusM: Number(e.target.value) })}
                          className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4 pt-1">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={townToolConfig.wallTowers}
                          onChange={(e) => onChangeTownToolConfig?.({ wallTowers: e.target.checked })}
                          className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                        />
                        <span className="text-stone-300">頂点に見張り塔を配置</span>
                      </label>

                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={townToolConfig.wallClosed}
                          onChange={(e) => onChangeTownToolConfig?.({ wallClosed: e.target.checked })}
                          className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                        />
                        <span className="text-stone-300">閉じた城郭ループ</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Pier tool options */}
                {activeTool === 'townPier' && (
                  <div className="grid grid-cols-2 gap-2 items-center text-[11px]">
                    <div>
                      <span className="text-stone-400 block mb-0.5">種類:</span>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="pierVariant"
                            checked={townToolConfig.pierVariant === 'pier'}
                            onChange={() => onChangeTownToolConfig?.({ pierVariant: 'pier' })}
                            className="text-amber-500 bg-stone-800"
                          />
                          <span>桟橋</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="pierVariant"
                            checked={townToolConfig.pierVariant === 'bridge'}
                            onChange={() => onChangeTownToolConfig?.({ pierVariant: 'bridge' })}
                            className="text-amber-500 bg-stone-800"
                          />
                          <span>橋</span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <span className="text-stone-400 block mb-0.5">幅: {townToolConfig.pierWidthM}m</span>
                      <input
                        type="range"
                        min={2}
                        max={12}
                        step={1}
                        value={townToolConfig.pierWidthM}
                        onChange={(e) => onChangeTownToolConfig?.({ pierWidthM: Number(e.target.value) })}
                        className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                    </div>
                  </div>
                )}

                {/* Help tip for drawing tools */}
                <div className="text-[10px] text-amber-300/80 flex items-center justify-between pt-1 border-t border-amber-800/30">
                  {activeTool === 'townSelect' && (
                    <span>クリックで選択、ドラッグで移動。頂点・中間点の丸をドラッグして変形。Delで削除。</span>
                  )}
                  {activeTool === 'townRoad' && (
                    <span>クリックで頂点を追加。Enterまたは最後の点を再クリックで確定。Escでキャンセル。</span>
                  )}
                  {activeTool === 'townWall' && (
                    <span>クリックで頂点を追加。始点クリックでループ閉鎖。Enterで確定。</span>
                  )}
                  {activeTool === 'townPier' && (
                    <span>陸から水上へクリックして頂点を追加。Enterで確定。</span>
                  )}
                </div>
              </div>
            )}

            {/* Selected Object(s) Property Inspector */}
            {selectedObjects.length > 0 && (
              <div className="bg-stone-950/80 border border-amber-500/60 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center justify-between border-b border-stone-800 pb-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                    <MousePointer className="w-3.5 h-3.5" />
                    <span>
                      {selectedObjects.length === 1
                        ? `選択中の部品 (${singleSelected?.kind === 'road' ? '道' : singleSelected?.kind === 'wall' ? '城壁' : singleSelected?.kind === 'pier' ? '桟橋/橋' : singleSelected?.kind === 'building' ? '建物' : '区画'})`
                        : `${selectedObjects.length} 件の部品を選択中`}
                    </span>
                  </div>

                  <button
                    onClick={handleDeleteSelected}
                    className="px-2 py-0.5 bg-red-950/70 hover:bg-red-900 text-red-300 border border-red-800 rounded text-[11px] flex items-center gap-1 transition shadow cursor-pointer"
                    title="選択した部品を削除 (Delete / Backspace)"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                    <span>{selectedObjects.length === 1 ? '削除' : '一括削除'}</span>
                  </button>
                </div>

                {/* Single Object Inspector */}
                {singleSelected && (
                  <div className="space-y-2 text-[11px]">
                    {/* Name input */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-stone-400 shrink-0">名前:</span>
                      <input
                        type="text"
                        value={singleSelected.name || ''}
                        placeholder={singleSelected.id}
                        onChange={(e) => {
                          const updated = { ...singleSelected, name: e.target.value };
                          handleUpdateSingleObject(updated, '町部品の名前を変更');
                        }}
                        className="flex-1 bg-stone-800 border border-stone-700 rounded px-2 py-0.5 text-stone-200 text-xs focus:ring-1 focus:ring-amber-500 outline-none"
                      />
                    </div>

                    {/* Road properties */}
                    {singleSelected.kind === 'road' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-stone-400 block mb-0.5">種別:</span>
                            <select
                              value={singleSelected.style}
                              onChange={(e) => {
                                const updated: TownRoad = {
                                  ...singleSelected,
                                  style: e.target.value as TownRoadStyle,
                                };
                                handleUpdateSingleObject(updated, '道路の種別を変更');
                              }}
                              className="w-full bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-200 text-xs"
                            >
                              <option value="main">大通り (石畳)</option>
                              <option value="street">街路 (舗装)</option>
                              <option value="path">小道 (未舗装)</option>
                            </select>
                          </div>

                          <div>
                            <span className="text-stone-400 block mb-0.5">幅: {singleSelected.widthM}m</span>
                            <input
                              type="range"
                              min={2}
                              max={16}
                              step={1}
                              value={singleSelected.widthM}
                              onChange={(e) => {
                                const updated: TownRoad = {
                                  ...singleSelected,
                                  widthM: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '道路の幅を変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={singleSelected.smooth}
                              onChange={(e) => {
                                const updated: TownRoad = {
                                  ...singleSelected,
                                  smooth: e.target.checked,
                                };
                                handleUpdateSingleObject(updated, '曲線の滑らかさを変更');
                              }}
                              className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                            />
                            <span className="text-stone-300">Catmull-Rom曲線</span>
                          </label>

                          <span className="text-stone-400">
                            全長: <strong className="text-amber-200 font-mono">{Math.round(polylineLength(singleSelected.points) * metersPerUnit)}m</strong> ({singleSelected.points.length}頂点)
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Wall properties */}
                    {singleSelected.kind === 'wall' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-stone-400 block mb-0.5">厚み: {singleSelected.thicknessM}m</span>
                            <input
                              type="range"
                              min={2}
                              max={10}
                              step={1}
                              value={singleSelected.thicknessM}
                              onChange={(e) => {
                                const updated: TownWall = {
                                  ...singleSelected,
                                  thicknessM: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '城壁の厚みを変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>

                          <div>
                            <span className="text-stone-400 block mb-0.5">塔半径: {singleSelected.towerRadiusM}m</span>
                            <input
                              type="range"
                              min={2}
                              max={8}
                              step={0.5}
                              value={singleSelected.towerRadiusM}
                              onChange={(e) => {
                                const updated: TownWall = {
                                  ...singleSelected,
                                  towerRadiusM: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '見張り塔半径を変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={singleSelected.towers}
                              onChange={(e) => {
                                const updated: TownWall = {
                                  ...singleSelected,
                                  towers: e.target.checked,
                                };
                                handleUpdateSingleObject(updated, '見張り塔の有無を変更');
                              }}
                              className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                            />
                            <span className="text-stone-300">見張り塔を表示</span>
                          </label>

                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={singleSelected.closed}
                              onChange={(e) => {
                                const updated: TownWall = {
                                  ...singleSelected,
                                  closed: e.target.checked,
                                };
                                handleUpdateSingleObject(updated, '城郭ループの開閉を変更');
                              }}
                              className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                            />
                            <span className="text-stone-300">閉じた城郭</span>
                          </label>
                        </div>

                        {/* Gates Management */}
                        <div className="bg-stone-900 border border-stone-800 rounded p-1.5 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-stone-300 font-semibold">
                              城門: {singleSelected.gates.length} 箇所
                            </span>
                            <button
                              type="button"
                              onClick={() => onToggleAddingGateMode?.(!isAddingGateMode)}
                              className={`px-2 py-0.5 rounded text-[10px] flex items-center gap-1 transition ${
                                isAddingGateMode
                                  ? 'bg-amber-500 text-stone-950 font-bold'
                                  : 'bg-stone-800 hover:bg-stone-700 text-amber-300'
                              }`}
                            >
                              <Plus className="w-2.5 h-2.5" />
                              <span>{isAddingGateMode ? '壁をクリックして門を配置中' : '門を追加'}</span>
                            </button>
                          </div>

                          {singleSelected.gates.length > 0 && (
                            <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                              {singleSelected.gates.map((g, gIdx) => (
                                <div
                                  key={gIdx}
                                  className="flex items-center justify-between bg-stone-950 px-2 py-0.5 rounded text-[10px]"
                                >
                                  <span className="text-stone-300">
                                    門 #{gIdx + 1}: 区間{g.segmentIndex + 1} (幅{g.widthM}m)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = removeGate(singleSelected, gIdx);
                                      handleUpdateSingleObject(updated, '城門の削除');
                                    }}
                                    className="text-stone-500 hover:text-red-400 p-0.5 rounded"
                                    title="この城門を削除"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Pier properties */}
                    {singleSelected.kind === 'pier' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-2 items-center">
                          <div>
                            <span className="text-stone-400 block mb-0.5">種類:</span>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="singlePierVariant"
                                  checked={singleSelected.variant === 'pier'}
                                  onChange={() => {
                                    const updated: TownPier = { ...singleSelected, variant: 'pier' };
                                    handleUpdateSingleObject(updated, '桟橋に変更');
                                  }}
                                  className="text-amber-500 bg-stone-800"
                                />
                                <span>桟橋</span>
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="singlePierVariant"
                                  checked={singleSelected.variant === 'bridge'}
                                  onChange={() => {
                                    const updated: TownPier = { ...singleSelected, variant: 'bridge' };
                                    handleUpdateSingleObject(updated, '橋に変更');
                                  }}
                                  className="text-amber-500 bg-stone-800"
                                />
                                <span>橋</span>
                              </label>
                            </div>
                          </div>

                          <div>
                            <span className="text-stone-400 block mb-0.5">幅: {singleSelected.widthM}m</span>
                            <input
                              type="range"
                              min={2}
                              max={12}
                              step={1}
                              value={singleSelected.widthM}
                              onChange={(e) => {
                                const updated: TownPier = {
                                  ...singleSelected,
                                  widthM: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '桟橋の幅を変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        <div className="text-right text-stone-400">
                          全長: <strong className="text-amber-200 font-mono">{Math.round(polylineLength(singleSelected.points) * metersPerUnit)}m</strong> ({singleSelected.points.length}頂点)
                        </div>
                      </div>
                    )}

                    {/* Building properties */}
                    {singleSelected.kind === 'building' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-stone-400 block mb-0.5">高さ: {singleSelected.heightM}m</span>
                          <input
                            type="range"
                            min={4}
                            max={24}
                            step={1}
                            value={singleSelected.heightM}
                            onChange={(e) => {
                              const updated = {
                                ...singleSelected,
                                heightM: Number(e.target.value),
                              };
                              handleUpdateSingleObject(updated, '建物の高さを変更');
                            }}
                            className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                        </div>

                        <div>
                          <span className="text-stone-400 block mb-0.5">屋根トーン差: {Math.round(singleSelected.tone * 100)}%</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={singleSelected.tone}
                            onChange={(e) => {
                              const updated = {
                                ...singleSelected,
                                tone: Number(e.target.value),
                              };
                              handleUpdateSingleObject(updated, '屋根トーンの変更');
                            }}
                            className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Roof Theme Dropdown */}
            <div className="flex items-center justify-between bg-stone-950/60 border border-stone-800/80 rounded px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 text-stone-300">
                <Palette className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-medium">屋根の配色:</span>
              </div>
              <select
                value={roofTheme}
                onChange={(e) => onChangeRoofTheme?.(e.target.value as TownRoofTheme)}
                className="bg-stone-800 hover:bg-stone-750 border border-stone-700 rounded px-2 py-0.5 text-stone-200 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
              >
                <option value="terracotta">赤茶 (テラコッタ)</option>
                <option value="thatch">わら (わら葺き)</option>
                <option value="slate">スレート (青灰色)</option>
                <option value="stone">石 (淡い石色)</option>
              </select>
            </div>

            {/* Counts Breakdown Grid */}
            <div className="grid grid-cols-5 gap-1.5 text-center">
              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Layers className="w-2.5 h-2.5 text-amber-500" />
                  <span>区画</span>
                </div>
                <div className="font-mono font-bold text-amber-300 mt-0.5">{counts.districts}</div>
              </div>

              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Milestone className="w-2.5 h-2.5 text-stone-400" />
                  <span>道路</span>
                </div>
                <div className="font-mono font-bold text-stone-200 mt-0.5">{counts.roads}</div>
              </div>

              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Building2 className="w-2.5 h-2.5 text-amber-600" />
                  <span>建物</span>
                </div>
                <div className="font-mono font-bold text-amber-200 mt-0.5">{counts.buildings}</div>
              </div>

              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Shield className="w-2.5 h-2.5 text-stone-300" />
                  <span>城壁</span>
                </div>
                <div className="font-mono font-bold text-stone-200 mt-0.5">{counts.walls}</div>
              </div>

              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Anchor className="w-2.5 h-2.5 text-sky-400" />
                  <span>桟橋</span>
                </div>
                <div className="font-mono font-bold text-sky-300 mt-0.5">{counts.piers}</div>
              </div>
            </div>

            {/* Last Placement Stats Notification */}
            {lastPlacementStats && (
              <div className="bg-stone-950/80 border border-stone-700/80 rounded p-2 text-[11px] space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>サンプルの町を配置しました</span>
                </div>
                <div className="text-stone-300 pl-5 space-y-0.5">
                  <div>
                    ・水の上のため置かなかった建物: <span className="font-mono text-amber-300 font-semibold">{lastPlacementStats.skippedBuildingsCount}</span> 棟
                  </div>
                  <div>
                    ・桟橋: <span className={lastPlacementStats.pierPlaced ? 'text-sky-300 font-medium' : 'text-stone-400'}>
                      {lastPlacementStats.pierPlaced ? '置きました' : '水が近くにないため置きませんでした'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setConfirmDialog('sample')}
                className="flex-1 flex items-center justify-center gap-1.5 bg-amber-700/80 hover:bg-amber-600 active:bg-amber-800 text-amber-100 font-medium py-1.5 px-3 rounded shadow transition-colors"
                title="サンプルの町並みを自動配置してペン画風の描画を確認します"
              >
                <Wand2 className="w-3.5 h-3.5 text-amber-200" />
                <span>サンプルの町を配置 (確認用)</span>
              </button>

              <button
                onClick={() => setConfirmDialog('clear')}
                disabled={counts.total === 0}
                className="flex items-center justify-center gap-1 bg-stone-800 hover:bg-red-950/80 hover:text-red-300 hover:border-red-800 border border-stone-700/80 disabled:opacity-40 disabled:pointer-events-none text-stone-300 font-medium py-1.5 px-2.5 rounded transition-colors"
                title="配置されているすべての町オブジェクトを削除します"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>全削除</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-stone-900 border border-stone-700 rounded-lg p-5 max-w-sm w-full shadow-2xl text-stone-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-950/60 border border-amber-800/80 rounded-full text-amber-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-stone-100 text-sm">
                  {confirmDialog === 'sample' ? 'サンプルの町を配置しますか？' : 'すべての部品を削除しますか？'}
                </h3>
                <p className="text-stone-400 text-xs mt-0.5">
                  {confirmDialog === 'sample'
                    ? '現在の部品は置き換えられます。（水域を避けて配置されます。操作は Undo で元に戻せます）'
                    : '配置されているすべての町部品を消去します。（Undo で元に戻せます）'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-800">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs rounded transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={confirmDialog === 'sample' ? handleConfirmSample : handleConfirmClear}
                className={`px-3 py-1.5 text-xs font-medium rounded shadow transition-colors ${
                  confirmDialog === 'sample'
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-red-700 hover:bg-red-600 text-white'
                }`}
              >
                {confirmDialog === 'sample' ? '置き換えて配置' : 'すべて削除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
