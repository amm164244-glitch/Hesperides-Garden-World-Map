import React, { useState } from 'react';
import {
  X,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  FileText,
  MapPin,
  Layers,
  Sparkles,
  ShieldCheck,
  Package,
} from 'lucide-react';
import { MapData } from '../types/map';
import { CustomMapAsset, CustomSymbolCategory } from '../types/symbols';
import { serializeMapData, deserializeMapData } from '../utils/serialization';
import { exportSymbolLibraryToJson, parseSymbolLibraryJson } from '../utils/assetStorage';

interface MapStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapData: MapData;
  customAssets?: CustomMapAsset[];
  categories?: CustomSymbolCategory[];
  onLoadMap: (
    mapData: MapData,
    loadedAssets?: CustomMapAsset[],
    loadedCategories?: CustomSymbolCategory[]
  ) => void;
  onImportSymbols?: (
    assets: CustomMapAsset[],
    categories: CustomSymbolCategory[]
  ) => void;
}

export const MapStorageModal: React.FC<MapStorageModalProps> = ({
  isOpen,
  onClose,
  mapData,
  customAssets = [],
  categories = [],
  onLoadMap,
  onImportSymbols,
}) => {
  const [activeTab, setActiveTab] = useState<'map' | 'symbols'>('map');
  const [mapName, setMapName] = useState<string>(`fantasy_world_seed_${mapData.seed}`);
  const [symbolsFileName, setSymbolsFileName] = useState<string>(
    `fantasy_symbols_backup_${new Date().toISOString().slice(0, 10)}`
  );
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  if (!isOpen) return null;

  // Full Map JSON Export (bundles terrain, regions, biomes, and custom symbols together)
  const handleExportMapJSON = () => {
    try {
      const serialized = serializeMapData(mapData, customAssets, categories);
      const jsonStr = JSON.stringify(serialized, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cleanFileName = (mapName.trim() || `world_map_seed_${mapData.seed}`).replace(/[/\\?%*:|"<>]/g, '_');
      a.download = `${cleanFileName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMessage({
        text: `地図JSONを出力しました。（世界地図・階層地域マップ・バイオーム設定・自作ドット絵シンボル ${customAssets.length}件をすべて同梱）`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMessage({ text: `エクスポート失敗: ${err.message}`, type: 'error' });
    }
  };

  // Full Map JSON Import
  const handleImportMapJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const raw = JSON.parse(event.target?.result as string);
        const parsed = deserializeMapData(raw);
        const assets = Array.isArray(raw.customAssets) ? raw.customAssets : undefined;
        const cats = Array.isArray(raw.customCategories) ? raw.customCategories : undefined;
        onLoadMap(parsed, assets, cats);

        const assetNote = assets && assets.length > 0 ? `（付属ドット絵シンボル ${assets.length}件を復元）` : '';
        setStatusMessage({
          text: `地図「シード ${parsed.seed}」を正常に読み込み復元しました！ ${assetNote}`,
          type: 'success',
        });
        setTimeout(() => onClose(), 1200);
      } catch (err: any) {
        setStatusMessage({ text: `読み込み失敗: ${err.message || '無効な地図ファイル形式です'}`, type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Standalone Custom Symbols Library Export
  const handleExportSymbolsOnly = () => {
    try {
      if (customAssets.length === 0 && categories.length === 0) {
        setStatusMessage({ text: '保存可能な登録ドット絵シンボルがありません。', type: 'error' });
        return;
      }
      exportSymbolLibraryToJson(customAssets, categories, symbolsFileName);
      setStatusMessage({
        text: `登録ドット絵シンボル（${customAssets.length}件）をバックアップJSONとして保存しました！`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMessage({ text: `シンボル保存失敗: ${err.message}`, type: 'error' });
    }
  };

  // Standalone Custom Symbols Library Import
  const handleImportSymbolsOnly = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonStr = event.target?.result as string;
        const { assets, categories: importedCats } = parseSymbolLibraryJson(jsonStr);
        if (onImportSymbols) {
          onImportSymbols(assets, importedCats);
        }
        setStatusMessage({
          text: `ドット絵シンボル（${assets.length}件）およびカテゴリ（${importedCats.length}件）を正常に復元・追加しました！`,
          type: 'success',
        });
      } catch (err: any) {
        setStatusMessage({ text: `シンボル復元失敗: ${err.message || '無効なシンボルファイルです'}`, type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const regionalCount = Object.keys(mapData.regionalMaps || {}).length;
  const mapPlacedSymbolCount = (mapData.symbols || []).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[#181512] border border-[#3d3224] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-stone-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d2419] bg-[#120f0d]">
          <div className="flex items-center gap-2.5">
            <FolderOpen className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-[#f5ebd9] font-serif">地図データの保存 / 読込</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-200 p-1 rounded-lg hover:bg-[#251e16] transition cursor-pointer"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-[#2d2419] bg-[#14110e] text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('map')}
            className={`flex-1 py-3 font-semibold flex items-center justify-center gap-2 border-b-2 transition cursor-pointer ${
              activeTab === 'map'
                ? 'border-amber-500 text-amber-300 bg-[#1e1914]'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>世界地図データ (JSON)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('symbols')}
            className={`flex-1 py-3 font-semibold flex items-center justify-center gap-2 border-b-2 transition cursor-pointer ${
              activeTab === 'symbols'
                ? 'border-amber-500 text-amber-300 bg-[#1e1914]'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>ドット絵シンボル集の保持・管理</span>
            {customAssets.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono">
                {customAssets.length}
              </span>
            )}
          </button>
        </div>

        {/* Info Strip */}
        <div className="px-5 py-2.5 bg-[#120f0d] border-b border-[#251e16] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#baa993]">
          <span className="flex items-center gap-1.5">
            <span>シード:</span>
            <strong className="font-mono text-amber-400">{mapData.seed}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span>解像度:</span>
            <span className="font-mono text-stone-300">{mapData.width} × {mapData.height}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-emerald-400" />
            <span>地域マップ: <strong className="text-stone-200">{regionalCount}</strong> 件</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>登録シンボル: <strong className="text-stone-200">{customAssets.length}</strong> 種類</span>
          </span>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
          {statusMessage && (
            <div
              className={`p-3 rounded-xl flex items-center gap-2.5 text-xs ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/80 border border-emerald-700 text-emerald-200'
                  : 'bg-rose-950/80 border border-rose-700 text-rose-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span className="leading-tight">{statusMessage.text}</span>
            </div>
          )}

          {activeTab === 'map' ? (
            <div className="space-y-4">
              {/* Export Full Map */}
              <div className="p-4 bg-[#1f1a14] rounded-xl border border-[#33281b] space-y-3">
                <div className="font-bold text-[#f5ebd9] flex items-center gap-2">
                  <Download className="w-4 h-4 text-amber-400" />
                  <span>現在の地図をJSONファイルとして保存（エクスポート）</span>
                </div>
                <p className="text-[#a89985] text-xs leading-relaxed">
                  全世界地形（標高・海陸・バイオーム）、階層地域マップ、配置シンボル、および<strong>作成・登録されたドット絵シンボル（{customAssets.length}件）</strong>を完全な状態で1つのJSONファイルにまとめて保存します。
                </p>

                <div className="space-y-1.5 pt-1">
                  <label className="text-[11px] font-semibold text-[#c4b59d] block">
                    保存ファイル名:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={mapName}
                      onChange={(e) => setMapName(e.target.value)}
                      placeholder="ファイル名を入力..."
                      className="flex-1 bg-[#120f0d] border border-[#3d3224] rounded-lg px-3 py-2 text-xs text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-xs text-stone-400 font-mono">.json</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleExportMapJSON}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-stone-950 font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer active:scale-[0.99]"
                >
                  <Download className="w-4 h-4" />
                  <span>地図JSONファイルをダウンロード保存</span>
                </button>
              </div>

              {/* Import Full Map */}
              <div className="p-4 bg-[#1f1a14] rounded-xl border border-[#33281b] space-y-3">
                <div className="font-bold text-[#f5ebd9] flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>保存済み地図JSONファイルを開く（インポート）</span>
                </div>
                <p className="text-[#a89985] text-xs leading-relaxed">
                  過去に保存した地図JSONファイルを開きます。大陸の形状や各地域マップに加え、ファイルに含まれる<strong>登録ドット絵シンボルも自動的に復元</strong>されます。
                </p>

                <label className="w-full py-3 px-4 bg-[#14110e] hover:bg-[#251e16] border border-dashed border-[#4a3a27] hover:border-amber-500/60 text-[#d9ba8f] font-semibold rounded-xl transition flex items-center justify-center gap-2.5 cursor-pointer group">
                  <FileText className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span>地図JSONファイルを選択して開く</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportMapJSON}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Storage Status Protection Banner */}
              <div className="p-3.5 bg-emerald-950/40 rounded-xl border border-emerald-800/40 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold text-emerald-200 block text-xs">
                    自動永続保存が有効です
                  </span>
                  <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                    作成・登録したドット絵シンボル（{customAssets.length}種類）は、ブラウザ内部ストレージ（IndexedDBおよびLocalStorage）に即時自動保存されています。ブラウザを更新または再起動しても消えません。
                  </p>
                </div>
              </div>

              {/* Export Standalone Symbols Library */}
              <div className="p-4 bg-[#1f1a14] rounded-xl border border-[#33281b] space-y-3">
                <div className="font-bold text-[#f5ebd9] flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-400" />
                  <span>ドット絵シンボル集のバックアップ書き出し</span>
                </div>
                <p className="text-[#a89985] text-xs leading-relaxed">
                  地図とは独立して、あなたがこれまでに作成したすべてのドット絵シンボルとカテゴリ定義を単体のJSONバックアップファイルとしてPCに保存します。他のPCやブラウザへシンボル集を移行する場合にも便利です。
                </p>

                <div className="space-y-1.5 pt-1">
                  <label className="text-[11px] font-semibold text-[#c4b59d] block">
                    バックアップ名:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={symbolsFileName}
                      onChange={(e) => setSymbolsFileName(e.target.value)}
                      placeholder="バックアップ名..."
                      className="flex-1 bg-[#120f0d] border border-[#3d3224] rounded-lg px-3 py-2 text-xs text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-xs text-stone-400 font-mono">.json</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleExportSymbolsOnly}
                  disabled={customAssets.length === 0}
                  className="w-full py-2.5 px-4 bg-amber-600/90 hover:bg-amber-500 disabled:opacity-40 disabled:pointer-events-none text-stone-950 font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>シンボル集をJSONで書き出し ({customAssets.length}件)</span>
                </button>
              </div>

              {/* Import Standalone Symbols Library */}
              <div className="p-4 bg-[#1f1a14] rounded-xl border border-[#33281b] space-y-3">
                <div className="font-bold text-[#f5ebd9] flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>ドット絵シンボル集の復元・読み込み</span>
                </div>
                <p className="text-[#a89985] text-xs leading-relaxed">
                  過去に書き出したシンボルバックアップJSONファイルを読み込みます。既存のシンボルを残したまま新しいシンボルがライブラリへ統合・保持されます。
                </p>

                <label className="w-full py-3 px-4 bg-[#14110e] hover:bg-[#251e16] border border-dashed border-[#4a3a27] hover:border-emerald-500/60 text-emerald-300 font-semibold rounded-xl transition flex items-center justify-center gap-2.5 cursor-pointer group">
                  <Upload className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span>シンボルJSONファイルを選択して復元</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportSymbolsOnly}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-[#2d2419] bg-[#120f0d] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#251e16] hover:bg-[#33281b] text-xs font-medium text-[#baa993] hover:text-[#f5ebd9] transition cursor-pointer"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

// Backwards-compatible export alias
export const SupabaseModal = MapStorageModal;
