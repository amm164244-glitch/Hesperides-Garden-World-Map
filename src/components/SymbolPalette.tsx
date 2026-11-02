import React, { useState } from 'react';
import {
  Sparkles,
  MapPin,
  Paintbrush,
  Eraser,
  Trash2,
  X,
  Plus,
  Edit2,
  FolderPlus,
  Eye,
  EyeOff,
  Sliders,
  Check,
  PackagePlus,
  Layers,
  ChevronDown,
} from 'lucide-react';
import {
  SymbolToolSettings,
  CustomMapAsset,
  CustomSymbolCategory,
} from '../types/symbols';
import { BrushMode } from '../types/map';

interface SymbolPaletteProps {
  brushMode: BrushMode;
  onChangeBrushMode: (mode: BrushMode) => void;
  toolSettings: SymbolToolSettings;
  onUpdateToolSettings: (patch: Partial<SymbolToolSettings>) => void;
  symbolCount: number;
  customAssets: CustomMapAsset[];
  categories: CustomSymbolCategory[];
  onAddCategory: (category: CustomSymbolCategory) => void;
  onUpdateCategory: (category: CustomSymbolCategory) => void;
  onDeleteCategory: (categoryId: string) => void;
  onOpenPixelStudio: (asset?: CustomMapAsset) => void;
  onOpenImageToPixel?: () => void;
  onDeleteCustomAsset: (assetId: string) => void;
  onClearSymbols: () => void;
  showSymbols: boolean;
  onToggleShowSymbols: () => void;
  onClose: () => void;
}

