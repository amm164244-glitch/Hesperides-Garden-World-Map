import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Sparkles,
  Pencil,
  PaintBucket,
  Eraser,
  Pipette,
  Minus,
  Square,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Check,
  Grid,
  ChevronDown,
  Plus,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Eye,
  FlipHorizontal,
  FolderPlus,
} from 'lucide-react';
import { CustomMapAsset, CustomSymbolCategory } from '../types/symbols';

interface PixelArtStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: CustomSymbolCategory[];
  onAddCategory: (category: CustomSymbolCategory) => void;
  onSaveCustomAsset: (asset: CustomMapAsset) => void;
  onDeleteCustomAsset?: (assetId: string) => void;
  initialAsset?: CustomMapAsset | null;
}

type DrawTool = 'pencil' | 'bucket' | 'eraser' | 'picker' | 'line' | 'rect';

// Curated Palettes for Fantasy Cartography & Retro Pixel Art
const PALETTES = {
  fantasy: {
    name: 'ファンタジーRPG (16色)',
    colors: [
      '#1a1714', '#3d2e24', '#664c38', '#9e7955',
      '#d9ba8f', '#faf3e3', '#942929', '#e04f36',
      '#e59b24', '#f7d048', '#1e4d2b', '#3b8543',
      '#74c25c', '#1b3f6b', '#3577ad', '#7ac4e8',
    ],
  },
  parchment: {
    name: '羊皮紙＆古典インク',
    colors: [
      '#14110d', '#2b2118', '#4a3828', '#73573c',
      '#a68159', '#cca87c', '#e6ceaa', '#f8ebd4',
      '#7a2222', '#b33d25', '#324a35', '#577850',
      '#2d485e', '#597994', '#99732b', '#c79d42',
    ],
  },
  pico8: {
    name: 'PICO-8 (レトロ)',
    colors: [
      '#000000', '#1D2B53', '#7E2553', '#008751',
      '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
      '#FF004D', '#FFA300', '#FFEC27', '#00E436',
      '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
    ],
  },
  gameboy: {
    name: 'ゲームボーイ (4色)',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
};

export const PixelArtStudioModal: React.FC<PixelArtStudioModalProps> = ({
  isOpen,
  onClose,
  categories,
  onAddCategory,
  onSaveCustomAsset,
  onDeleteCustomAsset,
  initialAsset,
}) => {
  // Grid size
  const [gridSize, setGridSize] = useState<number>(initialAsset?.gridSize || 24);
  const [grid, setGrid] = useState<string[][]>(() => {
    if (initialAsset?.gridData && initialAsset.gridData.length > 0) {
      return initialAsset.gridData;
    }
    return Array.from({ length: 24 }, () => Array(24).fill(''));
  });

  // History stack for Undo/Redo
  const [history, setHistory] = useState<string[][][]>([]);
  const [redoStack, setRedoStack] = useState<string[][][]>([]);

  // Active Tool & Color
  const [tool, setTool] = useState<DrawTool>('pencil');
  const [activeColor, setActiveColor] = useState<string>('#942929');
  const [activePaletteKey, setActivePaletteKey] = useState<keyof typeof PALETTES>('fantasy');
  const [mirrorX, setMirrorX] = useState<boolean>(false);
  const [showGridLines, setShowGridLines] = useState<boolean>(true);
  const [previewBg, setPreviewBg] = useState<'transparent' | 'parchment'>('parchment');

  // Metadata
  const [symbolName, setSymbolName] = useState<string>(initialAsset?.name || 'ドット絵シンボル');
  const [selectedCategory, setSelectedCategory] = useState<string>(
    initialAsset?.category || (categories[0]?.id ?? '')
  );

  // In-editor delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);

  // Quick category creation inside modal
  const [isAddingCategory, setIsAddingCategory] = useState<boolean>(false);
  const [newCatName, setNewCatName] = useState<string>('');
  const [newCatIcon, setNewCatIcon] = useState<string>('🚩');
  const [newCatColor, setNewCatColor] = useState<string>('#f59e0b');

  // Mouse drag tracking
  const isDrawingRef = useRef<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lineStartRef = useRef<{ x: number; y: number } | null>(null);
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);

  // Sync state if initialAsset changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setConfirmDelete(false);
      if (initialAsset) {
        setSymbolName(initialAsset.name);
        setSelectedCategory(initialAsset.category);
        const sz = initialAsset.gridSize || 24;
        setGridSize(sz);
        if (initialAsset.gridData) {
          setGrid(initialAsset.gridData);
        } else {
          setGrid(Array.from({ length: sz }, () => Array(sz).fill('')));
        }
      } else {
        setSymbolName('新規ドット絵シンボル');
        setSelectedCategory(categories[0]?.id ?? 'cat_village');
        // Clean blank canvas
        setGridSize(24);
        setGrid(Array.from({ length: 24 }, () => Array(24).fill('')));
      }
      setHistory([]);
      setRedoStack([]);
    }
  }, [isOpen, initialAsset, categories]);

  // Push to history before making modifications
  const pushHistory = useCallback((currentGrid: string[][]) => {
    setHistory((prev) => [...prev.slice(-25), currentGrid.map((r) => [...r])]);
    setRedoStack([]);
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack((r) => [...r, grid.map((row) => [...row])]);
    setHistory((h) => h.slice(0, -1));
    setGrid(prev);
  }, [history, grid]);

  // Redo
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory((h) => [...h, grid.map((row) => [...row])]);
    setRedoStack((r) => r.slice(0, -1));
    setGrid(next);
  }, [redoStack, grid]);

  // Change Grid Size
  const handleChangeGridSize = (newSize: number) => {
    if (newSize === gridSize) return;
    pushHistory(grid);
    const newGrid = Array.from({ length: newSize }, (_, y) =>
      Array.from({ length: newSize }, (_, x) => {
        if (y < grid.length && x < (grid[y]?.length ?? 0)) {
          return grid[y][x];
        }
        return '';
      })
    );
    setGridSize(newSize);
    setGrid(newGrid);
  };

  // 4-Way Flood Fill Algorithm
  const floodFill = (startX: number, startY: number, targetColor: string, fillColor: string) => {
    if (targetColor === fillColor) return;
    const newGrid = grid.map((r) => [...r]);
    const queue: [number, number][] = [[startX, startY]];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const [x, y] = queue.pop()!;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) continue;
      if (newGrid[y][x] !== targetColor) continue;

      newGrid[y][x] = fillColor;

      if (mirrorX) {
        const mx = gridSize - 1 - x;
        newGrid[y][mx] = fillColor;
      }

      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    pushHistory(grid);
    setGrid(newGrid);
  };

  // Bresenham line algorithm
  const getLinePixels = (x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] => {
    const points: { x: number; y: number }[] = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let curX = x0;
    let curY = y0;

    while (true) {
      points.push({ x: curX, y: curY });
      if (curX === x1 && curY === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        curX += sx;
      }
      if (e2 < dx) {
        err += dx;
        curY += sy;
      }
    }
    return points;
  };

  // Pixel Paint Handler
  const paintPixel = (x: number, y: number, color: string) => {
    if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) return;
    setGrid((prev) => {
      if (prev[y][x] === color && (!mirrorX || prev[y][gridSize - 1 - x] === color)) {
        return prev;
      }
      const next = prev.map((row) => [...row]);
      next[y][x] = color;
      if (mirrorX) {
        next[y][gridSize - 1 - x] = color;
      }
      return next;
    });
  };

  // Shift/Nudge Grid
  const handleShift = (dx: number, dy: number) => {
    pushHistory(grid);
    const next = Array.from({ length: gridSize }, (_, y) =>
      Array.from({ length: gridSize }, (_, x) => {
        const srcX = x - dx;
        const srcY = y - dy;
        if (srcX >= 0 && srcX < gridSize && srcY >= 0 && srcY < gridSize) {
          return grid[srcY][srcX];
        }
        return '';
      })
    );
    setGrid(next);
  };

  // Clear Grid
  const handleClear = () => {
    pushHistory(grid);
    setGrid(Array.from({ length: gridSize }, () => Array(gridSize).fill('')));
  };

  // Canvas Mouse / Pointer Event Handling
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const cellW = canvas.width / gridSize;
    const cellH = canvas.height / gridSize;
    const x = Math.floor(px / cellW);
    const y = Math.floor(py / cellH);
    if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
      return { x, y };
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    if (!coords) return;
    const { x, y } = coords;

    // Right click acts as eraser
    const isRightClick = e.button === 2;
    const drawColor = isRightClick ? '' : tool === 'eraser' ? '' : activeColor;

    if (tool === 'picker') {
      const picked = grid[y][x];
      if (picked) {
        setActiveColor(picked);
        setTool('pencil');
      }
      return;
    }

    if (tool === 'bucket') {
      const targetColor = grid[y][x];
      floodFill(x, y, targetColor, drawColor);
      return;
    }

    if (tool === 'line' || tool === 'rect') {
      lineStartRef.current = { x, y };
      isDrawingRef.current = true;
      pushHistory(grid);
      return;
    }

    pushHistory(grid);
    isDrawingRef.current = true;
    paintPixel(x, y, drawColor);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    setHoverCoord(coords);
    if (!coords || !isDrawingRef.current) return;
    const { x, y } = coords;

    if (tool === 'pencil' || tool === 'eraser') {
      const isRightClick = e.buttons === 2;
      const drawColor = isRightClick ? '' : tool === 'eraser' ? '' : activeColor;
      paintPixel(x, y, drawColor);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if ((tool === 'line' || tool === 'rect') && lineStartRef.current) {
      const coords = getCanvasCoords(e) || hoverCoord;
      if (coords) {
        const start = lineStartRef.current;
        const end = coords;
        const color = activeColor;
        setGrid((prev) => {
          const next = prev.map((r) => [...r]);
          if (tool === 'line') {
            const points = getLinePixels(start.x, start.y, end.x, end.y);
            for (const pt of points) {
              if (pt.x >= 0 && pt.x < gridSize && pt.y >= 0 && pt.y < gridSize) {
                next[pt.y][pt.x] = color;
                if (mirrorX) next[pt.y][gridSize - 1 - pt.x] = color;
              }
            }
          } else if (tool === 'rect') {
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            for (let py = minY; py <= maxY; py++) {
              for (let px = minX; px <= maxX; px++) {
                if (py === minY || py === maxY || px === minX || px === maxX) {
                  next[py][px] = color;
                  if (mirrorX) next[py][gridSize - 1 - px] = color;
                }
              }
            }
          }
          return next;
        });
      }
      lineStartRef.current = null;
    }
  };

  // Draw Grid Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cellW = canvas.width / gridSize;
    const cellH = canvas.height / gridSize;

    // Draw checkerboard transparent background
    const checkSize = 12;
    for (let y = 0; y < canvas.height; y += checkSize) {
      for (let x = 0; x < canvas.width; x += checkSize) {
        ctx.fillStyle = ((x / checkSize + y / checkSize) % 2 === 0) ? '#1f1b17' : '#2a241d';
        ctx.fillRect(x, y, checkSize, checkSize);
      }
    }

    // Draw pixels
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const color = grid[y]?.[x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
        }
      }
    }

    // Mirror center guide line
    if (mirrorX) {
      ctx.strokeStyle = 'rgba(235, 160, 40, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Grid lines
    if (showGridLines) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= gridSize; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellW, 0);
        ctx.lineTo(i * cellW, canvas.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i * cellH);
        ctx.lineTo(canvas.width, i * cellH);
        ctx.stroke();
      }
    }

    // Hover box
    if (hoverCoord) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        hoverCoord.x * cellW,
        hoverCoord.y * cellH,
        cellW,
        cellH
      );
    }
  }, [grid, gridSize, showGridLines, mirrorX, hoverCoord]);

  // Export to Crisp Transparent PNG Data URL
  const generatePngDataUrl = (): string => {
    const offscreen = document.createElement('canvas');
    // Scale up for high-dpi crisply rendered map symbols
    const scale = 4; // 16x16 -> 64x64, 24x24 -> 96x96
    offscreen.width = gridSize * scale;
    offscreen.height = gridSize * scale;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return '';

    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const color = grid[y]?.[x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
    return offscreen.toDataURL('image/png');
  };

  // Save Custom Asset
  const handleSave = () => {
    const dataUrl = generatePngDataUrl();
    const assetId = initialAsset ? initialAsset.id : `pixel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const asset: CustomMapAsset = {
      id: assetId,
      name: symbolName.trim() || '無題のドット絵',
      category: selectedCategory,
      dataUrl,
      width: gridSize * 4,
      height: gridSize * 4,
      originX: 0.5,
      originY: 0.88,
      createdAt: initialAsset ? initialAsset.createdAt : Date.now(),
      isPixelArt: true,
      gridSize,
      gridData: grid,
    };

    onSaveCustomAsset(asset);
    onClose();
  };

  // Download standalone PNG
  const handleDownload = () => {
    const dataUrl = generatePngDataUrl();
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${symbolName.trim() || 'pixel_symbol'}.png`;
    link.click();
  };

  // Add new custom category inline
  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    const newId = `cat_${Date.now()}`;
    const newCat: CustomSymbolCategory = {
      id: newId,
      name: newCatName.trim(),
      icon: newCatIcon.trim() || '🚩',
      color: newCatColor,
      createdAt: Date.now(),
    };
    onAddCategory(newCat);
    setSelectedCategory(newId);
    setNewCatName('');
    setIsAddingCategory(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#14120f] border border-[#3d3326] rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col text-[#e8dfcf] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-3.5 border-b border-[#2d261e] bg-[#1a1713] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-stone-950 shadow-md">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base text-[#f5ebd9] flex items-center gap-2">
                ドット絵・ピクセルアート スタジオ
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                  Pixel Art Creator
                </span>
              </h2>
              <p className="text-xs text-[#9e907d]">
                レトロRPG風ドット絵でオリジナルシンボルを作成し、自在にカテゴリ分類して地図に配置できます
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9e907d] hover:text-[#f5ebd9] hover:bg-[#2b241d] transition-colors"
            title="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Tools, Palettes & History (Cols: 4) */}
          <div className="lg:col-span-4 space-y-4">
            {/* Tool Selection */}
            <div className="bg-[#191612] p-3 rounded-xl border border-[#2d261e] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#c4b59d]">描画ツール</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleUndo}
                    disabled={history.length === 0}
                    className="p-1 rounded text-stone-400 hover:text-amber-300 disabled:opacity-30 disabled:hover:text-stone-400"
                    title="元に戻す (Undo)"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    className="p-1 rounded text-stone-400 hover:text-amber-300 disabled:opacity-30 disabled:hover:text-stone-400"
                    title="やり直す (Redo)"
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'pencil' as DrawTool, label: 'ペン', icon: <Pencil className="w-3.5 h-3.5" /> },
                  { id: 'bucket' as DrawTool, label: 'バケツ', icon: <PaintBucket className="w-3.5 h-3.5" /> },
                  { id: 'eraser' as DrawTool, label: '消しゴム', icon: <Eraser className="w-3.5 h-3.5" /> },
                  { id: 'picker' as DrawTool, label: 'スポイト', icon: <Pipette className="w-3.5 h-3.5" /> },
                  { id: 'line' as DrawTool, label: '直線', icon: <Minus className="w-3.5 h-3.5" /> },
                  { id: 'rect' as DrawTool, label: '四角', icon: <Square className="w-3.5 h-3.5" /> },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTool(t.id)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                      tool === t.id
                        ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                        : 'bg-[#241f19] text-[#c4b59d] hover:bg-[#2e2720] hover:text-[#f5ebd9]'
                    }`}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              {/* Utility Toggles */}
              <div className="flex items-center justify-between pt-1 border-t border-[#2d261e] text-xs">
                <button
                  onClick={() => setMirrorX(!mirrorX)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                    mirrorX
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                      : 'text-stone-400 hover:text-stone-200'
                  }`}
                  title="左右対称描画モード（城や塔、木を描く際に便利）"
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                  <span>左右対称</span>
                </button>

                <button
                  onClick={() => setShowGridLines(!showGridLines)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                    showGridLines ? 'text-amber-400' : 'text-stone-500'
                  }`}
                  title="グリッド線の表示/非表示"
                >
                  <Grid className="w-3.5 h-3.5" />
                  <span>枠線</span>
                </button>

                <button
                  onClick={handleClear}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-red-400 hover:bg-red-950/40 hover:text-red-300 transition-colors"
                  title="キャンバスを全消去"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>クリア</span>
                </button>
              </div>
            </div>

            {/* Grid Size & Nudge */}
            <div className="bg-[#191612] p-3 rounded-xl border border-[#2d261e] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#c4b59d]">キャンバス解像度</span>
                <span className="text-xs font-mono text-amber-400 font-bold">{gridSize} × {gridSize} px</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[16, 24, 32, 48].map((size) => (
                  <button
                    key={size}
                    onClick={() => handleChangeGridSize(size)}
                    className={`py-1 rounded text-xs font-mono font-medium transition-all ${
                      gridSize === size
                        ? 'bg-amber-500 text-stone-950 font-bold'
                        : 'bg-[#241f19] text-[#c4b59d] hover:bg-[#2e2720]'
                    }`}
                  >
                    {size}×{size}
                  </button>
                ))}
              </div>

              {/* Nudge Arrows */}
              <div className="flex items-center justify-between pt-1 border-t border-[#2d261e] text-[11px] text-[#9e907d]">
                <span>1マス移動:</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleShift(-1, 0)}
                    className="p-1 rounded bg-[#241f19] hover:bg-[#312a22] text-stone-300"
                    title="左へ1マスシフト"
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleShift(0, -1)}
                    className="p-1 rounded bg-[#241f19] hover:bg-[#312a22] text-stone-300"
                    title="上へ1マスシフト"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleShift(0, 1)}
                    className="p-1 rounded bg-[#241f19] hover:bg-[#312a22] text-stone-300"
                    title="下へ1マスシフト"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleShift(1, 0)}
                    className="p-1 rounded bg-[#241f19] hover:bg-[#312a22] text-stone-300"
                    title="右へ1マスシフト"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Color Palette */}
            <div className="bg-[#191612] p-3 rounded-xl border border-[#2d261e] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#c4b59d]">カラーパレット</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded border border-[#4a3f31] shadow-inner"
                    style={{ backgroundColor: activeColor }}
                    title={`現在の描画色: ${activeColor}`}
                  />
                  <input
                    type="color"
                    value={activeColor}
                    onChange={(e) => setActiveColor(e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                    title="カスタムカラー選択"
                  />
                </div>
              </div>

              {/* Palette Preset Tabs */}
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                {(Object.keys(PALETTES) as (keyof typeof PALETTES)[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setActivePaletteKey(key)}
                    className={`py-1 px-1.5 rounded truncate text-left transition-colors ${
                      activePaletteKey === key
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                        : 'bg-[#241f19] text-[#9e907d] hover:text-[#e8dfcf]'
                    }`}
                  >
                    {PALETTES[key].name}
                  </button>
                ))}
              </div>

              {/* Color Swatches Grid */}
              <div className="grid grid-cols-8 gap-1 p-1 bg-[#100e0c] rounded-lg border border-[#2a231b]">
                {PALETTES[activePaletteKey].colors.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setActiveColor(c);
                      if (tool === 'eraser') setTool('pencil');
                    }}
                    className={`w-full aspect-square rounded-sm border transition-transform hover:scale-110 ${
                      activeColor === c ? 'border-white scale-110 shadow-md ring-1 ring-amber-400' : 'border-black/40'
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>

              {/* Quick Transparent / Eraser Swatch */}
              <button
                onClick={() => setTool('eraser')}
                className={`w-full py-1 rounded text-xs flex items-center justify-center gap-1.5 border border-dashed transition-colors ${
                  tool === 'eraser'
                    ? 'border-red-500 bg-red-950/30 text-red-300 font-bold'
                    : 'border-[#3d3326] text-[#9e907d] hover:text-[#e8dfcf]'
                }`}
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>透明 / 消しゴム (右クリックでも消去可)</span>
              </button>
            </div>
          </div>

          {/* Center Column: Interactive Pixel Canvas (Cols: 5) */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center">
            <div className="relative p-2 rounded-2xl bg-[#0d0c0a] border-2 border-[#3d3326] shadow-2xl flex flex-col items-center">
              <canvas
                ref={canvasRef}
                width={400}
                height={400}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onContextMenu={(e) => e.preventDefault()}
                className="w-[320px] h-[320px] sm:w-[380px] sm:h-[380px] rounded-lg cursor-crosshair touch-none select-none shadow-inner"
              />

              {/* Coordinate & Tool info bar */}
              <div className="w-full mt-2 px-2 flex items-center justify-between text-[11px] text-[#9e907d] font-mono">
                <span>
                  {hoverCoord ? `X: ${hoverCoord.x}, Y: ${hoverCoord.y}` : `解像度: ${gridSize}×${gridSize}`}
                </span>
                <span className="capitalize">
                  ツール: {tool === 'pencil' ? 'ペン' : tool === 'bucket' ? 'バケツ' : tool === 'eraser' ? '消しゴム' : tool === 'line' ? '直線' : tool === 'rect' ? '四角' : 'スポイト'}
                  {mirrorX && ' (対称)'}
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Meta, Category, Previews & Templates (Cols: 3) */}
          <div className="lg:col-span-3 space-y-4">
            {/* Meta & Category Info */}
            <div className="bg-[#191612] p-3 rounded-xl border border-[#2d261e] space-y-3">
              <div>
                <label className="text-xs font-bold text-[#c4b59d] block mb-1">
                  シンボル名称
                </label>
                <input
                  type="text"
                  value={symbolName}
                  onChange={(e) => setSymbolName(e.target.value)}
                  placeholder="例: 古代の魔導塔"
                  className="w-full bg-[#100e0c] border border-[#3d3326] rounded-lg px-2.5 py-1.5 text-xs text-[#f5ebd9] focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Category Selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-[#c4b59d]">
                    所属カテゴリ
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsAddingCategory(!isAddingCategory)}
                    className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" />
                    <span>新規カテゴリ</span>
                  </button>
                </div>

                {isAddingCategory ? (
                  <form onSubmit={handleCreateCategory} className="p-2 bg-[#100e0c] rounded-lg border border-amber-500/30 space-y-2 mb-2 animate-in fade-in">
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newCatIcon}
                        onChange={(e) => setNewCatIcon(e.target.value)}
                        className="w-8 text-center bg-[#1a1713] border border-[#3d3326] rounded text-xs py-1"
                        placeholder="🛖"
                        title="絵文字アイコン"
                      />
                      <input
                        type="text"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        placeholder="カテゴリ名"
                        className="flex-1 bg-[#1a1713] border border-[#3d3326] rounded text-xs px-2 py-1 text-[#f5ebd9]"
                      />
                      <input
                        type="color"
                        value={newCatColor}
                        onChange={(e) => setNewCatColor(e.target.value)}
                        className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                        title="バッジ色"
                      />
                    </div>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setIsAddingCategory(false)}
                        className="px-2 py-0.5 rounded text-[11px] text-stone-400 hover:bg-[#25201a]"
                      >
                        キャンセル
                      </button>
                      <button
                        type="submit"
                        disabled={!newCatName.trim()}
                        className="px-2.5 py-0.5 rounded text-[11px] bg-amber-500 text-stone-950 font-bold disabled:opacity-40"
                      >
                        作成
                      </button>
                    </div>
                  </form>
                ) : (
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full bg-[#100e0c] border border-[#3d3326] rounded-lg px-2.5 py-1.5 text-xs text-[#f5ebd9] focus:outline-none focus:border-amber-500"
                  >
                    <option value="">未分類 (指定なし)</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.icon} {cat.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Live Map Preview */}
            <div className="bg-[#191612] p-3 rounded-xl border border-[#2d261e] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#c4b59d]">マップ配置プレビュー</span>
                <button
                  onClick={() => setPreviewBg(previewBg === 'parchment' ? 'transparent' : 'parchment')}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[#241f19] text-[#baa993] hover:text-[#f5ebd9]"
                >
                  {previewBg === 'parchment' ? '📜 羊皮紙背景' : '🏁 透過背景'}
                </button>
              </div>

              <div
                className={`w-full h-24 rounded-lg border border-[#3d3326] flex items-center justify-center gap-4 p-2 relative overflow-hidden ${
                  previewBg === 'parchment'
                    ? 'bg-[#e4d4b8] shadow-inner'
                    : 'bg-[#1a1713]'
                }`}
              >
                {/* 1x Preview */}
                <div className="flex flex-col items-center">
                  <div
                    className="overflow-hidden"
                    style={{
                      width: gridSize,
                      height: gridSize,
                      backgroundImage: `url(${generatePngDataUrl()})`,
                      backgroundSize: 'contain',
                      backgroundRepeat: 'no-repeat',
                      imageRendering: 'pixelated',
                    }}
                  />
                  <span className={`text-[9px] mt-1 font-mono ${previewBg === 'parchment' ? 'text-stone-700' : 'text-stone-400'}`}>1x</span>
                </div>

                {/* 2x Preview */}
                <div className="flex flex-col items-center">
                  <div
                    className="overflow-hidden"
                    style={{
                      width: gridSize * 1.5,
                      height: gridSize * 1.5,
                      backgroundImage: `url(${generatePngDataUrl()})`,
                      backgroundSize: 'contain',
                      backgroundRepeat: 'no-repeat',
                      imageRendering: 'pixelated',
                    }}
                  />
                  <span className={`text-[9px] mt-1 font-mono ${previewBg === 'parchment' ? 'text-stone-700' : 'text-stone-400'}`}>1.5x</span>
                </div>

                {/* 3x Preview */}
                <div className="flex flex-col items-center">
                  <div
                    className="overflow-hidden"
                    style={{
                      width: gridSize * 2.2,
                      height: gridSize * 2.2,
                      backgroundImage: `url(${generatePngDataUrl()})`,
                      backgroundSize: 'contain',
                      backgroundRepeat: 'no-repeat',
                      imageRendering: 'pixelated',
                    }}
                  />
                  <span className={`text-[9px] mt-1 font-mono ${previewBg === 'parchment' ? 'text-stone-700' : 'text-stone-400'}`}>2.2x</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-[#2d261e] bg-[#1a1713] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 rounded-lg bg-[#241f19] hover:bg-[#2e2720] text-xs font-medium text-[#c4b59d] hover:text-[#f5ebd9] flex items-center gap-1.5 transition-colors border border-[#3d3326]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PNG画像書き出し</span>
            </button>

            {initialAsset && onDeleteCustomAsset && (
              confirmDelete ? (
                <div className="flex items-center gap-1.5 bg-red-950/80 border border-red-700/60 rounded-lg px-2.5 py-1">
                  <span className="text-[11px] text-red-200 font-bold">本当に削除しますか？</span>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteCustomAsset(initialAsset.id);
                      onClose();
                    }}
                    className="px-2.5 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold cursor-pointer transition-colors"
                  >
                    削除
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-2.5 py-0.5 rounded bg-stone-700 hover:bg-stone-600 text-stone-200 text-[11px] cursor-pointer transition-colors"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-1.5 rounded-lg bg-red-950/30 hover:bg-red-900/50 text-xs font-medium text-red-400 hover:text-red-300 flex items-center gap-1.5 transition-colors border border-red-900/40 cursor-pointer"
                  title="このシンボルを削除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>このシンボルを削除</span>
                </button>
              )
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-[#241f19] hover:bg-[#2e2720] text-xs font-medium text-[#baa993] hover:text-[#f5ebd9] transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-serif font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-900/30 transition-all active:scale-[0.98]"
            >
              <Check className="w-4 h-4" />
              <span>シンボルを保存して配置可能にする</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
