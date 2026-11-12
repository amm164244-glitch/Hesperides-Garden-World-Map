import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Upload,
  Sparkles,
  Sliders,
  Palette,
  Eye,
  Download,
  Check,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  Layers,
  ArrowRight,
  FolderPlus,
  Image as ImageIcon,
  Flame,
  FileImage,
} from 'lucide-react';
import {
  convertImageToPixelArt,
  upscalePixelCanvas,
  ConverterOptions,
  ConvertResult,
  DitherMode,
  PalettePresetKey,
  PALETTE_PRESETS,
} from '../utils/pixelArtConverter';
import { CustomMapAsset, CustomSymbolCategory } from '../types/symbols';

interface ImageToPixelModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: CustomSymbolCategory[];
  onAddCategory: (category: CustomSymbolCategory) => void;
  onSaveCustomAsset: (asset: CustomMapAsset) => void;
  onOpenInPixelEditor?: (asset: CustomMapAsset) => void;
  onSetMapBackground?: (dataUrl: string) => void;
}

// Built-in presets for quick user testing
const SAMPLE_PRESETS = [
  {
    id: 'catacombs',
    name: '地下迷宮・カタコンベ（参考画像）',
    src: '/assets/aistudio/Catacombs-pixel-art-style3-scaled_bdbe652e.jpg',
    category: 'cat_dungeon',
    defaultWidth: 256,
    recommendedPalette: 'catacombs' as PalettePresetKey,
    recommendedDither: 'floyd-steinberg' as DitherMode,
  },
];

