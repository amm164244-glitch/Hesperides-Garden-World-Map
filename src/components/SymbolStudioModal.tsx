import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Sparkles,
  PenTool,
  Upload,
  Dice5,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Check,
  Layers,
  Sliders,
  Maximize2,
  Paintbrush,
  Eraser,
  Copy,
  ChevronRight,
} from 'lucide-react';
import { CustomMapAsset, MapSymbolCategory } from '../types/symbols';
import {
  MountainParams,
  CastleParams,
  TreeParams,
  drawParametricMountain,
  drawParametricCastle,
  drawParametricTree,
} from '../utils/parametricSymbolGenerator';

interface SymbolStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  customAssets: CustomMapAsset[];
  onSaveCustomAsset: (asset: CustomMapAsset) => void;
  onDeleteCustomAsset: (assetId: string) => void;
  onSelectAndEquipAsset: (assetId: string) => void;
}

type StudioTab = 'generator' | 'drawing' | 'import';

export const SymbolStudioModal: React.FC<SymbolStudioModalProps> = ({
  isOpen,
  onClose,
  customAssets,
  onSaveCustomAsset,
  onDeleteCustomAsset,
  onSelectAndEquipAsset,
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('generator');
  const [assetName, setAssetName] = useState<string>('自作の孤高の霊峰');
  const [assetCategory, setAssetCategory] = useState<MapSymbolCategory>('mountain');

  // Generator State
  const [genCategory, setGenCategory] = useState<'mountain' | 'castle' | 'tree'>('mountain');
  const [mountainParams, setMountainParams] = useState<MountainParams>({
    height: 85,
    baseWidth: 100,
    peakSharpness: 0.6,
    asymmetry: -0.05,
    snowcapRatio: 0.28,
    shadowHatchDensity: 8,
    cragCount: 3,
    foothills: 1,
    seed: 48921,
  });

  const [castleParams, setCastleParams] = useState<CastleParams>({
    towerCount: 3,
    keepHeight: 88,
    wallWidth: 95,
    crenellations: true,
    roofStyle: 'spire',
    roofColor: 'crimson',
    flags: true,
    gateStyle: 'portcullis',
    seed: 39182,
  });

  const [treeParams, setTreeParams] = useState<TreeParams>({
    type: 'pine',
    treeCount: 4,
    height: 65,
    spread: 55,
    foliageTone: 'evergreen',
    seed: 82914,
  });

  // Generator Preview Canvas
  const genCanvasRef = useRef<HTMLCanvasElement>(null);

  const redrawGenerator = useCallback(() => {
    const canvas = genCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width * 0.5;
    const cy = canvas.height * 0.85;

    if (genCategory === 'mountain') {
      drawParametricMountain(ctx, mountainParams, cx, cy);
    } else if (genCategory === 'castle') {
      drawParametricCastle(ctx, castleParams, cx, cy);
    } else {
      drawParametricTree(ctx, treeParams, cx, cy);
    }
  }, [genCategory, mountainParams, castleParams, treeParams]);

  useEffect(() => {
    if (activeTab === 'generator') {
      redrawGenerator();
    }
  }, [activeTab, redrawGenerator]);

  // Roll random parameters
  const handleRollRandom = () => {
    const s = Math.floor(Math.random() * 999999);
    if (genCategory === 'mountain') {
      setMountainParams({
        height: 60 + Math.floor(Math.random() * 55),
        baseWidth: 70 + Math.floor(Math.random() * 60),
        peakSharpness: 0.3 + Math.random() * 0.6,
        asymmetry: (Math.random() - 0.5) * 0.5,
        snowcapRatio: Math.random() < 0.25 ? 0 : 0.15 + Math.random() * 0.35,
        shadowHatchDensity: 5 + Math.floor(Math.random() * 8),
        cragCount: 1 + Math.floor(Math.random() * 4),
        foothills: Math.floor(Math.random() * 3),
        seed: s,
      });
      setAssetName(`山脈 #${s.toString().substring(0, 4)}`);
    } else if (genCategory === 'castle') {
      const roofStyles: ('crenellated' | 'spire' | 'conical' | 'dome')[] = [
        'crenellated',
        'spire',
        'conical',
        'dome',
      ];
      const colors: ('crimson' | 'royal_blue' | 'slate' | 'gold')[] = [
        'crimson',
        'royal_blue',
        'slate',
        'gold',
      ];
      const towers: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
      setCastleParams({
        towerCount: towers[Math.floor(Math.random() * towers.length)],
        keepHeight: 70 + Math.floor(Math.random() * 45),
        wallWidth: 75 + Math.floor(Math.random() * 50),
        crenellations: Math.random() < 0.8,
        roofStyle: roofStyles[Math.floor(Math.random() * roofStyles.length)],
        roofColor: colors[Math.floor(Math.random() * colors.length)],
        flags: Math.random() < 0.7,
        gateStyle: Math.random() < 0.5 ? 'portcullis' : 'arch',
        seed: s,
      });
      setAssetName(`城塞 #${s.toString().substring(0, 4)}`);
    } else {
      const treeTypes: ('pine' | 'oak' | 'cypress' | 'dead')[] = ['pine', 'oak'];
      const tones: ('evergreen' | 'moss' | 'autumn' | 'withered')[] = [
        'evergreen',
        'moss',
        'autumn',
      ];
      setTreeParams({
        type: treeTypes[Math.floor(Math.random() * treeTypes.length)],
        treeCount: 2 + Math.floor(Math.random() * 5),
        height: 50 + Math.floor(Math.random() * 35),
        spread: 40 + Math.floor(Math.random() * 40),
        foliageTone: tones[Math.floor(Math.random() * tones.length)],
        seed: s,
      });
      setAssetName(`森林 #${s.toString().substring(0, 4)}`);
    }
  };

  // Drawing Pad State
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [drawingTool, setDrawingTool] = useState<'pen_fine' | 'pen_bold' | 'wash' | 'white' | 'eraser'>('pen_fine');
  const [currentColor, setCurrentColor] = useState<string>('#1a1814');
  const [isSymmetryActive, setIsSymmetryActive] = useState<boolean>(false);
  const [drawHistory, setDrawHistory] = useState<ImageData[]>([]);
  const [drawRedoStack, setDrawRedoStack] = useState<ImageData[]>([]);
  const isDrawingRef = useRef<boolean>(false);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);

  const saveCanvasState = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setDrawHistory((prev) => [...prev.slice(-25), imgData]);
    setDrawRedoStack([]);
  };

  const handleDrawingUndo = () => {
    if (drawHistory.length <= 1) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const current = drawHistory[drawHistory.length - 1];
    const prev = drawHistory[drawHistory.length - 2];
    setDrawRedoStack((r) => [...r, current]);
    setDrawHistory((h) => h.slice(0, h.length - 1));
    ctx.putImageData(prev, 0, 0);
  };

  const handleDrawingRedo = () => {
    if (drawRedoStack.length === 0) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const next = drawRedoStack[drawRedoStack.length - 1];
    setDrawRedoStack((r) => r.slice(0, r.length - 1));
    setDrawHistory((h) => [...h, next]);
    ctx.putImageData(next, 0, 0);
  };

  const clearDrawingCanvas = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    saveCanvasState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Copy from Generator preview to Drawing pad
  const handleSendToDrawingPad = () => {
    const gen = genCanvasRef.current;
    const draw = drawCanvasRef.current;
    if (!gen || !draw) return;
    const drawCtx = draw.getContext('2d');
    if (!drawCtx) return;

    saveCanvasState();
    drawCtx.clearRect(0, 0, draw.width, draw.height);
    drawCtx.drawImage(gen, 0, 0, draw.width, draw.height);
    setActiveTab('drawing');
  };

  // Drawing Mouse Events
  const handleDrawStart = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;

    saveCanvasState();
    isDrawingRef.current = true;
    lastDrawPosRef.current = { x, y };

    // Single click dot
    handleDrawMove(e);
  };

  const handleDrawMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    const last = lastDrawPosRef.current || { x, y };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (drawingTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else if (drawingTool === 'wash') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = currentColor;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 18;
      ctx.strokeStyle = currentColor;
    } else if (drawingTool === 'white') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.0;
    } else if (drawingTool === 'pen_bold') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = 3.5;
    } else {
      // pen_fine
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = 1.4;
    }

    // Main stroke
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    // Symmetry mirror stroke (along vertical center axis x = canvas.width / 2)
    if (isSymmetryActive) {
      const cx = canvas.width * 0.5;
      const mX1 = cx - (last.x - cx);
      const mX2 = cx - (x - cx);
      ctx.beginPath();
      ctx.moveTo(mX1, last.y);
      ctx.lineTo(mX2, y);
      ctx.stroke();
    }

    ctx.restore();
    lastDrawPosRef.current = { x, y };
  };

  const handleDrawEnd = () => {
    isDrawingRef.current = false;
    lastDrawPosRef.current = null;
  };

  // Image Import State
  const [importedPreview, setImportedPreview] = useState<string | null>(null);
  const [whiteThreshold, setWhiteThreshold] = useState<number>(230);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      processImportedImage(src, whiteThreshold);
    };
    reader.readAsDataURL(file);
  };

  const processImportedImage = (src: string, threshold: number) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      // Fit image centered
      const scale = Math.min(240 / img.width, 240 / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (256 - dw) / 2;
      const dy = (256 - dh) / 2;

      ctx.drawImage(img, dx, dy, dw, dh);

      // Chroma-key out pure white paper background
      const imgData = ctx.getImageData(0, 0, 256, 256);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        if (r > threshold && g > threshold && b > threshold) {
          // Fade alpha smoothly
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      setImportedPreview(c.toDataURL('image/png'));
    };
    img.src = src;
  };

  // Save current asset to library
  const handleSaveAsset = () => {
    let dataUrl = '';
    if (activeTab === 'generator') {
      const canvas = genCanvasRef.current;
      if (canvas) dataUrl = canvas.toDataURL('image/png');
    } else if (activeTab === 'drawing') {
      const canvas = drawCanvasRef.current;
      if (canvas) dataUrl = canvas.toDataURL('image/png');
    } else if (activeTab === 'import') {
      dataUrl = importedPreview || '';
    }

    if (!dataUrl) return;

    const newAsset: CustomMapAsset = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: assetName.trim() || '自作シンボル',
      category: assetCategory,
      dataUrl,
      width: 256,
      height: 256,
      originX: 0.5,
      originY: 0.85,
      createdAt: Date.now(),
    };

    onSaveCustomAsset(newAsset);
    onSelectAndEquipAsset(newAsset.id);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#181512] border border-[#524434] rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl text-[#f3ece0] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#3d3224] flex items-center justify-between bg-[#201c18]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#d4af37] to-[#8a6b18] flex items-center justify-center text-[#1c160c] shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-lg tracking-wide text-[#fbf7ee]">
                シンボル自作・生成スタジオ
              </h2>
              <p className="text-xs text-[#a39480]">
                オリジナルの山脈・城塞・樹木スタンプをパラメータ生成、手描きスケッチ、または画像から作成
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9e907d] hover:text-[#fbf7ee] hover:bg-[#2e261e] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-[#3d3224] bg-[#141210] px-6 pt-2">
          <button
            onClick={() => setActiveTab('generator')}
            className={`pb-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'generator'
                ? 'border-[#d4af37] text-[#d4af37]'
                : 'border-transparent text-[#8a7a67] hover:text-[#d1c2aa]'
            }`}
          >
            <Sliders className="w-4 h-4" />
            パラメータ自動生成
          </button>
          <button
            onClick={() => {
              setActiveTab('drawing');
              // Initialize drawing history if empty
              setTimeout(() => {
                const canvas = drawCanvasRef.current;
                if (canvas && drawHistory.length === 0) {
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    setDrawHistory([img]);
                  }
                }
              }, 50);
            }}
            className={`pb-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'drawing'
                ? 'border-[#d4af37] text-[#d4af37]'
                : 'border-transparent text-[#8a7a67] hover:text-[#d1c2aa]'
            }`}
          >
            <PenTool className="w-4 h-4" />
            手描きスケッチパッド
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`pb-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'import'
                ? 'border-[#d4af37] text-[#d4af37]'
                : 'border-transparent text-[#8a7a67] hover:text-[#d1c2aa]'
            }`}
          >
            <Upload className="w-4 h-4" />
            画像取り込み・白背景透過
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* LEFT: Preview & Drawing Canvas Area (5 Cols) */}
          <div className="md:col-span-5 flex flex-col items-center justify-center bg-[#0d0c0a] p-4 rounded-xl border border-[#2b241d] relative">
            <div className="text-xs text-[#8c7d6c] mb-2 self-start font-medium flex items-center gap-1.5">
              <span>キャンバスプレビュー (256×256)</span>
            </div>

            {/* Checkerboard Pattern Container for Transparency */}
            <div className="relative w-64 h-64 rounded-lg overflow-hidden border-2 border-[#4a3d2e] shadow-xl bg-[linear-gradient(45deg,#1f1c19_25%,transparent_25%),linear-gradient(-45deg,#1f1c19_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f1c19_75%),linear-gradient(-45deg,transparent_75%,#1f1c19_75%)] bg-[size:16px_16px] bg-[#141210]">
              {/* Generator Canvas */}
              {activeTab === 'generator' && (
                <canvas
                  ref={genCanvasRef}
                  width={256}
                  height={256}
                  className="w-full h-full block"
                />
              )}

              {/* Drawing Pad Canvas */}
              {activeTab === 'drawing' && (
                <canvas
                  ref={drawCanvasRef}
                  width={256}
                  height={256}
                  onMouseDown={handleDrawStart}
                  onMouseMove={handleDrawMove}
                  onMouseUp={handleDrawEnd}
                  onMouseLeave={handleDrawEnd}
                  className="w-full h-full block cursor-crosshair select-none"
                />
              )}

              {/* Import Preview */}
              {activeTab === 'import' && (
                <div className="w-full h-full flex items-center justify-center p-2">
                  {importedPreview ? (
                    <img
                      src={importedPreview}
                      alt="Imported"
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="text-center text-xs text-[#736553] p-4">
                      画像をドラッグ＆ドロップするとここにプレビューされます
                    </div>
                  )}
                </div>
              )}

              {/* Symmetry Axis Line indicator if active in drawing mode */}
              {activeTab === 'drawing' && isSymmetryActive && (
                <div className="absolute inset-y-0 left-1/2 w-px bg-amber-400/50 pointer-events-none" />
              )}
            </div>

            {/* Quick Canvas Actions under preview */}
            {activeTab === 'generator' && (
              <div className="flex gap-2 mt-3 w-64">
                <button
                  onClick={handleRollRandom}
                  className="flex-1 py-1.5 bg-[#251f18] hover:bg-[#332a21] border border-[#4a3d2e] rounded-lg text-xs font-medium text-[#d4af37] flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Dice5 className="w-3.5 h-3.5" />
                  ランダム生成
                </button>
                <button
                  onClick={handleSendToDrawingPad}
                  className="py-1.5 px-3 bg-[#251f18] hover:bg-[#332a21] border border-[#4a3d2e] rounded-lg text-xs font-medium text-[#baa993] hover:text-[#f3ece0] flex items-center gap-1 transition-colors"
                  title="生成したシンボルを手描きキャンバスに送り、手作業で加筆・修正する"
                >
                  <PenTool className="w-3.5 h-3.5" />
                  加筆する
                </button>
              </div>
            )}

            {activeTab === 'drawing' && (
              <div className="flex items-center justify-between mt-3 w-64">
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleDrawingUndo}
                    disabled={drawHistory.length <= 1}
                    className="p-1.5 rounded-md bg-[#251f18] hover:bg-[#332a21] disabled:opacity-40 text-[#c2b29c]"
                    title="元に戻す"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleDrawingRedo}
                    disabled={drawRedoStack.length === 0}
                    className="p-1.5 rounded-md bg-[#251f18] hover:bg-[#332a21] disabled:opacity-40 text-[#c2b29c]"
                    title="やり直し"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsSymmetryActive((v) => !v)}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                      isSymmetryActive
                        ? 'border-[#d4af37] bg-[#3a2e1c] text-[#d4af37]'
                        : 'border-[#3d3224] bg-[#251f18] text-[#8c7d6c]'
                    }`}
                    title="左右対称ミラー描画"
                  >
                    対称ミラー
                  </button>
                </div>
                <button
                  onClick={clearDrawingCanvas}
                  className="p-1.5 rounded-md bg-[#2b1717] hover:bg-[#3d1e1e] text-[#f87171]"
                  title="全消去"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* RIGHT: Controls & Parameters (7 Cols) */}
          <div className="md:col-span-7 flex flex-col space-y-4">
            {/* Metadata (Name & Category) */}
            <div className="bg-[#12100e] p-3.5 rounded-xl border border-[#2b241d] space-y-3">
              <div>
                <label className="text-xs text-[#8c7d6c] block mb-1 font-medium">シンボル名</label>
                <input
                  type="text"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  className="w-full bg-[#1e1a16] border border-[#423629] rounded-lg px-3 py-1.5 text-xs text-[#fbf7ee] focus:outline-none focus:border-[#d4af37]"
                />
              </div>

              <div>
                <label className="text-xs text-[#8c7d6c] block mb-1 font-medium">分類カテゴリ</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['mountain', 'settlement', 'tree', 'custom'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setAssetCategory(cat)}
                      className={`py-1 text-xs rounded-md font-medium border transition-colors ${
                        assetCategory === cat
                          ? 'border-[#d4af37] bg-[#332918] text-[#d4af37]'
                          : 'border-[#2d251c] bg-[#1a1713] text-[#8c7d6c]'
                      }`}
                    >
                      {cat === 'mountain'
                        ? '山脈'
                        : cat === 'settlement'
                        ? '拠点・城'
                        : cat === 'tree'
                        ? '樹木'
                        : 'その他'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* TAB 1: PARAMETRIC SLIDERS */}
            {activeTab === 'generator' && (
              <div className="bg-[#12100e] p-4 rounded-xl border border-[#2b241d] space-y-4 max-h-[380px] overflow-y-auto">
                {/* Generation Type Switch */}
                <div className="flex gap-2 border-b border-[#2d251c] pb-2">
                  <button
                    onClick={() => {
                      setGenCategory('mountain');
                      setAssetCategory('mountain');
                      setAssetName('手描き主峰');
                    }}
                    className={`flex-1 py-1 text-xs font-semibold rounded-md transition-colors ${
                      genCategory === 'mountain'
                        ? 'bg-[#d4af37] text-[#1c160c]'
                        : 'bg-[#221c17] text-[#baa993]'
                    }`}
                  >
                    山脈・連峰
                  </button>
                  <button
                    onClick={() => {
                      setGenCategory('castle');
                      setAssetCategory('settlement');
                      setAssetName('手描き石造り城塞');
                    }}
                    className={`flex-1 py-1 text-xs font-semibold rounded-md transition-colors ${
                      genCategory === 'castle'
                        ? 'bg-[#d4af37] text-[#1c160c]'
                        : 'bg-[#221c17] text-[#baa993]'
                    }`}
                  >
                    城塞・要塞
                  </button>
                  <button
                    onClick={() => {
                      setGenCategory('tree');
                      setAssetCategory('tree');
                      setAssetName('手描き樹海');
                    }}
                    className={`flex-1 py-1 text-xs font-semibold rounded-md transition-colors ${
                      genCategory === 'tree'
                        ? 'bg-[#d4af37] text-[#1c160c]'
                        : 'bg-[#221c17] text-[#baa993]'
                    }`}
                  >
                    樹木・森林
                  </button>
                </div>

                {/* Mountain Sliders */}
                {genCategory === 'mountain' && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs text-[#a39480] mb-1">
                        <span>山の高さ</span>
                        <span className="font-mono text-[#d4af37]">{mountainParams.height}</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="120"
                        value={mountainParams.height}
                        onChange={(e) =>
                          setMountainParams((p) => ({ ...p, height: Number(e.target.value) }))
                        }
                        className="w-full h-1 bg-[#2b241d] accent-[#d4af37]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a39480] mb-1">
                        <span>裾野の広がり（幅）</span>
                        <span className="font-mono text-[#d4af37]">{mountainParams.baseWidth}</span>
                      </div>
                      <input
                        type="range"
                        min="60"
                        max="140"
                        value={mountainParams.baseWidth}
                        onChange={(e) =>
                          setMountainParams((p) => ({ ...p, baseWidth: Number(e.target.value) }))
                        }
                        className="w-full h-1 bg-[#2b241d] accent-[#d4af37]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a39480] mb-1">
                        <span>雪冠（雪の量）</span>
                        <span className="font-mono text-[#d4af37]">
                          {Math.round(mountainParams.snowcapRatio * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="0.6"
                        step="0.05"
                        value={mountainParams.snowcapRatio}
                        onChange={(e) =>
                          setMountainParams((p) => ({
                            ...p,
                            snowcapRatio: Number(e.target.value),
                          }))
                        }
                        className="w-full h-1 bg-[#2b241d] accent-[#d4af37]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a39480] mb-1">
                        <span>影のハッチング密度</span>
                        <span className="font-mono text-[#d4af37]">
                          {mountainParams.shadowHatchDensity}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="4"
                        max="14"
                        value={mountainParams.shadowHatchDensity}
                        onChange={(e) =>
                          setMountainParams((p) => ({
                            ...p,
                            shadowHatchDensity: Number(e.target.value),
                          }))
                        }
                        className="w-full h-1 bg-[#2b241d] accent-[#d4af37]"
                      />
                    </div>
                  </div>
                )}

                {/* Castle Sliders */}
                {genCategory === 'castle' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-[#a39480] block mb-1">塔の数</label>
                      <div className="grid grid-cols-4 gap-2">
                        {([1, 2, 3, 4] as const).map((cnt) => (
                          <button
                            key={cnt}
                            onClick={() => setCastleParams((p) => ({ ...p, towerCount: cnt }))}
                            className={`py-1 text-xs rounded border ${
                              castleParams.towerCount === cnt
                                ? 'border-[#d4af37] bg-[#332918] text-[#d4af37]'
                                : 'border-[#2d251c] text-[#8c7d6c]'
                            }`}
                          >
                            {cnt}基
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-[#a39480] block mb-1">屋根スタイル</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(['spire', 'crenellated', 'conical', 'dome'] as const).map((r) => (
                          <button
                            key={r}
                            onClick={() => setCastleParams((p) => ({ ...p, roofStyle: r }))}
                            className={`py-1 text-[11px] rounded border ${
                              castleParams.roofStyle === r
                                ? 'border-[#d4af37] bg-[#332918] text-[#d4af37]'
                                : 'border-[#2d251c] text-[#8c7d6c]'
                            }`}
                          >
                            {r === 'spire'
                              ? '鋭い尖塔'
                              : r === 'crenellated'
                              ? '狭間胸壁'
                              : r === 'conical'
                              ? '円錐屋根'
                              : 'ドーム'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-[#a39480] block mb-1">屋根の色</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(['crimson', 'royal_blue', 'gold', 'slate'] as const).map((c) => (
                          <button
                            key={c}
                            onClick={() => setCastleParams((p) => ({ ...p, roofColor: c }))}
                            className={`py-1 text-[11px] rounded border ${
                              castleParams.roofColor === c
                                ? 'border-[#d4af37] bg-[#332918] text-[#d4af37]'
                                : 'border-[#2d251c] text-[#8c7d6c]'
                            }`}
                          >
                            {c === 'crimson'
                              ? '深紅'
                              : c === 'royal_blue'
                              ? '蒼青'
                              : c === 'gold'
                              ? '黄金'
                              : '石板灰'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tree Sliders */}
                {genCategory === 'tree' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-[#a39480] block mb-1">樹木タイプ</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['pine', 'oak'] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setTreeParams((p) => ({ ...p, type: t }))}
                            className={`py-1.5 text-xs rounded border ${
                              treeParams.type === t
                                ? 'border-[#d4af37] bg-[#332918] text-[#d4af37]'
                                : 'border-[#2d251c] text-[#8c7d6c]'
                            }`}
                          >
                            {t === 'pine' ? '🌲 針葉樹（スプルース）' : '🌳 広葉樹（オーク）'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a39480] mb-1">
                        <span>群生本数</span>
                        <span className="font-mono text-[#d4af37]">{treeParams.treeCount}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="7"
                        value={treeParams.treeCount}
                        onChange={(e) =>
                          setTreeParams((p) => ({ ...p, treeCount: Number(e.target.value) }))
                        }
                        className="w-full h-1 bg-[#2b241d] accent-[#d4af37]"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: DRAWING PAD TOOLBAR */}
            {activeTab === 'drawing' && (
              <div className="bg-[#12100e] p-4 rounded-xl border border-[#2b241d] space-y-3">
                <label className="text-xs text-[#8c7d6c] block font-medium">ブラシ・ペンツール</label>
                <div className="grid grid-cols-5 gap-1.5">
                  <button
                    onClick={() => setDrawingTool('pen_fine')}
                    className={`py-1.5 rounded-lg text-xs font-medium border flex flex-col items-center gap-1 ${
                      drawingTool === 'pen_fine'
                        ? 'border-[#d4af37] bg-[#332918] text-[#d4af37]'
                        : 'border-[#2d251c] bg-[#1a1713] text-[#8c7d6c]'
                    }`}
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    細ペン
                  </button>
                  <button
                    onClick={() => setDrawingTool('pen_bold')}
                    className={`py-1.5 rounded-lg text-xs font-medium border flex flex-col items-center gap-1 ${
                      drawingTool === 'pen_bold'
                        ? 'border-[#d4af37] bg-[#332918] text-[#d4af37]'
                        : 'border-[#2d251c] bg-[#1a1713] text-[#8c7d6c]'
                    }`}
                  >
                    <Paintbrush className="w-3.5 h-3.5" />
                    太ペン
                  </button>
                  <button
                    onClick={() => setDrawingTool('wash')}
                    className={`py-1.5 rounded-lg text-xs font-medium border flex flex-col items-center gap-1 ${
                      drawingTool === 'wash'
                        ? 'border-[#d4af37] bg-[#332918] text-[#d4af37]'
                        : 'border-[#2d251c] bg-[#1a1713] text-[#8c7d6c]'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    陰影ウォッシュ
                  </button>
                  <button
                    onClick={() => setDrawingTool('white')}
                    className={`py-1.5 rounded-lg text-xs font-medium border flex flex-col items-center gap-1 ${
                      drawingTool === 'white'
                        ? 'border-[#d4af37] bg-[#332918] text-[#d4af37]'
                        : 'border-[#2d251c] bg-[#1a1713] text-[#8c7d6c]'
                    }`}
                  >
                    <div className="w-3.5 h-3.5 rounded-full bg-white border border-stone-600" />
                    雪・白ハイライト
                  </button>
                  <button
                    onClick={() => setDrawingTool('eraser')}
                    className={`py-1.5 rounded-lg text-xs font-medium border flex flex-col items-center gap-1 ${
                      drawingTool === 'eraser'
                        ? 'border-[#ef4444] bg-[#3d1818] text-[#f87171]'
                        : 'border-[#2d251c] bg-[#1a1713] text-[#8c7d6c]'
                    }`}
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    消しゴム
                  </button>
                </div>

                {/* Color swatches */}
                <div className="pt-2">
                  <label className="text-[11px] text-[#8c7d6c] block mb-1.5">インクカラー</label>
                  <div className="flex gap-2">
                    {[
                      { c: '#1a1814', label: '墨黒' },
                      { c: '#5c4e3f', label: '焦茶' },
                      { c: '#9e9282', label: '石灰' },
                      { c: '#882d24', label: '真紅' },
                      { c: '#264e70', label: '蒼' },
                      { c: '#2f6148', label: '翠' },
                      { c: '#b8860b', label: '金' },
                    ].map((item) => (
                      <button
                        key={item.c}
                        onClick={() => setCurrentColor(item.c)}
                        className={`w-6 h-6 rounded-full border-2 transition-transform ${
                          currentColor === item.c
                            ? 'scale-110 border-[#d4af37]'
                            : 'border-transparent'
                        }`}
                        style={{ backgroundColor: item.c }}
                        title={item.label}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: IMAGE IMPORT */}
            {activeTab === 'import' && (
              <div className="bg-[#12100e] p-4 rounded-xl border border-[#2b241d] space-y-4">
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files[0]) handleFileDrop(e.dataTransfer.files[0]);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[#4a3d2e] hover:border-[#d4af37] rounded-xl p-8 text-center cursor-pointer bg-[#181512]/60 hover:bg-[#201c18] transition-colors"
                >
                  <Upload className="w-8 h-8 text-[#d4af37] mx-auto mb-2" />
                  <p className="text-xs font-semibold text-[#fbf7ee]">
                    透過PNGまたはJPEG画像をここにドラッグ＆ドロップ
                  </p>
                  <p className="text-[11px] text-[#8c7d6c] mt-1">またはクリックしてファイルを選択</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleFileDrop(e.target.files[0]);
                    }}
                    className="hidden"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-[#a39480] mb-1">
                    <span>白背景透過しきい値（自動クロマキー）</span>
                    <span className="font-mono text-[#d4af37]">{whiteThreshold}</span>
                  </div>
                  <input
                    type="range"
                    min="180"
                    max="255"
                    value={whiteThreshold}
                    onChange={(e) => setWhiteThreshold(Number(e.target.value))}
                    className="w-full h-1 bg-[#2b241d] accent-[#d4af37]"
                  />
                  <p className="text-[10px] text-[#8c7d6c] mt-1">
                    ※ 白い紙に描いたイラストの背景を自動で透明に切り抜きます
                  </p>
                </div>
              </div>
            )}

            {/* SAVE BUTTON */}
            <div className="pt-2">
              <button
                onClick={handleSaveAsset}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#d4af37] to-[#aa851c] hover:from-[#e5c048] hover:to-[#be982d] text-[#1c160c] font-serif font-bold text-sm tracking-wide flex items-center justify-center gap-2 shadow-xl shadow-black/40 transition-all active:scale-[0.99]"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                マイ・ライブラリに保存してマップに登録
              </button>
            </div>
          </div>
        </div>

        {/* Existing Custom Assets Shelf (Bottom Drawer) */}
        {customAssets.length > 0 && (
          <div className="border-t border-[#3d3224] bg-[#12100e] px-6 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[#baa993]">
                保存済みの自作シンボル ({customAssets.length}件)
              </span>
            </div>
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {customAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="group relative flex-shrink-0 w-16 h-16 rounded-lg border border-[#3d3224] bg-[#1a1713] flex flex-col items-center justify-center p-1 hover:border-[#d4af37] transition-all"
                >
                  <img
                    src={asset.dataUrl}
                    alt={asset.name}
                    className="w-10 h-10 object-contain drop-shadow"
                  />
                  <span className="text-[9px] text-[#9e907d] truncate w-full text-center mt-0.5">
                    {asset.name}
                  </span>
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCustomAsset(asset.id);
                    }}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-900 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                    title="削除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