export const SymbolPalette: React.FC<SymbolPaletteProps> = ({
  brushMode,
  onChangeBrushMode,
  toolSettings,
  onUpdateToolSettings,
  symbolCount,
  customAssets = [],
  categories,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onOpenPixelStudio,
  onOpenImageToPixel,
  onDeleteCustomAsset,
  onClearSymbols,
  showSymbols,
  onToggleShowSymbols,
  onClose,
}) => {
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [showCategoryManager, setShowCategoryManager] = useState<boolean>(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  // Form states for creating / editing category
  const [catNameInput, setCatNameInput] = useState<string>('');
  const [catIconInput, setCatIconInput] = useState<string>('🚩');
  const [catColorInput, setCatColorInput] = useState<string>('#f59e0b');

  // Filter symbols by category
  const filteredSymbols = activeCategoryId === 'all'
    ? customAssets
    : customAssets.filter((a) => a.category === activeCategoryId);

  // Category counts
  const categoryCounts = categories.reduce<Record<string, number>>((acc, cat) => {
    acc[cat.id] = customAssets.filter((a) => a.category === cat.id).length;
    return acc;
  }, {});

  // Handle Category Add
  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catNameInput.trim()) return;
    const newCat: CustomSymbolCategory = {
      id: `cat_${Date.now()}`,
      name: catNameInput.trim(),
      icon: catIconInput.trim() || '🚩',
      color: catColorInput,
      createdAt: Date.now(),
    };
    onAddCategory(newCat);
    setCatNameInput('');
    setActiveCategoryId(newCat.id);
  };

  // Start editing category
  const startEditCategory = (cat: CustomSymbolCategory) => {
    setEditingCategoryId(cat.id);
    setCatNameInput(cat.name);
    setCatIconInput(cat.icon);
    setCatColorInput(cat.color);
  };

  // Save edited category
  const saveEditedCategory = () => {
    if (!editingCategoryId || !catNameInput.trim()) return;
    const existing = categories.find((c) => c.id === editingCategoryId);
    if (!existing) return;
    onUpdateCategory({
      ...existing,
      name: catNameInput.trim(),
      icon: catIconInput.trim() || '🚩',
      color: catColorInput,
    });
    setEditingCategoryId(null);
    setCatNameInput('');
  };

  return (
    <div className="w-88 sm:w-96 bg-[#161412]/95 backdrop-blur-md border border-[#4a3f31] rounded-xl shadow-2xl text-[#e8dfcf] flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#3d3326] flex items-center justify-between bg-[#1f1b17]/90">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-amber-500 shadow-sm shadow-amber-500/50" />
          <h3 className="font-serif font-bold text-sm tracking-wide text-[#f5ebd9]">
            ドット絵シンボルパレット
          </h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#2a241c] text-amber-300 font-mono border border-[#44382c]">
            {customAssets.length} 種類
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[#9e907d] hover:text-[#f5ebd9] p-1 rounded-md hover:bg-[#2b241d] transition-colors"
          title="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3.5 space-y-3.5 max-h-[calc(100vh-12rem)] overflow-y-auto">
        {/* Creation Buttons: Manual Studio & Image to Pixel Art Converter */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onOpenPixelStudio()}
            className="py-2.5 px-2 rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-stone-950 font-serif font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-[0.98]"
            title="エディタで1マスずつドット絵を描く"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>＋ 手描き作成</span>
          </button>
          {onOpenImageToPixel && (
            <button
              onClick={onOpenImageToPixel}
              className="py-2.5 px-2 rounded-lg bg-gradient-to-r from-orange-600 via-amber-600 to-amber-700 hover:from-orange-500 hover:to-amber-500 text-stone-950 font-serif font-bold text-xs flex items-center justify-center gap-1.5 shadow-md border border-amber-400/40 transition-all active:scale-[0.98]"
              title="風景や写真画像を高精細ドット絵に自動変換 (カタコンベ等)"
            >
              <Sparkles className="w-3.5 h-3.5 text-stone-950" />
              <span>📷 画像から変換</span>
            </button>
          )}
        </div>

        {/* Tool Mode Selector */}
        <div>
          <label className="text-xs font-medium text-[#baa993] mb-1.5 block">
            スタンプ・描画モード
          </label>
          <div className="grid grid-cols-3 gap-1.5 bg-[#0f0e0c] p-1 rounded-lg border border-[#2d261e]">
            <button
              onClick={() => onChangeBrushMode('stamp')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                brushMode === 'stamp'
                  ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                  : 'text-[#baa993] hover:text-[#f5ebd9] hover:bg-[#1f1b17]'
              }`}
              title="クリックで1個配置、または既存シンボルをクリックして移動・選択"
            >
              <MapPin className="w-3.5 h-3.5" />
              スタンプ
            </button>
            <button
              onClick={() => onChangeBrushMode('symbolBrush')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                brushMode === 'symbolBrush'
                  ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                  : 'text-[#baa993] hover:text-[#f5ebd9] hover:bg-[#1f1b17]'
              }`}
              title="ドラッグで連続ペイント"
            >
              <Paintbrush className="w-3.5 h-3.5" />
              散布ブラシ
            </button>
            <button
              onClick={() => onChangeBrushMode('symbolEraser')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                brushMode === 'symbolEraser'
                  ? 'bg-red-600 text-white font-bold shadow-sm'
                  : 'text-[#baa993] hover:text-[#f5ebd9] hover:bg-[#1f1b17]'
              }`}
              title="地図上のシンボルをクリックして消去"
            >
              <Eraser className="w-3.5 h-3.5" />
              消しゴム
            </button>
          </div>
        </div>

        {/* Custom Category Tabs & Manager */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#c4b59d] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>カテゴリ分類</span>
            </span>
            <button
              onClick={() => setShowCategoryManager(!showCategoryManager)}
              className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <FolderPlus className="w-3 h-3" />
              <span>{showCategoryManager ? '管理を閉じる' : 'カテゴリ自作・管理'}</span>
            </button>
          </div>

          {/* Category Management Drawer */}
          {showCategoryManager && (
            <div className="p-2.5 bg-[#100e0c] rounded-lg border border-[#3d3326] space-y-2.5 text-xs animate-in fade-in">
              <span className="font-bold text-[#e8dfcf] block text-[11px]">
                カテゴリの追加 / 編集
              </span>

              {/* Add New Category Form */}
              <form onSubmit={handleCreateCategory} className="flex gap-1.5">
                <input
                  type="text"
                  value={catIconInput}
                  onChange={(e) => setCatIconInput(e.target.value)}
                  className="w-8 text-center bg-[#1a1713] border border-[#3d3326] rounded text-xs py-1"
                  placeholder="🚩"
                  title="アイコン（絵文字）"
                />
                <input
                  type="text"
                  value={catNameInput}
                  onChange={(e) => setCatNameInput(e.target.value)}
                  placeholder="新カテゴリ名"
                  className="flex-1 bg-[#1a1713] border border-[#3d3326] rounded text-xs px-2 py-1 text-[#f5ebd9]"
                />
                <input
                  type="color"
                  value={catColorInput}
                  onChange={(e) => setCatColorInput(e.target.value)}
                  className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                  title="バッジカラー"
                />
                {editingCategoryId ? (
                  <button
                    type="button"
                    onClick={saveEditedCategory}
                    className="px-2 py-1 rounded bg-amber-500 text-stone-950 font-bold text-xs"
                  >
                    更新
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!catNameInput.trim()}
                    className="px-2.5 py-1 rounded bg-amber-500 text-stone-950 font-bold text-xs disabled:opacity-40"
                  >
                    追加
                  </button>
                )}
              </form>

              {/* Existing Categories List */}
              <div className="space-y-1 max-h-32 overflow-y-auto pt-1 border-t border-[#2d261e]">
                {categories.length === 0 ? (
                  <p className="text-center text-[11px] text-[#9e907d] py-2">
                    登録されているカテゴリはありません。上のフォームから自由に追加できます。
                  </p>
                ) : (
                  categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between p-1 rounded bg-[#1a1713] border border-[#2d261e] text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                        <span>{cat.icon}</span>
                        <span className="text-[#f5ebd9] truncate">{cat.name}</span>
                        <span className="text-stone-500 text-[10px]">({categoryCounts[cat.id] || 0})</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startEditCategory(cat)}
                          className="p-1 text-stone-400 hover:text-amber-300"
                          title="名前・色を変更"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => onDeleteCategory(cat.id)}
                          className="p-1 text-stone-400 hover:text-red-400"
                          title="カテゴリを削除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Category Chips / Filter */}
          <div className="flex flex-wrap gap-1 pb-1">
            <button
              onClick={() => setActiveCategoryId('all')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                activeCategoryId === 'all'
                  ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                  : 'bg-[#241f19] text-[#baa993] hover:text-[#f5ebd9] hover:bg-[#2d271f]'
              }`}
            >
              すべて ({customAssets.length})
            </button>
            {categories.map((cat) => {
              const count = categoryCounts[cat.id] || 0;
              const isSelected = activeCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategoryId(cat.id)}
                  className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all ${
                    isSelected
                      ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                      : 'bg-[#241f19] text-[#baa993] hover:text-[#f5ebd9] hover:bg-[#2d271f]'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span>{cat.icon}</span>
                  <span>{cat.name}</span>
                  <span className={`text-[10px] ${isSelected ? 'text-stone-900 font-bold' : 'text-stone-500'}`}>
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scale & Brush Controls */}
        <div className="bg-[#191612] p-2.5 rounded-lg border border-[#2d261e] space-y-2.5">
          {/* Symbol Size / Scale */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#baa993] font-medium">シンボルの大きさ (スケール)</span>
              <div className="flex items-center gap-1 font-mono">
                <button
                  type="button"
                  onClick={() => onUpdateToolSettings({ scale: Math.max(0.05, Number((toolSettings.scale - 0.05).toFixed(2))) })}
                  className="px-1.5 py-0.5 rounded bg-[#241f19] hover:bg-[#322920] text-amber-300 text-[10px] border border-[#3d3326] transition-colors"
                  title="5%小さくする"
                >
                  -5%
                </button>
                <span className="text-amber-400 font-bold min-w-[42px] text-center">
                  {Math.round(toolSettings.scale * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateToolSettings({ scale: Math.min(2.5, Number((toolSettings.scale + 0.05).toFixed(2))) })}
                  className="px-1.5 py-0.5 rounded bg-[#241f19] hover:bg-[#322920] text-amber-300 text-[10px] border border-[#3d3326] transition-colors"
                  title="5%大きくする"
                >
                  +5%
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0.05"
              max="2.5"
              step="0.01"
              value={toolSettings.scale}
              onChange={(e) => onUpdateToolSettings({ scale: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 h-1.5 bg-[#2d261e] rounded-lg cursor-pointer"
            />
            {/* Quick Scale Presets (Micro to Large) */}
            <div className="flex items-center justify-between gap-1 pt-0.5">
              {[
                { label: '極小 10%', val: 0.10 },
                { label: '微小 20%', val: 0.20 },
                { label: '小 40%', val: 0.40 },
                { label: '中 70%', val: 0.70 },
                { label: '標準 100%', val: 1.00 },
                { label: '大 150%', val: 1.50 },
              ].map((p) => {
                const isSelected = Math.abs(toolSettings.scale - p.val) < 0.04;
                return (
                  <button
                    key={p.val}
                    type="button"
                    onClick={() => onUpdateToolSettings({ scale: p.val })}
                    className={`flex-1 py-0.5 px-1 rounded text-[10px] font-mono transition-all text-center ${
                      isSelected
                        ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                        : 'bg-[#241f19] text-[#9e907d] hover:text-[#f5ebd9] hover:bg-[#2e271f]'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {brushMode === 'symbolBrush' && (
            <div className="pt-2 border-t border-[#2d261e] space-y-2.5">
              {/* Scatter Density */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#baa993]">散布密度 (1〜10)</span>
                  <span className="font-mono text-amber-400 font-bold">{toolSettings.density}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={toolSettings.density}
                  onChange={(e) => onUpdateToolSettings({ density: parseInt(e.target.value, 10) })}
                  className="w-full accent-amber-500 h-1.5 bg-[#2d261e] rounded-lg cursor-pointer"
                />
                <div className="flex items-center gap-1">
                  {[
                    { label: 'まばら (1)', val: 1 },
                    { label: '標準 (3)', val: 3 },
                    { label: '密 (6)', val: 6 },
                    { label: '超密集 (10)', val: 10 },
                  ].map((d) => (
                    <button
                      key={d.val}
                      type="button"
                      onClick={() => onUpdateToolSettings({ density: d.val })}
                      className={`flex-1 py-0.5 rounded text-[10px] transition-all text-center ${
                        toolSettings.density === d.val
                          ? 'bg-amber-500 text-stone-950 font-bold'
                          : 'bg-[#241f19] text-[#9e907d] hover:text-[#f5ebd9]'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scatter Radius */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#baa993]">散布半径</span>
                  <span className="font-mono text-amber-400 font-bold">{toolSettings.scatterRadius}px</span>
                </div>
                <input
                  type="range"
                  min="15"
                  max="200"
                  step="5"
                  value={toolSettings.scatterRadius}
                  onChange={(e) => onUpdateToolSettings({ scatterRadius: parseInt(e.target.value, 10) })}
                  className="w-full accent-amber-500 h-1.5 bg-[#2d261e] rounded-lg cursor-pointer"
                />
                <div className="flex items-center gap-1">
                  {[
                    { label: '小 (30px)', val: 30 },
                    { label: '中 (60px)', val: 60 },
                    { label: '大 (100px)', val: 100 },
                    { label: '広域 (160px)', val: 160 },
                  ].map((r) => (
                    <button
                      key={r.val}
                      type="button"
                      onClick={() => onUpdateToolSettings({ scatterRadius: r.val })}
                      className={`flex-1 py-0.5 rounded text-[10px] transition-all text-center ${
                        toolSettings.scatterRadius === r.val
                          ? 'bg-amber-500 text-stone-950 font-bold'
                          : 'bg-[#241f19] text-[#9e907d] hover:text-[#f5ebd9]'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Terrain Type Constraint Note */}
              <div className="text-[11px] text-amber-200/90 bg-[#120f0d] p-2 rounded-lg border border-amber-900/40 flex items-start gap-1.5 leading-relaxed">
                <span className="text-amber-400 shrink-0">🧭</span>
                <span>散布ブラシは、<strong>カーソルのある地形タイプ（同一バイオーム・海域）</strong>にのみ配置されます。異なる地形タイプにははみ出して配置されません。</span>
              </div>
            </div>
          )}
        </div>

        {/* Custom Pixel Symbols Grid */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#c4b59d]">
              登録ドット絵シンボル ({filteredSymbols.length})
            </span>
          </div>

          {filteredSymbols.length === 0 ? (
            <div className="py-6 px-4 bg-[#100e0c] rounded-xl border border-dashed border-[#3d3326] text-center space-y-3">
              <p className="text-xs text-[#9e907d]">
                {activeCategoryId === 'all'
                  ? '現在登録されているシンボルはありません'
                  : 'このカテゴリにはまだシンボルがありません'}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <button
                  onClick={() => onOpenPixelStudio()}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 text-stone-950 font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-amber-400 shadow-md cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>手描きで作成</span>
                </button>
                {onOpenImageToPixel && (
                  <button
                    onClick={onOpenImageToPixel}
                    className="px-3 py-1.5 rounded-lg bg-[#241f19] text-[#c4b59d] hover:text-[#f5ebd9] border border-[#3d3326] text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>📷 画像から変換</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto p-1">
              {filteredSymbols.map((asset) => {
                const isSelected =
                  toolSettings.selectedType === 'custom' &&
                  toolSettings.selectedCustomAssetId === asset.id;
                const cat = categories.find((c) => c.id === asset.category);

                return (
                  <div
                    key={asset.id}
                    className={`relative group rounded-xl p-2.5 flex flex-col items-center justify-between transition-all border cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-400 ring-1 ring-amber-400 shadow-md'
                        : 'bg-[#191612] border-[#2e271f] hover:border-[#4a3f31] hover:bg-[#221d18]'
                    }`}
                    onClick={() => {
                      onUpdateToolSettings({
                        selectedType: 'custom',
                        selectedCustomAssetId: asset.id,
                        category: asset.category,
                      });
                      if (brushMode === 'symbolEraser') {
                        onChangeBrushMode('stamp');
                      }
                    }}
                  >
                    {/* Action buttons on card */}
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded px-1 py-0.5 backdrop-blur-sm z-10">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenPixelStudio(asset);
                        }}
                        className="p-1 text-stone-300 hover:text-amber-300 transition-colors"
                        title="ドット絵エディタで再編集"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`シンボル「${asset.name}」を削除しますか？`)) {
                            onDeleteCustomAsset(asset.id);
                          }
                        }}
                        className="p-1 text-stone-300 hover:text-red-400 transition-colors"
                        title="シンボルを削除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Pixel Art Preview Image */}
                    <div className="w-14 h-14 flex items-center justify-center p-1 rounded-lg bg-[#0e0c0a] border border-[#2d261e] mb-1.5">
                      <img
                        src={asset.dataUrl}
                        alt={asset.name}
                        className="max-w-full max-h-full object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </div>

                    {/* Name & Category badge */}
                    <span className="text-xs font-medium text-[#f5ebd9] truncate w-full text-center">
                      {asset.name}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.2 rounded-full mt-1 flex items-center gap-1 font-mono"
                      style={{
                        backgroundColor: cat ? `${cat.color}20` : '#ffffff15',
                        color: cat?.color || '#baa993',
                      }}
                    >
                      <span>{cat?.icon || '🏷️'}</span>
                      <span className="truncate max-w-[80px]">{cat?.name || 'カスタム'}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Map Placed Symbols Controls */}
        <div className="pt-3 border-t border-[#3d3326] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#baa993] flex items-center gap-1.5">
              <span>地図上に配置中:</span>
              <span className="font-mono text-amber-400 font-bold">{symbolCount} 個</span>
            </span>
            <button
              onClick={onToggleShowSymbols}
              className={`p-1 rounded flex items-center gap-1 text-xs transition-colors ${
                showSymbols ? 'text-amber-400' : 'text-stone-500'
              }`}
              title="配置済みシンボルの表示/非表示切り替え"
            >
              {showSymbols ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>{showSymbols ? '表示中' : '非表示'}</span>
            </button>
          </div>

          {/* Wipe All Placed Symbols Button */}
          <button
            onClick={() => {
              if (symbolCount === 0) return;
              if (confirm('地図上に配置されたすべてのシンボルを消去しますか？（元に戻すことも可能です）')) {
                onClearSymbols();
              }
            }}
            disabled={symbolCount === 0}
            className="w-full py-2 px-3 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-800/40 text-red-300 disabled:opacity-40 disabled:pointer-events-none text-xs font-medium flex items-center justify-center gap-2 transition-colors"
            title="地図上のすべての配置シンボルを消去"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>キャンバス上の全シンボルを消去</span>
          </button>
        </div>
      </div>
    </div>
  );
};
