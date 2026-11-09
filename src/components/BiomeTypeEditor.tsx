import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  AlertTriangle,
  Sparkles,
  Palette,
  Layers,
  Image as ImageIcon,
  Check,
} from 'lucide-react';
import { BiomeType, BiomeSymbolRule, DEFAULT_BIOME_TYPES } from '../types/biome';
import { MapData } from '../types/map';
import { CustomMapAsset } from '../types/symbols';
import {
  addBiomeType,
  countBiomeUsage,
  moveBiomeType,
  resetToDefaultBiomeTypes,
  checkColorProximity,
  resolveSymbolRule,
} from '../utils/biomeTypes';

interface BiomeTypeEditorProps {
  isOpen: boolean;
  onClose: () => void;
  biomeTypes: BiomeType[];
  onSave: (updatedBiomeTypes: BiomeType[], removedSlots: number[]) => void;
  mapData: MapData;
  customAssets?: CustomMapAsset[];
  seaLevel?: number;
}

const BiomeTypeEditorComponent: React.FC<BiomeTypeEditorProps> = ({
  isOpen,
  onClose,
  biomeTypes,
  onSave,
  mapData,
  customAssets = [],
  seaLevel,
}) => {
  const [draftTypes, setDraftTypes] = useState<BiomeType[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [initialSlots, setInitialSlots] = useState<Set<number>>(new Set());

  // Confirm dialogs
  const [deleteConfirmSlot, setDeleteConfirmSlot] = useState<number | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState<boolean>(false);
  const [isSymbolPickerOpen, setIsSymbolPickerOpen] = useState<boolean>(false);

  // Initialize draft when modal opens
  useEffect(() => {
    if (isOpen) {
      const initial = biomeTypes && biomeTypes.length > 0 ? biomeTypes : DEFAULT_BIOME_TYPES;
      const cloned: BiomeType[] = JSON.parse(JSON.stringify(initial)).map((b: BiomeType) => ({
        ...b,
        // Purge all built-in symbol presets; retain only custom pixel art symbols
        symbols: (b.symbols || []).filter((s) => s && s.kind === 'custom'),
      }));
      setDraftTypes(cloned);
      setInitialSlots(new Set(cloned.map((b) => b.slot)));
      setSelectedSlot(cloned[0]?.slot ?? null);
      setDeleteConfirmSlot(null);
      setIsResetConfirmOpen(false);
      setIsSymbolPickerOpen(false);
    }
  }, [isOpen, biomeTypes]);

  // Usage cell count per slot across world and all regional maps
  const usageCounts = useMemo(() => {
    return countBiomeUsage(mapData);
  }, [mapData]);

  if (!isOpen) return null;

  const currentBiome = draftTypes.find((b) => b.slot === selectedSlot) || draftTypes[0];

  // Proximity warning for currentBiome
  const proximityWarning = currentBiome
    ? checkColorProximity(
        currentBiome.color,
        draftTypes.filter((b) => b.slot !== currentBiome.slot)
      )
    : null;

  // Validation for current name
  const nameTrimmed = currentBiome ? currentBiome.name.trim() : '';
  const isNameEmpty = nameTrimmed.length === 0;
  const isNameTooLong = nameTrimmed.length > 20;
  const isNameDuplicate = currentBiome
    ? draftTypes.some((b) => b.slot !== currentBiome.slot && b.name.trim() === nameTrimmed)
    : false;
  const hasNameError = isNameEmpty || isNameTooLong || isNameDuplicate;

  const effectiveSeaLevel = Math.round(seaLevel ?? mapData?.seaLevel ?? 35);

  const hasElevationError = draftTypes.some((b) =>
    (b.symbols || []).some(
      (s) =>
        s.elevationMin !== undefined &&
        s.elevationMax !== undefined &&
        s.elevationMin > s.elevationMax
    )
  );

  // Overall validity before saving
  const canSave =
    !hasElevationError &&
    draftTypes.length > 0 &&
    draftTypes.every((b) => {
      const t = b.name.trim();
      if (t.length === 0 || t.length > 20) return false;
      const dup = draftTypes.filter((o) => o.name.trim() === t);
      return dup.length === 1;
    });

  // Handlers
  const handleAddType = () => {
    try {
      const defaultName = `新規バイオーム ${draftTypes.length + 1}`;
      const defaultColor = '#509650';
      const updated = addBiomeType(draftTypes, defaultName, defaultColor);
      setDraftTypes(updated);
      const newlyAdded = updated[updated.length - 1];
      if (newlyAdded) setSelectedSlot(newlyAdded.slot);
    } catch (err: any) {
      alert(err.message || '追加できませんでした');
    }
  };

  const handleDuplicate = (slotToDup: number) => {
    const target = draftTypes.find((b) => b.slot === slotToDup);
    if (!target) return;
    try {
      const copyName = `${target.name}のコピー`.slice(0, 20);
      const updated = addBiomeType(draftTypes, copyName, target.color, {
        symbols: JSON.parse(JSON.stringify(target.symbols || [])),
        density: target.density,
        minDistance: target.minDistance,
        flipRandom: target.flipRandom,
      });
      setDraftTypes(updated);
      const newlyAdded = updated[updated.length - 1];
      if (newlyAdded) setSelectedSlot(newlyAdded.slot);
    } catch (err: any) {
      alert(err.message || '複製できませんでした');
    }
  };

  const handleDeleteSlot = (slotToDelete: number) => {
    const nextDraft = draftTypes.filter((b) => b.slot !== slotToDelete);
    setDraftTypes(nextDraft);
    setDeleteConfirmSlot(null);
    if (selectedSlot === slotToDelete) {
      setSelectedSlot(nextDraft[0]?.slot ?? null);
    }
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const toIndex = direction === 'up' ? index - 1 : index + 1;
    const moved = moveBiomeType(draftTypes, index, toIndex);
    setDraftTypes(moved);
  };

  const handleResetToDefaults = () => {
    const defaults = resetToDefaultBiomeTypes();
    setDraftTypes(defaults);
    setSelectedSlot(defaults[0]?.slot ?? null);
    setIsResetConfirmOpen(false);
  };

  const handleSave = () => {
    if (!canSave) return;
    const currentSlots = new Set(draftTypes.map((b) => b.slot));
    const removedSlots = [...initialSlots].filter((s) => !currentSlots.has(s));
    onSave(draftTypes, removedSlots);
    onClose();
  };

  const updateCurrent = (patch: Partial<BiomeType>) => {
    if (!currentBiome) return;
    setDraftTypes((prev) =>
      prev.map((b) => (b.slot === currentBiome.slot ? { ...b, ...patch } : b))
    );
  };

  const handleAddSymbolRule = (rule: BiomeSymbolRule) => {
    if (!currentBiome) return;
    const existing = currentBiome.symbols || [];
    updateCurrent({ symbols: [...existing, rule] });
    setIsSymbolPickerOpen(false);
  };

  const handleUpdateSymbolRule = (index: number, patch: Partial<BiomeSymbolRule>) => {
    if (!currentBiome) return;
    const existing = [...(currentBiome.symbols || [])];
    existing[index] = { ...existing[index], ...patch };
    updateCurrent({ symbols: existing });
  };

  const handleDeleteSymbolRule = (index: number) => {
    if (!currentBiome) return;
    const existing = [...(currentBiome.symbols || [])];
    existing.splice(index, 1);
    updateCurrent({ symbols: existing });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="flex flex-col w-full max-w-4xl h-[90vh] max-h-[800px] bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl overflow-hidden text-stone-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800 bg-stone-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <Palette className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-amber-200">地形タイプ（バイオーム）管理・編集</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-stone-800 text-stone-400 font-mono">
              {draftTypes.length} / 32
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-100 hover:bg-stone-800 rounded-lg transition"
            title="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2-Column Body */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Left Column: Biome List */}
          <div className="w-80 shrink-0 border-r border-stone-800 bg-stone-950/40 flex flex-col min-h-0">
            {/* Add Button Bar */}
            <div className="p-3 border-b border-stone-800 shrink-0 flex items-center justify-between">
              <button
                type="button"
                onClick={handleAddType}
                disabled={draftTypes.length >= 32}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-800 disabled:text-stone-600 text-stone-950 font-bold rounded-lg text-xs transition shadow"
              >
                <Plus className="w-4 h-4" />
                <span>新規地形タイプ</span>
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
              {draftTypes.map((biome, idx) => {
                const isSelected = biome.slot === selectedSlot;
                const cellCount = usageCounts[biome.slot] || 0;
                return (
                  <div
                    key={biome.slot}
                    className={`flex items-center gap-2 p-2 rounded-xl border text-xs transition-all ${
                      isSelected
                        ? 'bg-stone-800/90 border-emerald-500/80 shadow-md ring-1 ring-emerald-500/30'
                        : 'bg-stone-900/60 border-stone-800/90 hover:bg-stone-800/50 hover:border-stone-700'
                    }`}
                  >
                    {/* Reorder Buttons */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleMove(idx, 'up')}
                        disabled={idx === 0}
                        className="text-stone-500 hover:text-stone-200 disabled:opacity-20 p-0.5"
                        title="上へ"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(idx, 'down')}
                        disabled={idx === draftTypes.length - 1}
                        className="text-stone-500 hover:text-stone-200 disabled:opacity-20 p-0.5"
                        title="下へ"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Color Swatch & Selection Click Target */}
                    <button
                      type="button"
                      onClick={() => setSelectedSlot(biome.slot)}
                      className="flex-1 flex items-center gap-2.5 min-w-0 text-left py-0.5 cursor-pointer"
                    >
                      <span
                        className="w-4 h-4 rounded-full shrink-0 border border-black/40 shadow-inner"
                        style={{ backgroundColor: biome.color }}
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium text-stone-200 truncate">
                          {biome.name || '無名'}
                        </span>
                        <span className="text-[10px] text-stone-500 font-mono">
                          {cellCount.toLocaleString()} px
                          {biome.symbols?.length ? ` · ${biome.symbols.length}シンボル` : ''}
                        </span>
                      </div>
                    </button>

                    {/* Duplicate */}
                    <button
                      type="button"
                      onClick={() => handleDuplicate(biome.slot)}
                      disabled={draftTypes.length >= 32}
                      className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 rounded transition"
                      title="複製"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmSlot(biome.slot)}
                      className="p-1 text-stone-500 hover:text-rose-400 rounded transition"
                      title="削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Reset to defaults button */}
            <div className="p-3 border-t border-stone-800 shrink-0">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-800 rounded-lg text-xs transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>初期の7種類に戻す</span>
              </button>
            </div>
          </div>

          {/* Right Column: Selected Biome Editor */}
          <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-5 min-h-0">
            {currentBiome ? (
              <>
                {/* Basic info: Name & Color */}
                <div className="space-y-4 bg-stone-950/50 p-4 rounded-xl border border-stone-800/80">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-amber-200 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-emerald-400" />
                      <span>基本設定 (スロット: {currentBiome.slot})</span>
                    </h3>
                  </div>

                  {/* Name Input */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-stone-400 block">
                      地形タイプ名 (1〜20文字)
                    </label>
                    <input
                      type="text"
                      value={currentBiome.name}
                      maxLength={20}
                      onChange={(e) => updateCurrent({ name: e.target.value })}
                      placeholder="例: 針葉樹林、湿地帯、水晶平原"
                      className={`w-full bg-stone-900 border rounded-lg px-3 py-1.5 text-xs text-stone-100 focus:outline-none transition ${
                        hasNameError
                          ? 'border-rose-500 focus:border-rose-400'
                          : 'border-stone-700 focus:border-emerald-500'
                      }`}
                    />
                    {isNameEmpty && (
                      <p className="text-[11px] text-rose-400">※ 名前を入力してください。</p>
                    )}
                    {isNameDuplicate && (
                      <p className="text-[11px] text-rose-400">※ 他の地形タイプと名前が重複しています。</p>
                    )}
                  </div>

                  {/* Color Selector */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-stone-400 block">
                      オーバーレイ表示色
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 bg-stone-900 px-3 py-1.5 rounded-lg border border-stone-700">
                        <input
                          type="color"
                          value={currentBiome.color}
                          onChange={(e) => updateCurrent({ color: e.target.value })}
                          className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                        />
                        <input
                          type="text"
                          value={currentBiome.color}
                          maxLength={7}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                              updateCurrent({ color: val });
                            }
                          }}
                          className="w-20 font-mono text-xs bg-transparent text-stone-200 focus:outline-none"
                        />
                      </div>
                      <span className="text-xs text-stone-400">
                        地図上に半透明で重ねて描画される色です
                      </span>
                    </div>

                    {proximityWarning && (
                      <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-amber-950/60 border border-amber-600/50 rounded-lg text-amber-200 text-xs">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>
                          他の地形タイプ「{proximityWarning.otherName}」と色が似ています（区別しづらい場合があります）。
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Target Symbols Definition List */}
                <div className="space-y-3 bg-stone-950/50 p-4 rounded-xl border border-stone-800/80">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-amber-200 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span>対象シンボル定義</span>
                      </h3>
                      <p className="text-[11px] text-stone-400 mt-0.5">
                        この地形タイプに関連付けるシンボル（種類・重み・大きさ範囲）を指定します。
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsSymbolPickerOpen(true)}
                      className="flex items-center gap-1.5 py-1 px-2.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-xs transition shadow"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>シンボルを追加</span>
                    </button>
                  </div>

                  {/* Rules list */}
                  {(!currentBiome.symbols || currentBiome.symbols.length === 0) ? (
                    <div className="py-6 text-center text-stone-500 text-xs border border-dashed border-stone-800 rounded-lg bg-stone-900/30">
                      まだシンボルが設定されていません。「シンボルを追加」から木や山、自作ドット絵を登録できます。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {currentBiome.symbols.map((rule, idx) => {
                        const resolved = resolveSymbolRule(rule, customAssets);
                        return (
                          <div
                            key={idx}
                            className="p-3 bg-stone-900/80 border border-stone-800 rounded-xl space-y-2.5 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {/* Preview Thumbnail */}
                                {resolved.isMissing ? (
                                  <div className="w-8 h-8 rounded bg-rose-950/60 border border-rose-700/60 flex items-center justify-center text-rose-400">
                                    <AlertTriangle className="w-4 h-4" />
                                  </div>
                                ) : resolved.customAsset?.dataUrl ? (
                                  <img
                                    src={resolved.customAsset.dataUrl}
                                    alt={resolved.displayName}
                                    className="w-8 h-8 rounded bg-stone-950 object-contain border border-stone-700 p-0.5"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded bg-stone-950 border border-stone-700 flex items-center justify-center text-amber-300">
                                    <Sparkles className="w-4 h-4" />
                                  </div>
                                )}

                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-stone-200">
                                      {resolved.displayName}
                                    </span>
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-stone-800 text-stone-400">
                                      {rule.kind === 'custom' ? '自作' : '組み込み'}
                                    </span>
                                  </div>
                                  {resolved.isMissing && (
                                    <span className="text-[10px] text-rose-400">
                                      ⚠️ 自作シンボル画像が見つかりません
                                    </span>
                                  )}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleDeleteSymbolRule(idx)}
                                className="p-1 text-stone-500 hover:text-rose-400 rounded transition"
                                title="ルールを削除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Sliders: Weight & Scale Range */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-stone-800/80">
                              {/* Weight */}
                              <div className="space-y-1">
                                <div className="flex justify-between text-[11px] text-stone-400">
                                  <span>重み (選ばれやすさ):</span>
                                  <span className="font-mono text-amber-300">{rule.weight}</span>
                                </div>
                                <input
                                  type="range"
                                  min={1}
                                  max={10}
                                  step={1}
                                  value={rule.weight}
                                  onChange={(e) =>
                                    handleUpdateSymbolRule(idx, { weight: Number(e.target.value) })
                                  }
                                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
                                />
                                <div className="flex justify-between text-[9px] text-stone-500">
                                  <span>1 (低)</span>
                                  <span>10 (高頻度)</span>
                                </div>
                              </div>

                              {/* Scale Min & Max */}
                              <div className="space-y-1">
                                <div className="flex justify-between text-[11px] text-stone-400">
                                  <span>大きさ範囲 (スケール):</span>
                                  <span className="font-mono text-emerald-300">
                                    {rule.scaleMin.toFixed(1)}x 〜 {rule.scaleMax.toFixed(1)}x
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min={0.3}
                                    max={3.0}
                                    step={0.1}
                                    value={rule.scaleMin}
                                    onChange={(e) => {
                                      const minVal = Number(e.target.value);
                                      handleUpdateSymbolRule(idx, {
                                        scaleMin: minVal,
                                        scaleMax: Math.max(minVal, rule.scaleMax),
                                      });
                                    }}
                                    className="w-1/2 accent-emerald-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
                                    title="最小スケール"
                                  />
                                  <input
                                    type="range"
                                    min={rule.scaleMin}
                                    max={3.0}
                                    step={0.1}
                                    value={rule.scaleMax}
                                    onChange={(e) =>
                                      handleUpdateSymbolRule(idx, {
                                        scaleMax: Number(e.target.value),
                                      })
                                    }
                                    className="w-1/2 accent-emerald-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
                                    title="最大スケール"
                                  />
                                </div>
                                <div className="flex justify-between text-[9px] text-stone-500">
                                  <span>小 ({rule.scaleMin.toFixed(1)})</span>
                                  <span>大 ({rule.scaleMax.toFixed(1)})</span>
                                </div>
                              </div>
                            </div>

                            {/* Elevation Range (Optional) & Sea Level Indicator */}
                            <div className="pt-2 border-t border-stone-800/80 space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-stone-400">
                                <span className="flex items-center gap-1.5">
                                  <span>標高の範囲 (0〜100、任意):</span>
                                  <span className="text-[10px] text-cyan-400/80 font-mono">
                                    海面: {effectiveSeaLevel}
                                  </span>
                                </span>
                                {rule.elevationMin !== undefined &&
                                rule.elevationMax !== undefined &&
                                rule.elevationMin > rule.elevationMax ? (
                                  <span className="text-rose-400 font-bold text-[10px]">
                                    最小標高が最大標高を超えています
                                  </span>
                                ) : (
                                  <span className="text-stone-500 text-[10px]">
                                    {rule.elevationMin === undefined && rule.elevationMax === undefined
                                      ? '全標高に配置'
                                      : `${rule.elevationMin ?? 0} 〜 ${rule.elevationMax ?? 100}`}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 flex items-center gap-1">
                                  <span className="text-[10px] text-stone-500">最小:</span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    placeholder="制限なし"
                                    value={rule.elevationMin ?? ''}
                                    onChange={(e) => {
                                      const val = e.target.value.trim();
                                      handleUpdateSymbolRule(idx, {
                                        elevationMin: val === '' ? undefined : Math.max(0, Math.min(100, Number(val))),
                                      });
                                    }}
                                    className={`w-full bg-stone-900 border ${
                                      rule.elevationMin !== undefined &&
                                      rule.elevationMax !== undefined &&
                                      rule.elevationMin > rule.elevationMax
                                        ? 'border-rose-500 text-rose-300'
                                        : 'border-stone-700 text-stone-200'
                                    } rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-500`}
                                  />
                                </div>
                                <span className="text-stone-500 text-xs">〜</span>
                                <div className="flex-1 flex items-center gap-1">
                                  <span className="text-[10px] text-stone-500">最大:</span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    placeholder="制限なし"
                                    value={rule.elevationMax ?? ''}
                                    onChange={(e) => {
                                      const val = e.target.value.trim();
                                      handleUpdateSymbolRule(idx, {
                                        elevationMax: val === '' ? undefined : Math.max(0, Math.min(100, Number(val))),
                                      });
                                    }}
                                    className={`w-full bg-stone-900 border ${
                                      rule.elevationMin !== undefined &&
                                      rule.elevationMax !== undefined &&
                                      rule.elevationMin > rule.elevationMax
                                        ? 'border-rose-500 text-rose-300'
                                        : 'border-stone-700 text-stone-200'
                                    } rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-500`}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Placement Parameters: Density, MinDistance, Flip */}
                <div className="space-y-4 bg-stone-950/50 p-4 rounded-xl border border-stone-800/80">
                  <h3 className="text-sm font-bold text-amber-200">
                    シンボル配置パラメータ
                  </h3>

                  {/* Density */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-stone-400">
                      <span>配置密度 (Density):</span>
                      <span className="font-mono text-amber-300">{currentBiome.density}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={currentBiome.density}
                      onChange={(e) => updateCurrent({ density: Number(e.target.value) })}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
                    />
                    <div className="flex justify-between text-[10px] text-stone-500">
                      <span>0% (なし)</span>
                      <span>塗った範囲のうち、どのくらいの割合にシンボルを置くか</span>
                      <span>100% (高密度)</span>
                    </div>
                  </div>

                  {/* Min Distance */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-stone-400">
                      <span>最小間隔 (Min Distance):</span>
                      <span className="font-mono text-emerald-300">{currentBiome.minDistance} px</span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={60}
                      step={2}
                      value={currentBiome.minDistance}
                      onChange={(e) => updateCurrent({ minDistance: Number(e.target.value) })}
                      className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
                    />
                    <div className="flex justify-between text-[10px] text-stone-500">
                      <span>2 px (密集)</span>
                      <span>シンボル同士が重ならない最小距離</span>
                      <span>60 px (まばら)</span>
                    </div>
                  </div>

                  {/* Random Flip */}
                  <div className="pt-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-stone-300">
                      <input
                        type="checkbox"
                        checked={currentBiome.flipRandom}
                        onChange={(e) => updateCurrent({ flipRandom: e.target.checked })}
                        className="rounded border-stone-700 text-amber-500 focus:ring-0 w-4 h-4"
                      />
                      <span className="font-medium">左右ランダム反転 (Flip Random)</span>
                      <span className="text-[10px] text-stone-500">
                        自然な見た目にするため、配置時に左右を50%の確率で反転します
                      </span>
                    </label>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-stone-500 text-sm">
                左の一覧から地形タイプを選択してください
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-stone-800 bg-stone-950/70 shrink-0">
          <div className="text-xs text-stone-400">
            {hasNameError ? (
              <span className="text-rose-400">※ 名前を修正してから保存してください</span>
            ) : (
              <span>「変更を保存」を押すまで編集内容は地図に反映されません</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="py-1.5 px-4 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-xs transition"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="py-1.5 px-5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-800 disabled:text-stone-600 text-stone-950 font-bold rounded-lg text-xs transition shadow flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>変更を保存</span>
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmSlot !== null && (() => {
        const slotToDelete = deleteConfirmSlot;
        const target = draftTypes.find((b) => b.slot === slotToDelete);
        const cellCount = usageCounts[slotToDelete] || 0;
        return (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="bg-stone-900 border border-stone-700 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl text-stone-200">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h4 className="font-bold text-sm">地形タイプの削除確認</h4>
              </div>

              <div className="text-xs text-stone-300 space-y-2 leading-relaxed">
                <p>
                  「<strong className="text-amber-200">{target?.name}</strong>」を削除しますか？
                </p>
                {cellCount > 0 ? (
                  <p className="p-2.5 bg-rose-950/60 border border-rose-800/80 rounded-lg text-rose-200">
                    ⚠️ この地形タイプで塗られた <strong>{cellCount.toLocaleString()} セル</strong> は、指定なし（海／未設定）に戻ります。
                  </p>
                ) : (
                  <p className="text-stone-400">
                    この地形タイプは現在どのマップにも塗られていません。
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmSlot(null)}
                  className="py-1.5 px-3 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-xs"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSlot(slotToDelete)}
                  className="py-1.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs shadow"
                >
                  削除する
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Reset Confirmation Modal */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-stone-900 border border-stone-700 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl text-stone-200">
            <div className="flex items-center gap-2 text-amber-400">
              <RotateCcw className="w-5 h-5 shrink-0" />
              <h4 className="font-bold text-sm">初期の7種類に戻す確認</h4>
            </div>

            <div className="text-xs text-stone-300 space-y-2 leading-relaxed">
              <p>
                地形タイプリストを初期の7種類（針葉樹林、広葉樹林、草原、砂漠・荒地、湿地、雪原・ツンドラ、岩山）にリセットしますか？
              </p>
              <p className="p-2.5 bg-amber-950/60 border border-amber-800/80 rounded-lg text-amber-200">
                ⚠️ スロット番号 8 以上のカスタムバイオームで塗られたセルは「指定なし」に戻ります。
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="py-1.5 px-3 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-xs"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleResetToDefaults}
                className="py-1.5 px-4 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold rounded-lg text-xs shadow"
              >
                初期化する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Symbol Picker Popup */}
      {isSymbolPickerOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-stone-900 border border-stone-700 rounded-2xl max-w-lg w-full max-h-[80vh] flex flex-col shadow-2xl text-stone-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800 bg-stone-950/80">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h4 className="font-bold text-sm text-amber-200">シンボルを選択して追加</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsSymbolPickerOpen(false)}
                className="p-1 text-stone-400 hover:text-stone-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
              {/* Custom Registered Pixel Art Symbols Only */}
              {customAssets.length === 0 ? (
                <div className="py-8 px-4 text-center space-y-3 bg-stone-950/50 rounded-xl border border-dashed border-stone-800">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-stone-200">
                      登録済みのドット絵シンボルがありません
                    </p>
                    <p className="text-[11px] text-stone-400 max-w-sm mx-auto leading-relaxed">
                      この地形タイプに配置するシンボルを追加するには、先にツールバーの「シンボルパレット」から手描きまたは画像変換でドット絵シンボルを作成・登録してください。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-300 border-b border-stone-800 pb-1">
                    <span className="flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5" />
                      登録ドット絵シンボル ({customAssets.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {customAssets.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() =>
                          handleAddSymbolRule({
                            kind: 'custom',
                            customAssetId: asset.id,
                            weight: 5,
                            scaleMin: 0.8,
                            scaleMax: 1.2,
                          })
                        }
                        className="flex items-center gap-2 p-2 bg-stone-950/70 hover:bg-stone-800 border border-stone-800 hover:border-amber-500 rounded-lg text-left transition group cursor-pointer"
                      >
                        <img
                          src={asset.dataUrl}
                          alt={asset.name}
                          className="w-8 h-8 rounded bg-stone-900 object-contain p-0.5 border border-stone-700"
                        />
                        <span className="text-xs text-stone-300 group-hover:text-amber-200 truncate">
                          {asset.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const BiomeTypeEditor = React.memo(BiomeTypeEditorComponent);
