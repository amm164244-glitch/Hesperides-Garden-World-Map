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
} from 'lucide-react';
import { TownObject } from '../types/town';
import { generateSampleTown } from '../utils/town/townSample';

interface TownObjectsPanelProps {
  mapWidth: number;
  mapHeight: number;
  metersPerUnit: number;
  townSeed?: number;
  townObjects: TownObject[];
  showTownObjects: boolean;
  onToggleShowTownObjects: (show: boolean) => void;
  onApplyTownObjects: (newObjects: TownObject[], description: string) => void;
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
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<'sample' | 'clear' | null>(null);

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

  const handleConfirmSample = () => {
    const sample = generateSampleTown(
      mapWidth,
      mapHeight,
      metersPerUnit,
      townSeed || Math.floor(Math.random() * 100000)
    );
    onApplyTownObjects(sample, 'サンプルの町を配置');
    setConfirmDialog(null);
  };

  const handleConfirmClear = () => {
    onApplyTownObjects([], '町の部品をすべて削除');
    setConfirmDialog(null);
  };

  return (
    <>
      <div className="bg-stone-900/95 backdrop-blur-md border border-stone-800 text-stone-200 shadow-2xl rounded-t-lg transition-all text-xs select-none">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-stone-800/80 bg-stone-950/60 rounded-t-lg">
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
                    ? '現在の部品は置き換えられます。（操作は Undo で元に戻せます）'
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
