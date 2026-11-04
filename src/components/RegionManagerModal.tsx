import React, { useState, useMemo } from 'react';
import {
  X,
  Trash2,
  Layers,
  Home,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  CornerDownRight,
} from 'lucide-react';
import { RegionalMapData } from '../types/map';

interface RegionManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  regionalMaps: Record<string, RegionalMapData>;
  activeRegionId: string | null;
  onSelectRegion: (id: string | null) => void;
  onDeleteRegion: (id: string) => void;
}

/**
 * Collect all recursive descendant map IDs for a given root region ID.
 */
function getDescendants(rootId: string, allMaps: Record<string, RegionalMapData>): RegionalMapData[] {
  const result: RegionalMapData[] = [];
  const queue: string[] = [rootId];
  const visited = new Set<string>([rootId]);

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const [id, reg] of Object.entries(allMaps)) {
      if (reg.parentId === parentId && !visited.has(id)) {
        visited.add(id);
        result.push(reg);
        queue.push(id);
      }
    }
  }

  return result;
}

export const RegionManagerModal: React.FC<RegionManagerModalProps> = ({
  isOpen,
  onClose,
  regionalMaps,
  activeRegionId,
  onSelectRegion,
  onDeleteRegion,
}) => {
  // Region pending confirmation for deletion
  const [confirmTargetId, setConfirmTargetId] = useState<string | null>(null);

  // Close confirmation if modal closes
  const handleClose = () => {
    setConfirmTargetId(null);
    onClose();
  };

  const mapList = useMemo(() => {
    return Object.values(regionalMaps).sort((a, b) => {
      // Sort: parents first, then towns/children, or by name
      if (a.parentId === null && b.parentId !== null) return -1;
      if (a.parentId !== null && b.parentId === null) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [regionalMaps]);

  const confirmTarget = confirmTargetId ? regionalMaps[confirmTargetId] : null;
  const descendantMaps = useMemo(() => {
    if (!confirmTargetId) return [];
    return getDescendants(confirmTargetId, regionalMaps);
  }, [confirmTargetId, regionalMaps]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="region-manager-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl bg-stone-900 border border-stone-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-stone-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between bg-stone-950/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-950/90 border border-sky-700/60 flex items-center justify-center text-sky-400 shadow-inner">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 id="region-manager-title" className="text-sm font-bold text-stone-100 flex items-center gap-2">
                地域・町マップの管理
                <span className="text-[11px] font-mono font-normal px-2 py-0.5 rounded-full bg-stone-800 text-stone-400 border border-stone-700">
                  {mapList.length} 件
                </span>
              </h2>
              <p className="text-[11px] text-stone-400">
                作成済みの地域マップや町マップの一覧、移動、および削除が行えます
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg transition"
            title="閉じる"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {mapList.length === 0 ? (
            <div className="py-12 px-6 text-center border-2 border-dashed border-stone-800 rounded-xl bg-stone-950/30">
              <Layers className="w-10 h-10 text-stone-600 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-stone-300 mb-1">
                生成された地域マップはありません
              </h3>
              <p className="text-xs text-stone-500 max-w-sm mx-auto leading-relaxed">
                ツールバーの「地域範囲選択」ツールを使って地図上の範囲を選択すると、高精細な詳細地域マップや町マップを作成できます。
              </p>
            </div>
          ) : (
            mapList.map((reg) => {
              const isCurrent = activeRegionId === reg.id;
              const parentMap = reg.parentId ? regionalMaps[reg.parentId] : null;
              const directChildren = mapList.filter((m) => m.parentId === reg.id);
              const symbolCount = reg.symbols?.length || 0;
              const townObjCount = reg.townObjects?.length || 0;

              return (
                <div
                  key={reg.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isCurrent
                      ? 'bg-amber-950/30 border-amber-500/60 shadow-lg'
                      : 'bg-stone-950/60 border-stone-800 hover:border-stone-700/80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {reg.kind === 'town' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-900/60 text-amber-300 border border-amber-700/60">
                            <Home className="w-3 h-3 text-amber-400" />
                            町マップ
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-700/60">
                            <Layers className="w-3 h-3 text-sky-400" />
                            地域 ({reg.zoomScale}x)
                          </span>
                        )}

                        <span className="text-sm font-bold text-stone-100 truncate">
                          {reg.name}
                        </span>

                        {isCurrent && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/50 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            表示中
                          </span>
                        )}
                      </div>

                      {/* Map Metadata details */}
                      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-stone-400 mt-1">
                        <span className="font-mono">
                          解像度: {reg.gridCols}×{reg.gridRows}
                        </span>
                        {reg.widthKm !== undefined && (
                          <span>
                            実幅: 約 {reg.widthKm >= 100 ? Math.round(reg.widthKm).toLocaleString() : reg.widthKm.toFixed(1)} km
                          </span>
                        )}
                        <span>
                          親マップ: {parentMap ? parentMap.name : '世界マップ'}
                        </span>
                        {directChildren.length > 0 && (
                          <span className="text-sky-400 font-medium flex items-center gap-0.5">
                            <CornerDownRight className="w-3 h-3" />
                            配下: {directChildren.length} 件
                          </span>
                        )}
                        {symbolCount > 0 && (
                          <span>シンボル: {symbolCount} 個</span>
                        )}
                        {townObjCount > 0 && (
                          <span>町オブジェクト: {townObjCount} 個</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectRegion(reg.id);
                          handleClose();
                        }}
                        disabled={isCurrent}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                          isCurrent
                            ? 'bg-stone-800 text-stone-500 cursor-default'
                            : 'bg-stone-800 hover:bg-stone-700 text-amber-200 border border-stone-700 hover:border-amber-500/50 cursor-pointer shadow-sm'
                        }`}
                        title={isCurrent ? '現在このマップを表示中です' : 'このマップへ移動して表示'}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>{isCurrent ? '表示中' : '開く'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirmTargetId(reg.id)}
                        className="p-1.5 bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-200 border border-red-800/40 hover:border-red-600 rounded-lg transition text-xs flex items-center gap-1 cursor-pointer"
                        title={`「${reg.name}」を削除`}
                        aria-label={`「${reg.name}」を削除`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-800 bg-stone-950/80 flex items-center justify-between text-xs text-stone-400">
          <span>
            {activeRegionId ? '現在地域マップを表示中' : '現在世界マップを表示中'}
          </span>
          <div className="flex items-center gap-2">
            {activeRegionId && (
              <button
                type="button"
                onClick={() => {
                  onSelectRegion(null);
                  handleClose();
                }}
                className="px-3 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-xs font-medium border border-stone-700 transition"
              >
                世界マップへ戻る
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg font-medium transition"
            >
              閉じる
            </button>
          </div>
        </div>

        {/* Delete Confirmation Dialog Overlay */}
        {confirmTarget && (
          <div className="absolute inset-0 z-20 bg-black/85 backdrop-blur-md p-6 flex flex-col justify-center animate-in fade-in duration-150">
            <div className="bg-stone-900 border border-red-500/50 rounded-2xl p-6 shadow-2xl max-w-lg mx-auto w-full">
              <div className="flex items-center gap-3 text-red-400 mb-3">
                <div className="w-10 h-10 rounded-xl bg-red-950/80 border border-red-600/60 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-stone-100">
                    地域マップの削除確認
                  </h3>
                  <p className="text-xs text-stone-400">
                    この操作を実行するとデータは完全に削除され、復元できません。
                  </p>
                </div>
              </div>

              <div className="my-4 p-3.5 bg-stone-950/80 rounded-xl border border-stone-800 text-xs space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-stone-400">対象マップ:</span>
                  <span className="font-bold text-stone-100">
                    {confirmTarget.kind === 'town' ? `[町] ${confirmTarget.name}` : confirmTarget.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">
                    {confirmTarget.gridCols}×{confirmTarget.gridRows}
                  </span>
                </div>

                {descendantMaps.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-stone-800/80 text-amber-300">
                    <p className="font-semibold flex items-center gap-1 mb-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      以下の配下マップ ({descendantMaps.length} 件) も同時に削除されます:
                    </p>
                    <ul className="pl-4 space-y-0.5 list-disc text-stone-300 max-h-28 overflow-y-auto font-mono text-[11px]">
                      {descendantMaps.map((d) => (
                        <li key={d.id}>
                          {d.kind === 'town' ? `[町] ${d.name}` : d.name} ({d.gridCols}×{d.gridRows})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setConfirmTargetId(null)}
                  className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-xl text-xs font-semibold transition"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const idToDelete = confirmTargetId;
                    setConfirmTargetId(null);
                    if (idToDelete) {
                      onDeleteRegion(idToDelete);
                    }
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-red-950/50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>マップを完全に削除</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
