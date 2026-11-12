import React, { useRef, useState } from 'react';
import { X, Upload, Check } from 'lucide-react';
import { CustomMapAsset, CustomSymbolCategory } from '../types/symbols';
import { importIllustrationFile } from '../utils/illustrationImport';

interface IllustrationImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: CustomSymbolCategory[];
  onAddCategory: (category: CustomSymbolCategory) => void;
  onSaveCustomAsset: (asset: CustomMapAsset) => void;
}

const KIND_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'tree', label: '木', hint: '小さめ' },
  { id: 'mountain', label: '山・火山・丘', hint: '大きめ' },
  { id: 'village', label: '村・小さな建物', hint: '小さめ' },
  { id: 'town', label: '街・城', hint: '中くらい' },
  { id: 'tower', label: '塔', hint: '小さめ' },
  { id: 'other', label: 'その他', hint: '中くらい' },
];

const NEW_CATEGORY = '__new__';

export const IllustrationImportModal: React.FC<IllustrationImportModalProps> = ({
  isOpen,
  onClose,
  categories,
  onAddCategory,
  onSaveCustomAsset,
}) => {
  const [kind, setKind] = useState<string>('tree');
  const [categoryId, setCategoryId] = useState<string>(NEW_CATEGORY);
  const [removeBg, setRemoveBg] = useState<boolean>(true);
  const [sizeMul, setSizeMul] = useState<number>(1);
  const [busy, setBusy] = useState<boolean>(false);
  const [results, setResults] = useState<CustomMapAsset[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const resolveCategoryId = (): string => {
    if (categoryId !== NEW_CATEGORY && categories.some((c) => c.id === categoryId)) return categoryId;
    const existing = categories.find((c) => c.id === 'cat_illustration');
    if (existing) return existing.id;
    onAddCategory({
      id: 'cat_illustration',
      name: 'イラスト',
      icon: '🌲',
      color: '#10b981',
      createdAt: Date.now(),
    });
    return 'cat_illustration';
  };

  const handleFiles = async (list: FileList | File[]) => {
    const files = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) {
      setErrors(['画像ファイル(PNG / JPEG / WebP)を選んでください']);
      return;
    }
    setBusy(true);
    setErrors([]);
    const category = resolveCategoryId();
    const added: CustomMapAsset[] = [];
    const errs: string[] = [];
    for (const file of files) {
      try {
        const asset = await importIllustrationFile(file, {
          category,
          sizeKind: kind,
          removeBackground: removeBg,
          sizeMultiplier: sizeMul,
        });
        onSaveCustomAsset(asset);
        added.push(asset);
      } catch (err) {
        errs.push(err instanceof Error ? err.message : String(err));
      }
    }
    setResults((prev: CustomMapAsset[]) => [...added, ...prev]);
    setErrors(errs);
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl text-stone-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-800 bg-stone-950/70 shrink-0">
          <h2 className="text-sm font-bold text-amber-200">🖼 イラストを取り込む</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-100 hover:bg-stone-800 rounded-lg"
            title="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="text-xs font-bold text-stone-400 block mb-1.5">1. 何の絵ですか?(大きさの基準になります)</label>
            <div className="grid grid-cols-3 gap-1.5">
              {KIND_OPTIONS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  className={`py-1.5 rounded-lg text-xs border transition ${
                    kind === k.id
                      ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                      : 'border-stone-700 bg-stone-950/60 text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {k.label}
                  <span className="block text-[10px] opacity-60">{k.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-stone-400 block mb-1.5">2. 保存先カテゴリ</label>
            <select
              value={categoryId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCategoryId(e.target.value)}
              className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-1.5 text-xs text-stone-200"
            >
              <option value={NEW_CATEGORY}>「イラスト」カテゴリ(自動作成)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-stone-400 block mb-1.5">3. 画像を選ぶ(複数OK)</label>
            <div
              onDragOver={(e: React.DragEvent<HTMLDivElement>) => e.preventDefault()}
              onDrop={(e: React.DragEvent<HTMLDivElement>) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed border-stone-600 hover:border-amber-500 rounded-xl p-7 text-center cursor-pointer bg-stone-950/50 hover:bg-stone-900 transition-colors"
            >
              <Upload className="w-7 h-7 text-amber-400 mx-auto mb-2" />
              <p className="text-xs font-semibold text-stone-200">ここにドラッグ&ドロップ、またはクリックして選択</p>
              <p className="text-[11px] text-stone-500 mt-1">PNG / JPEG / WebP(白背景のままでも、透過済みでもOK)</p>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/*"
                multiple
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 text-xs">
            <label className="flex items-center gap-2 text-stone-400 cursor-pointer">
              <input
                type="checkbox"
                checked={removeBg}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemoveBg(e.target.checked)}
                className="accent-amber-500"
              />
              単色の背景を自動で透明にする(透過済みの画像はそのまま)
            </label>
            <div>
              <div className="flex justify-between text-stone-400 mb-1">
                <span>大きさの倍率(あとからスケールでも調整できます)</span>
                <span className="font-mono text-amber-300">×{sizeMul.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={sizeMul}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSizeMul(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
          </div>

          {busy && <p className="text-xs text-amber-300">取り込み中…</p>}
          {errors.length > 0 && (
            <ul className="text-xs text-rose-400 space-y-0.5">
              {errors.map((er: string, i: number) => (
                <li key={i}>{er}</li>
              ))}
            </ul>
          )}

          {results.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {results.length} 件を登録しました。シンボルパレットに並び、バイオーム設定でも使えます
              </p>
              <div className="grid grid-cols-6 gap-1.5">
                {results.map((a: CustomMapAsset) => (
                  <div
                    key={a.id}
                    className="aspect-square rounded-md bg-[#2a3f45] border border-stone-700 flex items-end justify-center p-1"
                    title={`${a.name}(表示幅 ${a.displayWidth ?? 64})`}
                  >
                    <img src={a.dataUrl} alt={a.name} className="max-w-full max-h-full object-contain" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-800 bg-stone-950/70 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-bold text-stone-200"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
