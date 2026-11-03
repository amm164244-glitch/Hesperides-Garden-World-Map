import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Paintbrush,
  PaintBucket,
  Undo2,
  Redo2,
  Globe,
  Spline,
  Palette,
  Loader2,
} from 'lucide-react';
import {
  ColorSample,
  SegmentationOptions,
  SegmentationResult,
  SegmentationStats,
  SeedCounts,
  ColorCluster,
  rgbToLab,
  segmentLandSea,
  computeCoastlineOutline,
  runLabKMeans,
  analyzeSeeds,
  estimateSegmentationMemory,
} from '../utils/imageTerrain/segmentLandSea';
import {
  MaskPatch,
  applyBrushToMask,
  applyBrushStrokeToMask,
  applyPatchToMask,
  floodFillMask,
  applyPolygonToMask,
  createMapDataFromMask,
  maskToElevationGrid,
} from '../utils/imageTerrain/maskEditor';
import { STANDARD_SEA_LEVEL } from '../utils/tectonicGenerator';
import { buildElevationFromMask } from '../utils/imageTerrain/upsampleMask';
import { MapData } from '../types/map';
import {
  SegmentationWorkerRequest,
  SegmentationWorkerResponse,
} from '../workers/segmentationWorker';
import {
  UpsampleWorkerRequest,
  UpsampleWorkerResponse,
} from '../workers/upsampleWorker';

export type TerrainResolution = '1024x512' | '2048x1024' | '4096x2048' | '8192x4096';
export type AnalysisResolution = 'auto' | '1024x512' | '2048x1024' | '4096x2048';

/**
 * Calculates effective analysis resolution based on user setting, crop width, and output resolution.
 */
export function getEffectiveAnalysisResolution(
  analysisRes: AnalysisResolution,
  outputRes: TerrainResolution,
  cropWidth: number
): '1024x512' | '2048x1024' | '4096x2048' {
  if (analysisRes !== 'auto') {
    if (analysisRes === '4096x2048' && cropWidth < 4096) {
      return '2048x1024';
    }
    return analysisRes;
  }
  // Auto mode:
  // If crop width < 2048: 1024x512
  // If output resolution is 1024x512: 1024x512
  // Otherwise: 2048x1024
  if (cropWidth < 2048 || outputRes === '1024x512') {
    return '1024x512';
  }
  return '2048x1024';
}

/**
 * Probes the client WebGL environment for MAX_TEXTURE_SIZE.
 */
export function getMaxTextureSize(): number | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return null;
    const max = (gl as WebGLRenderingContext).getParameter((gl as WebGLRenderingContext).MAX_TEXTURE_SIZE);
    return typeof max === 'number' && max > 0 ? max : null;
  } catch {
    return null;
  }
}

/**
 * Returns pixel width, height, and approximate elevation grid memory for each TerrainResolution.
 */
export function getResolutionDims(res: TerrainResolution): { width: number; height: number; memMb: number } {
  switch (res) {
    case '8192x4096':
      return { width: 8192, height: 4096, memMb: 134 };
    case '4096x2048':
      return { width: 4096, height: 2048, memMb: 34 };
    case '2048x1024':
      return { width: 2048, height: 1024, memMb: 8 };
    case '1024x512':
    default:
      return { width: 1024, height: 512, memMb: 2 };
  }
}