export const ImageToPixelModal: React.FC<ImageToPixelModalProps> = ({
  isOpen,
  onClose,
  categories,
  onAddCategory,
  onSaveCustomAsset,
  onOpenInPixelEditor,
  onSetMapBackground,
}) => {
  // Source image state
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string>('sample_catacombs.jpg');
  const [sourceDimensions, setSourceDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Conversion Options
  const [targetWidth, setTargetWidth] = useState<number>(256);
  const [colorCount, setColorCount] = useState<number>(24);
  const [palettePreset, setPalettePreset] = useState<PalettePresetKey>('adaptive');
  const [ditherMode, setDitherMode] = useState<DitherMode>('floyd-steinberg');
  const [ditherStrength, setDitherStrength] = useState<number>(0.65);
  const [contrast, setContrast] = useState<number>(15);
  const [saturation, setSaturation] = useState<number>(10);
  const [brightness, setBrightness] = useState<number>(0);
  const [edgeEnhance, setEdgeEnhance] = useState<number>(25);

  // Background transparency for map icons
  const [transparentBackground, setTransparentBackground] = useState<boolean>(false);
  const [transparencyTolerance, setTransparencyTolerance] = useState<number>(25);
  const [transparencySamplePos, setTransparencySamplePos] = useState<'top-left' | 'white' | 'black'>('top-left');

  // Preview & Result state
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [previewZoom, setPreviewZoom] = useState<number>(2); // 1x, 2x, 3x, 4x
  const [viewMode, setViewMode] = useState<'pixel' | 'original' | 'split'>('pixel');

  // Registration Form
  const [assetName, setAssetName] = useState<string>('高精細ピクセルアート');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(categories[0]?.id || '');
  const [isSavedSuccess, setIsSavedSuccess] = useState<boolean>(false);

  // Download scale factor
  const [exportScale, setExportScale] = useState<number>(2);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load sample image on initial open
  useEffect(() => {
    if (isOpen && !sourceImage) {
      loadPresetImage(SAMPLE_PRESETS[0]);
    }
  }, [isOpen]);

  const loadPresetImage = (preset: typeof SAMPLE_PRESETS[0]) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setSourceImage(img);
      setSourceFileName(preset.name);
      setSourceDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      setTargetWidth(preset.defaultWidth);
      setPalettePreset(preset.recommendedPalette);
      setDitherMode(preset.recommendedDither);
      setAssetName(preset.name.replace(/（.*）/, ''));
      setSelectedCategoryId(preset.category);
    };
    img.src = preset.src;
  };

  const handleFileUpload = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setSourceImage(img);
        setSourceFileName(file.name);
        setSourceDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        // Set good default name
        const cleanName = file.name.replace(/\.[^/.]+$/, '');
        setAssetName(cleanName);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Run Conversion when options change (debounced slightly for smooth slider interaction)
  useEffect(() => {
    if (!sourceImage) return;

    let isMounted = true;
    setIsConverting(true);

    const timer = setTimeout(async () => {
      try {
        const options: ConverterOptions = {
          targetWidth,
          colorCount,
          palettePreset,
          ditherMode,
          ditherStrength,
          contrast,
          saturation,
          brightness,
          edgeEnhance,
          transparentBackground,
          transparencyTolerance,
          transparencySamplePos,
        };

        const res = await convertImageToPixelArt(sourceImage, options);
        if (isMounted) {
          setResult(res);
          setIsConverting(false);
        }
      } catch (err) {
        console.error('Pixel art conversion error:', err);
        if (isMounted) setIsConverting(false);
      }
    }, 75);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [
    sourceImage,
    targetWidth,
    colorCount,
    palettePreset,
    ditherMode,
    ditherStrength,
    contrast,
    saturation,
    brightness,
    edgeEnhance,
    transparentBackground,
    transparencyTolerance,
    transparencySamplePos,
  ]);

  // Handle Save As Custom Symbol
  const handleSaveToSymbols = () => {
    if (!result) return;
    const asset: CustomMapAsset = {
      id: `pixel_art_${Date.now()}`,
      name: assetName.trim() || 'ピクセルアートシンボル',
      category: selectedCategoryId,
      dataUrl: result.dataUrl,
      width: result.width,
      height: result.height,
      originX: 0.5,
      originY: 0.85,
      createdAt: Date.now(),
      isPixelArt: true,
      gridSize: result.width,
      gridData: result.gridData,
    };
    onSaveCustomAsset(asset);
    setIsSavedSuccess(true);
    setTimeout(() => setIsSavedSuccess(false), 2000);
  };

  // Handle Open In Pixel Editor
  const handleOpenInEditor = () => {
    if (!result) return;
    const asset: CustomMapAsset = {
      id: `pixel_art_${Date.now()}`,
      name: assetName.trim() || '変換ドット絵',
      category: selectedCategoryId,
      dataUrl: result.dataUrl,
      width: result.width,
      height: result.height,
      originX: 0.5,
      originY: 0.85,
      createdAt: Date.now(),
      isPixelArt: true,
      gridSize: Math.max(result.width, result.height),
      gridData: result.gridData,
    };
    if (onOpenInPixelEditor) {
      onOpenInPixelEditor(asset);
      onClose();
    }
  };

  // Handle PNG Download
  const handleDownloadPNG = () => {
    if (!result) return;
    const exportCanvas = upscalePixelCanvas(result.canvas, exportScale);
    const link = document.createElement('a');
    link.download = `${assetName.trim().replace(/\s+/g, '_')}_${result.width}x${result.height}_x${exportScale}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  };

  // Handle Map Background set
  const handleSetBackground = () => {
    if (!result || !onSetMapBackground) return;
    onSetMapBackground(result.dataUrl);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-7xl h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-200">
        {/* Top Header */}
        <header className="px-5 py-3.5 border-b border-slate-800 bg-slate-950 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-600 via-orange-500 to-amber-300 flex items-center justify-center shadow-lg shadow-amber-900/40">
              <Sparkles className="w-5 h-5 text-slate-950 font-bold" />
            </div>
            <div>
              <h2 className="text-base font-bold text-amber-200 tracking-wide">
                ピクセル変換
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Main Workspace: Left Controls / Center Preview / Right Export */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Conversion Parameters */}
          <div className="w-80 border-r border-slate-800 bg-slate-950/70 flex flex-col shrink-0 overflow-y-auto p-4 space-y-4">
            {/* Source Image Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-amber-300 flex items-center justify-between">
                <span>元画像の読み込み</span>
                {sourceDimensions.width > 0 && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    {sourceDimensions.width} × {sourceDimensions.height} px
                  </span>
                )}
              </label>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-slate-700/80 hover:border-slate-500 bg-slate-900/60'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                  }}
                />
                <Upload className="w-5 h-5 text-amber-400 mx-auto mb-1" />
                <p className="text-xs font-medium text-slate-200">
                  クリックまたは画像ファイルをドロップ
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  風景画・写真・PNG・JPG・WebP対応
                </p>
              </div>
            </div>

            {/* Pixel Resolution / Grid Size (User requested: "結構ピクセル数は多くしてください") */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Grid className="w-3.5 h-3.5" />
                  <span>ピクセル解像度（横幅）</span>
                </label>
                <span className="text-xs font-mono font-bold text-amber-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  {targetWidth} px
                </span>
              </div>

              {/* Quick preset buttons */}
              <div className="grid grid-cols-4 gap-1 text-[11px]">
                {[
                  { w: 96, label: '96px (小)' },
                  { w: 160, label: '160px' },
                  { w: 256, label: '256px★' },
                  { w: 320, label: '320px(高)' },
                ].map((item) => (
                  <button
                    key={item.w}
                    onClick={() => setTargetWidth(item.w)}
                    className={`py-1 rounded font-medium border transition-colors ${
                      targetWidth === item.w
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <input
                type="range"
                min="48"
                max="480"
                step="16"
                value={targetWidth}
                onChange={(e) => setTargetWidth(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>48px (粗め)</span>
                <span>256px (高密度推奨)</span>
                <span>480px (超精細)</span>
              </div>
            </div>

            {/* Palette Style & Colors */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5" />
                <span>カラーパレット調</span>
              </label>

              <select
                value={palettePreset}
                onChange={(e) => setPalettePreset(e.target.value as PalettePresetKey)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              >
                {Object.entries(PALETTE_PRESETS).map(([key, item]) => (
                  <option key={key} value={key}>
                    {item.name}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 italic">
                {PALETTE_PRESETS[palettePreset]?.description}
              </p>

              {/* Color Count Slider */}
              <div className="pt-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">使用色数（クォンタイズ）</span>
                  <span className="font-mono text-amber-400 font-semibold">{colorCount} 色</span>
                </div>
                <div className="flex gap-1 my-1">
                  {[8, 16, 24, 32, 48].map((c) => (
                    <button
                      key={c}
                      onClick={() => setColorCount(c)}
                      className={`flex-1 py-0.5 rounded text-[10px] font-mono border ${
                        colorCount === c
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min="4"
                  max="64"
                  step="2"
                  value={colorCount}
                  onChange={(e) => setColorCount(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Dithering Engine */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-amber-300">ディザリング（階調陰影）</label>
                <span className="text-xs font-mono text-amber-400">
                  {Math.round(ditherStrength * 100)}%
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1 text-[11px]">
                {[
                  { mode: 'floyd-steinberg', label: 'Floyd-Steinberg (推奨)' },
                  { mode: 'bayer4', label: 'Bayer 4x4 (レトロ網目)' },
                  { mode: 'atkinson', label: 'Atkinson (鮮明階調)' },
                  { mode: 'none', label: 'なし (フラットセル)' },
                ].map((item) => (
                  <button
                    key={item.mode}
                    onClick={() => setDitherMode(item.mode as DitherMode)}
                    className={`py-1 px-1.5 rounded font-medium border text-left truncate transition-colors ${
                      ditherMode === item.mode
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {ditherMode !== 'none' && (
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={ditherStrength}
                  onChange={(e) => setDitherStrength(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              )}
            </div>

            {/* Image Enhancements & Outlines */}
            <div className="space-y-2.5 pt-2 border-t border-slate-800">
              <label className="text-xs font-bold text-amber-300 flex items-center justify-between">
                <span>ディテール＆輪郭補正</span>
                <button
                  onClick={() => {
                    setContrast(15);
                    setSaturation(10);
                    setBrightness(0);
                    setEdgeEnhance(25);
                  }}
                  className="text-[10px] text-slate-400 hover:text-amber-300 flex items-center gap-1"
                >
                  <RotateCcw className="w-2.5 h-2.5" /> リセット
                </button>
              </label>

              {/* Edge Outline Booster */}
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">石垣・輪郭強調 (Sobel)</span>
                  <span className="font-mono text-amber-400">{edgeEnhance}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={edgeEnhance}
                  onChange={(e) => setEdgeEnhance(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Contrast */}
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">コントラスト</span>
                  <span className="font-mono text-amber-400">
                    {contrast > 0 ? `+${contrast}` : contrast}
                  </span>
                </div>
                <input
                  type="range"
                  min="-40"
                  max="50"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              {/* Saturation */}
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">彩度</span>
                  <span className="font-mono text-amber-400">
                    {saturation > 0 ? `+${saturation}` : saturation}
                  </span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={saturation}
                  onChange={(e) => setSaturation(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Background Transparency (Optional for Map Icons) */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-300">
                <input
                  type="checkbox"
                  checked={transparentBackground}
                  onChange={(e) => setTransparentBackground(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
                />
                <span>背景を透過（マップ配置シンボル用）</span>
              </label>

              {transparentBackground && (
                <div className="space-y-1.5 pl-5">
                  <div className="flex gap-1 text-[10px]">
                    {[
                      { key: 'top-left', label: '左上色' },
                      { key: 'white', label: '白抜き' },
                      { key: 'black', label: '黒抜き' },
                    ].map((pos) => (
                      <button
                        key={pos.key}
                        onClick={() => setTransparencySamplePos(pos.key as any)}
                        className={`flex-1 py-0.5 rounded border ${
                          transparencySamplePos === pos.key
                            ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        {pos.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>透過許容値</span>
                    <span>{transparencyTolerance}%</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="60"
                    value={transparencyTolerance}
                    onChange={(e) => setTransparencyTolerance(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Center Column: Interactive Canvas & Viewport */}
          <div className="flex-1 bg-slate-950 flex flex-col overflow-hidden relative">
            {/* Top Toolbar over Canvas */}
            <div className="h-11 px-4 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between shrink-0">
              {/* View mode toggle */}
              <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                <button
                  onClick={() => setViewMode('pixel')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === 'pixel'
                      ? 'bg-amber-500/20 text-amber-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ピクセルアート
                </button>
                <button
                  onClick={() => setViewMode('original')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === 'original'
                      ? 'bg-amber-500/20 text-amber-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  元画像
                </button>
                <button
                  onClick={() => setViewMode('split')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === 'split'
                      ? 'bg-amber-500/20 text-amber-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  左右比較
                </button>
              </div>

              {/* Status & Processing speed */}
              <div className="flex items-center gap-3">
                {isConverting ? (
                  <span className="flex items-center gap-1.5 text-xs text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    変換処理中...
                  </span>
                ) : result ? (
                  <span className="text-[11px] text-slate-400 flex items-center gap-2">
                    <span className="text-amber-300 font-mono">
                      {result.width} × {result.height} ピクセル
                    </span>
                    <span>({result.palette.length}色・{result.processingTimeMs}ms)</span>
                  </span>
                ) : null}

                {/* Zoom controls */}
                <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setPreviewZoom((z) => Math.max(1, z - 0.5))}
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200"
                    title="縮小"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-mono px-1.5 text-slate-300 font-semibold">
                    {previewZoom}x
                  </span>
                  <button
                    onClick={() => setPreviewZoom((z) => Math.min(6, z + 0.5))}
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200"
                    title="拡大"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPreviewZoom(2)}
                    className="px-2 py-0.5 text-[10px] hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200"
                  >
                    等倍
                  </button>
                </div>
              </div>
            </div>

            {/* Canvas Viewport Area */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-6 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
              {result && (
                <div
                  className="transition-all duration-150 flex items-center justify-center"
                  style={{
                    transform: `scale(${previewZoom})`,
                    transformOrigin: 'center center',
                  }}
                >
                  {viewMode === 'pixel' && (
                    <div className="relative shadow-2xl rounded-sm overflow-hidden border border-slate-800">
                      <img
                        src={result.dataUrl}
                        alt="Pixel Art"
                        className="block max-w-none"
                        style={{
                          imageRendering: 'pixelated',
                          width: `${result.width}px`,
                          height: `${result.height}px`,
                        }}
                      />
                    </div>
                  )}

                  {viewMode === 'original' && sourceImage && (
                    <div className="relative shadow-2xl rounded-sm overflow-hidden border border-slate-800">
                      <img
                        src={sourceImage.src}
                        alt="Original"
                        className="block max-w-none"
                        style={{
                          width: `${result.width}px`,
                          height: `${result.height}px`,
                          objectFit: 'cover',
                        }}
                      />
                    </div>
                  )}

                  {viewMode === 'split' && sourceImage && (
                    <div className="flex shadow-2xl border border-slate-800 overflow-hidden rounded-sm">
                      <div className="overflow-hidden border-r border-amber-500/50">
                        <img
                          src={sourceImage.src}
                          alt="Original"
                          className="block max-w-none"
                          style={{
                            width: `${result.width / 2}px`,
                            height: `${result.height}px`,
                            objectFit: 'cover',
                            objectPosition: 'left center',
                          }}
                        />
                      </div>
                      <div className="overflow-hidden">
                        <img
                          src={result.dataUrl}
                          alt="Pixel Art"
                          className="block max-w-none"
                          style={{
                            imageRendering: 'pixelated',
                            width: `${result.width}px`,
                            height: `${result.height}px`,
                            marginLeft: `-${result.width / 2}px`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Palette Bar */}
            {result && result.palette.length > 0 && (
              <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/90 flex items-center gap-3 shrink-0">
                <span className="text-[11px] font-medium text-slate-400 shrink-0">
                  生成パレット ({result.palette.length}色):
                </span>
                <div className="flex-1 flex flex-wrap gap-1 items-center max-h-12 overflow-y-auto">
                  {result.palette.map((color, idx) => (
                    <div
                      key={idx}
                      className="w-4 h-4 rounded-sm border border-black/40 shadow-sm shrink-0 hover:scale-125 transition-transform cursor-pointer"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Save & Export Actions */}
          <div className="w-80 border-l border-slate-800 bg-slate-950/70 flex flex-col shrink-0 p-4 space-y-5">
            <div>
              <h3 className="text-sm font-bold text-amber-200 mb-1 flex items-center gap-1.5">
                <FolderPlus className="w-4 h-4 text-amber-400" />
                <span>マップシンボルとして登録</span>
              </h3>
            </div>

            {/* Name Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">シンボル名</label>
              <input
                type="text"
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                placeholder="例: 古代遺跡"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Category Select */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">保存先カテゴリ</label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
              >
                <option value="">未分類 (指定なし)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Action 1: Save as Symbol */}
            <button
              onClick={handleSaveToSymbols}
              disabled={!result}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all ${
                isSavedSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 shadow-amber-950/30 font-bold'
              }`}
            >
              {isSavedSuccess ? (
                <>
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>登録完了！パレットに追加されました</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>シンボルパレットに登録</span>
                </>
              )}
            </button>

            {/* Action 2: Open in Pixel Art Editor */}
            {onOpenInPixelEditor && (
              <button
                onClick={handleOpenInEditor}
                disabled={!result}
                className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <Grid className="w-4 h-4 text-amber-400" />
                <span>ドット絵エディタで微調整する</span>
              </button>
            )}

            {/* Action 3: Set as Map Background (for full landscapes / scenes) */}
            {onSetMapBackground && (
              <button
                onClick={handleSetBackground}
                disabled={!result}
                className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                title="地図の背景や挿絵として設定"
              >
                <ImageIcon className="w-4 h-4 text-indigo-400" />
                <span>マップ背景・挿絵に設定</span>
              </button>
            )}

            {/* Section: Crisp PNG Export */}
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" />
                <span>PNG画像として保存</span>
              </label>

              <div className="flex gap-1.5">
                {[
                  { scale: 1, label: '1x (実寸)' },
                  { scale: 2, label: '2x' },
                  { scale: 4, label: '4x' },
                  { scale: 8, label: '8x (高解像度)' },
                ].map((item) => (
                  <button
                    key={item.scale}
                    onClick={() => setExportScale(item.scale)}
                    className={`flex-1 py-1 rounded text-[11px] font-mono border ${
                      exportScale === item.scale
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleDownloadPNG}
                disabled={!result}
                className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  PNGダウンロード (
                  {result ? `${result.width * exportScale} × ${result.height * exportScale}px` : ''}
                  )
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
