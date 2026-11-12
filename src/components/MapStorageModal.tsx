import React, { useState } from 'react';
import {
  X,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  FileText,
  Layers,
  Sparkles,
  ShieldCheck,
  Package,
  Cpu,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { MapData } from '../types/map';
import { CustomMapAsset, CustomSymbolCategory } from '../types/symbols';
import { serializeMapData } from '../utils/serialization';
import { exportSymbolLibraryToJson, parseSymbolLibraryJson } from '../utils/assetStorage';
import { serializeMapDataToFwm, loadUnifiedMapFile } from '../utils/binaryMapStorage';

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
  const [exportFormat, setExportFormat] = useState<'fwm' | 'json'>('fwm');
  const [highPrecision, setHighPrecision] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);

  const [mapName, setMapName] = useState<string>(`fantasy_world_seed_${mapData.seed}`);
  const [symbolsFileName, setSymbolsFileName] = useState<string>(
    `fantasy_symbols_backup_${new Date().toISOString().slice(0, 10)}`
  );
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);

  if (!isOpen) return null;

  const totalCells = (mapData.gridCols || 2048) * (mapData.gridRows || 1024);
  const isLargeMap = totalCells > 2048 * 1024;
  const rawElevMb = (totalCells * 4) / (1024 * 1024);
  const estNormalMin = Math.max(0.2, rawElevMb * 0.08).toFixed(1);
  const estNormalMax = Math.max(0.5, rawElevMb * 0.22).toFixed(1);
  const estHighMin = Math.max(0.5, rawElevMb * 0.4).toFixed(1);
  const estHighMax = Math.max(1.0, rawElevMb * 0.65).toFixed(1);

  // Full Map Export (.fwm or legacy .json)
  const handleExportMap = async () => {
    setIsProcessing(true);
    setProgress({ stage: 'エクスポート準備中...', percent: 0 });
    setStatusMessage(null);

    try {
      const cleanFileName = (mapName.trim() || `world_map_seed_${mapData.seed}`).replace(/[/\\?%*:|"<>]/g, '_');

      if (exportFormat === 'fwm') {
        const res = await serializeMapDataToFwm(mapData, customAssets, categories, {
          highPrecision,
          onProgress: (stage, p) => {
            setProgress({ stage, percent: Math.round(p * 100) });
          },
        });

        const url = URL.createObjectURL(res.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${cleanFileName}.fwm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const rawMb = (res.rawBytes / (1024 * 1024)).toFixed(1);
        const compMb = (res.compressedBytes / (1024 * 1024)).toFixed(1);
        setStatusMessage({
          text: `地図データ (.fwm) を保存しました: ${rawMb}MB → ${compMb}MB (${res.reductionPercent}% 削減)`,
          type: 'success',
        });
      } else {
        // Legacy JSON Export
        setProgress({ stage: 'JSON構造を生成中...', percent: 40 });
        await new Promise((r) => setTimeout(r, 10));
        const serialized = serializeMapData(mapData, customAssets, categories);
        const jsonStr = JSON.stringify(serialized, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${cleanFileName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setStatusMessage({
          text: `地図JSONを出力しました。（世界地図・階層地域マップ・バイオーム設定・自作シンボル ${customAssets.length}件をすべて同梱）`,
          type: 'success',
        });
      }
    } catch (err: any) {
      setStatusMessage({ text: `エクスポート失敗: ${err.message || err}`, type: 'error' });
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  // Full Map Import (.fwm or .json auto-detected)
  const handleImportMapFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setProgress({ stage: 'ファイルを読み込み中...', percent: 0 });
    setStatusMessage(null);

    try {
      const result = await loadUnifiedMapFile(file, {
        onProgress: (stage, p) => {
          setProgress({ stage, percent: Math.round(p * 100) });
        },
      });

      onLoadMap(result.mapData, result.customAssets, result.customCategories);

      const assetNote = result.customAssets && result.customAssets.length > 0
        ? `（付属シンボル ${result.customAssets.length}件を復元）`
        : '';
      const formatNote = result.format === 'fwm' ? '新形式 (.fwm)' : 'JSON形式';
      const warningNote = result.warnings && result.warnings.length > 0 ? ` ⚠️ ${result.warnings.join(' ')}` : '';

      setStatusMessage({
        text: `地図「シード ${result.mapData.seed}」(${formatNote}) を正常に復元しました！ ${assetNote}${warningNote}`,
        type: result.warnings && result.warnings.length > 0 ? 'warning' : 'success',
      });

      setTimeout(() => {
        onClose();
      }, 1600);
    } catch (err: any) {
      setStatusMessage({ text: `読み込み失敗: ${err.message || '無効な地図ファイル形式です'}`, type: 'error' });
    } finally {
      setIsProcessing(false);
      setProgress(null);
      e.target.value = '';
    }
  };

  // Standalone Custom Symbols Library Export
  const handleExportSymbolsOnly = () => {
    try {
      if (customAssets.length === 0 && categories.length === 0) {
        setStatusMessage({ text: '保存可能な登録シンボルがありません。', type: 'error' });
        return;
      }
      exportSymbolLibraryToJson(customAssets, categories, symbolsFileName);
      setStatusMessage({
        text: `登録シンボル（${customAssets.length}件）をバックアップJSONとして保存しました！`,
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
          text: `シンボル（${assets.length}件）およびカテゴリ（${importedCats.length}件）を正常に復元・追加しました！`,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-[#181512] border border-[#3d3224] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-stone-200">
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
            <X className="w-4 h-4" />
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
            <span>世界地図データ (.fwm / .json)</span>
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
            <span>シンボル集の保持・管理</span>
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
            <span className="font-mono text-stone-300">
              {mapData.gridCols || mapData.width} × {mapData.gridRows || mapData.height}
            </span>
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
          {/* Progress Indicator */}
          {isProcessing && progress && (
            <div className="p-3.5 bg-amber-950/40 border border-amber-700/60 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-amber-200">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  <span>{progress.stage}</span>
                </span>
                <span className="font-mono font-bold text-amber-300">{progress.percent}%</span>
              </div>
              <div className="w-full bg-[#1e1914] rounded-full h-2 overflow-hidden border border-[#3d3224]">
                <div
                  className="bg-gradient-to-r from-amber-600 to-amber-400 h-full transition-all duration-200"
                  style={{ width: `${Math.max(3, progress.percent)}%` }}
                />
              </div>
            </div>
          )}

          {statusMessage && (
            <div
              className={`p-3 rounded-xl flex items-center gap-2.5 text-xs ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/80 border border-emerald-700 text-emerald-200'
                  : statusMessage.type === 'warning'
                  ? 'bg-amber-950/80 border border-amber-700 text-amber-200'
                  : 'bg-rose-950/80 border border-rose-700 text-rose-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : statusMessage.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span className="leading-tight">{statusMessage.text}</span>
            </div>
          )}

          {activeTab === 'map' ? (
            <div className="space-y-4">
              {/* Export Full Map */}
              <div className="p-4 bg-[#1f1a14] rounded-xl border border-[#33281b] space-y-3.5">
                <div className="font-bold text-[#f5ebd9] flex items-center gap-2">
                  <Download className="w-4 h-4 text-amber-400" />
                  <span>現在の地図をファイルとして保存（エクスポート）</span>
                </div>
                <p className="text-[#a89985] text-xs leading-relaxed">
                  全世界地形（標高・海陸・バイオーム）、階層地域マップ、配置シンボル、および<strong>作成・登録されたシンボル（{customAssets.length}件）</strong>を完全な状態で1つのファイルにまとめて保存します。
                </p>

                {/* Format Selector */}
                <div className="space-y-2 pt-1">
                  <label className="text-[11px] font-semibold text-[#c4b59d] block">
                    保存形式の選択:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label
                      className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${
                        exportFormat === 'fwm'
                          ? 'bg-amber-500/10 border-amber-500/60 text-stone-100'
                          : 'bg-[#14110e] border-[#33281b] text-stone-400 hover:border-[#4d3c28]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="exportFormat"
                        value="fwm"
                        checked={exportFormat === 'fwm'}
                        onChange={() => setExportFormat('fwm')}
                        className="mt-0.5 accent-amber-500 cursor-pointer"
                      />
                      <div className="space-y-0.5">
                        <div className="font-bold text-xs flex items-center gap-1.5 text-[#f5ebd9]">
                          <span>新形式 (.fwm)</span>
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-normal">
                            推奨
                          </span>
                        </div>
                        <p className="text-[11px] text-[#a89985] leading-snug">
                          容量が小さく高速。差分化と圧縮により大マップでも超軽量。
                        </p>
                      </div>
                    </label>

                    <label
                      className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${
                        exportFormat === 'json'
                          ? 'bg-amber-500/10 border-amber-500/60 text-stone-100'
                          : 'bg-[#14110e] border-[#33281b] text-stone-400 hover:border-[#4d3c28]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="exportFormat"
                        value="json"
                        checked={exportFormat === 'json'}
                        onChange={() => setExportFormat('json')}
                        className="mt-0.5 accent-amber-500 cursor-pointer"
                      />
                      <div className="space-y-0.5">
                        <div className="font-bold text-xs text-[#f5ebd9]">
                          JSON形式 (.json)
                        </div>
                        <p className="text-[11px] text-[#a89985] leading-snug">
                          従来の形式。他ツール連携や小さなマップ向けの互換形式。
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* .fwm Options & Estimates */}
                {exportFormat === 'fwm' && (
                  <div className="p-3 bg-[#15120f] border border-[#2d2419] rounded-xl space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={highPrecision}
                        onChange={(e) => setHighPrecision(e.target.checked)}
                        className="mt-0.5 accent-amber-500 cursor-pointer rounded"
                      />
                      <div className="space-y-0.5">
                        <span className="font-semibold text-stone-200 flex items-center gap-1 text-xs">
                          <Cpu className="w-3.5 h-3.5 text-amber-400" />
                          <span>高精度で保存 (標高を32bit浮動小数点のまま保存)</span>
                        </span>
                        <p className="text-[11px] text-stone-400 leading-snug">
                          ファイルサイズが約2倍になりますが、微小な標高の誤差を完全になくします。
                        </p>
                      </div>
                    </label>

                    <div className="pt-1.5 border-t border-[#231c14] flex flex-wrap items-center justify-between text-[11px] text-stone-400">
                      <span>推定ファイルサイズ:</span>
                      <span className="font-mono text-amber-300">
                        {highPrecision
                          ? `約 ${estHighMin}〜${estHighMax} MB (高精度)`
                          : `約 ${estNormalMin}〜${estNormalMax} MB (通常量子化)`}
                      </span>
                    </div>
                  </div>
                )}

                {/* Large Map JSON Warning */}
                {exportFormat === 'json' && isLargeMap && (
                  <div className="p-3 bg-amber-950/50 border border-amber-700/60 rounded-xl flex items-start gap-2.5 text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] leading-relaxed">
                      大きなマップを JSON 形式で保存すると、ブラウザのメモリが不足して失敗する可能性があります。新形式 (.fwm) の使用を推奨します。
                    </p>
                  </div>
                )}

                {/* File Name */}
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
                    <span className="text-xs text-amber-400 font-mono font-bold">.{exportFormat}</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleExportMap}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:opacity-50 text-stone-950 font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer active:scale-[0.99]"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>処理中...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>
                        地図{exportFormat === 'fwm' ? ' (.fwm)' : ' (JSON)'} をダウンロード保存
                      </span>
                    </>
                  )}
                </button>
              </div>

              {/* Import Full Map */}
              <div className="p-4 bg-[#1f1a14] rounded-xl border border-[#33281b] space-y-3">
                <div className="font-bold text-[#f5ebd9] flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>保存済み地図ファイルを開く（インポート）</span>
                </div>
                <p className="text-[#a89985] text-xs leading-relaxed">
                  過去に保存した地図ファイルを開きます。新形式（.fwm）と従来のJSONファイル（.json）の<strong>両方を自動判別して復元</strong>します。大陸の形状や各階層地域マップに加え、ファイルに含まれる自作シンボルも復元されます。
                </p>

                <label
                  className={`w-full py-3 px-4 bg-[#14110e] hover:bg-[#251e16] border border-dashed border-[#4a3a27] hover:border-amber-500/60 text-[#d9ba8f] font-semibold rounded-xl transition flex items-center justify-center gap-2.5 group ${
                    isProcessing ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                  }`}
                >
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  )}
                  <span>地図ファイルを選択して開く (.fwm / .json)</span>
                  <input
                    type="file"
                    accept=".fwm,.json,application/json"
                    onChange={handleImportMapFile}
                    disabled={isProcessing}
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
                    作成・登録したシンボル（{customAssets.length}種類）は、ブラウザ内部ストレージ（IndexedDBおよびLocalStorage）に即時自動保存されています。ブラウザを更新または再起動しても消えません。
                  </p>
                </div>
              </div>

              {/* Export Standalone Symbols Library */}
              <div className="p-4 bg-[#1f1a14] rounded-xl border border-[#33281b] space-y-3">
                <div className="font-bold text-[#f5ebd9] flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-400" />
                  <span>シンボル集のバックアップ書き出し</span>
                </div>
                <p className="text-[#a89985] text-xs leading-relaxed">
                  地図とは独立して、あなたがこれまでに作成したすべてのシンボルとカテゴリ定義を単体のJSONバックアップファイルとしてPCに保存します。他のPCやブラウザへシンボル集を移行する場合にも便利です。
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
                  <span>シンボル集の復元・読み込み</span>
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
