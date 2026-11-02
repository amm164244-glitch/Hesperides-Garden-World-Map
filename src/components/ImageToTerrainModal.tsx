import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Upload,
  Crop,
  Check,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  AlertTriangle,
  Move,
  ChevronRight,
  ArrowLeft,
  FileImage,
  Sparkles,
  Pipette,
  Sliders,
  Eye,
  Layers,
  RefreshCw,
  Trash2,
  Waves,
  Mountain,
} from 'lucide-react';
import {
  ColorSample,
  SegmentationOptions,
  SegmentationResult,
  SegmentationStats,
  rgbToLab,
  segmentLandSea,
} from '../utils/imageTerrain/segmentLandSea';
import {
  SegmentationWorkerRequest,
  SegmentationWorkerResponse,
} from '../workers/segmentationWorker';

export type TerrainResolution = '1024x512' | '2048x1024';

export interface CroppedTerrainResult {
  imageData: ImageData;
  resolution: TerrainResolution;
  width: number;
  height: number;
  dataUrl?: string;
  mask?: Uint8Array;
  boundaryMask?: Uint8Array;
  stats?: SegmentationStats;
}

export interface ImageToTerrainModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCropped?: (result: CroppedTerrainResult) => void;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragMode =
  | 'none'
  | 'pan'
  | 'move_crop'
  | 'resize_nw'
  | 'resize_ne'
  | 'resize_sw'
  | 'resize_se'
  | 'resize_n'
  | 'resize_s'
  | 'resize_w'
  | 'resize_e';