export interface CroppedTerrainResult {
  imageData: ImageData;
  resolution: TerrainResolution;
  analysisResolution?: '1024x512' | '2048x1024' | '4096x2048';
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
  onApplyToWorldMap?: (mapData: MapData) => void;
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
  onApplyToWorldMap,
}) => {
  // Steps: 1: 画像を読み込む, 2: 切り抜き, 3: 陸海の自動判定, 4: 陸海の手動補正
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Source image data (Step 1 & 2)
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [originalDimensions, setOriginalDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [scaledDimensions, setScaledDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  // WebGL capabilities probe
  const maxTextureSize = useMemo(() => getMaxTextureSize(), []);

  // Step 2 Crop & Resolution settings
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 200, height: 100 });
  const [lockAspectRatio, setLockAspectRatio] = useState<boolean>(true);
  const [resolution, setResolution] = useState<TerrainResolution>('1024x512');
  const [analysisResolution, setAnalysisResolution] = useState<AnalysisResolution>('auto');

  // Application to world map status
  const [isApplyingToWorld, setIsApplyingToWorld] = useState<boolean>(false);
  const [applyProgress, setApplyProgress] = useState<{ step: string; percent: number }>({
    step: '',
    percent: 0,
  });
  const [applyError, setApplyError] = useState<string | null>(null);

  // Effective analysis resolution and memory estimate
  const effectiveAnalysisRes = useMemo(() => {
    return getEffectiveAnalysisResolution(analysisResolution, resolution, Math.round(crop.width));
  }, [analysisResolution, resolution, crop.width]);

  const effectiveAnalysisDims = useMemo(() => {
    if (effectiveAnalysisRes === '4096x2048') return { width: 4096, height: 2048 };
    if (effectiveAnalysisRes === '2048x1024') return { width: 2048, height: 1024 };
    return { width: 1024, height: 512 };
  }, [effectiveAnalysisRes]);

  const outputDims = useMemo(() => getResolutionDims(resolution), [resolution]);

  const segMemoryEstimate = useMemo(() => {
    return estimateSegmentationMemory(effectiveAnalysisDims.width, effectiveAnalysisDims.height);
  }, [effectiveAnalysisDims]);

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
  const [medianRadius, setMedianRadius] = useState<number>(3);
  const [tolerance, setTolerance] = useState<number>(18);
  const [minIslandAreaRatio, setMinIslandAreaRatio] = useState<number>(0.002); // 0.20%
  const [smoothingIterations, setSmoothingIterations] = useState<number>(1);
  const [marginPercent, setMarginPercent] = useState<number>(3); // 0 to 8% (default 3%)
  const [riaRoughness, setRiaRoughness] = useState<number>(8); // 1 to 10 (海岸線の複雑さ・リアス度、初期値 8)

  // Seed visualization & status
  const [showSeeds, setShowSeeds] = useState<boolean>(false);
  const [seedMask, setSeedMask] = useState<Uint8Array | null>(null);
  const [seedCounts, setSeedCounts] = useState<SeedCounts | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  // Suggested color clusters (k-means)
  const [suggestedClusters, setSuggestedClusters] = useState<ColorCluster[]>([]);
  const [clusterAssignments, setClusterAssignments] = useState<Record<string, 'sea' | 'land' | 'ignore'>>({});
  const [isGeneratingClusters, setIsGeneratingClusters] = useState<boolean>(false);

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

  // Step 4: Manual correction states & refs
  const [manualMask, setManualMask] = useState<Uint8Array | null>(null);
  const [initialStep3Mask, setInitialStep3Mask] = useState<Uint8Array | null>(null);
  const [maskUndoStack, setMaskUndoStack] = useState<MaskPatch[]>([]);
  const [maskRedoStack, setMaskRedoStack] = useState<MaskPatch[]>([]);
  const [hasEditedStep4, setHasEditedStep4] = useState<boolean>(false);
  const [step4Tool, setStep4Tool] = useState<'brush_land' | 'brush_sea' | 'bucket' | 'lasso' | 'pan'>('brush_land');
  const [step4BrushRadius, setStep4BrushRadius] = useState<number>(15);
  const [step4OverlayOpacity, setStep4OverlayOpacity] = useState<number>(0.6);
  const [step4LassoPoints, setStep4LassoPoints] = useState<[number, number][]>([]);
  const [step4Viewport, setStep4Viewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const [step4MousePos, setStep4MousePos] = useState<{ x: number; y: number } | null>(null);
  const [step4RedrawTrigger, setStep4RedrawTrigger] = useState<number>(0);

  // Dialog states
  const [showConfirmReset, setShowConfirmReset] = useState<boolean>(false);
  const [showConfirmReSegment, setShowConfirmReSegment] = useState<boolean>(false);
  const [showConfirmApply, setShowConfirmApply] = useState<boolean>(false);

  // Step 4 Canvas & interaction refs
  const step4CanvasRef = useRef<HTMLCanvasElement | null>(null);
  const step4ContainerRef = useRef<HTMLDivElement | null>(null);
  const step4DragRef = useRef<{ isDragging: boolean; startX: number; startY: number; startVp: { x: number; y: number } }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    startVp: { x: 0, y: 0 },
  });
  const isStep4DrawingRef = useRef<boolean>(false);
  const strokeStartMaskSnapshot = useRef<Uint8Array | null>(null);
  const step4MaskCanvasCache = useRef<HTMLCanvasElement | null>(null);
  const step4OutlineCanvasCache = useRef<HTMLCanvasElement | null>(null);
  const lastBrushPosRef = useRef<{ x: number; y: number } | null>(null);

  // Worker references
  const segWorkerRef = useRef<Worker | null>(null);
  const upsampleWorkerRef = useRef<Worker | null>(null);

  // Cached render canvases for Step 3
  const maskCanvasCache = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasCache = useRef<HTMLCanvasElement | null>(null);
  const originalCanvasCache = useRef<HTMLCanvasElement | null>(null);
  const seedCanvasCache = useRef<HTMLCanvasElement | null>(null);

  // Canvas elements
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const step3CanvasRef = useRef<HTMLCanvasElement | null>(null);
  const step3ContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize Workers
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
          if (data.result.seedMask) {
            setSeedMask(data.result.seedMask);
          }
          if (data.result.seedCounts) {
            setSeedCounts(data.result.seedCounts);
          }
          setSeedError(null);
          setIsSegmenting(false);
        } else if (data.type === 'error') {
          console.error('Segmentation worker error:', data.error);
          setSeedError(data.error);
          if (data.seedCounts) {
            setSeedCounts(data.seedCounts);
          }
          if (data.seedMask) {
            setSeedMask(data.seedMask);
          }
          setIsSegmenting(false);
        }
      };
    } catch (err) {
      console.warn('Segmentation Worker initialization fallback to main thread:', err);
    }

    try {
      upsampleWorkerRef.current = new Worker(
        new URL('../workers/upsampleWorker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch (err) {
      console.warn('Upsample Worker initialization fallback to main thread:', err);
    }

    return () => {
      segWorkerRef.current?.terminate();
      segWorkerRef.current = null;
      upsampleWorkerRef.current?.terminate();
      upsampleWorkerRef.current = null;
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
    (targetCropped?: CroppedTerrainResult | null, customOptions?: Partial<SegmentationOptions>) => {
      const activeCropped = targetCropped || croppedResult;
      if (!activeCropped) return;

      const options: SegmentationOptions = {
        seaSamples,
        landSamples,
        tolerance,
        medianRadius,
        minIslandAreaRatio,
        smoothingIterations,
        marginPercent,
        ...customOptions,
      };

      // 1. Analyze seeds first to get counts and check sufficiency threshold (0.5%)
      const seedAnalysis = analyzeSeeds(activeCropped.imageData, options);
      setSeedMask(seedAnalysis.seedMask);
      setSeedCounts(seedAnalysis.seedCounts);

      if (!seedAnalysis.seedCounts.isSufficient) {
        setSeedError(
          seedAnalysis.seedCounts.errorMessage ||
          '海(または陸)の目印が足りません。スポイトで色を指定してください'
        );
        setIsSegmenting(false);
        return;
      }

      setSeedError(null);
      setIsSegmenting(true);
      setSegmentProgress({ step: 'セグメンテーション開始...', percent: 5 });

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
        segWorkerRef.current.postMessage(req, [clampedCopy.buffer]);
      } else {
        setTimeout(() => {
          try {
            const res = segmentLandSea(activeCropped.imageData, options, (step, percent) => {
              setSegmentProgress({ step, percent });
            });
            setSegmentationMask(res.mask);
            setBoundaryMask(res.boundaryMask);
            setSegmentationStats(res.stats);
            if (res.seedMask) setSeedMask(res.seedMask);
            if (res.seedCounts) setSeedCounts(res.seedCounts);
            setSeedError(null);
          } catch (err: any) {
            console.error('Segmentation error:', err);
            setSeedError(err?.message || '陸海判定処理中にエラーが発生しました');
            if (err?.seedCounts) setSeedCounts(err.seedCounts);
            if (err?.seedMask) setSeedMask(err.seedMask);
          } finally {
            setIsSegmenting(false);
          }
        }, 15);
      }
    },
    [croppedResult, seaSamples, landSamples, tolerance, medianRadius, minIslandAreaRatio, smoothingIterations, marginPercent]
  );

  // Propose color clusters using k-means (k=6)
  const handleProposeColors = useCallback(() => {
    if (!croppedResult) return;
    setIsGeneratingClusters(true);
    setTimeout(() => {
      try {
        const clusters = runLabKMeans(croppedResult.imageData, 6);
        setSuggestedClusters(clusters);
      } catch (err) {
        console.error('Failed to run Lab k-means:', err);
      } finally {
        setIsGeneratingClusters(false);
      }
    }, 10);
  }, [croppedResult]);

  // Handle color cluster assignment ('sea' | 'land' | 'ignore')
  const handleAssignClusterColor = useCallback(
    (cluster: ColorCluster, role: 'sea' | 'land' | 'ignore') => {
      setClusterAssignments((prev) => ({ ...prev, [cluster.id]: role }));

      const nextSea = seaSamples.filter((s) => s.id !== cluster.id);
      const nextLand = landSamples.filter((l) => l.id !== cluster.id);

      if (role === 'sea') {
        nextSea.push({
          id: cluster.id,
          r: cluster.r,
          g: cluster.g,
          b: cluster.b,
          lab: cluster.lab,
          type: 'sea',
        });
      } else if (role === 'land') {
        nextLand.push({
          id: cluster.id,
          r: cluster.r,
          g: cluster.g,
          b: cluster.b,
          lab: cluster.lab,
          type: 'land',
        });
      }

      setSeaSamples(nextSea);
      setLandSamples(nextLand);
      triggerSegmentation(croppedResult, { seaSamples: nextSea, landSamples: nextLand });
    },
    [croppedResult, seaSamples, landSamples, triggerSegmentation]
  );

  // Step 2 -> Step 3: Perform crop and trigger segmentation
  const handleProceedToStep3 = () => {
    if (!sourceCanvas) return;
    if (segMemoryEstimate.isTooLarge) return;

    const targetW = effectiveAnalysisDims.width;
    const targetH = effectiveAnalysisDims.height;

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
      analysisResolution: effectiveAnalysisRes,
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

  // Re-build cached offscreen canvases whenever segmentation masks or seeds update
  useEffect(() => {
    if (!croppedResult) return;

    const { width, height, imageData } = croppedResult;
    const size = width * height;

    if (segmentationMask && boundaryMask) {
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
    }

    // 3. Build Seed Canvas Cache (Sea: blue #3b82f6, Land: red #ef4444)
    if (seedMask) {
      const sCanvas = document.createElement('canvas');
      sCanvas.width = width;
      sCanvas.height = height;
      const sCtx = sCanvas.getContext('2d');
      if (sCtx) {
        const sImgData = sCtx.createImageData(width, height);
        for (let i = 0; i < size; i++) {
          const outIdx = i * 4;
          if (seedMask[i] === 1) {
            // Sea seed: semi-transparent blue
            sImgData.data[outIdx] = 59;
            sImgData.data[outIdx + 1] = 130;
            sImgData.data[outIdx + 2] = 246;
            sImgData.data[outIdx + 3] = 180;
          } else if (seedMask[i] === 2) {
            // Land seed: semi-transparent red
            sImgData.data[outIdx] = 239;
            sImgData.data[outIdx + 1] = 68;
            sImgData.data[outIdx + 2] = 68;
            sImgData.data[outIdx + 3] = 180;
          } else {
            sImgData.data[outIdx + 3] = 0;
          }
        }
        sCtx.putImageData(sImgData, 0, 0);
        seedCanvasCache.current = sCanvas;
      }
    }
  }, [croppedResult, segmentationMask, boundaryMask, seedMask]);

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

    // Draw seed overlay if enabled
    if (showSeeds && seedCanvasCache.current) {
      ctx.drawImage(seedCanvasCache.current, 0, 0);
    }

    ctx.restore();
  }, [currentStep, croppedResult, previewMode, step3Viewport, segmentationMask, boundaryMask, showSeeds, seedMask]);

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

    // Prioritize space key or middle click for panning
    if (isSpacePressed || e.button === 1) {
      step3DragRef.current = {
        isDragging: true,
        startX: mx,
        startY: my,
        startVp: { x: step3Viewport.x, y: step3Viewport.y },
      };
      return;
    }

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

  // Update Step 4 mask canvas cache and coastline outline cache
  const updateStep4MaskCanvas = useCallback(
    (mask: Uint8Array, width: number, height: number, updateOutline: boolean = true) => {
      if (!step4MaskCanvasCache.current) {
        step4MaskCanvasCache.current = document.createElement('canvas');
      }
      const mc = step4MaskCanvasCache.current;
      if (mc.width !== width || mc.height !== height) {
        mc.width = width;
        mc.height = height;
      }
      const mctx = mc.getContext('2d');
      if (mctx) {
        const imgData = mctx.createImageData(width, height);
        const data = imgData.data;
        const total = width * height;
        for (let i = 0; i < total; i++) {
          const idx = i * 4;
          if (mask[i] === 1) {
            // Land: vibrant green
            data[idx] = 34;
            data[idx + 1] = 197;
            data[idx + 2] = 94;
            data[idx + 3] = 255;
          } else {
            // Sea: deep blue
            data[idx] = 37;
            data[idx + 1] = 99;
            data[idx + 2] = 235;
            data[idx + 3] = 255;
          }
        }
        mctx.putImageData(imgData, 0, 0);
      }

      if (updateOutline) {
        if (!step4OutlineCanvasCache.current) {
          step4OutlineCanvasCache.current = document.createElement('canvas');
        }
        const oc = step4OutlineCanvasCache.current;
        if (oc.width !== width || oc.height !== height) {
          oc.width = width;
          oc.height = height;
        }
        const octx = oc.getContext('2d');
        if (octx) {
          const oImgData = octx.createImageData(width, height);
          const oData = oImgData.data;
          const outline = computeCoastlineOutline(mask, width, height);
          const total = width * height;
          for (let i = 0; i < total; i++) {
            if (outline[i] === 1) {
              const idx = i * 4;
              oData[idx] = 239; // Red highlight
              oData[idx + 1] = 68;
              oData[idx + 2] = 68;
              oData[idx + 3] = 255;
            }
          }
          octx.putImageData(oImgData, 0, 0);
        }
      }
    },
    []
  );

  // Transition from Step 3 (Segmentation) to Step 4 (Manual Correction)
  const handleProceedToStep4 = () => {
    if (!croppedResult) return;
    const baseMask =
      segmentationMask || new Uint8Array(croppedResult.width * croppedResult.height);
    const initialClone = new Uint8Array(baseMask);
    const manualClone = new Uint8Array(baseMask);

    setInitialStep3Mask(initialClone);
    setManualMask(manualClone);
    setMaskUndoStack([]);
    setMaskRedoStack([]);
    setHasEditedStep4(false);
    setStep4LassoPoints([]);

    // Initialize viewport to center within container
    const cw = step4ContainerRef.current?.clientWidth || 800;
    const ch = step4ContainerRef.current?.clientHeight || 500;
    const scaleX = (cw - 40) / croppedResult.width;
    const scaleY = (ch - 40) / croppedResult.height;
    const fitZoom = Math.min(scaleX, scaleY, 1.0);
    const vx = (cw - croppedResult.width * fitZoom) / 2;
    const vy = (ch - croppedResult.height * fitZoom) / 2;
    setStep4Viewport({ x: vx, y: vy, zoom: fitZoom });

    updateStep4MaskCanvas(manualClone, croppedResult.width, croppedResult.height, true);
    setCurrentStep(4);
  };

  // Fit Step 4 Viewport
  const handleFitStep4View = useCallback(() => {
    if (!step4ContainerRef.current || !croppedResult) return;
    const cw = step4ContainerRef.current.clientWidth || 800;
    const ch = step4ContainerRef.current.clientHeight || 500;
    const scaleX = (cw - 40) / croppedResult.width;
    const scaleY = (ch - 40) / croppedResult.height;
    const fitZoom = Math.min(scaleX, scaleY, 1.0);
    const vx = (cw - croppedResult.width * fitZoom) / 2;
    const vy = (ch - croppedResult.height * fitZoom) / 2;
    setStep4Viewport({ x: vx, y: vy, zoom: fitZoom });
  }, [croppedResult]);

  // Step 4 Land ratio
  const step4LandRatio = useMemo(() => {
    if (!manualMask) return 0;
    let land = 0;
    for (let i = 0; i < manualMask.length; i++) {
      if (manualMask[i] === 1) land++;
    }
    return Number(((land / manualMask.length) * 100).toFixed(1));
  }, [manualMask, step4RedrawTrigger]);

  // Step 4 Canvas rendering
  const drawStep4Canvas = useCallback(() => {
    const canvas = step4CanvasRef.current;
    if (!canvas || !croppedResult || !manualMask) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#0c0a09';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(step4Viewport.x, step4Viewport.y);
    ctx.scale(step4Viewport.zoom, step4Viewport.zoom);

    // 1. Draw base original cropped image
    if (originalCanvasCache.current) {
      ctx.drawImage(originalCanvasCache.current, 0, 0);
    } else {
      ctx.putImageData(croppedResult.imageData, 0, 0);
    }

    // 2. Draw mask overlay with opacity
    if (step4MaskCanvasCache.current && step4OverlayOpacity > 0) {
      ctx.globalAlpha = step4OverlayOpacity;
      ctx.drawImage(step4MaskCanvasCache.current, 0, 0);
      ctx.globalAlpha = 1.0;
    }

    // 3. Draw red coastline outline
    if (step4OutlineCanvasCache.current) {
      ctx.drawImage(step4OutlineCanvasCache.current, 0, 0);
    }

    // 4. Draw polygon lasso if points exist
    if (step4LassoPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(step4LassoPoints[0][0], step4LassoPoints[0][1]);
      for (let i = 1; i < step4LassoPoints.length; i++) {
        ctx.lineTo(step4LassoPoints[i][0], step4LassoPoints[i][1]);
      }
      if (step4MousePos && step4Tool === 'lasso') {
        const mxImg = (step4MousePos.x - step4Viewport.x) / step4Viewport.zoom;
        const myImg = (step4MousePos.y - step4Viewport.y) / step4Viewport.zoom;
        ctx.lineTo(mxImg, myImg);
      }
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = Math.max(1, 2 / step4Viewport.zoom);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
      ctx.fill();
      ctx.stroke();

      for (let i = 0; i < step4LassoPoints.length; i++) {
        ctx.beginPath();
        const pt = step4LassoPoints[i];
        ctx.arc(pt[0], pt[1], Math.max(3, 4 / step4Viewport.zoom), 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#ef4444' : '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 1.5 / step4Viewport.zoom);
        ctx.stroke();
      }
    }

    // 5. Draw brush circle cursor
    if (step4MousePos && (step4Tool === 'brush_land' || step4Tool === 'brush_sea')) {
      const mxImg = (step4MousePos.x - step4Viewport.x) / step4Viewport.zoom;
      const myImg = (step4MousePos.y - step4Viewport.y) / step4Viewport.zoom;

      ctx.beginPath();
      ctx.arc(mxImg, myImg, step4BrushRadius, 0, Math.PI * 2);
      ctx.strokeStyle = step4Tool === 'brush_land' ? '#22c55e' : '#3b82f6';
      ctx.lineWidth = Math.max(1, 2 / step4Viewport.zoom);
      ctx.stroke();
      ctx.fillStyle =
        step4Tool === 'brush_land' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(59, 130, 246, 0.25)';
      ctx.fill();
    }

    ctx.restore();
  }, [
    croppedResult,
    manualMask,
    step4Viewport,
    step4OverlayOpacity,
    step4LassoPoints,
    step4MousePos,
    step4Tool,
    step4BrushRadius,
  ]);

  // Step 4 Canvas resize & redraw
  useEffect(() => {
    if (currentStep !== 4 || !step4ContainerRef.current || !step4CanvasRef.current) return;
    const updateSize = () => {
      if (!step4ContainerRef.current || !step4CanvasRef.current) return;
      const w = step4ContainerRef.current.clientWidth;
      const h = step4ContainerRef.current.clientHeight;
      if (w > 0 && h > 0) {
        step4CanvasRef.current.width = w;
        step4CanvasRef.current.height = h;
        drawStep4Canvas();
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [currentStep, drawStep4Canvas]);

  useEffect(() => {
    if (currentStep === 4) {
      drawStep4Canvas();
    }
  }, [currentStep, drawStep4Canvas, step4RedrawTrigger]);

  // Step 4 Undo / Redo handlers
  const handleMaskUndo = useCallback(() => {
    if (maskUndoStack.length === 0 || !manualMask || !croppedResult) return;
    const patch = maskUndoStack[maskUndoStack.length - 1];
    applyPatchToMask(manualMask, croppedResult.width, patch, 'before');
    setMaskUndoStack((prev) => prev.slice(0, prev.length - 1));
    setMaskRedoStack((prev) => [...prev, patch]);
    setHasEditedStep4(true);
    updateStep4MaskCanvas(manualMask, croppedResult.width, croppedResult.height, true);
    setStep4RedrawTrigger((t) => t + 1);
  }, [maskUndoStack, manualMask, croppedResult, updateStep4MaskCanvas]);

  const handleMaskRedo = useCallback(() => {
    if (maskRedoStack.length === 0 || !manualMask || !croppedResult) return;
    const patch = maskRedoStack[maskRedoStack.length - 1];
    applyPatchToMask(manualMask, croppedResult.width, patch, 'after');
    setMaskRedoStack((prev) => prev.slice(0, prev.length - 1));
    setMaskUndoStack((prev) => [...prev, patch]);
    setHasEditedStep4(true);
    updateStep4MaskCanvas(manualMask, croppedResult.width, croppedResult.height, true);
    setStep4RedrawTrigger((t) => t + 1);
  }, [maskRedoStack, manualMask, croppedResult, updateStep4MaskCanvas]);

  // Apply Polygon Lasso
  const handleApplyLasso = useCallback(
    (fillValue: 0 | 1) => {
      if (step4LassoPoints.length < 3 || !manualMask || !croppedResult) return;
      const patch = applyPolygonToMask(
        manualMask,
        croppedResult.width,
        croppedResult.height,
        step4LassoPoints,
        fillValue
      );
      if (patch) {
        setMaskUndoStack((prev) => [...prev.slice(-29), patch]);
        setMaskRedoStack([]);
        setHasEditedStep4(true);
      }
      setStep4LassoPoints([]);
      updateStep4MaskCanvas(manualMask, croppedResult.width, croppedResult.height, true);
      setStep4RedrawTrigger((t) => t + 1);
    },
    [step4LassoPoints, manualMask, croppedResult, updateStep4MaskCanvas]
  );

  // Reset to initial Step 3 segmentation mask
  const handleResetToInitialStep3 = useCallback(() => {
    if (!initialStep3Mask || !manualMask || !croppedResult) return;
    manualMask.set(initialStep3Mask);
    setMaskUndoStack([]);
    setMaskRedoStack([]);
    setHasEditedStep4(false);
    setStep4LassoPoints([]);
    setShowConfirmReset(false);
    updateStep4MaskCanvas(manualMask, croppedResult.width, croppedResult.height, true);
    setStep4RedrawTrigger((t) => t + 1);
  }, [initialStep3Mask, manualMask, croppedResult, updateStep4MaskCanvas]);

  // Confirm Apply to World Map with upsampling and worker progress
  const handleConfirmApplyWorld = useCallback(() => {
    if (!manualMask || !croppedResult) return;
    setApplyError(null);

    const dstDims = getResolutionDims(croppedResult.resolution);
    const dstCols = dstDims.width;
    const dstRows = dstDims.height;
    const srcCols = croppedResult.width;
    const srcRows = croppedResult.height;

    const finishApply = (elevationGrid?: Float32Array) => {
      const newMap = createMapDataFromMask(
        manualMask,
        dstCols,
        dstRows,
        {
          gridResolution: croppedResult.resolution,
          coastlineComplexity: riaRoughness,
          riaRoughness,
        } as any,
        elevationGrid
      );
      setIsApplyingToWorld(false);
      setShowConfirmApply(false);
      onApplyToWorldMap?.(newMap);
      onCropped?.({
        ...croppedResult,
        mask: manualMask,
        boundaryMask: computeCoastlineOutline(manualMask, srcCols, srcRows),
      });
      onClose();
    };

    // If source and destination dimensions are identical, apply directly
    if (srcCols === dstCols && srcRows === dstRows) {
      finishApply();
      return;
    }

    // High-resolution upsampling via Web Worker
    setIsApplyingToWorld(true);
    setApplyProgress({ step: 'マスクを拡大中...', percent: 10 });

    if (upsampleWorkerRef.current) {
      const maskCopy = new Uint8Array(manualMask);
      const req: UpsampleWorkerRequest = {
        type: 'upsample',
        sourceMask: maskCopy,
        srcWidth: srcCols,
        srcHeight: srcRows,
        dstWidth: dstCols,
        dstHeight: dstRows,
        seaLevel: STANDARD_SEA_LEVEL,
        riaRoughness,
      };

      const handleWorkerMessage = (e: MessageEvent<UpsampleWorkerResponse>) => {
        const data = e.data;
        if (data.type === 'progress') {
          setApplyProgress({ step: data.step, percent: data.percent });
        } else if (data.type === 'complete') {
          upsampleWorkerRef.current?.removeEventListener('message', handleWorkerMessage);
          finishApply(data.elevationGrid);
        } else if (data.type === 'error') {
          upsampleWorkerRef.current?.removeEventListener('message', handleWorkerMessage);
          setIsApplyingToWorld(false);
          setApplyError(data.error || 'メモリが足りません。解像度を下げてお試しください');
        }
      };

      upsampleWorkerRef.current.addEventListener('message', handleWorkerMessage);
      upsampleWorkerRef.current.postMessage(req, [maskCopy.buffer]);
    } else {
      // Fallback if Web Worker is unavailable
      setTimeout(() => {
        try {
          const elevationGrid = buildElevationFromMask(
            manualMask,
            srcCols,
            srcRows,
            dstCols,
            dstRows,
            STANDARD_SEA_LEVEL,
            {
              riaRoughness,
              onProgress: (percent, step) => {
                setApplyProgress({ step, percent });
              },
            }
          );
          finishApply(elevationGrid);
        } catch (err: any) {
          setIsApplyingToWorld(false);
          setApplyError('メモリが足りません。解像度を下げてお試しください');
        }
      }, 50);
    }
  }, [manualMask, croppedResult, onApplyToWorldMap, onCropped, onClose, riaRoughness]);

  // Step 4 Mouse interactions
  const handleStep4MouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!step4ContainerRef.current || !croppedResult || !manualMask) return;
    const rect = step4ContainerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Pan with space or middle click or pan tool
    if (isSpacePressed || e.button === 1 || step4Tool === 'pan') {
      step4DragRef.current = {
        isDragging: true,
        startX: mx,
        startY: my,
        startVp: { x: step4Viewport.x, y: step4Viewport.y },
      };
      return;
    }

    const imgX = (mx - step4Viewport.x) / step4Viewport.zoom;
    const imgY = (my - step4Viewport.y) / step4Viewport.zoom;
    const isInside =
      imgX >= 0 && imgX < croppedResult.width && imgY >= 0 && imgY < croppedResult.height;

    if (!isInside || e.button !== 0) return;

    if (step4Tool === 'brush_land' || step4Tool === 'brush_sea') {
      strokeStartMaskSnapshot.current = new Uint8Array(manualMask);
      isStep4DrawingRef.current = true;
      lastBrushPosRef.current = { x: imgX, y: imgY };
      const val: 0 | 1 = step4Tool === 'brush_land' ? 1 : 0;
      applyBrushToMask(
        manualMask,
        croppedResult.width,
        croppedResult.height,
        Math.round(imgX),
        Math.round(imgY),
        step4BrushRadius,
        val
      );
      updateStep4MaskCanvas(manualMask, croppedResult.width, croppedResult.height, false);
      setStep4RedrawTrigger((t) => t + 1);
    } else if (step4Tool === 'bucket') {
      const fillRes = floodFillMask(
        manualMask,
        croppedResult.width,
        croppedResult.height,
        Math.floor(imgX),
        Math.floor(imgY)
      );
      if (fillRes) {
        setMaskUndoStack((prev) => [...prev.slice(-29), fillRes.patch]);
        setMaskRedoStack([]);
        setHasEditedStep4(true);
        updateStep4MaskCanvas(manualMask, croppedResult.width, croppedResult.height, true);
        setStep4RedrawTrigger((t) => t + 1);
      }
    } else if (step4Tool === 'lasso') {
      setStep4LassoPoints((prev) => [...prev, [Math.round(imgX), Math.round(imgY)]]);
      setStep4RedrawTrigger((t) => t + 1);
    }
  };

  const handleStep4MouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!step4ContainerRef.current || !croppedResult || !manualMask) return;
    const rect = step4ContainerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    setStep4MousePos({ x: mx, y: my });

    if (step4DragRef.current.isDragging) {
      const dx = mx - step4DragRef.current.startX;
      const dy = my - step4DragRef.current.startY;
      setStep4Viewport({
        x: step4DragRef.current.startVp.x + dx,
        y: step4DragRef.current.startVp.y + dy,
        zoom: step4Viewport.zoom,
      });
      return;
    }

    const imgX = (mx - step4Viewport.x) / step4Viewport.zoom;
    const imgY = (my - step4Viewport.y) / step4Viewport.zoom;

    if (
      isStep4DrawingRef.current &&
      (step4Tool === 'brush_land' || step4Tool === 'brush_sea') &&
      lastBrushPosRef.current
    ) {
      const val: 0 | 1 = step4Tool === 'brush_land' ? 1 : 0;
      applyBrushStrokeToMask(
        manualMask,
        croppedResult.width,
        croppedResult.height,
        [
          [lastBrushPosRef.current.x, lastBrushPosRef.current.y],
          [imgX, imgY],
        ],
        step4BrushRadius,
        val
      );
      lastBrushPosRef.current = { x: imgX, y: imgY };
      updateStep4MaskCanvas(manualMask, croppedResult.width, croppedResult.height, false);
      setStep4RedrawTrigger((t) => t + 1);
    }
  };

  const handleStep4MouseUp = () => {
    step4DragRef.current.isDragging = false;

    if (isStep4DrawingRef.current && strokeStartMaskSnapshot.current && manualMask && croppedResult) {
      isStep4DrawingRef.current = false;
      lastBrushPosRef.current = null;

      const start = strokeStartMaskSnapshot.current;
      const current = manualMask;
      const w = croppedResult.width;
      const h = croppedResult.height;

      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const idx = row + x;
          if (start[idx] !== current[idx]) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX >= minX && maxY >= minY) {
        const pw = maxX - minX + 1;
        const ph = maxY - minY + 1;
        const before = new Uint8Array(pw * ph);
        const after = new Uint8Array(pw * ph);
        for (let py = 0; py < ph; py++) {
          const srcY = minY + py;
          for (let px = 0; px < pw; px++) {
            const srcX = minX + px;
            const srcIdx = srcY * w + srcX;
            const pIdx = py * pw + px;
            before[pIdx] = start[srcIdx];
            after[pIdx] = current[srcIdx];
          }
        }
        const patch: MaskPatch = { minX, minY, width: pw, height: ph, before, after };
        setMaskUndoStack((prev) => [...prev.slice(-29), patch]);
        setMaskRedoStack([]);
        setHasEditedStep4(true);
      }
      strokeStartMaskSnapshot.current = null;
      updateStep4MaskCanvas(manualMask, w, h, true);
      setStep4RedrawTrigger((t) => t + 1);
    }
  };

  const handleStep4Wheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!step4ContainerRef.current) return;
    const rect = step4ContainerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const nextZoom = Math.max(0.05, Math.min(12, step4Viewport.zoom * zoomFactor));

    const newX = mx - (mx - step4Viewport.x) * (nextZoom / step4Viewport.zoom);
    const newY = my - (my - step4Viewport.y) * (nextZoom / step4Viewport.zoom);

    setStep4Viewport({ x: newX, y: newY, zoom: nextZoom });
  };

  // Step 4 Keyboard shortcuts (Undo/Redo/Escape)
  useEffect(() => {
    if (currentStep !== 4) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        handleMaskUndo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyZ') ||
        ((e.ctrlKey || e.metaKey) && e.code === 'KeyY')
      ) {
        e.preventDefault();
        handleMaskRedo();
      } else if (e.code === 'Escape') {
        if (step4LassoPoints.length > 0) {
          setStep4LassoPoints([]);
          setStep4RedrawTrigger((t) => t + 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, handleMaskUndo, handleMaskRedo, step4LassoPoints]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/85 backdrop-blur-md">
      <div className="relative w-full max-w-6xl h-[92vh] bg-stone-900 border border-stone-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-stone-200">
        {/* Header with 4-Step Indicator */}
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
                    : currentStep === 3
                    ? '第2段階: 陸海自動判定'
                    : '第3段階: 陸海手動補正'}
                </span>
              </h2>
              <p className="text-[11px] text-stone-400">
                {currentStep === 4
                  ? 'ブラシや塗りつぶしで陸海マスクを手動補正し、確定後に世界マップへ反映します'
                  : currentStep === 3
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
              <span>2:1切抜</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-stone-600" />
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md ${
                currentStep === 3
                  ? 'bg-amber-500 text-stone-950 font-bold shadow'
                  : currentStep > 3
                  ? 'text-amber-400'
                  : 'text-stone-500'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-stone-950/20 flex items-center justify-center text-[10px]">3</span>
              <span>陸海の判定</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-stone-600" />
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md ${
                currentStep === 4
                  ? 'bg-amber-500 text-stone-950 font-bold shadow'
                  : 'text-stone-500'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-stone-950/20 flex items-center justify-center text-[10px]">4</span>
              <span>陸海の手動補正</span>
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

                {/* Resolution Selectors (Output Resolution & Analysis Resolution) */}
                <div className="space-y-3 p-3 rounded-xl bg-stone-900/70 border border-stone-800">
                  {/* Output Resolution */}
                  <div className="space-y-1.5">
                    <div className="font-bold text-stone-200 flex items-center justify-between">
                      <span>出力解像度（2:1）</span>
                      <span className="font-mono text-[10px] text-amber-400">
                        {outputDims.width} × {outputDims.height}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-1.5">
                      {/* 1024x512 */}
                      {(() => {
                        const isDisabled = maxTextureSize !== null && 1024 > maxTextureSize;
                        return (
                          <label
                            className={`p-2 rounded-lg border transition flex items-center justify-between ${
                              isDisabled
                                ? 'bg-stone-900/40 border-stone-800/60 opacity-40 cursor-not-allowed'
                                : resolution === '1024x512'
                                ? 'bg-amber-950/60 border-amber-500/80 text-amber-200 cursor-pointer'
                                : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="outputResolution"
                                value="1024x512"
                                disabled={isDisabled}
                                checked={resolution === '1024x512'}
                                onChange={() => setResolution('1024x512')}
                                className="accent-amber-500"
                              />
                              <div>
                                <div className="font-mono font-bold text-xs">1024 × 512</div>
                                <div className="text-[10px] text-stone-400">
                                  標準・軽量（標高格子: 約2MB）
                                </div>
                                {isDisabled && (
                                  <div className="text-[10px] text-rose-400">
                                    この環境では使えません（最大テクスチャサイズ: {maxTextureSize}）
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                              高速
                            </span>
                          </label>
                        );
                      })()}

                      {/* 2048x1024 */}
                      {(() => {
                        const isDisabled = maxTextureSize !== null && 2048 > maxTextureSize;
                        return (
                          <label
                            className={`p-2 rounded-lg border transition flex items-center justify-between ${
                              isDisabled
                                ? 'bg-stone-900/40 border-stone-800/60 opacity-40 cursor-not-allowed'
                                : resolution === '2048x1024'
                                ? 'bg-amber-950/60 border-amber-500/80 text-amber-200 cursor-pointer'
                                : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="outputResolution"
                                value="2048x1024"
                                disabled={isDisabled}
                                checked={resolution === '2048x1024'}
                                onChange={() => setResolution('2048x1024')}
                                className="accent-amber-500"
                              />
                              <div>
                                <div className="font-mono font-bold text-xs">2048 × 1024</div>
                                <div className="text-[10px] text-stone-400">
                                  高精細（標高格子: 約8MB）
                                </div>
                                {isDisabled && (
                                  <div className="text-[10px] text-rose-400">
                                    この環境では使えません（最大テクスチャサイズ: {maxTextureSize}）
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-700 text-stone-300 font-mono">
                              HD
                            </span>
                          </label>
                        );
                      })()}

                      {/* 4096x2048 */}
                      {(() => {
                        const isDisabled = maxTextureSize !== null && 4096 > maxTextureSize;
                        return (
                          <label
                            className={`p-2 rounded-lg border transition flex items-center justify-between ${
                              isDisabled
                                ? 'bg-stone-900/40 border-stone-800/60 opacity-40 cursor-not-allowed'
                                : resolution === '4096x2048'
                                ? 'bg-amber-950/60 border-amber-500/80 text-amber-200 cursor-pointer'
                                : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="outputResolution"
                                value="4096x2048"
                                disabled={isDisabled}
                                checked={resolution === '4096x2048'}
                                onChange={() => setResolution('4096x2048')}
                                className="accent-amber-500"
                              />
                              <div>
                                <div className="font-mono font-bold text-xs">4096 × 2048</div>
                                <div className="text-[10px] text-stone-400">
                                  超高精細（標高格子: 約34MB）
                                </div>
                                {isDisabled && (
                                  <div className="text-[10px] text-rose-400">
                                    この環境では使えません（最大テクスチャサイズ: {maxTextureSize}）
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-300 font-mono">
                              4K
                            </span>
                          </label>
                        );
                      })()}

                      {/* 8192x4096 */}
                      {(() => {
                        const isDisabled = maxTextureSize !== null && 8192 > maxTextureSize;
                        return (
                          <label
                            className={`p-2 rounded-lg border transition flex items-center justify-between ${
                              isDisabled
                                ? 'bg-stone-900/40 border-stone-800/60 opacity-40 cursor-not-allowed'
                                : resolution === '8192x4096'
                                ? 'bg-amber-950/60 border-amber-500/80 text-amber-200 cursor-pointer'
                                : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="outputResolution"
                                value="8192x4096"
                                disabled={isDisabled}
                                checked={resolution === '8192x4096'}
                                onChange={() => setResolution('8192x4096')}
                                className="accent-amber-500"
                              />
                              <div>
                                <div className="font-mono font-bold text-xs">8192 × 4096</div>
                                <div className="text-[10px] text-stone-400">
                                  極大解像度（標高格子: 約134MB）
                                </div>
                                <div className="text-[10px] text-amber-400/90 leading-tight mt-0.5">
                                  ※ メモリの多いPC向け。保存や読み込みも重くなります
                                </div>
                                {isDisabled && (
                                  <div className="text-[10px] text-rose-400">
                                    この環境では使えません（最大テクスチャサイズ: {maxTextureSize}）
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">
                              8K
                            </span>
                          </label>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Analysis Resolution Selector */}
                  <div className="space-y-1.5 pt-2 border-t border-stone-800/80">
                    <div className="font-bold text-stone-200 flex items-center justify-between">
                      <span>判定・補正解像度</span>
                      <span className="font-mono text-[10px] text-amber-400">
                        {effectiveAnalysisDims.width} × {effectiveAnalysisDims.height}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-1.5">
                      {/* Auto */}
                      <label
                        className={`p-2 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          analysisResolution === 'auto'
                            ? 'bg-amber-950/60 border-amber-500/80 text-amber-200'
                            : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="analysisResolution"
                            value="auto"
                            checked={analysisResolution === 'auto'}
                            onChange={() => setAnalysisResolution('auto')}
                            className="accent-amber-500"
                          />
                          <div>
                            <div className="font-bold text-xs">自動（初期値・推奨）</div>
                            <div className="text-[10px] text-stone-400">
                              元画像と出力解像度から最適化（最大 2048×1024）
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                          Auto
                        </span>
                      </label>

                      {/* 1024x512 */}
                      <label
                        className={`p-2 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          analysisResolution === '1024x512'
                            ? 'bg-amber-950/60 border-amber-500/80 text-amber-200'
                            : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="analysisResolution"
                            value="1024x512"
                            checked={analysisResolution === '1024x512'}
                            onChange={() => setAnalysisResolution('1024x512')}
                            className="accent-amber-500"
                          />
                          <div>
                            <div className="font-mono font-bold text-xs">1024 × 512</div>
                            <div className="text-[10px] text-stone-400">最軽量・高速判定</div>
                          </div>
                        </div>
                      </label>

                      {/* 2048x1024 */}
                      <label
                        className={`p-2 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          analysisResolution === '2048x1024'
                            ? 'bg-amber-950/60 border-amber-500/80 text-amber-200'
                            : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="analysisResolution"
                            value="2048x1024"
                            checked={analysisResolution === '2048x1024'}
                            onChange={() => setAnalysisResolution('2048x1024')}
                            className="accent-amber-500"
                          />
                          <div>
                            <div className="font-mono font-bold text-xs">2048 × 1024</div>
                            <div className="text-[10px] text-stone-400">標準高解像度判定</div>
                          </div>
                        </div>
                      </label>

                      {/* 4096x2048 */}
                      {(() => {
                        const isCropTooSmall = Math.round(crop.width) < 4096;
                        return (
                          <label
                            className={`p-2 rounded-lg border transition flex items-center justify-between ${
                              isCropTooSmall
                                ? 'bg-stone-900/40 border-stone-800/60 opacity-40 cursor-not-allowed'
                                : analysisResolution === '4096x2048'
                                ? 'bg-amber-950/60 border-amber-500/80 text-amber-200 cursor-pointer'
                                : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-600 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="analysisResolution"
                                value="4096x2048"
                                disabled={isCropTooSmall}
                                checked={analysisResolution === '4096x2048'}
                                onChange={() => setAnalysisResolution('4096x2048')}
                                className="accent-amber-500"
                              />
                              <div>
                                <div className="font-mono font-bold text-xs">4096 × 2048</div>
                                <div className="text-[10px] text-stone-400">
                                  超高解像度判定（手動指定のみ）
                                </div>
                                {isCropTooSmall && (
                                  <div className="text-[10px] text-amber-400/90 leading-tight mt-0.5">
                                    元画像の切り抜き幅が4096px未満のため選択できません（現在の切り抜き幅: {Math.round(crop.width)}px）
                                  </div>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Summary & Memory Estimate */}
                  <div className="p-2.5 rounded-lg bg-stone-950/70 border border-stone-800 space-y-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-stone-400">判定解像度:</span>
                      <span className="font-mono font-bold text-amber-300">
                        {effectiveAnalysisDims.width} × {effectiveAnalysisDims.height}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-stone-400">出力解像度:</span>
                      <span className="font-mono font-bold text-stone-200">
                        {outputDims.width} × {outputDims.height}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-stone-400">判定時メモリ見積もり:</span>
                      <span
                        className={`font-mono font-bold ${
                          segMemoryEstimate.isTooLarge ? 'text-rose-400' : 'text-emerald-400'
                        }`}
                      >
                        {segMemoryEstimate.formatted}
                      </span>
                    </div>

                    {segMemoryEstimate.isTooLarge && (
                      <div className="p-2 rounded bg-rose-950/60 border border-rose-600/70 text-rose-300 text-[10px] leading-tight mt-1">
                        ⚠️ メモリ見積もりが1.2GBを超えているため実行できません。判定解像度を下げてください。
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="mt-auto pt-2 space-y-2">
                  <button
                    type="button"
                    onClick={handleProceedToStep3}
                    disabled={segMemoryEstimate.isTooLarge}
                    className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                      segMemoryEstimate.isTooLarge
                        ? 'bg-stone-800 text-stone-500 cursor-not-allowed border border-stone-700'
                        : 'bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-500 text-stone-950 shadow-lg shadow-amber-950/40 ring-1 ring-amber-400 cursor-pointer active:scale-98'
                    }`}
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
                  cursor: isSpacePressed
                    ? 'grab'
                    : activeStep3Tool === 'dropper_sea' || activeStep3Tool === 'dropper_land'
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
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
                  <div className="flex items-center bg-stone-900/90 backdrop-blur-md p-1 rounded-xl border border-stone-700/80 shadow-2xl text-xs">
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

                  {/* Seed Visualization Toggle */}
                  <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-900/90 backdrop-blur-md border border-stone-700/80 shadow-2xl text-xs text-stone-200 hover:text-white cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showSeeds}
                      onChange={(e) => setShowSeeds(e.target.checked)}
                      className="accent-amber-500 rounded cursor-pointer w-3.5 h-3.5"
                    />
                    <span className="font-medium text-[11px]">
                      シードを表示 (<span className="text-blue-400 font-bold">青:海</span> / <span className="text-red-400 font-bold">赤:陸</span>)
                    </span>
                  </label>

                  {/* Resolution Indicator Pill */}
                  <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-stone-900/90 backdrop-blur-md border border-stone-700/80 shadow-2xl text-[11px] font-mono">
                    <span className="text-amber-300 font-bold">判定: {croppedResult.width}×{croppedResult.height}</span>
                    <span className="text-stone-500">|</span>
                    <span className="text-stone-200">出力: {getResolutionDims(croppedResult.resolution).width}×{getResolutionDims(croppedResult.resolution).height}</span>
                  </div>
                </div>

                {/* Insufficient Seeds Alert Banner */}
                {seedError && (
                  <div className="absolute top-16 left-1/2 -translate-x-1/2 max-w-xl w-[92%] bg-amber-950/95 border border-amber-500/90 shadow-2xl rounded-xl p-3 backdrop-blur-md z-20 text-amber-200 text-xs flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <div className="font-bold text-amber-300">シードが不足しています</div>
                      <div className="text-[11px] leading-relaxed text-amber-100">{seedError}</div>
                      {seedCounts && (
                        <div className="text-[10px] font-mono text-amber-300/80 pt-0.5">
                          海シード: {seedCounts.seaSeedCount.toLocaleString()} px ({seedCounts.seaSeedPercent}%) /
                          陸シード: {seedCounts.landSeedCount.toLocaleString()} px ({seedCounts.landSeedPercent}%)
                          （各0.5%以上必要）
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Extreme Land Ratio Warning Banner */}
                {!seedError && segmentationStats && (segmentationStats.landRatio >= 90 || segmentationStats.landRatio <= 3) && (
                  <div className="absolute top-16 left-1/2 -translate-x-1/2 max-w-xl w-[92%] bg-red-950/95 border border-red-500/90 shadow-2xl rounded-xl p-3 backdrop-blur-md z-20 text-red-200 text-xs flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <div className="font-bold text-red-300">
                        判定結果が偏っています（陸地比率 {segmentationStats.landRatio}%）
                      </div>
                      <div className="text-[11px] leading-relaxed text-red-100">
                        判定結果が偏っています。海と陸の色をそれぞれ3箇所以上スポイトで指定するか、外周の海幅を広げてください。
                      </div>
                    </div>
                  </div>
                )}

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
                    <span>海の色を選ぶ</span>
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
                    <span>陸の色を選ぶ</span>
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
                        <span>ホイールでズーム、スペース+ドラッグでパン。スポイトまたは代表色提案で色を指定できます</span>
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
                <div className="space-y-2.5 p-3 rounded-xl bg-stone-900/80 border border-stone-800">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-stone-200 flex items-center gap-1.5">
                      <Pipette className="w-3.5 h-3.5 text-amber-400" />
                      <span>シード指定（色のスポイト）</span>
                    </span>
                    {(seaSamples.length > 0 || landSamples.length > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSeaSamples([]);
                          setLandSamples([]);
                          setClusterAssignments({});
                          triggerSegmentation(croppedResult, { seaSamples: [], landSamples: [] });
                        }}
                        className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>全消去</span>
                      </button>
                    )}
                  </div>

                  {/* Seed Pixel Counts Banner */}
                  <div className="p-2 rounded-lg bg-stone-950/70 border border-stone-800 text-[11px] space-y-1">
                    <div className="flex justify-between items-center text-stone-300">
                      <span className="text-[10px] text-stone-400">検出シード画素数:</span>
                      <span className="text-[9px] text-stone-500">（基準: 各0.5%以上）</span>
                    </div>
                    <div className="font-mono text-[10px] flex flex-col gap-0.5">
                      <div className={`flex items-center justify-between ${seedCounts && seedCounts.seaSeedPercent >= 0.5 ? 'text-blue-300' : 'text-amber-400 font-bold'}`}>
                        <span>🌊 海シード:</span>
                        <span>{seedCounts ? seedCounts.seaSeedCount.toLocaleString() : 0} px ({seedCounts?.seaSeedPercent ?? 0}%)</span>
                      </div>
                      <div className={`flex items-center justify-between ${seedCounts && seedCounts.landSeedPercent >= 0.5 ? 'text-emerald-300' : 'text-amber-400 font-bold'}`}>
                        <span>⛰️ 陸シード:</span>
                        <span>{seedCounts ? seedCounts.landSeedCount.toLocaleString() : 0} px ({seedCounts?.landSeedPercent ?? 0}%)</span>
                      </div>
                    </div>
                  </div>

                  {/* Propose Color Palette Button (k-means) */}
                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={handleProposeColors}
                      disabled={isGeneratingClusters}
                      className="w-full py-1.5 px-3 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 text-amber-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Palette className="w-3.5 h-3.5 text-amber-400" />
                      <span>{suggestedClusters.length > 0 ? '色の候補を再提案' : '色の候補を提案（k-means）'}</span>
                    </button>
                  </div>

                  {/* Display suggested color clusters if available */}
                  {suggestedClusters.length > 0 && (
                    <div className="space-y-1.5 p-2 rounded-lg bg-stone-950/80 border border-stone-800">
                      <div className="flex items-center justify-between text-[11px] font-bold text-stone-300">
                        <span>色の候補（Lab k=6）</span>
                        <span className="text-[9px] text-stone-500 font-normal">面積割合順</span>
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                        {suggestedClusters.map((cluster) => {
                          const currentRole = clusterAssignments[cluster.id] || 'ignore';
                          return (
                            <div
                              key={cluster.id}
                              className="flex items-center justify-between gap-1 p-1.5 rounded-lg bg-stone-900 border border-stone-800 text-[10px]"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="w-4 h-4 rounded border border-stone-600 shadow-sm shrink-0"
                                  style={{ backgroundColor: cluster.hex }}
                                />
                                <div className="truncate">
                                  <span className="font-mono text-stone-200 font-bold">{cluster.ratioPercent}%</span>
                                  <span className="text-[9px] text-stone-500 font-mono ml-1">{cluster.hex}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleAssignClusterColor(cluster, 'sea')}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition cursor-pointer ${
                                    currentRole === 'sea'
                                      ? 'bg-blue-600 text-white font-bold ring-1 ring-blue-400'
                                      : 'bg-stone-800 text-blue-300 hover:bg-blue-950'
                                  }`}
                                >
                                  海
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAssignClusterColor(cluster, 'land')}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition cursor-pointer ${
                                    currentRole === 'land'
                                      ? 'bg-amber-600 text-stone-950 font-bold ring-1 ring-amber-300'
                                      : 'bg-stone-800 text-amber-300 hover:bg-amber-950'
                                  }`}
                                >
                                  陸
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAssignClusterColor(cluster, 'ignore')}
                                  className={`px-1.5 py-0.5 rounded text-[10px] transition cursor-pointer ${
                                    currentRole === 'ignore'
                                      ? 'bg-stone-700 text-stone-300 font-medium'
                                      : 'bg-stone-800 text-stone-500 hover:text-stone-300'
                                  }`}
                                >
                                  無視
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

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
                      <span className="text-stone-300">ぼかし強度 (メディアン半径 0〜6)</span>
                      <span className="font-mono text-amber-400 font-bold">
                        {medianRadius === 0 ? '無効 (0)' : `${medianRadius * 2 + 1}×${medianRadius * 2 + 1} (半径${medianRadius})`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={6}
                      step={1}
                      value={medianRadius}
                      onChange={(e) => setMedianRadius(Number(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-800 rounded-lg"
                    />
                    <div className="flex justify-between text-[9px] text-stone-500">
                      <span>なし (0)</span>
                      <span>標準 (3: 7×7)</span>
                      <span>最大 (6: 13×13)</span>
                    </div>
                  </div>

                  {/* Island Removal Area Threshold */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-stone-300">小さな島を除去する最小面積</span>
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
                      <span>微小島も残す (0.05%)</span>
                      <span>初期値 (0.20%)</span>
                      <span>大島のみ (2.0%)</span>
                    </div>
                  </div>

                  {/* Smoothing Iterations */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-stone-300">海岸線の滑らかさ (0〜4回)</span>
                      <span className="font-mono text-amber-400 font-bold">
                        {smoothingIterations === 0 ? 'なし (0回)' : `${smoothingIterations}回`}
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
                    <div className="flex justify-between text-[9px] text-stone-500">
                      <span>なし</span>
                      <span>標準 (1回)</span>
                      <span>滑らか (4回)</span>
                    </div>
                  </div>

                  {/* Outer margin in percent */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-stone-300">画像外周を海とみなす幅</span>
                      <span className="font-mono text-amber-400 font-bold">
                        {marginPercent === 0
                          ? '無効 (0%)'
                          : `${marginPercent}% (約${Math.round(
                              (croppedResult?.width || 1024) * (marginPercent / 100)
                            )}px)`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={0.5}
                      value={marginPercent}
                      onChange={(e) => setMarginPercent(Number(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-800 rounded-lg"
                    />
                    <div className="flex justify-between text-[9px] text-stone-500">
                      <span>無効 (0%)</span>
                      <span>初期値 (3%)</span>
                      <span>広め (8%)</span>
                    </div>
                  </div>

                  {/* Re-calculate Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (hasEditedStep4) {
                        setShowConfirmReSegment(true);
                      } else {
                        triggerSegmentation();
                      }
                    }}
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
                    onClick={handleProceedToStep4}
                    disabled={!segmentationMask || isSegmenting || !!seedError}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-500 text-stone-950 flex items-center justify-center gap-1.5 transition shadow shadow-amber-950/40 cursor-pointer active:scale-98 disabled:opacity-50"
                  >
                    <span>次へ（手動補正へ進む）</span>
                    <ChevronRight className="w-4 h-4 font-bold" />
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

          {/* STEP 4: 陸海マスクの手動補正 */}
          {currentStep === 4 && croppedResult && manualMask && (
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
              {/* Main Interactive Canvas Area */}
              <div
                ref={step4ContainerRef}
                className="flex-1 bg-stone-950 relative overflow-hidden flex items-center justify-center select-none"
              >
                <canvas
                  ref={step4CanvasRef}
                  onMouseDown={handleStep4MouseDown}
                  onMouseMove={handleStep4MouseMove}
                  onMouseUp={handleStep4MouseUp}
                  onMouseLeave={handleStep4MouseUp}
                  onWheel={handleStep4Wheel}
                  className="w-full h-full block cursor-crosshair"
                />

                {/* Floating Top-Left Tool Bar */}
                <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl bg-stone-900/90 border border-stone-700/80 shadow-2xl backdrop-blur-md z-10 text-xs">
                  {/* Land Brush */}
                  <button
                    type="button"
                    onClick={() => {
                      setStep4Tool('brush_land');
                      setStep4LassoPoints([]);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      step4Tool === 'brush_land'
                        ? 'bg-emerald-600 text-white shadow shadow-emerald-950 font-bold'
                        : 'text-stone-300 hover:bg-stone-800'
                    }`}
                    title="陸ブラシ (円形で陸地を塗る)"
                  >
                    <Mountain className="w-3.5 h-3.5 text-emerald-300" />
                    <span>陸ブラシ</span>
                  </button>

                  {/* Sea Brush */}
                  <button
                    type="button"
                    onClick={() => {
                      setStep4Tool('brush_sea');
                      setStep4LassoPoints([]);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      step4Tool === 'brush_sea'
                        ? 'bg-blue-600 text-white shadow shadow-blue-950 font-bold'
                        : 'text-stone-300 hover:bg-stone-800'
                    }`}
                    title="海ブラシ (円形で海を塗る)"
                  >
                    <Waves className="w-3.5 h-3.5 text-blue-300" />
                    <span>海ブラシ</span>
                  </button>

                  {/* Bucket Fill */}
                  <button
                    type="button"
                    onClick={() => {
                      setStep4Tool('bucket');
                      setStep4LassoPoints([]);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      step4Tool === 'bucket'
                        ? 'bg-amber-600 text-stone-950 font-bold shadow shadow-amber-950'
                        : 'text-stone-300 hover:bg-stone-800'
                    }`}
                    title="塗りつぶし (同じ値の領域を反転)"
                  >
                    <PaintBucket className="w-3.5 h-3.5" />
                    <span>塗りつぶし</span>
                  </button>

                  {/* Polygon Lasso */}
                  <button
                    type="button"
                    onClick={() => setStep4Tool('lasso')}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      step4Tool === 'lasso'
                        ? 'bg-purple-600 text-white shadow shadow-purple-950 font-bold'
                        : 'text-stone-300 hover:bg-stone-800'
                    }`}
                    title="線で囲む (多角形を描いて内側を一括塗り)"
                  >
                    <Spline className="w-3.5 h-3.5" />
                    <span>線で囲む</span>
                  </button>

                  {/* Pan Tool */}
                  <button
                    type="button"
                    onClick={() => {
                      setStep4Tool('pan');
                      setStep4LassoPoints([]);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      step4Tool === 'pan'
                        ? 'bg-stone-700 text-white font-bold'
                        : 'text-stone-300 hover:bg-stone-800'
                    }`}
                    title="移動 (Spaceキー長押しでも移動可能)"
                  >
                    <Move className="w-3.5 h-3.5" />
                    <span>移動</span>
                  </button>

                  <div className="w-[1px] h-5 bg-stone-700 mx-1" />

                  {/* Undo Button */}
                  <button
                    type="button"
                    onClick={handleMaskUndo}
                    disabled={maskUndoStack.length === 0}
                    className="p-1.5 rounded-lg text-stone-300 hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="元に戻す (Ctrl+Z)"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>

                  {/* Redo Button */}
                  <button
                    type="button"
                    onClick={handleMaskRedo}
                    disabled={maskRedoStack.length === 0}
                    className="p-1.5 rounded-lg text-stone-300 hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="やり直し (Ctrl+Shift+Z)"
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>

                  <div className="w-[1px] h-5 bg-stone-700 mx-1" />

                  {/* Zoom controls */}
                  <button
                    type="button"
                    onClick={() =>
                      setStep4Viewport((v) => ({ ...v, zoom: Math.max(0.05, v.zoom * 0.85) }))
                    }
                    className="p-1.5 rounded-lg text-stone-300 hover:bg-stone-800 transition"
                    title="縮小"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-[11px] text-stone-400 px-1">
                    {Math.round(step4Viewport.zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setStep4Viewport((v) => ({ ...v, zoom: Math.min(12, v.zoom * 1.15) }))
                    }
                    className="p-1.5 rounded-lg text-stone-300 hover:bg-stone-800 transition"
                    title="拡大"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleFitStep4View}
                    className="p-1.5 rounded-lg text-stone-300 hover:bg-stone-800 transition"
                    title="全体表示"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Floating Lasso Actions Panel (Visible when points placed) */}
                {step4Tool === 'lasso' && step4LassoPoints.length > 0 && (
                  <div className="absolute top-16 left-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-950/95 border border-purple-500/60 shadow-2xl backdrop-blur-md z-10 text-xs text-purple-200">
                    <span className="font-semibold">
                      多角形: {step4LassoPoints.length} 点
                    </span>
                    {step4LassoPoints.length >= 3 && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApplyLasso(1)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition flex items-center gap-1 cursor-pointer"
                        >
                          <Mountain className="w-3.5 h-3.5" />
                          <span>陸にする</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyLasso(0)}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition flex items-center gap-1 cursor-pointer"
                        >
                          <Waves className="w-3.5 h-3.5" />
                          <span>海にする</span>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setStep4LassoPoints([]);
                        setStep4RedrawTrigger((t) => t + 1);
                      }}
                      className="px-2 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px] transition cursor-pointer"
                    >
                      クリア (Esc)
                    </button>
                  </div>
                )}

                {/* Bottom Canvas Hints */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[11px] text-stone-400 bg-stone-900/80 px-3 py-1.5 rounded-lg border border-stone-800 pointer-events-none backdrop-blur-sm">
                  <span>
                    左ドラッグ: 描画 | ホイール: 拡大縮小 | Space+ドラッグ: パン | Ctrl+Z: 元に戻す
                  </span>
                  <span className="font-mono text-stone-300">
                    {croppedResult.width} × {croppedResult.height}
                  </span>
                </div>
              </div>

              {/* Step 4 Right Sidebar */}
              <div className="w-full md:w-80 lg:w-96 bg-stone-950/95 border-l border-stone-800 p-4 flex flex-col gap-3.5 overflow-y-auto shrink-0 text-xs text-stone-300">
                {/* Tool Settings Card */}
                <div className="p-3.5 rounded-xl bg-stone-900/90 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-amber-200">
                    <span className="flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-amber-400" />
                      <span>ツールの設定</span>
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-800 text-stone-400 font-normal">
                      {step4Tool === 'brush_land'
                        ? '陸ブラシ'
                        : step4Tool === 'brush_sea'
                        ? '海ブラシ'
                        : step4Tool === 'bucket'
                        ? '塗りつぶし'
                        : step4Tool === 'lasso'
                        ? '線で囲む'
                        : 'パン移動'}
                    </span>
                  </div>

                  {(step4Tool === 'brush_land' || step4Tool === 'brush_sea') && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-stone-400">ブラシ半径</span>
                        <span className="font-bold text-amber-400 font-mono">
                          {step4BrushRadius} px
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        value={step4BrushRadius}
                        onChange={(e) => setStep4BrushRadius(Number(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-800 rounded-lg"
                      />
                      <div className="flex gap-1.5 pt-1">
                        {[5, 15, 30, 60, 100].map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setStep4BrushRadius(r)}
                            className={`flex-1 py-1 rounded text-[10px] font-mono transition cursor-pointer ${
                              step4BrushRadius === r
                                ? 'bg-amber-500 text-stone-950 font-bold'
                                : 'bg-stone-800 hover:bg-stone-700 text-stone-300'
                            }`}
                          >
                            {r}px
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {step4Tool === 'bucket' && (
                    <div className="text-[11px] text-stone-400 leading-relaxed bg-stone-950/60 p-2.5 rounded-lg border border-stone-800/80">
                      <p className="text-stone-300 font-semibold mb-1">塗りつぶし（バケツ）の使い方:</p>
                      クリックした位置とつながっている同じ値（陸または海）の領域を反転して一括塗りつぶします。小さな湖や離島の除去に便利です。
                    </div>
                  )}

                  {step4Tool === 'lasso' && (
                    <div className="text-[11px] text-stone-400 leading-relaxed bg-stone-950/60 p-2.5 rounded-lg border border-stone-800/80">
                      <p className="text-stone-300 font-semibold mb-1">線で囲むツールの使い方:</p>
                      プレビュー上をクリックして多角形の頂点を配置します（3点以上）。上部の「陸にする」または「海にする」ボタンを押すと、囲まれた領域が一括塗り替えされます。
                    </div>
                  )}

                  {step4Tool === 'pan' && (
                    <div className="text-[11px] text-stone-400 leading-relaxed bg-stone-950/60 p-2.5 rounded-lg border border-stone-800/80">
                      ドラッグで表示範囲を自由に移動できます。どのツール選択中でもスペースキーを押しながらドラッグすることでいつでもパン移動できます。
                    </div>
                  )}
                </div>

                {/* Mask Overlay Opacity Card */}
                <div className="p-3.5 rounded-xl bg-stone-900/90 border border-stone-800 space-y-2.5">
                  <div className="flex justify-between items-center text-xs font-bold text-amber-200">
                    <span className="flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-amber-400" />
                      <span>マスク重ね合わせ不透明度</span>
                    </span>
                    <span className="font-mono text-amber-400">
                      {Math.round(step4OverlayOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={step4OverlayOpacity}
                    onChange={(e) => setStep4OverlayOpacity(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-800 rounded-lg"
                  />
                  {/* Color Legend */}
                  <div className="flex items-center justify-between text-[10px] text-stone-400 pt-1">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" />
                      <span>陸 (標高47)</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-blue-500 inline-block" />
                      <span>海 (標高23)</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-rose-500 inline-block" />
                      <span>海岸線境界</span>
                    </span>
                  </div>
                </div>

                {/* Correction Status & Stats */}
                <div className="p-3.5 rounded-xl bg-stone-900/90 border border-stone-800 space-y-2">
                  <div className="text-xs font-bold text-amber-200">補正状態と統計</div>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-stone-400">操作履歴:</span>
                      <span className="font-mono text-stone-200 font-semibold">
                        {maskUndoStack.length} / 30 手
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-400">手動補正状態:</span>
                      <span
                        className={`font-semibold ${
                          hasEditedStep4 ? 'text-amber-400' : 'text-stone-400'
                        }`}
                      >
                        {hasEditedStep4 ? '手動補正あり' : '自動判定のまま'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-400">陸地比率:</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {step4LandRatio}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-400">判定解像度:</span>
                      <span className="font-mono text-amber-300 font-semibold">
                        {croppedResult.width} × {croppedResult.height}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-400">出力解像度:</span>
                      <span className="font-mono text-stone-200 font-semibold">
                        {getResolutionDims(croppedResult.resolution).width} × {getResolutionDims(croppedResult.resolution).height}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Reset to Step 3 segmentation button */}
                <button
                  type="button"
                  onClick={() => setShowConfirmReset(true)}
                  disabled={!hasEditedStep4}
                  className="w-full py-2 px-3 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-800 text-[11px] font-medium flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                  <span>元の判定結果に戻す</span>
                </button>

                {/* Bottom Actions */}
                <div className="mt-auto space-y-2 pt-2">
                  {/* Primary Apply Button */}
                  <button
                    type="button"
                    onClick={() => setShowConfirmApply(true)}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-500 text-stone-950 flex items-center justify-center gap-2 transition shadow-lg shadow-amber-950/60 cursor-pointer active:scale-98"
                  >
                    <Globe className="w-4 h-4 font-bold" />
                    <span>世界マップに反映</span>
                  </button>

                  {/* Back to Step 3 */}
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="w-full py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-semibold border border-stone-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>判定ステップに戻る</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal: Confirm Apply to World Map */}
        {showConfirmApply && croppedResult && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <div className="w-full max-w-md bg-stone-900 border border-amber-600/50 rounded-2xl p-6 shadow-2xl space-y-4 text-stone-200">
              <div className="flex items-center gap-3 text-amber-400">
                <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-amber-200">世界マップへの反映確認</h3>
              </div>

              {/* Resolution & Memory Specs */}
              {(() => {
                const dstDims = getResolutionDims(croppedResult.resolution);
                return (
                  <div className="space-y-2 p-3 rounded-xl bg-stone-950/80 border border-stone-800 text-xs">
                    <div className="font-bold text-stone-300 pb-1 border-b border-stone-800/80 flex items-center justify-between">
                      <span>反映スペック</span>
                      <span className="font-mono text-amber-400 font-bold">{croppedResult.resolution}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-y-1.5 text-[11px]">
                      <span className="text-stone-400">出力解像度:</span>
                      <span className="font-mono font-bold text-stone-200 text-right">
                        {dstDims.width} × {dstDims.height}
                      </span>
                      <span className="text-stone-400">格子の大きさ:</span>
                      <span className="font-mono text-stone-300 text-right">
                        {dstDims.width} × {dstDims.height} セル
                      </span>
                      <span className="text-stone-400">メモリの目安:</span>
                      <span className="font-mono text-emerald-400 font-bold text-right">
                        標高格子: 約{dstDims.memMb}MB
                      </span>
                      <span className="text-stone-400">判定解像度:</span>
                      <span className="font-mono text-amber-300/90 text-right">
                        {croppedResult.width} × {croppedResult.height}
                      </span>
                    </div>

                    {dstDims.width >= 4096 && (
                      <div className="p-2 rounded-lg bg-amber-950/50 border border-amber-600/50 text-amber-300 text-[11px] font-medium flex items-center gap-1.5 mt-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>完了まで数十秒かかる場合があります</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Coastline Complexity & Rias Setting */}
              <div className="space-y-1.5 p-3 rounded-xl bg-stone-950/80 border border-stone-800 text-xs">
                <div className="flex justify-between items-center text-stone-300">
                  <span className="font-medium text-stone-200">海岸線の複雑さ・リアス度</span>
                  <span className="font-mono text-amber-400 font-bold">Lv {riaRoughness}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={riaRoughness}
                  onChange={(e) => setRiaRoughness(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-stone-700 rounded-lg"
                />
                <div className="flex justify-between text-[10px] text-stone-400">
                  <span>Lv 1 (なだらか)</span>
                  <span className="text-amber-400/90 font-medium">Lv 8 (標準リアス海岸)</span>
                  <span>Lv 10 (極大フィヨルド・岩礁)</span>
                </div>
                <div className="text-[10px] text-stone-400 pt-0.5 leading-relaxed">
                  ※ 自動で座標歪曲・樹状の入り江・岬のギザギザ・沿岸岩礁群を形成します。
                </div>
              </div>

              <div className="space-y-2 text-xs text-stone-300 leading-relaxed bg-stone-950/60 p-3.5 rounded-xl border border-stone-800">
                <p className="font-bold text-rose-400">
                  ⚠️ 現在の世界マップ、地域マップ、シンボルは破棄されます。
                </p>
                <p className="text-stone-400 text-[11px]">
                  判定解像度の陸海マスクをバイリニア補間と多重平滑化によって滑らかに出力解像度へ拡大し、陸地は約 47、海洋は約 23 の初期地形として世界マップを生成します。
                </p>
              </div>

              {/* In-progress indicator during upsampling */}
              {isApplyingToWorld && (
                <div className="p-3.5 rounded-xl bg-stone-950 border border-amber-500/60 space-y-2.5">
                  <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                    <span>{applyProgress.step || '世界マップに反映中...'}</span>
                    <span className="ml-auto font-mono text-amber-400">{applyProgress.percent}%</span>
                  </div>
                  <div className="w-full bg-stone-800 rounded-full h-2 overflow-hidden border border-stone-700">
                    <div
                      className="bg-gradient-to-r from-amber-500 to-amber-300 h-full transition-all duration-200"
                      style={{ width: `${applyProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error Alert */}
              {applyError && (
                <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-600 text-rose-200 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{applyError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={isApplyingToWorld}
                  onClick={() => setShowConfirmApply(false)}
                  className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-semibold border border-stone-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  disabled={isApplyingToWorld}
                  onClick={handleConfirmApplyWorld}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-stone-950 text-xs font-bold shadow-lg shadow-amber-950/50 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isApplyingToWorld ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-stone-950" />
                      <span>拡大・反映中...</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-4 h-4 font-bold" />
                      <span>確定して反映する</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Confirm Reset to Initial Segmentation */}
        {showConfirmReset && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <div className="w-full max-w-md bg-stone-900 border border-stone-700 rounded-2xl p-6 shadow-2xl space-y-4 text-stone-200">
              <div className="flex items-center gap-3 text-stone-200">
                <div className="p-2.5 rounded-xl bg-stone-800 border border-stone-700">
                  <RotateCcw className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-stone-100">元の判定結果に戻しますか？</h3>
              </div>
              <p className="text-xs text-stone-400 leading-relaxed bg-stone-950/60 p-3.5 rounded-xl border border-stone-800">
                手動で補正した内容はすべて破棄され、自動判定ステップ完了直後の陸海マスクに戻ります。この操作は取り消せません。
              </p>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmReset(false)}
                  className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-semibold border border-stone-700 transition cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleResetToInitialStep3}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>元に戻す</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Confirm Re-segmentation Overwrite */}
        {showConfirmReSegment && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <div className="w-full max-w-md bg-stone-900 border border-amber-600/50 rounded-2xl p-6 shadow-2xl space-y-4 text-stone-200">
              <div className="flex items-center gap-3 text-amber-400">
                <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-amber-200">手動補正内容の上書き確認</h3>
              </div>
              <p className="text-xs text-stone-300 leading-relaxed bg-stone-950/60 p-3.5 rounded-xl border border-stone-800">
                すでにステップ4で手動補正した内容があります。再判定を実行すると手動補正した内容は上書きされます。再判定を実行しますか？
              </p>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmReSegment(false)}
                  className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-semibold border border-stone-700 transition cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmReSegment(false);
                    setHasEditedStep4(false);
                    triggerSegmentation();
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4 font-bold" />
                  <span>上書きして再判定を実行</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
