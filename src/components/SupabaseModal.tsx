import React, { useEffect, useState } from 'react';
import {
  X,
  Database,
  Download,
  Upload,
  Cloud,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import { MapData, SupabaseMapRecord } from '../types/map';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  listMapsFromSupabase,
  loadMapFromSupabase,
  saveMapToSupabase,
  SUPABASE_SETUP_SQL,
} from '../lib/supabase';
import { serializeMapData, deserializeMapData } from '../utils/serialization';

interface SupabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapData: MapData;
  onLoadMap: (mapData: MapData) => void;
}

export const SupabaseModal: React.FC<SupabaseModalProps> = ({
  isOpen,
  onClose,
  mapData,
  onLoadMap,
}) => {
  const [activeTab, setActiveTab] = useState<'local' | 'supabase'>('local');
  const [mapName, setMapName] = useState<string>(`ファンタジー大陸_${mapData.seed}`);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [savedMaps, setSavedMaps] = useState<SupabaseMapRecord[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // Custom Supabase credentials input if env vars aren't set yet
  const [customUrl, setCustomUrl] = useState<string>('');
  const [customKey, setCustomKey] = useState<string>('');

  const configured = isSupabaseConfigured() || Boolean(customUrl && customKey);

  const fetchMaps = async () => {
    setIsLoadingList(true);
    setStatusMessage(null);
    const client = getSupabaseClient(customUrl, customKey);
    const res = await listMapsFromSupabase(client);
    setIsLoadingList(false);
    if (res.success && res.data) {
      setSavedMaps(res.data);
    } else if (res.error) {
      setStatusMessage({ text: `一覧取得エラー: ${res.error}`, type: 'error' });
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'supabase' && configured) {
      fetchMaps();
    }
  }, [isOpen, activeTab, configured]);

  if (!isOpen) return null;

  // JSON Export with compact typed array serialization
  const handleExportJSON = () => {
    try {
      const serialized = serializeMapData(mapData);
      const jsonStr = JSON.stringify(serialized);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `world_map_seed_${mapData.seed}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMessage({ text: 'JSONファイルをダウンロードしました。（世界地図＋全地域マップを保持）', type: 'success' });
    } catch (err: any) {
      setStatusMessage({ text: `JSONエクスポート失敗: ${err.message}`, type: 'error' });
    }
  };

  // JSON Import with typed array restoration
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const raw = JSON.parse(event.target?.result as string);
        const parsed = deserializeMapData(raw);
        onLoadMap(parsed);
        setStatusMessage({ text: `地図「シード ${parsed.seed}」を読み込みました！`, type: 'success' });
        setTimeout(() => onClose(), 1200);
      } catch (err: any) {
        setStatusMessage({ text: `読み込みエラー: ${err.message}`, type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Save to Supabase
  const handleSaveToSupabase = async () => {
    setIsSaving(true);
    setStatusMessage(null);
    const client = getSupabaseClient(customUrl, customKey);
    const res = await saveMapToSupabase(mapName, mapData, client);
    setIsSaving(false);
    if (res.success) {
      setStatusMessage({ text: 'Supabaseに保存が完了しました！', type: 'success' });
      fetchMaps();
    } else {
      setStatusMessage({ text: `保存失敗: ${res.error}`, type: 'error' });
    }
  };

  // Load from Supabase
  const handleLoadFromSupabase = async (id: string) => {
    setIsLoadingList(true);
    const client = getSupabaseClient(customUrl, customKey);
    const res = await loadMapFromSupabase(id, client);
    setIsLoadingList(false);
    if (res.success && res.mapData) {
      onLoadMap(res.mapData);
      setStatusMessage({ text: `「${res.name}」を正常に読み込みました！`, type: 'success' });
      setTimeout(() => onClose(), 1000);
    } else {
      setStatusMessage({ text: `読み込み失敗: ${res.error}`, type: 'error' });
    }
  };

  const copySql = () => {
    navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 bg-stone-950/50">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-stone-100">地図データの保存 / 読込</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-200 p-1 rounded-lg hover:bg-stone-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-stone-800 bg-stone-950/30 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('local')}
            className={`flex-1 py-3 font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              activeTab === 'local'
                ? 'border-amber-500 text-amber-400 bg-stone-800/50'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>JSONファイル (即時保存/読込)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('supabase')}
            className={`flex-1 py-3 font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              activeTab === 'supabase'
                ? 'border-emerald-500 text-emerald-400 bg-stone-800/50'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Cloud className="w-4 h-4" />
            <span>Supabase クラウド連携</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
          {statusMessage && (
            <div
              className={`p-3 rounded-lg flex items-center gap-2 text-xs ${
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
              <span>{statusMessage.text}</span>
            </div>
          )}

          {activeTab === 'local' ? (
            <div className="space-y-4">
              <div className="p-4 bg-stone-950/60 rounded-xl border border-stone-800 space-y-3">
                <div className="font-semibold text-stone-200 flex items-center gap-2">
                  <Download className="w-4 h-4 text-amber-400" />
                  <span>現在の地図をJSONとしてダウンロード</span>
                </div>
                <p className="text-stone-400 text-xs">
                  生成・編集した地図（セル標高、海陸判定、気温、湿度、シード値）をすべて含んだJSONファイルを出力します。
                </p>
                <button
                  type="button"
                  onClick={handleExportJSON}
                  className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg"
                >
                  <Download className="w-4 h-4" />
                  <span>JSONファイルをダウンロード保存</span>
                </button>
              </div>

              <div className="p-4 bg-stone-950/60 rounded-xl border border-stone-800 space-y-3">
                <div className="font-semibold text-stone-200 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>保存済みJSONファイルを読み込む</span>
                </div>
                <p className="text-stone-400 text-xs">
                  以前ダウンロードした地図JSONファイルを選択して、完全に復元します。
                </p>
                <label className="w-full py-2.5 px-4 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>JSONファイルを選択して開く</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportJSON}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Supabase Status Banner */}
              <div className="p-3.5 bg-stone-950/70 rounded-xl border border-stone-800 flex items-start gap-3">
                {configured ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 space-y-1">
                  <div className="font-semibold text-stone-200">
                    {configured ? 'Supabase連携: 設定完了' : 'Supabase連携: 環境設定が必要です'}
                  </div>
                  <p className="text-stone-400 text-[11px] leading-relaxed">
                    {configured
                      ? 'Vercel / .env の接続設定を使用して、データベースに地図を保存・読み込みできます。'
                      : 'Vercelの環境変数またはローカル環境で VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください。'}
                  </p>
                </div>
              </div>

              {/* Save Form */}
              <div className="p-4 bg-stone-950/60 rounded-xl border border-stone-800 space-y-3">
                <div className="font-semibold text-stone-200">Supabaseへ保存</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mapName}
                    onChange={(e) => setMapName(e.target.value)}
                    placeholder="地図の名前を入力"
                    className="flex-1 bg-stone-800 border border-stone-700 px-3 py-2 rounded-lg text-xs text-stone-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    disabled={isSaving || !configured}
                    onClick={handleSaveToSupabase}
                    className={`px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition ${
                      configured && !isSaving
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-stone-950'
                        : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                    }`}
                  >
                    {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>保存</span>
                  </button>
                </div>
              </div>

              {/* Saved Maps List */}
              <div className="p-4 bg-stone-950/60 rounded-xl border border-stone-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-stone-200">クラウド保存済みの地図一覧</div>
                  <button
                    type="button"
                    onClick={fetchMaps}
                    disabled={isLoadingList || !configured}
                    className="text-stone-400 hover:text-stone-200 flex items-center gap-1 text-[11px]"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingList ? 'animate-spin' : ''}`} />
                    <span>更新</span>
                  </button>
                </div>

                {savedMaps.length === 0 ? (
                  <div className="text-center py-6 text-stone-500 italic">
                    {isLoadingList ? '読み込み中...' : '保存された地図はまだありません'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {savedMaps.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between p-2.5 bg-stone-800/70 hover:bg-stone-800 rounded-lg border border-stone-700/60 transition"
                      >
                        <div>
                          <div className="font-medium text-stone-200">{m.name}</div>
                          <div className="text-[10px] text-stone-400 font-mono">
                            シード: {m.seed} | セル数: {m.cell_count.toLocaleString()}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => m.id && handleLoadFromSupabase(m.id)}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold rounded text-xs transition"
                        >
                          読み込む
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Supabase SQL Instructions Accordion */}
              <div className="p-3.5 bg-stone-950/80 rounded-xl border border-stone-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-stone-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-amber-400" />
                    <span>Supabase側で必要な準備（初回のみ）</span>
                  </div>
                  <button
                    type="button"
                    onClick={copySql}
                    className="px-2 py-1 bg-stone-800 hover:bg-stone-700 rounded text-stone-300 text-[10px] flex items-center gap-1"
                  >
                    {copiedSql ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSql ? 'コピー完了' : 'SQLをコピー'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-stone-400 leading-relaxed">
                  Supabaseダッシュボードの「SQL Editor」に以下のSQLを貼り付けてRunを押すだけで、mapsテーブルが作成されます。
                </p>
                <pre className="bg-stone-900 p-2.5 rounded-lg border border-stone-800 text-[10px] font-mono text-stone-300 overflow-x-auto max-h-32">
                  {SUPABASE_SETUP_SQL}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-stone-800 bg-stone-950/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg text-xs font-medium transition"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