export const ImageToTerrainModal: React.FC<ImageToTerrainModalProps> = ({
  isOpen,
  onClose,
  onCropped,
}) => {
  // Steps: 1: 画像を読み込む, 2: 切り抜き, 3: 陸海の自動判定
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Source image data (Step 1 & 2)
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [originalDimensions, setOriginalDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [scaledDimensions, setScaledDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  // Step 2 Crop settings
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 200, height: 100 });
  const [lockAspectRatio, setLockAspectRatio] = useState<boolean>(true);
  const [resolution, setResolution] = useState<TerrainResolution>('1024x512');

  // Viewport for Step 2 canvas
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);

  // Drag interaction state for Step 2
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startCrop: CropRect;
    startViewport: { x: number; y: number };
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    startCrop: { x: 0, y: 0, width: 0, height: 0 },
    startViewport: { x: 0, y: 0 },
  });

  // Step 3 Cropped result & Segmentation states
  const [croppedResult, setCroppedResult] = useState<CroppedTerrainResult | null>(null);
  const [segmentationMask, setSegmentationMask] = useState<Uint8Array | null>(null);
  const [boundaryMask, setBoundaryMask] = useState<Uint8Array | null>(null);
  const [segmentationStats, setSegmentationStats] = useState<SegmentationStats | null>(null);
  const [isSegmenting, setIsSegmenting] = useState<boolean>(false);
  const [segmentProgress, setSegmentProgress] = useState<{ step: string; percent: number }>({
    step: '',
    percent: 0,
  });

  // Step 3 Parameters
  const [medianRadius, setMedianRadius] = useState<number>(2);
  const [tolerance, setTolerance] = useState<number>(18);
  const [minIslandAreaRatio, setMinIslandAreaRatio] = useState<number>(0.002); // 0.20%
  const [smoothingIterations, setSmoothingIterations] = useState<number>(1);
  const [marginPx, setMarginPx] = useState<number>(6);

  // Eyedropper & Samples
  const [seaSamples, setSeaSamples] = useState<ColorSample[]>([]);
  const [landSamples, setLandSamples] = useState<ColorSample[]>([]);
  const [activeStep3Tool, setActiveStep3Tool] = useState<'pan' | 'dropper_sea' | 'dropper_land'>('pan');

  // Step 3 Preview mode
  const [previewMode, setPreviewMode] = useState<'overlay' | 'mask' | 'original'>('overlay');

  // Step 3 Viewport & Canvas
  const [step3Viewport, setStep3Viewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const [step3HoverInfo, setStep3HoverInfo] = useState<{
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    lab: { L: number; a: number; b: number };
    isLand?: boolean;
  } | null>(null);

  const step3DragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startVp: { x: number; y: number };
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    startVp: { x: 0, y: 0 },
  });

  // Worker reference
  const segWorkerRef = useRef<Worker | null>(null);

  // Cached render canvases for Step 3
  const maskCanvasCache = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasCache = useRef<HTMLCanvasElement | null>(null);
  const originalCanvasCache = useRef<HTMLCanvasElement | null>(null);

  // Canvas elements
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const step3CanvasRef = useRef<HTMLCanvasElement | null>(null);
  const step3ContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize Worker
  useEffect(() => {
    try {
      segWorkerRef.current = new Worker(
        new URL('../workers/segmentationWorker.ts', import.meta.url),
        { type: 'module' }
      );

      segWorkerRef.current.onmessage = (e: MessageEvent<SegmentationWorkerResponse>) => {
        const data = e.data;
        if (data.type === 'progress') {
          setSegmentProgress({ step: data.step, percent: data.percent });
        } else if (data.type === 'complete') {
          setSegmentationMask(data.result.mask);
          setBoundaryMask(data.result.boundaryMask);
          setSegmentationStats(data.result.stats);
          setIsSegmenting(false);
        } else if (data.type === 'error') {
          console.error('Segmentation worker error:', data.error);
          setIsSegmenting(false);
        }
      };
    } catch (err) {
      console.warn('Worker initialization fallback to main thread:', err);
    }

    return () => {
      segWorkerRef.current?.terminate();
      segWorkerRef.current = null;
    };
  }, []);

  // Keyboard space key listener for panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement)) {
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Process and load input image
  const processAndLoadImage = useCallback((img: HTMLImageElement, name: string) => {
    setFileName(name);
    setOriginalDimensions({ width: img.naturalWidth, height: img.naturalHeight });

    const maxDim = 4096;
    let targetW = img.naturalWidth;
    let targetH = img.naturalHeight;

    if (targetW > maxDim || targetH > maxDim) {
      const scale = maxDim / Math.max(targetW, targetH);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }
    setScaledDimensions({ width: targetW, height: targetH });

    const offscreen = document.createElement('canvas');
    offscreen.width = targetW;
    offscreen.height = targetH;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, targetW, targetH);
    setSourceCanvas(offscreen);

    // Initial 2:1 crop rectangle in center
    const imgRatio = targetW / targetH;
    let initCropW: number;
    let initCropH: number;

    if (imgRatio >= 2) {
      initCropH = targetH;
      initCropW = targetH * 2;
    } else {
      initCropW = targetW;
      initCropH = targetW / 2;
    }

    const initCropX = (targetW - initCropW) / 2;
    const initCropY = (targetH - initCropH) / 2;

    setCrop({
      x: Math.round(initCropX),
      y: Math.round(initCropY),
      width: Math.round(initCropW),
      height: Math.round(initCropH),
    });
    setLockAspectRatio(true);

    const containerW = containerRef.current?.clientWidth || 800;
    const containerH = containerRef.current?.clientHeight || 500;
    const fitZoom = Math.min((containerW - 60) / targetW, (containerH - 60) / targetH, 1.0);
    setViewport({
      x: (containerW - targetW * fitZoom) / 2,
      y: (containerH - targetH * fitZoom) / 2,
      zoom: Math.max(0.05, fitZoom),
    });

    setCurrentStep(2);
  }, []);

  // Handle file upload
  const handleFile = (file: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        processAndLoadImage(img, file.name);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Quick sample image generator for testing
  const handleLoadSample = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Antique parchment sea color
    ctx.fillStyle = '#e8dec8';
    ctx.fillRect(0, 0, 1600, 1000);

    // Fine grid lines on antique map (to test median noise rejection)
    ctx.strokeStyle = '#d4c7af';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < 1600; gx += 80) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, 1000);
      ctx.stroke();
    }
    for (let gy = 0; gy < 1000; gy += 80) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(1600, gy);
      ctx.stroke();
    }

    // Text labels on sea (to test text noise filtering)
    ctx.fillStyle = '#9e8c6c';
    ctx.font = 'italic 16px serif';
    ctx.fillText('OCEANUS ATLANTICUS', 650, 200);
    ctx.fillText('MARE SEPTENTRIONALE', 150, 750);

    // Continent 1 (Earth green / brown parchment)
    ctx.fillStyle = '#5c6b48';
    ctx.beginPath();
    ctx.ellipse(450, 420, 260, 200, 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Continent 2 (Mountainous brown)
    ctx.fillStyle = '#7a6348';
    ctx.beginPath();
    ctx.ellipse(1120, 500, 310, 220, -0.15, 0, Math.PI * 2);
    ctx.fill();

    // Islands
    ctx.fillStyle = '#4f5e3e';
    for (let i = 0; i < 15; i++) {
      const ix = 200 + Math.sin(i * 1.7) * 600 + 400;
      const iy = 180 + Math.cos(i * 2.3) * 300 + 200;
      ctx.beginPath();
      ctx.arc(ix, iy, 12 + (i % 4) * 6, 0, Math.PI * 2);
      ctx.fill();
    }

    const img = new Image();
    img.onload = () => {
      processAndLoadImage(img, 'antique_fantasy_sample.png');
    };
    img.src = canvas.toDataURL('image/png');
  };

  // Center & Fit view to container (Step 2)
  const handleFitView = useCallback(() => {
    if (!sourceCanvas || !containerRef.current) return;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    const fitZoom = Math.min(
      (containerW - 80) / sourceCanvas.width,
      (containerH - 80) / sourceCanvas.height,
      1.0
    );
    setViewport({
      x: (containerW - sourceCanvas.width * fitZoom) / 2,
      y: (containerH - sourceCanvas.height * fitZoom) / 2,
      zoom: Math.max(0.05, fitZoom),
    });
  }, [sourceCanvas]);

  // Center & Fit view for Step 3
  const handleFitStep3View = useCallback(() => {
    if (!croppedResult || !step3ContainerRef.current) return;
    const containerW = step3ContainerRef.current.clientWidth;
    const containerH = step3ContainerRef.current.clientHeight;
    const fitZoom = Math.min(
      (containerW - 60) / croppedResult.width,
      (containerH - 60) / croppedResult.height,
      1.0
    );
    setStep3Viewport({
      x: (containerW - croppedResult.width * fitZoom) / 2,
      y: (containerH - croppedResult.height * fitZoom) / 2,
      zoom: Math.max(0.05, fitZoom),
    });
  }, [croppedResult]);

  // Reset crop to centered 2:1
  const handleResetCrop2to1 = () => {
    if (!sourceCanvas) return;
    const targetW = sourceCanvas.width;
    const targetH = sourceCanvas.height;
    const imgRatio = targetW / targetH;
    let initCropW: number;
    let initCropH: number;
    if (imgRatio >= 2) {
      initCropH = targetH;
      initCropW = targetH * 2;
    } else {
      initCropW = targetW;
      initCropH = targetW / 2;
    }
    const initCropX = (targetW - initCropW) / 2;
    const initCropY = (targetH - initCropH) / 2;
    setCrop({
      x: Math.round(initCropX),
      y: Math.round(initCropY),
      width: Math.round(initCropW),
      height: Math.round(initCropH),
    });
    setLockAspectRatio(true);
  };

  // Render crop canvas overlay (Step 2)
  useEffect(() => {
    if (currentStep !== 2 || !sourceCanvas || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    canvas.width = width;
    canvas.height = height;

    // Clear background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Draw background subtle grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const gridSize = 32 * viewport.zoom;
    if (gridSize > 8) {
      const offsetX = ((viewport.x % gridSize) + gridSize) % gridSize;
      const offsetY = ((viewport.y % gridSize) + gridSize) % gridSize;
      ctx.beginPath();
      for (let gx = offsetX; gx < width; gx += gridSize) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
      }
      for (let gy = offsetY; gy < height; gy += gridSize) {
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
      }
      ctx.stroke();
    }

    // Draw source image
    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 24 / viewport.zoom;
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.restore();

    // Calculate crop rectangle on screen
    const screenCropX = viewport.x + crop.x * viewport.zoom;
    const screenCropY = viewport.y + crop.y * viewport.zoom;
    const screenCropW = crop.width * viewport.zoom;
    const screenCropH = crop.height * viewport.zoom;

    // Darken areas outside crop box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, width, Math.max(0, screenCropY));
    ctx.fillRect(0, Math.max(0, screenCropY + screenCropH), width, Math.max(0, height - (screenCropY + screenCropH)));
    ctx.fillRect(0, Math.max(0, screenCropY), Math.max(0, screenCropX), screenCropH);
    ctx.fillRect(
      Math.max(0, screenCropX + screenCropW),
      Math.max(0, screenCropY),
      Math.max(0, width - (screenCropX + screenCropW)),
      screenCropH
    );

    // Crop border
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(screenCropX, screenCropY, screenCropW, screenCropH);

    // Inner rule of thirds grid
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(screenCropX + screenCropW / 3, screenCropY);
    ctx.lineTo(screenCropX + screenCropW / 3, screenCropY + screenCropH);
    ctx.moveTo(screenCropX + (screenCropW * 2) / 3, screenCropY);
    ctx.lineTo(screenCropX + (screenCropW * 2) / 3, screenCropY + screenCropH);
    ctx.moveTo(screenCropX, screenCropY + screenCropH / 3);
    ctx.lineTo(screenCropX + screenCropW, screenCropY + screenCropH / 3);
    ctx.moveTo(screenCropX, screenCropY + (screenCropH * 2) / 3);
    ctx.lineTo(screenCropX + screenCropW, screenCropY + (screenCropH * 2) / 3);
    ctx.stroke();
    ctx.setLineDash([]);

    // Corner and edge handles
    const handleRadius = 5;
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;

    const handles = [
      { x: screenCropX, y: screenCropY },
      { x: screenCropX + screenCropW, y: screenCropY },
      { x: screenCropX, y: screenCropY + screenCropH },
      { x: screenCropX + screenCropW, y: screenCropY + screenCropH },
      { x: screenCropX + screenCropW / 2, y: screenCropY },
      { x: screenCropX + screenCropW / 2, y: screenCropY + screenCropH },
      { x: screenCropX, y: screenCropY + screenCropH / 2 },
      { x: screenCropX + screenCropW, y: screenCropY + screenCropH / 2 },
    ];

    for (const h of handles) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, handleRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [currentStep, sourceCanvas, crop, viewport]);

  // Step 2 Handle Detection
  const getHitHandle = (mx: number, my: number): DragMode => {
    const screenCropX = viewport.x + crop.x * viewport.zoom;
    const screenCropY = viewport.y + crop.y * viewport.zoom;
    const screenCropW = crop.width * viewport.zoom;
    const screenCropH = crop.height * viewport.zoom;
    const threshold = 12;

    if (Math.hypot(mx - screenCropX, my - screenCropY) <= threshold) return 'resize_nw';
    if (Math.hypot(mx - (screenCropX + screenCropW), my - screenCropY) <= threshold) return 'resize_ne';
    if (Math.hypot(mx - screenCropX, my - (screenCropY + screenCropH)) <= threshold) return 'resize_sw';
    if (Math.hypot(mx - (screenCropX + screenCropW), my - (screenCropY + screenCropH)) <= threshold) return 'resize_se';

    if (Math.abs(my - screenCropY) <= threshold && mx >= screenCropX && mx <= screenCropX + screenCropW) return 'resize_n';
    if (Math.abs(my - (screenCropY + screenCropH)) <= threshold && mx >= screenCropX && mx <= screenCropX + screenCropW) return 'resize_s';
    if (Math.abs(mx - screenCropX) <= threshold && my >= screenCropY && my <= screenCropY + screenCropH) return 'resize_w';
    if (Math.abs(mx - (screenCropX + screenCropW)) <= threshold && my >= screenCropY && my <= screenCropY + screenCropH) return 'resize_e';

    if (mx >= screenCropX && mx <= screenCropX + screenCropW && my >= screenCropY && my <= screenCropY + screenCropH) {
      return 'move_crop';
    }

    return 'pan';
  };

  // Step 2 Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isSpacePressed || e.button === 1) {
      dragRef.current = {
        mode: 'pan',
        startX: mx,
        startY: my,
        startCrop: { ...crop },
        startViewport: { ...viewport },
      };
      return;
    }

    if (e.button !== 0) return;

    const hit = getHitHandle(mx, my);
    dragRef.current = {
      mode: hit,
      startX: mx,
      startY: my,
      startCrop: { ...crop },
      startViewport: { ...viewport },
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!containerRef.current || !sourceCanvas) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const { mode, startX, startY, startCrop, startViewport } = dragRef.current;

    if (mode === 'none') {
      const hit = getHitHandle(mx, my);
      let cursor = 'default';
      if (isSpacePressed) cursor = 'grab';
      else if (hit === 'move_crop') cursor = 'move';
      else if (hit === 'resize_nw' || hit === 'resize_se') cursor = 'nwse-resize';
      else if (hit === 'resize_ne' || hit === 'resize_sw') cursor = 'nesw-resize';
      else if (hit === 'resize_n' || hit === 'resize_s') cursor = 'ns-resize';
      else if (hit === 'resize_w' || hit === 'resize_e') cursor = 'ew-resize';
      else cursor = 'grab';
      containerRef.current.style.cursor = cursor;
      return;
    }

    if (mode === 'pan') {
      const dx = mx - startX;
      const dy = my - startY;
      setViewport({
        x: startViewport.x + dx,
        y: startViewport.y + dy,
        zoom: viewport.zoom,
      });
      return;
    }

    if (mode === 'move_crop') {
      const dxImg = (mx - startX) / viewport.zoom;
      const dyImg = (my - startY) / viewport.zoom;
      const nextX = Math.max(0, Math.min(sourceCanvas.width - startCrop.width, startCrop.x + dxImg));
      const nextY = Math.max(0, Math.min(sourceCanvas.height - startCrop.height, startCrop.y + dyImg));
      setCrop({
        ...startCrop,
        x: Math.round(nextX),
        y: Math.round(nextY),
      });
      return;
    }

    const dxImg = (mx - startX) / viewport.zoom;
    const dyImg = (my - startY) / viewport.zoom;
    const minW = 64;
    const minH = 32;

    if (lockAspectRatio) {
      let newW = startCrop.width;
      let newH = startCrop.height;
      let newX = startCrop.x;
      let newY = startCrop.y;

      if (mode === 'resize_se' || mode === 'resize_e' || mode === 'resize_s') {
        newW = Math.max(minW, startCrop.width + dxImg);
        newH = newW / 2;
        if (newX + newW > sourceCanvas.width) {
          newW = sourceCanvas.width - newX;
          newH = newW / 2;
        }
        if (newY + newH > sourceCanvas.height) {
          newH = sourceCanvas.height - newY;
          newW = newH * 2;
        }
      } else if (mode === 'resize_nw' || mode === 'resize_w' || mode === 'resize_n') {
        newW = Math.max(minW, startCrop.width - dxImg);
        newH = newW / 2;
        newX = startCrop.x + (startCrop.width - newW);
        newY = startCrop.y + (startCrop.height - newH);
        if (newX < 0) {
          newX = 0;
          newW = startCrop.x + startCrop.width;
          newH = newW / 2;
          newY = startCrop.y + startCrop.height - newH;
        }
        if (newY < 0) {
          newY = 0;
          newH = startCrop.y + startCrop.height;
          newW = newH * 2;
          newX = startCrop.x + startCrop.width - newW;
        }
      } else if (mode === 'resize_ne') {
        newW = Math.max(minW, startCrop.width + dxImg);
        newH = newW / 2;
        newY = startCrop.y + (startCrop.height - newH);
        if (newX + newW > sourceCanvas.width) {
          newW = sourceCanvas.width - newX;
          newH = newW / 2;
          newY = startCrop.y + startCrop.height - newH;
        }
        if (newY < 0) {
          newY = 0;
          newH = startCrop.y + startCrop.height;
          newW = newH * 2;
        }
      } else if (mode === 'resize_sw') {
        newW = Math.max(minW, startCrop.width - dxImg);
        newH = newW / 2;
        newX = startCrop.x + (startCrop.width - newW);
        if (newX < 0) {
          newX = 0;
          newW = startCrop.x + startCrop.width;
          newH = newW / 2;
        }
        if (newY + newH > sourceCanvas.height) {
          newH = sourceCanvas.height - newY;
          newW = newH * 2;
          newX = startCrop.x + startCrop.width - newW;
        }
      }

      setCrop({
        x: Math.round(newX),
        y: Math.round(newY),
        width: Math.round(newW),
        height: Math.round(newH),
      });
    } else {
      let newX = startCrop.x;
      let newY = startCrop.y;
      let newW = startCrop.width;
      let newH = startCrop.height;

      if (mode === 'resize_e' || mode === 'resize_ne' || mode === 'resize_se') {
        newW = Math.max(minW, Math.min(sourceCanvas.width - newX, startCrop.width + dxImg));
      }
      if (mode === 'resize_w' || mode === 'resize_nw' || mode === 'resize_sw') {
        const potentialW = Math.max(minW, startCrop.width - dxImg);
        const shiftX = startCrop.width - potentialW;
        newX = Math.max(0, startCrop.x + shiftX);
        newW = startCrop.x + startCrop.width - newX;
      }
      if (mode === 'resize_s' || mode === 'resize_sw' || mode === 'resize_se') {
        newH = Math.max(minH, Math.min(sourceCanvas.height - newY, startCrop.height + dyImg));
      }
      if (mode === 'resize_n' || mode === 'resize_nw' || mode === 'resize_ne') {
        const potentialH = Math.max(minH, startCrop.height - dyImg);
        const shiftY = startCrop.height - potentialH;
        newY = Math.max(0, startCrop.y + shiftY);
        newH = startCrop.y + startCrop.height - newY;
      }

      setCrop({
        x: Math.round(newX),
        y: Math.round(newY),
        width: Math.round(newW),
        height: Math.round(newH),
      });
    }
  };

  const handleMouseUp = () => {
    dragRef.current.mode = 'none';
  };

  const handleWheel = (e: React.WheelEvent<HTMLElement>) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const nextZoom = Math.max(0.05, Math.min(12, viewport.zoom * zoomFactor));

    const newX = mx - (mx - viewport.x) * (nextZoom / viewport.zoom);
    const newY = my - (my - viewport.y) * (nextZoom / viewport.zoom);

    setViewport({ x: newX, y: newY, zoom: nextZoom });
  };

  // Run Segmentation calculation via Web Worker (or synchronous fallback)
  const triggerSegmentation = useCallback(
    (targetCropped?: CroppedTerrainResult, customOptions?: Partial<SegmentationOptions>) => {
      const activeCropped = targetCropped || croppedResult;
      if (!activeCropped) return;

      setIsSegmenting(true);
      setSegmentProgress({ step: 'セグメンテーション開始...', percent: 5 });

      const options: SegmentationOptions = {
        seaSamples,
        landSamples,
        tolerance,
        medianRadius,
        minIslandAreaRatio,
        smoothingIterations,
        marginPx,
        ...customOptions,
      };

      if (segWorkerRef.current) {
        const clampedCopy = new Uint8ClampedArray(activeCropped.imageData.data);
        const req: SegmentationWorkerRequest = {
          type: 'segment',
          imageData: {
            data: clampedCopy,
            width: activeCropped.width,
            height: activeCropped.height,
          },
          options,
        };
        segWorkerRef.current.postMessage(req);
      } else {
        setTimeout(() => {
          try {
            const res = segmentLandSea(activeCropped.imageData, options, (step, percent) => {
              setSegmentProgress({ step, percent });
            });
            setSegmentationMask(res.mask);
            setBoundaryMask(res.boundaryMask);
            setSegmentationStats(res.stats);
          } catch (err) {
            console.error('Segmentation error:', err);
          } finally {
            setIsSegmenting(false);
          }
        }, 15);
      }
    },
    [croppedResult, seaSamples, landSamples, tolerance, medianRadius, minIslandAreaRatio, smoothingIterations, marginPx]
  );

  // Step 2 -> Step 3: Perform crop and trigger segmentation
  const handleProceedToStep3 = () => {
    if (!sourceCanvas) return;

    const targetW = resolution === '1024x512' ? 1024 : 2048;
    const targetH = resolution === '1024x512' ? 512 : 1024;

    const offscreen = document.createElement('canvas');
    offscreen.width = targetW;
    offscreen.height = targetH;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      sourceCanvas,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      targetW,
      targetH
    );

    const imgData = ctx.getImageData(0, 0, targetW, targetH);
    const dataUrl = offscreen.toDataURL('image/png');

    const result: CroppedTerrainResult = {
      imageData: imgData,
      resolution,
      width: targetW,
      height: targetH,
      dataUrl,
    };

    setCroppedResult(result);

    // Cache original image canvas for Step 3
    const origCanvas = document.createElement('canvas');
    origCanvas.width = targetW;
    origCanvas.height = targetH;
    const origCtx = origCanvas.getContext('2d');
    if (origCtx) {
      origCtx.putImageData(imgData, 0, 0);
    }
    originalCanvasCache.current = origCanvas;

    setCurrentStep(3);

    // Initial fit view for Step 3
    setTimeout(() => {
      const containerW = step3ContainerRef.current?.clientWidth || 800;
      const containerH = step3ContainerRef.current?.clientHeight || 500;
      const fitZoom = Math.min(
        (containerW - 60) / targetW,
        (containerH - 60) / targetH,
        1.0
      );
      setStep3Viewport({
        x: (containerW - targetW * fitZoom) / 2,
        y: (containerH - targetH * fitZoom) / 2,
        zoom: Math.max(0.05, fitZoom),
      });

      // Automatically run initial segmentation
      triggerSegmentation(result);
    }, 50);
  };

  // Re-build cached offscreen canvases whenever segmentation masks update
  useEffect(() => {
    if (!croppedResult || !segmentationMask || !boundaryMask) return;

    const { width, height, imageData } = croppedResult;
    const size = width * height;

    // 1. Build Mask Canvas (Land: light yellow #fef3c7, Sea: rich blue #2563eb)
    const mCanvas = document.createElement('canvas');
    mCanvas.width = width;
    mCanvas.height = height;
    const mCtx = mCanvas.getContext('2d');
    if (mCtx) {
      const maskImgData = mCtx.createImageData(width, height);
      for (let i = 0; i < size; i++) {
        const outIdx = i * 4;
        if (segmentationMask[i] === 1) {
          // Land: #fef3c7 (Warm antique cream yellow)
          maskImgData.data[outIdx] = 254;
          maskImgData.data[outIdx + 1] = 243;
          maskImgData.data[outIdx + 2] = 199;
          maskImgData.data[outIdx + 3] = 255;
        } else {
          // Sea: #2563eb (Vibrant ocean blue)
          maskImgData.data[outIdx] = 37;
          maskImgData.data[outIdx + 1] = 99;
          maskImgData.data[outIdx + 2] = 235;
          maskImgData.data[outIdx + 3] = 255;
        }
      }
      mCtx.putImageData(maskImgData, 0, 0);
      maskCanvasCache.current = mCanvas;
    }

    // 2. Build Overlay Canvas (Original image + Red Coastline Outline #ef4444)
    const oCanvas = document.createElement('canvas');
    oCanvas.width = width;
    oCanvas.height = height;
    const oCtx = oCanvas.getContext('2d');
    if (oCtx) {
      const overlayImgData = oCtx.createImageData(width, height);
      // Copy original image RGB
      overlayImgData.data.set(imageData.data);

      // Highlight coastline boundary pixels in vivid red
      for (let i = 0; i < size; i++) {
        if (boundaryMask[i] === 1) {
          const outIdx = i * 4;
          overlayImgData.data[outIdx] = 239; // Red #ef4444
          overlayImgData.data[outIdx + 1] = 68;
          overlayImgData.data[outIdx + 2] = 68;
          overlayImgData.data[outIdx + 3] = 255;
        }
      }
      oCtx.putImageData(overlayImgData, 0, 0);
      overlayCanvasCache.current = oCanvas;
    }
  }, [croppedResult, segmentationMask, boundaryMask]);

  // Render Step 3 Canvas (Interactive pan/zoom with cached render layers)
  useEffect(() => {
    if (currentStep !== 3 || !croppedResult || !step3CanvasRef.current || !step3ContainerRef.current) return;

    const canvas = step3CanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = step3ContainerRef.current.clientWidth;
    const height = step3ContainerRef.current.clientHeight;
    canvas.width = width;
    canvas.height = height;

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Subtle grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const gridSize = 32 * step3Viewport.zoom;
    if (gridSize > 8) {
      const offsetX = ((step3Viewport.x % gridSize) + gridSize) % gridSize;
      const offsetY = ((step3Viewport.y % gridSize) + gridSize) % gridSize;
      ctx.beginPath();
      for (let gx = offsetX; gx < width; gx += gridSize) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
      }
      for (let gy = offsetY; gy < height; gy += gridSize) {
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
      }
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(step3Viewport.x, step3Viewport.y);
    ctx.scale(step3Viewport.zoom, step3Viewport.zoom);

    // Draw active preview layer
    let activeCanvas: HTMLCanvasElement | null = null;
    if (previewMode === 'mask' && maskCanvasCache.current) {
      activeCanvas = maskCanvasCache.current;
    } else if (previewMode === 'overlay' && overlayCanvasCache.current) {
      activeCanvas = overlayCanvasCache.current;
    } else if (originalCanvasCache.current) {
      activeCanvas = originalCanvasCache.current;
    }

    if (activeCanvas) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 24 / step3Viewport.zoom;
      ctx.drawImage(activeCanvas, 0, 0);
    }

    ctx.restore();
  }, [currentStep, croppedResult, previewMode, step3Viewport, segmentationMask, boundaryMask]);

  // Eyedropper 5x5 color sampling function
  const sampleColorAt = useCallback(
    (pixelX: number, pixelY: number) => {
      if (!croppedResult) return null;
      const { imageData, width, height } = croppedResult;
      const cx = Math.max(0, Math.min(width - 1, Math.round(pixelX)));
      const cy = Math.max(0, Math.min(height - 1, Math.round(pixelY)));

      const r = 2; // 5x5 window
      let sumR = 0,
        sumG = 0,
        sumB = 0,
        count = 0;

      for (let dy = -r; dy <= r; dy++) {
        const py = cy + dy;
        if (py < 0 || py >= height) continue;
        const row = py * width * 4;
        for (let dx = -r; dx <= r; dx++) {
          const px = cx + dx;
          if (px < 0 || px >= width) continue;
          const idx = row + px * 4;
          sumR += imageData.data[idx];
          sumG += imageData.data[idx + 1];
          sumB += imageData.data[idx + 2];
          count++;
        }
      }

      const avgR = Math.round(sumR / count);
      const avgG = Math.round(sumG / count);
      const avgB = Math.round(sumB / count);
      const lab = rgbToLab(avgR, avgG, avgB);

      return { r: avgR, g: avgG, b: avgB, lab, x: cx, y: cy };
    },
    [croppedResult]
  );

  // Step 3 Mouse Interaction (Dropper sampling or Panning)
  const handleStep3MouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (!step3ContainerRef.current || !croppedResult) return;
    const rect = step3ContainerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Convert mouse position to image coordinates
    const imgX = (mx - step3Viewport.x) / step3Viewport.zoom;
    const imgY = (my - step3Viewport.y) / step3Viewport.zoom;

    const isInsideImage =
      imgX >= 0 && imgX < croppedResult.width && imgY >= 0 && imgY < croppedResult.height;

    // Eyedropper click
    if (
      isInsideImage &&
      (activeStep3Tool === 'dropper_sea' || activeStep3Tool === 'dropper_land') &&
      e.button === 0
    ) {
      const sampled = sampleColorAt(imgX, imgY);
      if (sampled) {
        if (activeStep3Tool === 'dropper_sea') {
          const newSample: ColorSample = {
            id: 'sea_' + Date.now(),
            r: sampled.r,
            g: sampled.g,
            b: sampled.b,
            lab: sampled.lab,
            type: 'sea',
          };
          const nextSea = [...seaSamples, newSample];
          setSeaSamples(nextSea);
          triggerSegmentation(croppedResult, { seaSamples: nextSea });
        } else {
          const newSample: ColorSample = {
            id: 'land_' + Date.now(),
            r: sampled.r,
            g: sampled.g,
            b: sampled.b,
            lab: sampled.lab,
            type: 'land',
          };
          const nextLand = [...landSamples, newSample];
          setLandSamples(nextLand);
          triggerSegmentation(croppedResult, { landSamples: nextLand });
        }
      }
      return;
    }

    // Otherwise Pan
    step3DragRef.current = {
      isDragging: true,
      startX: mx,
      startY: my,
      startVp: { x: step3Viewport.x, y: step3Viewport.y },
    };
  };

  const handleStep3MouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!step3ContainerRef.current || !croppedResult) return;
    const rect = step3ContainerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Hover inspector update
    const imgX = (mx - step3Viewport.x) / step3Viewport.zoom;
    const imgY = (my - step3Viewport.y) / step3Viewport.zoom;

    if (imgX >= 0 && imgX < croppedResult.width && imgY >= 0 && imgY < croppedResult.height) {
      const px = Math.floor(imgX);
      const py = Math.floor(imgY);
      const idx = (py * croppedResult.width + px) * 4;
      const r = croppedResult.imageData.data[idx];
      const g = croppedResult.imageData.data[idx + 1];
      const b = croppedResult.imageData.data[idx + 2];
      const lab = rgbToLab(r, g, b);
      const isLand = segmentationMask ? segmentationMask[py * croppedResult.width + px] === 1 : undefined;

      setStep3HoverInfo({ x: px, y: py, r, g, b, lab, isLand });
    } else {
      setStep3HoverInfo(null);
    }

    // Panning
    if (step3DragRef.current.isDragging) {
      const dx = mx - step3DragRef.current.startX;
      const dy = my - step3DragRef.current.startY;
      setStep3Viewport({
        x: step3DragRef.current.startVp.x + dx,
        y: step3DragRef.current.startVp.y + dy,
        zoom: step3Viewport.zoom,
      });
    }
  };

  const handleStep3MouseUp = () => {
    step3DragRef.current.isDragging = false;
  };

  const handleStep3Wheel = (e: React.WheelEvent<HTMLElement>) => {
    e.preventDefault();
    if (!step3ContainerRef.current) return;
    const rect = step3ContainerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const nextZoom = Math.max(0.05, Math.min(12, step3Viewport.zoom * zoomFactor));

    const newX = mx - (mx - step3Viewport.x) * (nextZoom / step3Viewport.zoom);
    const newY = my - (my - step3Viewport.y) * (nextZoom / step3Viewport.zoom);

    setStep3Viewport({ x: newX, y: newY, zoom: nextZoom });
  };

  // Complete and pass segmentation result to parent
  const handleFinalizeSegmentation = () => {
    if (!croppedResult) return;
    const completeResult: CroppedTerrainResult = {
      ...croppedResult,
      mask: segmentationMask || undefined,
      boundaryMask: boundaryMask || undefined,
      stats: segmentationStats || undefined,
    };
    onCropped?.(completeResult);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/85 backdrop-blur-md">
      <div className="relative w-full max-w-6xl h-[92vh] bg-stone-900 border border-stone-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-stone-200">
        {/* Header with 3-Step Indicator */}
        <header className="px-5 py-3.5 border-b border-stone-800 bg-stone-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-600 via-orange-500 to-amber-300 flex items-center justify-center shadow-lg shadow-amber-950/60">
              <FileImage className="w-4 h-4 text-stone-950 font-bold" />
            </div>
            <div>
              <h2 className="text-sm md:text-base font-bold text-amber-200 flex items-center gap-2">
                <span>画像から地形を作る</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {currentStep === 1
                    ? '第1段階: 読込'
                    : currentStep === 2
                    ? '第1段階: 2:1切抜'
                    : '第2段階: 陸海自動判定'}
                </span>
              </h2>
              <p className="text-[11px] text-stone-400">
                {currentStep === 3
                  ? '切り抜いた画像から陸と海を高精度に自動判定します。スポイトやパラメータで境界を微調整できます'
                  : '地図画像やイラストを読み込み、世界マップ（2:1）の規定画角にトリミングします'}
              </p>
            </div>
          </div>

          {/* Step Breadcrumbs */}
          <div className="flex items-center gap-1.5 bg-stone-900/80 px-3 py-1.5 rounded-xl border border-stone-800 text-xs font-medium">
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md ${
                currentStep === 1
                  ? 'bg-amber-500 text-stone-950 font-bold shadow'
                  : currentStep > 1
                  ? 'text-amber-400'
                  : 'text-stone-500'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-stone-950/20 flex items-center justify-center text-[10px]">1</span>
              <span>画像の読込</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-stone-600" />
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md ${
                currentStep === 2
                  ? 'bg-amber-500 text-stone-950 font-bold shadow'
                  : currentStep > 2
                  ? 'text-amber-400'
                  : 'text-stone-500'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-stone-950/20 flex items-center justify-center text-[10px]">2</span>
              <span>2:1切り抜き</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-stone-600" />
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md ${
                currentStep === 3
                  ? 'bg-amber-500 text-stone-950 font-bold shadow'
                  : 'text-stone-500'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-stone-950/20 flex items-center justify-center text-[10px]">3</span>
              <span>陸海の判定</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-400 hover:text-stone-200 transition"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Modal Body */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* STEP 1: 画像を読み込む */}
          {currentStep === 1 && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
              <div className="w-full max-w-xl space-y-6">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFile(e.target.files[0]);
                  }}
                />

                {/* Dropzone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 md:p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3.5 ${
                    isDraggingFile
                      ? 'border-amber-400 bg-amber-500/10 scale-[1.01]'
                      : 'border-stone-700 hover:border-amber-500/80 bg-stone-950/60 hover:bg-stone-950'
                  }`}
                >
                  <div className="w-16 h-16 rounded-2xl bg-amber-950/80 border border-amber-600/40 flex items-center justify-center text-amber-400 shadow-inner">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-stone-100">
                      地図または地形画像を選択・ドロップ
                    </h3>
                    <p className="text-xs text-stone-400 mt-1">
                      PNG, JPEG, WebP に対応（4096pxを超える場合は比率を保持して自動最適化）
                    </p>
                  </div>
                  <button
                    type="button"
                    className="mt-2 px-5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-semibold border border-stone-600 transition"
                  >
                    ファイルを選択する
                  </button>
                </div>

                {/* Sample Image Option */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-stone-950/40 border border-stone-800 text-xs">
                  <div className="flex items-center gap-2 text-stone-300">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>手元に画像がない場合はテスト用サンプルを読み込めます</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadSample}
                    className="px-3 py-1.5 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40 font-medium transition cursor-pointer"
                  >
                    サンプル画像で試す
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: 切り抜き */}
          {currentStep === 2 && sourceCanvas && (
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
              {/* Left Canvas Viewport */}
              <div
                ref={containerRef}
                className="relative flex-1 bg-stone-950 overflow-hidden select-none"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
              >
                <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />

                {/* Floating View Controls (Top Left) */}
                <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-stone-900/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-stone-700 text-xs shadow-lg">
                  <button
                    type="button"
                    onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(10, v.zoom * 1.25) }))}
                    className="p-1 hover:bg-stone-800 text-stone-300 rounded cursor-pointer"
                    title="ズームイン"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(0.05, v.zoom * 0.8) }))}
                    className="p-1 hover:bg-stone-800 text-stone-300 rounded cursor-pointer"
                    title="ズームアウト"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleFitView}
                    className="p-1 hover:bg-stone-800 text-stone-300 rounded cursor-pointer"
                    title="全体を表示"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <div className="w-px h-3.5 bg-stone-700 mx-1" />
                  <span className="font-mono text-[11px] text-amber-400 font-semibold">
                    {Math.round(viewport.zoom * 100)}%
                  </span>
                </div>

                {/* Hint Bar (Bottom Left) */}
                <div className="absolute bottom-3 left-3 bg-stone-900/85 backdrop-blur-sm px-3 py-1 rounded-lg border border-stone-800 text-[11px] text-stone-400 pointer-events-none flex items-center gap-2">
                  <Move className="w-3.5 h-3.5 text-stone-400" />
                  <span>枠をドラッグで移動、四隅ハンドルでリサイズ。Space+ドラッグでキャンバス移動</span>
                </div>
              </div>

              {/* Right Sidebar: Settings & Next Button */}
              <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-stone-800 bg-stone-950/80 p-4 flex flex-col gap-4 overflow-y-auto shrink-0 text-xs">
                {/* File info card */}
                <div className="p-3 rounded-xl bg-stone-900/70 border border-stone-800 space-y-1">
                  <div className="text-stone-400 text-[10px] uppercase font-bold tracking-wider">読み込み画像</div>
                  <div className="text-stone-100 font-medium truncate" title={fileName}>
                    {fileName}
                  </div>
                  <div className="text-stone-400 font-mono text-[11px]">
                    {originalDimensions.width} × {originalDimensions.height} px
                    {scaledDimensions.width !== originalDimensions.width && (
                      <span className="text-amber-400/90 ml-1">
                        (最適化: {scaledDimensions.width}×{scaledDimensions.height})
                      </span>
                    )}
                  </div>
                </div>

                {/* Aspect Ratio Lock Toggle */}
                <div className="space-y-2 p-3 rounded-xl bg-stone-900/70 border border-stone-800">
                  <div className="font-bold text-stone-200 flex items-center gap-1.5">
                    <Crop className="w-3.5 h-3.5 text-amber-400" />
                    <span>切り抜きアスペクト比</span>
                  </div>

                  <label className="flex items-start gap-2 text-stone-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={!lockAspectRatio}
                      onChange={(e) => setLockAspectRatio(!e.target.checked)}
                      className="mt-0.5 accent-amber-500 rounded cursor-pointer"
                    />
                    <span>枠の縦横比を固定しない</span>
                  </label>

                  {!lockAspectRatio ? (
                    <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-600/50 text-amber-200 text-[11px] flex gap-2 items-start mt-1">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        ⚠️ 縦横比を固定しない場合、世界マップ反映時（2:1）に横または縦方向に引き伸ばされます。
                      </span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-stone-400">
                      世界マップと同じ横縦比（2:1）に固定されています。
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleResetCrop2to1}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px] font-medium border border-stone-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-stone-400" />
                    <span>2:1比率に戻す</span>
                  </button>
                </div>

                {/* Resolution Selector */}
                <div className="space-y-2 p-3 rounded-xl bg-stone-900/70 border border-stone-800">
                  <div className="font-bold text-stone-200">出力解像度（2:1）</div>
                  <div className="grid grid-cols-1 gap-2">
                    <label
                      className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                        resolution === '1024x512'
                          ? 'bg-amber-950/60 border-amber-500/80 text-amber-200'
                          : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="resolution"
                          value="1024x512"
                          checked={resolution === '1024x512'}
                          onChange={() => setResolution('1024x512')}
                          className="accent-amber-500"
                        />
                        <div>
                          <div className="font-mono font-bold text-xs">1024 × 512</div>
                          <div className="text-[10px] text-stone-400">標準・軽量（推奨）</div>
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                        高速
                      </span>
                    </label>

                    <label
                      className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                        resolution === '2048x1024'
                          ? 'bg-amber-950/60 border-amber-500/80 text-amber-200'
                          : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="resolution"
                          value="2048x1024"
                          checked={resolution === '2048x1024'}
                          onChange={() => setResolution('2048x1024')}
                          className="accent-amber-500"
                        />
                        <div>
                          <div className="font-mono font-bold text-xs">2048 × 1024</div>
                          <div className="text-[10px] text-stone-400">高精細（巨大マップ向け）</div>
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-700 text-stone-300 font-mono">
                        HD
                      </span>
                    </label>
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="mt-auto pt-2 space-y-2">
                  <button
                    type="button"
                    onClick={handleProceedToStep3}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-500 text-stone-950 shadow-lg shadow-amber-950/40 ring-1 ring-amber-400 cursor-pointer active:scale-98"
                  >
                    <span>切り抜きを確定して陸海判定へ</span>
                    <ChevronRight className="w-4 h-4 font-bold" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="w-full py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-stone-200 text-xs font-medium border border-stone-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>別の画像を選び直す</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: 陸海の自動判定 */}
          {currentStep === 3 && croppedResult && (
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
              {/* Interactive Preview Canvas Area */}
              <div
                ref={step3ContainerRef}
                className="relative flex-1 bg-stone-950 overflow-hidden select-none"
                style={{
                  cursor:
                    activeStep3Tool === 'dropper_sea' || activeStep3Tool === 'dropper_land'
                      ? 'crosshair'
                      : step3DragRef.current.isDragging
                      ? 'grabbing'
                      : 'grab',
                }}
                onMouseDown={handleStep3MouseDown}
                onMouseMove={handleStep3MouseMove}
                onMouseUp={handleStep3MouseUp}
                onMouseLeave={handleStep3MouseUp}
                onWheel={handleStep3Wheel}
              >
                <canvas ref={step3CanvasRef} className="absolute inset-0 block w-full h-full" />

                {/* View Mode Switcher Pills (Top Center) */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center bg-stone-900/90 backdrop-blur-md p-1 rounded-xl border border-stone-700/80 shadow-2xl text-xs z-10">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('original')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      previewMode === 'original'
                        ? 'bg-stone-700 text-stone-100 shadow'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>元画像</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('mask')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      previewMode === 'mask'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>判定マスク（黄陸/青海）</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('overlay')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      previewMode === 'overlay'
                        ? 'bg-amber-600 text-stone-950 font-bold shadow'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>重ね合わせ（赤輪郭線）</span>
                  </button>
                </div>

                {/* Floating View Zoom Controls (Top Left) */}
                <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-stone-900/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-stone-700 text-xs shadow-lg z-10">
                  <button
                    type="button"
                    onClick={() => setStep3Viewport((v) => ({ ...v, zoom: Math.min(10, v.zoom * 1.25) }))}
                    className="p-1 hover:bg-stone-800 text-stone-300 rounded cursor-pointer"
                    title="ズームイン"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep3Viewport((v) => ({ ...v, zoom: Math.max(0.05, v.zoom * 0.8) }))}
                    className="p-1 hover:bg-stone-800 text-stone-300 rounded cursor-pointer"
                    title="ズームアウト"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleFitStep3View}
                    className="p-1 hover:bg-stone-800 text-stone-300 rounded cursor-pointer"
                    title="全体を表示"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <div className="w-px h-3.5 bg-stone-700 mx-1" />
                  <span className="font-mono text-[11px] text-amber-400 font-semibold">
                    {Math.round(step3Viewport.zoom * 100)}%
                  </span>
                </div>

                {/* Tool Selector (Top Right of Canvas) */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-stone-900/90 backdrop-blur-md p-1 rounded-xl border border-stone-700 text-xs shadow-lg z-10">
                  <button
                    type="button"
                    onClick={() => setActiveStep3Tool('pan')}
                    className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
                      activeStep3Tool === 'pan'
                        ? 'bg-stone-700 text-stone-100 font-medium'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <Move className="w-3.5 h-3.5" />
                    <span>移動</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStep3Tool('dropper_sea')}
                    className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
                      activeStep3Tool === 'dropper_sea'
                        ? 'bg-blue-600 text-white font-bold ring-1 ring-blue-300'
                        : 'text-blue-300 hover:bg-blue-950/60'
                    }`}
                    title="海の確実な色をサンプリング"
                  >
                    <Pipette className="w-3.5 h-3.5" />
                    <span>海スポイト</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStep3Tool('dropper_land')}
                    className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
                      activeStep3Tool === 'dropper_land'
                        ? 'bg-amber-600 text-stone-950 font-bold ring-1 ring-amber-300'
                        : 'text-amber-300 hover:bg-amber-950/60'
                    }`}
                    title="陸の確実な色をサンプリング"
                  >
                    <Pipette className="w-3.5 h-3.5" />
                    <span>陸スポイト</span>
                  </button>
                </div>

                {/* Hover Inspector / Instructions Badge (Bottom Left) */}
                <div className="absolute bottom-3 left-3 bg-stone-950/90 backdrop-blur-md px-3.5 py-2 rounded-xl border border-stone-800 text-[11px] text-stone-300 shadow-xl flex items-center gap-3 pointer-events-none z-10">
                  {step3HoverInfo ? (
                    <div className="flex items-center gap-2.5 font-mono">
                      <div
                        className="w-4 h-4 rounded border border-stone-600 shadow-sm shrink-0"
                        style={{
                          backgroundColor: `rgb(${step3HoverInfo.r}, ${step3HoverInfo.g}, ${step3HoverInfo.b})`,
                        }}
                      />
                      <span>
                        X:{step3HoverInfo.x} Y:{step3HoverInfo.y}
                      </span>
                      <span className="text-stone-400">
                        RGB({step3HoverInfo.r},{step3HoverInfo.g},{step3HoverInfo.b})
                      </span>
                      <span className="text-stone-400">
                        Lab({step3HoverInfo.lab.L.toFixed(0)},{step3HoverInfo.lab.a.toFixed(0)},{step3HoverInfo.lab.b.toFixed(0)})
                      </span>
                      {step3HoverInfo.isLand !== undefined && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            step3HoverInfo.isLand
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                          }`}
                        >
                          {step3HoverInfo.isLand ? '陸地' : '海洋'}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-stone-400 flex items-center gap-1.5">
                      {activeStep3Tool !== 'pan' ? (
                        <span>
                          {activeStep3Tool === 'dropper_sea' ? '🌊 海' : '⛰️ 陸'}
                          として指定したい場所をクリックして色をサンプリングします（周辺5×5平均）
                        </span>
                      ) : (
                        <span>ドラッグでパン移動、ホイールでズーム。スポイトで確実な色をサンプリングできます</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Running Progress Overlay */}
                {isSegmenting && (
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-20">
                    <div className="bg-stone-900 border border-amber-500/60 p-5 rounded-2xl shadow-2xl flex flex-col items-center gap-3 max-w-sm w-full mx-4">
                      <RefreshCw className="w-7 h-7 text-amber-400 animate-spin" />
                      <div className="text-center">
                        <div className="text-sm font-bold text-amber-200">
                          {segmentProgress.step || '陸海を解析中...'}
                        </div>
                        <div className="text-[11px] text-stone-400 mt-0.5">
                          分水嶺アルゴリズム（Watershed）を実行中
                        </div>
                      </div>
                      <div className="w-full bg-stone-800 rounded-full h-2 overflow-hidden mt-1 border border-stone-700">
                        <div
                          className="bg-gradient-to-r from-amber-500 to-amber-300 h-full transition-all duration-200"
                          style={{ width: `${segmentProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Sidebar: Sampling & Parameter Controls */}
              <div className="w-full md:w-84 border-t md:border-t-0 md:border-l border-stone-800 bg-stone-950/90 p-4 flex flex-col gap-3.5 overflow-y-auto shrink-0 text-xs">
                {/* Sampling Section */}
                <div className="space-y-2 p-3 rounded-xl bg-stone-900/80 border border-stone-800">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-stone-200 flex items-center gap-1.5">
                      <Pipette className="w-3.5 h-3.5 text-amber-400" />
                      <span>色サンプリング（シード）</span>
                    </span>
                    {(seaSamples.length > 0 || landSamples.length > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSeaSamples([]);
                          setLandSamples([]);
                          triggerSegmentation(croppedResult, { seaSamples: [], landSamples: [] });
                        }}
                        className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>全消去</span>
                      </button>
                    )}
                  </div>

                  <p className="text-[10px] text-stone-400 leading-relaxed">
                    未指定時は羊皮紙地図の自動配色で判定します。境界が曖昧な場合はスポイトで色を追加してください。
                  </p>

                  {/* Sea Samples */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-blue-300 font-semibold flex items-center gap-1">
                        <Waves className="w-3 h-3" />
                        <span>海のサンプル ({seaSamples.length})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveStep3Tool('dropper_sea')}
                        className={`text-[10px] px-2 py-0.5 rounded cursor-pointer transition ${
                          activeStep3Tool === 'dropper_sea'
                            ? 'bg-blue-600 text-white font-bold'
                            : 'bg-blue-950/80 text-blue-300 border border-blue-700/60 hover:bg-blue-900'
                        }`}
                      >
                        スポイト選択
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 min-h-[28px] p-1.5 rounded-lg bg-stone-950/60 border border-stone-800/80 items-center">
                      {seaSamples.length === 0 ? (
                        <span className="text-[10px] text-stone-500 italic">サンプル未登録</span>
                      ) : (
                        seaSamples.map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center gap-1 bg-stone-800 px-1.5 py-0.5 rounded border border-stone-700 text-[10px]"
                          >
                            <span
                              className="w-3 h-3 rounded-full border border-stone-600 inline-block shrink-0"
                              style={{ backgroundColor: `rgb(${s.r},${s.g},${s.b})` }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const next = seaSamples.filter((x) => x.id !== s.id);
                                setSeaSamples(next);
                                triggerSegmentation(croppedResult, { seaSamples: next });
                              }}
                              className="text-stone-400 hover:text-red-400 cursor-pointer"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Land Samples */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-amber-300 font-semibold flex items-center gap-1">
                        <Mountain className="w-3 h-3" />
                        <span>陸のサンプル ({landSamples.length})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveStep3Tool('dropper_land')}
                        className={`text-[10px] px-2 py-0.5 rounded cursor-pointer transition ${
                          activeStep3Tool === 'dropper_land'
                            ? 'bg-amber-600 text-stone-950 font-bold'
                            : 'bg-amber-950/80 text-amber-300 border border-amber-700/60 hover:bg-amber-900'
                        }`}
                      >
                        スポイト選択
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 min-h-[28px] p-1.5 rounded-lg bg-stone-950/60 border border-stone-800/80 items-center">
                      {landSamples.length === 0 ? (
                        <span className="text-[10px] text-stone-500 italic">サンプル未登録</span>
                      ) : (
                        landSamples.map((l) => (
                          <div
                            key={l.id}
                            className="flex items-center gap-1 bg-stone-800 px-1.5 py-0.5 rounded border border-stone-700 text-[10px]"
                          >
                            <span
                              className="w-3 h-3 rounded-full border border-stone-600 inline-block shrink-0"
                              style={{ backgroundColor: `rgb(${l.r},${l.g},${l.b})` }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const next = landSamples.filter((x) => x.id !== l.id);
                                setLandSamples(next);
                                triggerSegmentation(croppedResult, { landSamples: next });
                              }}
                              className="text-stone-400 hover:text-red-400 cursor-pointer"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Parameters Section */}
                <div className="space-y-3 p-3 rounded-xl bg-stone-900/80 border border-stone-800">
                  <div className="font-bold text-stone-200 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-amber-400" />
                    <span>セグメンテーション調整</span>
                  </div>

                  {/* Tolerance Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-stone-300">色許容度 (Lab ΔE)</span>
                      <span className="font-mono text-amber-400 font-bold">{tolerance}</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={50}
                      step={1}
                      value={tolerance}
                      onChange={(e) => setTolerance(Number(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-800 rounded-lg"
                    />
                    <div className="flex justify-between text-[9px] text-stone-500">
                      <span>厳格 (5)</span>
                      <span>広範 (50)</span>
                    </div>
                  </div>

                  {/* Median Filter Radius */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-stone-300">文字・グリッド線ぼかし</span>
                      <span className="font-mono text-amber-400 font-bold">
                        {medianRadius === 0 ? '無効' : `${medianRadius * 2 + 1}×${medianRadius * 2 + 1}`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      step={1}
                      value={medianRadius}
                      onChange={(e) => setMedianRadius(Number(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-800 rounded-lg"
                    />
                    <div className="flex justify-between text-[9px] text-stone-500">
                      <span>なし</span>
                      <span>標準 (5×5)</span>
                      <span>強力 (9×9)</span>
                    </div>
                  </div>

                  {/* Island Removal Area Threshold */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-stone-300">最小島サイズ（孤立ゴミ除去）</span>
                      <span className="font-mono text-amber-400 font-bold">
                        {(minIslandAreaRatio * 100).toFixed(2)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.0005}
                      max={0.02}
                      step={0.0005}
                      value={minIslandAreaRatio}
                      onChange={(e) => setMinIslandAreaRatio(Number(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-800 rounded-lg"
                    />
                    <div className="flex justify-between text-[9px] text-stone-500">
                      <span>微小島も残す</span>
                      <span>大島のみ</span>
                    </div>
                  </div>

                  {/* Smoothing Iterations */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-stone-300">海岸線スムージング</span>
                      <span className="font-mono text-amber-400 font-bold">
                        {smoothingIterations === 0 ? 'なし' : `${smoothingIterations}回`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      step={1}
                      value={smoothingIterations}
                      onChange={(e) => setSmoothingIterations(Number(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-800 rounded-lg"
                    />
                  </div>

                  {/* Outer margin */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-stone-300">外枠海マージン</span>
                      <span className="font-mono text-amber-400 font-bold">{marginPx} px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      value={marginPx}
                      onChange={(e) => setMarginPx(Number(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-800 rounded-lg"
                    />
                  </div>

                  {/* Re-calculate Button */}
                  <button
                    type="button"
                    onClick={() => triggerSegmentation()}
                    disabled={isSegmenting}
                    className="w-full mt-1 py-2 px-3 rounded-lg bg-stone-800 hover:bg-stone-700 text-amber-300 border border-stone-700 font-medium flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSegmenting ? 'animate-spin' : ''}`} />
                    <span>再判定を実行</span>
                  </button>
                </div>

                {/* Statistics Card */}
                {segmentationStats && (
                  <div className="p-3 rounded-xl bg-stone-900/80 border border-stone-800 space-y-2">
                    <div className="text-[11px] font-bold text-amber-300">陸海判定統計</div>
                    <div className="space-y-1.5 text-[11px]">
                      <div>
                        <div className="flex justify-between text-stone-300 mb-1">
                          <span>陸地比率</span>
                          <span className="font-bold text-amber-400 font-mono">
                            {segmentationStats.landRatio}%
                          </span>
                        </div>
                        <div className="w-full bg-blue-900/50 rounded-full h-2 overflow-hidden border border-blue-700/50">
                          <div
                            className="bg-amber-400 h-full"
                            style={{ width: `${Math.min(100, segmentationStats.landRatio)}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex justify-between pt-1">
                        <span className="text-stone-400">検出された大陸・島:</span>
                        <span className="font-bold font-mono text-stone-200">
                          {segmentationStats.islandCount} 個
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-400">総画素数:</span>
                        <span className="font-mono text-stone-300">
                          {segmentationStats.width} × {segmentationStats.height}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Bottom Actions */}
                <div className="mt-auto space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={handleFinalizeSegmentation}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-500 text-stone-950 flex items-center justify-center gap-1.5 transition shadow shadow-amber-950/40 cursor-pointer active:scale-98"
                  >
                    <Check className="w-4 h-4 font-bold" />
                    <span>判定結果を確定して完了</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="w-full py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-semibold border border-stone-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>切り抜き範囲を再調整する</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
