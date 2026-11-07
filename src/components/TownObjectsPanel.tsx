import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Castle,
  Eye,
  EyeOff,
  Trash2,
  Wand2,
  ChevronDown,
  ChevronUp,
  Building2,
  Milestone,
  Shield,
  Anchor,
  Layers,
  AlertTriangle,
  Palette,
  CheckCircle2,
  Plus,
  X,
  Magnet,
  Ruler,
  MousePointer,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  AlignJustify,
  CopyPlus,
  Landmark,
  Compass,
  Bookmark,
  Download,
  Upload,
  Sparkles,
  Edit2,
  Stamp,
  Image as ImageIcon,
  Check,
  Copy,
} from 'lucide-react';
import { BrushMode } from '../types/map';
import {
  DEFAULT_TOWN_TOOL_CONFIG,
  DEFAULT_BUILDING_HEIGHTS,
  TownBuilding,
  TownBuildingKind,
  TownDistrict,
  TownDistrictKind,
  TownObject,
  TownRoad,
  TownRoadStyle,
  TownRoofTheme,
  TownTexture,
  TownTextureAssignment,
  TownTextureSlot,
  TownToolConfig,
  TownWall,
  TownPier,
} from '../types/town';
import {
  TownTemplate,
  TownTemplatePlacement,
  serializeTemplateLibrary,
  parseTemplateLibrary,
  uniqueTemplateName,
} from '../utils/town/townTemplate';
import { getSlotLabel, TOWN_TEXTURE_SLOTS } from '../utils/town/townTextures';
import {
  createTerrainWaterSampler,
  generateSampleTown,
  SampleTownStats,
} from '../utils/town/townSample';
import { polylineLength } from '../utils/town/townGeometry';
import { removeGate, translateObject } from '../utils/town/townEdit';
import {
  rotateObject,
  flipObject,
  alignParallel,
  alignToLine,
  distributeEvenly,
  minAreaRect,
  getObjectsCentroid,
} from '../utils/town/townBuild';
import {
  AutoFillConfig,
  AutoFillResult,
  autoFillDistrict,
  getAutoFillDefaults,
} from '../utils/town/townAutoFill';

interface TownObjectsPanelProps {
  mapWidth: number;
  mapHeight: number;
  metersPerUnit: number;
  townSeed?: number;
  townObjects: TownObject[];
  showTownObjects: boolean;
  onToggleShowTownObjects: (show: boolean) => void;
  onApplyTownObjects: (newObjects: TownObject[], description: string) => void;
  elevationGrid?: Float32Array;
  gridCols?: number;
  gridRows?: number;
  seaLevel?: number;
  roofTheme?: TownRoofTheme;
  onChangeRoofTheme?: (theme: TownRoofTheme) => void;
  rivers?: import('../types/water').RiverData[];
  lakes?: import('../types/water').LakeData[];

  // Town tool editing additions
  activeTool?: BrushMode;
  selectedTownObjectIds?: string[];
  onSelectTownObjectIds?: (ids: string[]) => void;
  townToolConfig?: TownToolConfig;
  onChangeTownToolConfig?: (patch: Partial<TownToolConfig>) => void;
  isAddingGateMode?: boolean;
  onToggleAddingGateMode?: (enabled: boolean) => void;
  autoFillPreviewBuildings?: TownBuilding[] | null;
  onUpdateAutoFillPreview?: (buildings: TownBuilding[] | null) => void;

  // Town template additions
  townTemplates?: TownTemplate[];
  onSaveTemplate?: (name: string) => void;
  onDeleteTemplate?: (id: string) => void;
  onRenameTemplate?: (id: string, newName: string) => void;
  onStartTemplatePlacement?: (template: TownTemplate) => void;
  templatePlacement?: TownTemplatePlacement | null;
  onUpdateTemplatePlacement?: (patch: Partial<TownTemplatePlacement>) => void;
  onCancelTemplatePlacement?: () => void;
  onImportTemplates?: (res: { templates: TownTemplate[]; skipped: number; error?: string }) => void;
  templateMessage?: { text: string; kind: 'info' | 'error' } | null;

  // Town textures additions
  townTextures?: TownTexture[];
  onAddTextures?: (files: File[]) => void;
  onDeleteTexture?: (id: string) => void;
  onRenameTexture?: (id: string, newName: string) => void;
  onToggleTexturePixelated?: (id: string, pixelated: boolean) => void;
  onExportTextures?: () => void;
  onImportTextures?: (file: File) => void;
  textureAssignments?: Partial<Record<TownTextureSlot, TownTextureAssignment>>;
  onChangeTextureAssignment?: (slot: TownTextureSlot, assignment: TownTextureAssignment | null) => void;
  onApplyTextureGroup?: (group: 'roof' | 'road' | 'wall' | 'ground', sourceSlot: TownTextureSlot) => void;
  textureMessage?: { text: string; kind: 'info' | 'error' | 'success' } | null;
}

export const TownObjectsPanel: React.FC<TownObjectsPanelProps> = ({
  mapWidth,
  mapHeight,
  metersPerUnit,
  townSeed = 12345,
  townObjects,
  showTownObjects,
  onToggleShowTownObjects,
  onApplyTownObjects,
  elevationGrid,
  gridCols,
  gridRows,
  seaLevel,
  roofTheme = 'terracotta',
  onChangeRoofTheme,
  rivers,
  lakes,
  activeTool,
  selectedTownObjectIds = [],
  onSelectTownObjectIds,
  townToolConfig = DEFAULT_TOWN_TOOL_CONFIG,
  onChangeTownToolConfig,
  isAddingGateMode = false,
  onToggleAddingGateMode,
  autoFillPreviewBuildings = null,
  onUpdateAutoFillPreview,
  townTemplates = [],
  onSaveTemplate,
  onDeleteTemplate,
  onRenameTemplate,
  onStartTemplatePlacement,
  templatePlacement = null,
  onUpdateTemplatePlacement,
  onCancelTemplatePlacement,
  onImportTemplates,
  templateMessage = null,
  townTextures = [],
  onAddTextures,
  onDeleteTexture,
  onRenameTexture,
  onToggleTexturePixelated,
  onExportTextures,
  onImportTextures,
  textureAssignments = {},
  onChangeTextureAssignment,
  onApplyTextureGroup,
  textureMessage = null,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isTemplatesCollapsed, setIsTemplatesCollapsed] = useState(false);
  const [isTexturesCollapsed, setIsTexturesCollapsed] = useState(false);
  const [activeTextureTab, setActiveTextureTab] = useState<'assignments' | 'library'>('assignments');
  const [editingTextureId, setEditingTextureId] = useState<string | null>(null);
  const [editingTextureName, setEditingTextureName] = useState('');
  const [deleteConfirmTextureId, setDeleteConfirmTextureId] = useState<string | null>(null);
  const textureUploadInputRef = useRef<HTMLInputElement>(null);
  const textureImportInputRef = useRef<HTMLInputElement>(null);

  const [newTemplateName, setNewTemplateName] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDialog, setConfirmDialog] = useState<'sample' | 'clear' | null>(null);
  const [lastPlacementStats, setLastPlacementStats] = useState<SampleTownStats | null>(null);

  // Group counts by object kind
  const counts = useMemo(() => {
    let districts = 0;
    let roads = 0;
    let buildings = 0;
    let walls = 0;
    let piers = 0;

    for (const obj of townObjects) {
      if (obj.kind === 'district') districts++;
      else if (obj.kind === 'road') roads++;
      else if (obj.kind === 'building') buildings++;
      else if (obj.kind === 'wall') walls++;
      else if (obj.kind === 'pier') piers++;
    }

    return {
      districts,
      roads,
      buildings,
      walls,
      piers,
      total: townObjects.length,
    };
  }, [townObjects]);

  // Selected object(s) lookup
  const selectedObjects = useMemo(() => {
    if (!selectedTownObjectIds || selectedTownObjectIds.length === 0) return [];
    const set = new Set(selectedTownObjectIds);
    return townObjects.filter((o) => set.has(o.id));
  }, [selectedTownObjectIds, townObjects]);

  const singleSelected = selectedObjects.length === 1 ? selectedObjects[0] : null;

  const handleConfirmSample = () => {
    const terrain =
      elevationGrid && gridCols && gridRows && seaLevel !== undefined
        ? createTerrainWaterSampler(
            elevationGrid,
            gridCols,
            gridRows,
            mapWidth,
            mapHeight,
            seaLevel,
            rivers,
            lakes
          )
        : undefined;

    const sample = generateSampleTown(
      mapWidth,
      mapHeight,
      metersPerUnit,
      townSeed || Math.floor(Math.random() * 100000),
      terrain
    );

    setLastPlacementStats(sample.stats);
    onApplyTownObjects(sample, 'サンプルの町を配置');
    onSelectTownObjectIds?.([]);
    setConfirmDialog(null);
  };

  const handleConfirmClear = () => {
    onApplyTownObjects([], '町の部品をすべて削除');
    setLastPlacementStats(null);
    onSelectTownObjectIds?.([]);
    setConfirmDialog(null);
  };

  // Update properties of single selected object
  const handleUpdateSingleObject = (updated: TownObject, desc: string) => {
    const nextObjects = townObjects.map((o) => (o.id === updated.id ? updated : o));
    onApplyTownObjects(nextObjects, desc);
  };

  // Delete currently selected object(s)
  const handleDeleteSelected = () => {
    if (selectedObjects.length === 0) return;
    const toDelete = new Set(selectedTownObjectIds);
    const nextObjects = townObjects.filter((o) => !toDelete.has(o.id));
    onApplyTownObjects(nextObjects, selectedObjects.length === 1 ? '町部品の削除' : `${selectedObjects.length}件の町部品を削除`);
    onSelectTownObjectIds?.([]);
  };

  const selectedBuildings = useMemo(() => {
    return selectedObjects.filter((o) => o.kind === 'building') as TownBuilding[];
  }, [selectedObjects]);

  // Auto-fill state for selected districts
  const selectedDistricts = useMemo(() => {
    return selectedObjects.filter((o): o is TownDistrict => o.kind === 'district');
  }, [selectedObjects]);

  const firstDistrict = selectedDistricts[0];
  const firstNonPark = selectedDistricts.find((d) => d.districtKind !== 'park');

  const [autoFillConfig, setAutoFillConfig] = useState<AutoFillConfig | null>(null);
  const [autoFillSeed, setAutoFillSeed] = useState<number>(townSeed);
  const [autoFillStats, setAutoFillStats] = useState<AutoFillResult['stats'] | null>(null);
  const [previewDismissed, setPreviewDismissed] = useState<boolean>(false);

  // Reset or initialize config when district kind changes
  const prevDistrictKindRef = useRef<string | null>(null);
  useEffect(() => {
    const currentKind = firstDistrict ? firstDistrict.districtKind : null;
    if (currentKind !== prevDistrictKindRef.current) {
      prevDistrictKindRef.current = currentKind;
      if (currentKind && currentKind !== 'park') {
        const defaults = getAutoFillDefaults(currentKind as TownDistrictKind);
        setAutoFillConfig(defaults);
        setPreviewDismissed(false);
      } else {
        setAutoFillConfig(null);
        setAutoFillStats(null);
        onUpdateAutoFillPreview?.(null);
      }
    }
  }, [firstDistrict, onUpdateAutoFillPreview]);

  // Reset preview on selection or tool change
  useEffect(() => {
    onUpdateAutoFillPreview?.(null);
    setAutoFillStats(null);
    setPreviewDismissed(false);
  }, [activeTool, selectedTownObjectIds, onUpdateAutoFillPreview]);

  // Clean up preview on unmount
  useEffect(() => {
    return () => {
      onUpdateAutoFillPreview?.(null);
    };
  }, [onUpdateAutoFillPreview]);

  // Debounced preview calculation (150ms)
  useEffect(() => {
    if (selectedDistricts.length === 0 || !firstNonPark || !autoFillConfig || previewDismissed) {
      if (autoFillStats !== null) {
        setAutoFillStats(null);
        onUpdateAutoFillPreview?.(null);
      }
      return;
    }

    const timer = setTimeout(() => {
      const sampler =
        elevationGrid && gridCols && gridRows && mapWidth && mapHeight && seaLevel !== undefined
          ? createTerrainWaterSampler(
              elevationGrid,
              gridCols,
              gridRows,
              mapWidth,
              mapHeight,
              seaLevel,
              rivers,
              lakes
            )
          : undefined;

      let accumulatedBuildings: TownBuilding[] = [];
      const combinedStats: AutoFillResult['stats'] = {
        placed: 0,
        rejectedOutside: 0,
        rejectedRoad: 0,
        rejectedOverlap: 0,
        rejectedWater: 0,
        rejectedWall: 0,
        hitLimit: false,
      };

      let curSeed = autoFillSeed;
      const nonParkDistricts = selectedDistricts.filter((d) => d.districtKind !== 'park');

      for (const dist of nonParkDistricts) {
        const currentObjects = [...townObjects, ...accumulatedBuildings];
        const res = autoFillDistrict({
          district: dist,
          objects: currentObjects,
          metersPerUnit,
          config: autoFillConfig,
          seed: curSeed,
          waterSampler: sampler,
        });

        accumulatedBuildings.push(...res.buildings);
        combinedStats.placed += res.stats.placed;
        combinedStats.rejectedOutside += res.stats.rejectedOutside;
        combinedStats.rejectedRoad += res.stats.rejectedRoad;
        combinedStats.rejectedOverlap += res.stats.rejectedOverlap;
        combinedStats.rejectedWater += res.stats.rejectedWater;
        combinedStats.rejectedWall += res.stats.rejectedWall;
        if (res.stats.hitLimit) combinedStats.hitLimit = true;

        curSeed = (curSeed * 1664525 + 1013904223) >>> 0;
      }

      setAutoFillStats(combinedStats);
      onUpdateAutoFillPreview?.(accumulatedBuildings);
    }, 150);

    return () => clearTimeout(timer);
  }, [
    selectedDistricts,
    firstNonPark,
    autoFillConfig,
    autoFillSeed,
    previewDismissed,
    townObjects,
    metersPerUnit,
    elevationGrid,
    gridCols,
    gridRows,
    mapWidth,
    mapHeight,
    seaLevel,
    rivers,
    lakes,
    onUpdateAutoFillPreview,
  ]);

  const handleCommitAutoFill = () => {
    if (!autoFillPreviewBuildings || autoFillPreviewBuildings.length === 0) return;
    const count = autoFillPreviewBuildings.length;
    const newBuildingIds = autoFillPreviewBuildings.map((b) => b.id);
    onApplyTownObjects(
      [...townObjects, ...autoFillPreviewBuildings],
      `建物を自動配置 (${count}棟)`
    );
    onSelectTownObjectIds?.(newBuildingIds);
    setAutoFillStats(null);
    setPreviewDismissed(true);
    onUpdateAutoFillPreview?.(null);
  };

  const handleCancelAutoFill = () => {
    setAutoFillStats(null);
    setPreviewDismissed(true);
    onUpdateAutoFillPreview?.(null);
  };

  const updateConfig = (patch: Partial<AutoFillConfig>) => {
    setPreviewDismissed(false);
    setAutoFillConfig((prev) => (prev ? { ...prev, ...patch } : null));
  };

  const handleRerollSeed = () => {
    setPreviewDismissed(false);
    setAutoFillSeed(Math.floor(Math.random() * 1000000) + 1);
  };

  const handleRotateSelected = (degrees: number) => {
    if (selectedObjects.length === 0) return;
    const center = getObjectsCentroid(selectedObjects);
    const rad = (degrees * Math.PI) / 180;
    const selectedSet = new Set(selectedTownObjectIds);
    const next = townObjects.map((o) =>
      selectedSet.has(o.id) ? rotateObject(o, center, rad) : o
    );
    onApplyTownObjects(next, `町部品の回転 (${degrees > 0 ? `+${degrees}` : degrees}°)`);
  };

  const handleFlipSelected = (axis: 'x' | 'y') => {
    if (selectedObjects.length === 0) return;
    const center = getObjectsCentroid(selectedObjects);
    const selectedSet = new Set(selectedTownObjectIds);
    const next = townObjects.map((o) =>
      selectedSet.has(o.id) ? flipObject(o, center, axis) : o
    );
    onApplyTownObjects(next, `町部品の${axis === 'x' ? '左右反転' : '上下反転'}`);
  };

  const handleDuplicateSelected = () => {
    if (selectedObjects.length === 0) return;
    const shiftUnits = (3 / metersPerUnit) * 0.7071;
    const now = Date.now();
    const duplicated = selectedObjects.map((o) => {
      const newId = `${o.kind}_${now}_${Math.random().toString(36).substring(2, 6)}`;
      const shifted = translateObject(o, shiftUnits, shiftUnits);
      return { ...shifted, id: newId };
    });
    const next = [...townObjects, ...duplicated];
    onApplyTownObjects(next, '町部品の複製');
    onSelectTownObjectIds?.(duplicated.map((o) => o.id));
  };

  const handleAlignParallel = () => {
    const selectedSet = new Set(selectedTownObjectIds);
    const selectedBlds = townObjects.filter((o) => selectedSet.has(o.id) && o.kind === 'building') as TownBuilding[];
    if (selectedBlds.length === 0) return;
    const roadAndWalls = townObjects.filter((o) => o.kind === 'road' || o.kind === 'wall');
    const alignedBlds = alignParallel(selectedBlds, roadAndWalls, metersPerUnit);
    const alignedMap = new Map(alignedBlds.map((b) => [b.id, b]));
    const next = townObjects.map((o) => alignedMap.get(o.id) || o);
    onApplyTownObjects(next, '建物を道に平行に整列');
  };

  const handleAlignToLine = () => {
    const selectedSet = new Set(selectedTownObjectIds);
    const selectedBlds = townObjects.filter((o) => selectedSet.has(o.id) && o.kind === 'building') as TownBuilding[];
    if (selectedBlds.length < 2) return;
    const alignedBlds = alignToLine(selectedBlds);
    const alignedMap = new Map(alignedBlds.map((b) => [b.id, b]));
    const next = townObjects.map((o) => alignedMap.get(o.id) || o);
    onApplyTownObjects(next, '建物を一列に整列');
  };

  const handleDistributeEvenly = () => {
    const selectedSet = new Set(selectedTownObjectIds);
    const selectedBlds = townObjects.filter((o) => selectedSet.has(o.id) && o.kind === 'building') as TownBuilding[];
    if (selectedBlds.length < 3) return;
    const distributedBlds = distributeEvenly(selectedBlds);
    const distMap = new Map(distributedBlds.map((b) => [b.id, b]));
    const next = townObjects.map((o) => distMap.get(o.id) || o);
    onApplyTownObjects(next, '建物を等間隔に整列');
  };

  const handleMinAreaRect = () => {
    const selectedSet = new Set(selectedTownObjectIds);
    const hasEligible = townObjects.some(
      (o) => selectedSet.has(o.id) && o.kind === 'building' && o.buildingKind !== 'tower'
    );
    if (!hasEligible) return;
    const next = townObjects.map((o) => {
      if (selectedSet.has(o.id) && o.kind === 'building' && o.buildingKind !== 'tower') {
        return { ...o, polygon: minAreaRect(o.polygon) };
      }
      return o;
    });
    onApplyTownObjects(next, '建物を長方形に整列');
  };

  const isTownToolActive =
    activeTool === 'townSelect' ||
    activeTool === 'townRoad' ||
    activeTool === 'townWall' ||
    activeTool === 'townPier' ||
    activeTool === 'townBuilding' ||
    activeTool === 'townDistrict';

  const handleSaveCurrentTemplate = () => {
    if (selectedObjects.length === 0) return;
    const nameToSave = newTemplateName.trim() || 'テンプレート';
    onSaveTemplate?.(nameToSave);
    setNewTemplateName('');
  };

  const handleExportTemplates = () => {
    if (townTemplates.length === 0) return;
    const jsonStr = serializeTemplateLibrary(townTemplates);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'town-templates.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const res = parseTemplateLibrary(content);
        onImportTemplates?.(res);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      onImportTemplates?.({
        templates: [],
        skipped: 0,
        error: 'ファイルの読み込みに失敗しました。',
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleStartRename = (t: TownTemplate) => {
    setEditingTemplateId(t.id);
    setEditingNameValue(t.name);
  };

  const handleCommitRename = (id: string) => {
    if (editingNameValue.trim()) {
      onRenameTemplate?.(id, editingNameValue.trim());
    }
    setEditingTemplateId(null);
  };

  const renderTemplateThumbnail = (template: TownTemplate) => {
    const span = Math.max(template.sizeM.width, template.sizeM.height, 10) * 1.25;
    const half = span / 2;
    const viewBox = `${-half} ${-half} ${span} ${span}`;

    return (
      <svg
        viewBox={viewBox}
        className="w-12 h-12 bg-stone-950 rounded border border-stone-800 shrink-0 overflow-hidden"
      >
        {template.objects.map((obj, i) => {
          if (obj.kind === 'district') {
            const pts = obj.polygon.map(([x, y]) => `${x},${y}`).join(' ');
            return (
              <polygon
                key={i}
                points={pts}
                fill="rgba(217, 119, 6, 0.2)"
                stroke="#d97706"
                strokeWidth={Math.max(0.5, span / 35)}
              />
            );
          }
          if (obj.kind === 'building') {
            const pts = obj.polygon.map(([x, y]) => `${x},${y}`).join(' ');
            return (
              <polygon
                key={i}
                points={pts}
                fill="#d97706"
                stroke="#78350f"
                strokeWidth={Math.max(0.5, span / 40)}
              />
            );
          }
          if (obj.kind === 'road') {
            const pts = obj.points.map(([x, y]) => `${x},${y}`).join(' ');
            return (
              <polyline
                key={i}
                points={pts}
                stroke="#a8a29e"
                strokeWidth={Math.max(1, (obj.widthM || 4) * 0.8)}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            );
          }
          if (obj.kind === 'wall') {
            const pts = obj.points.map(([x, y]) => `${x},${y}`).join(' ');
            return obj.closed ? (
              <polygon
                key={i}
                points={pts}
                stroke="#f5f5f4"
                strokeWidth={Math.max(1.2, (obj.thicknessM || 3) * 0.8)}
                fill="none"
              />
            ) : (
              <polyline
                key={i}
                points={pts}
                stroke="#f5f5f4"
                strokeWidth={Math.max(1.2, (obj.thicknessM || 3) * 0.8)}
                strokeLinecap="round"
                fill="none"
              />
            );
          }
          if (obj.kind === 'pier') {
            const pts = obj.points.map(([x, y]) => `${x},${y}`).join(' ');
            return (
              <polyline
                key={i}
                points={pts}
                stroke="#38bdf8"
                strokeWidth={Math.max(1, (obj.widthM || 3) * 0.8)}
                strokeLinecap="round"
                fill="none"
              />
            );
          }
          return null;
        })}
      </svg>
    );
  };

  return (
    <>
      <div className="bg-stone-900/95 backdrop-blur-md border border-stone-800 text-stone-200 shadow-2xl rounded-t-lg transition-all text-xs select-none max-h-[85vh] overflow-y-auto">
        {/* Header Bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-1.5 border-b border-stone-800/80 bg-stone-950/90 rounded-t-lg">
          <div className="flex items-center gap-2">
            <Castle className="w-4 h-4 text-amber-400" />
            <span className="font-semibold tracking-wide text-amber-200">町の部品 (オブジェクト層)</span>
            <span className="bg-stone-800 text-stone-400 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
              計 {counts.total} 件
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer text-stone-300 hover:text-amber-300 transition-colors">
              <input
                type="checkbox"
                checked={showTownObjects}
                onChange={(e) => onToggleShowTownObjects(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-stone-700 bg-stone-800 text-amber-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-[11px] flex items-center gap-1">
                {showTownObjects ? <Eye className="w-3 h-3 text-emerald-400" /> : <EyeOff className="w-3 h-3 text-stone-500" />}
                表示
              </span>
            </label>

            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 hover:bg-stone-800 text-stone-400 hover:text-stone-200 rounded transition-colors"
              title={isCollapsed ? '展開' : '折りたたむ'}
            >
              {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Content Body */}
        {!isCollapsed && (
          <div className="p-3 space-y-2.5">
            {/* Template Placement Active Banner */}
            {templatePlacement && (
              <div className="bg-amber-950/80 border border-amber-500 rounded-lg p-2.5 space-y-2 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs">
                    <Sparkles className="w-4 h-4 text-amber-400 animate-spin-slow" />
                    <span>配置中: 「{templatePlacement.template.name}」</span>
                  </div>
                  <button
                    type="button"
                    onClick={onCancelTemplatePlacement}
                    className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white rounded text-[10px] border border-stone-600 cursor-pointer transition"
                    title="配置モードを終了 (Esc / 右クリック)"
                  >
                    終了 (Esc)
                  </button>
                </div>

                <div className="text-[10px] text-amber-200/90 leading-relaxed">
                  地図上をクリックして配置。何度でも連続して配置できます。<br />
                  <span className="text-stone-400 font-mono">[ / ]</span> で回転、
                  <span className="text-stone-400 font-mono">F</span> で左右反転、
                  <span className="text-stone-400 font-mono">Esc</span> または右クリックで終了。
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-800/60 text-[10px]">
                  <div className="flex items-center gap-1">
                    <span className="text-stone-400">回転:</span>
                    <button
                      type="button"
                      onClick={() => onUpdateTemplatePlacement?.({ angleDeg: (templatePlacement.angleDeg - 15 + 360) % 360 })}
                      className="px-1.5 py-0.5 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded border border-stone-700 cursor-pointer"
                      title="左回転 -15° (Shift+[: -5°)"
                    >
                      <RotateCcw className="w-3 h-3 inline mr-0.5 text-amber-400" />
                      -15°
                    </button>
                    <span className="font-mono text-amber-300 min-w-8 text-center">{templatePlacement.angleDeg}°</span>
                    <button
                      type="button"
                      onClick={() => onUpdateTemplatePlacement?.({ angleDeg: (templatePlacement.angleDeg + 15) % 360 })}
                      className="px-1.5 py-0.5 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded border border-stone-700 cursor-pointer"
                      title="右回転 +15° (Shift+]: +5°)"
                    >
                      <RotateCw className="w-3 h-3 inline mr-0.5 text-amber-400" />
                      +15°
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onUpdateTemplatePlacement?.({ flipX: !templatePlacement.flipX })}
                    className={`px-2 py-0.5 rounded border text-[10px] flex items-center gap-1 cursor-pointer transition ${
                      templatePlacement.flipX
                        ? 'bg-amber-600/30 border-amber-500 text-amber-300 font-bold'
                        : 'bg-stone-800 border-stone-700 text-stone-300 hover:text-stone-100'
                    }`}
                    title="左右反転 (F キー)"
                  >
                    <FlipHorizontal className="w-3 h-3" />
                    <span>{templatePlacement.flipX ? '左右反転中' : '左右反転 (F)'}</span>
                  </button>
                </div>
              </div>
            )}
            {/* Active Town Tool Settings Bar */}
            {isTownToolActive && (
              <div className="bg-amber-950/40 border border-amber-600/50 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center justify-between border-b border-amber-800/40 pb-1.5">
                  <div className="flex items-center gap-1.5 text-amber-300 font-semibold text-xs">
                    {activeTool === 'townSelect' && <MousePointer className="w-3.5 h-3.5" />}
                    {activeTool === 'townRoad' && <Milestone className="w-3.5 h-3.5" />}
                    {activeTool === 'townWall' && <Shield className="w-3.5 h-3.5" />}
                    {activeTool === 'townPier' && <Anchor className="w-3.5 h-3.5" />}
                    {activeTool === 'townBuilding' && <Building2 className="w-3.5 h-3.5" />}
                    {activeTool === 'townDistrict' && <Landmark className="w-3.5 h-3.5" />}
                    <span>
                      {activeTool === 'townSelect' && 'ツール設定: 選択・変形'}
                      {activeTool === 'townRoad' && 'ツール設定: 道を描く'}
                      {activeTool === 'townWall' && 'ツール設定: 城壁を描く'}
                      {activeTool === 'townPier' && 'ツール設定: 桟橋/橋を描く'}
                      {activeTool === 'townBuilding' && 'ツール設定: 建物を配置'}
                      {activeTool === 'townDistrict' && 'ツール設定: 区画を描く'}
                    </span>
                  </div>

                  {/* Common Snapping & Length label toggles */}
                  <div className="flex items-center gap-2 text-[10px] text-stone-300">
                    <label className="flex items-center gap-1 cursor-pointer" title="端点や頂点への8px自動吸着 (Altキーで一時解除)">
                      <input
                        type="checkbox"
                        checked={townToolConfig.snapEnabled}
                        onChange={(e) => onChangeTownToolConfig?.({ snapEnabled: e.target.checked })}
                        className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                      />
                      <Magnet className="w-3 h-3 text-sky-400" />
                      <span>吸着</span>
                    </label>

                    <label className="flex items-center gap-1 cursor-pointer" title="描画中に実距離(m)ラベルを表示">
                      <input
                        type="checkbox"
                        checked={townToolConfig.showLengths}
                        onChange={(e) => onChangeTownToolConfig?.({ showLengths: e.target.checked })}
                        className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                      />
                      <Ruler className="w-3 h-3 text-emerald-400" />
                      <span>距離表示</span>
                    </label>
                  </div>
                </div>

                {/* Road tool options */}
                {activeTool === 'townRoad' && (
                  <div className="grid grid-cols-3 gap-2 items-center text-[11px]">
                    <div>
                      <span className="text-stone-400 block mb-0.5">種別:</span>
                      <select
                        value={townToolConfig.roadStyle}
                        onChange={(e) => onChangeTownToolConfig?.({ roadStyle: e.target.value as TownRoadStyle })}
                        className="w-full bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-200 text-xs"
                      >
                        <option value="main">大通り (石畳)</option>
                        <option value="street">街路 (舗装)</option>
                        <option value="path">小道 (未舗装)</option>
                      </select>
                    </div>

                    <div>
                      <span className="text-stone-400 block mb-0.5">幅: {townToolConfig.roadWidthM}m</span>
                      <input
                        type="range"
                        min={2}
                        max={16}
                        step={1}
                        value={townToolConfig.roadWidthM}
                        onChange={(e) => onChangeTownToolConfig?.({ roadWidthM: Number(e.target.value) })}
                        className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                    </div>

                    <div className="pt-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={townToolConfig.roadSmooth}
                          onChange={(e) => onChangeTownToolConfig?.({ roadSmooth: e.target.checked })}
                          className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                        />
                        <span className="text-stone-300">滑らかな曲線</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Wall tool options */}
                {activeTool === 'townWall' && (
                  <div className="space-y-1.5 text-[11px]">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-stone-400 block mb-0.5">厚み: {townToolConfig.wallThicknessM}m</span>
                        <input
                          type="range"
                          min={2}
                          max={10}
                          step={1}
                          value={townToolConfig.wallThicknessM}
                          onChange={(e) => onChangeTownToolConfig?.({ wallThicknessM: Number(e.target.value) })}
                          className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                      </div>

                      <div>
                        <span className="text-stone-400 block mb-0.5">見張り塔半径: {townToolConfig.wallTowerRadiusM}m</span>
                        <input
                          type="range"
                          min={2}
                          max={8}
                          step={0.5}
                          value={townToolConfig.wallTowerRadiusM}
                          onChange={(e) => onChangeTownToolConfig?.({ wallTowerRadiusM: Number(e.target.value) })}
                          className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4 pt-1">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={townToolConfig.wallTowers}
                          onChange={(e) => onChangeTownToolConfig?.({ wallTowers: e.target.checked })}
                          className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                        />
                        <span className="text-stone-300">頂点に見張り塔を配置</span>
                      </label>

                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={townToolConfig.wallClosed}
                          onChange={(e) => onChangeTownToolConfig?.({ wallClosed: e.target.checked })}
                          className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                        />
                        <span className="text-stone-300">閉じた城郭ループ</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Pier tool options */}
                {activeTool === 'townPier' && (
                  <div className="grid grid-cols-2 gap-2 items-center text-[11px]">
                    <div>
                      <span className="text-stone-400 block mb-0.5">種類:</span>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="pierVariant"
                            checked={townToolConfig.pierVariant === 'pier'}
                            onChange={() => onChangeTownToolConfig?.({ pierVariant: 'pier' })}
                            className="text-amber-500 bg-stone-800"
                          />
                          <span>桟橋</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="pierVariant"
                            checked={townToolConfig.pierVariant === 'bridge'}
                            onChange={() => onChangeTownToolConfig?.({ pierVariant: 'bridge' })}
                            className="text-amber-500 bg-stone-800"
                          />
                          <span>橋</span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <span className="text-stone-400 block mb-0.5">幅: {townToolConfig.pierWidthM}m</span>
                      <input
                        type="range"
                        min={2}
                        max={12}
                        step={1}
                        value={townToolConfig.pierWidthM}
                        onChange={(e) => onChangeTownToolConfig?.({ pierWidthM: Number(e.target.value) })}
                        className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                    </div>
                  </div>
                )}

                {/* Building tool options */}
                {activeTool === 'townBuilding' && (
                  <div className="space-y-2 text-[11px]">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-stone-400 block mb-0.5">建物の種類:</span>
                        <select
                          value={townToolConfig.buildingKind}
                          onChange={(e) => {
                            const k = e.target.value as TownBuildingKind;
                            onChangeTownToolConfig?.({
                              buildingKind: k,
                              buildingHeightM: DEFAULT_BUILDING_HEIGHTS[k],
                            });
                          }}
                          className="w-full bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-200 text-xs"
                        >
                          <option value="house">民家 (6m)</option>
                          <option value="shop">商家・工房 (7m)</option>
                          <option value="hall">大広間 (9m)</option>
                          <option value="church">教会・聖堂 (14m)</option>
                          <option value="keep">天守・要塞 (18m)</option>
                          <option value="tower">見張り塔 (16m)</option>
                          <option value="barn">納屋・倉庫 (7m)</option>
                        </select>
                      </div>

                      <div>
                        <span className="text-stone-400 block mb-0.5">高さ: {townToolConfig.buildingHeightM}m</span>
                        <input
                          type="range"
                          min={4}
                          max={26}
                          step={1}
                          value={townToolConfig.buildingHeightM}
                          onChange={(e) => onChangeTownToolConfig?.({ buildingHeightM: Number(e.target.value) })}
                          className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                      </div>
                    </div>

                    {/* Draw Mode */}
                    <div>
                      <span className="text-stone-400 block mb-0.5">作図モード:</span>
                      <div className="grid grid-cols-3 gap-1">
                        <button
                          type="button"
                          onClick={() => onChangeTownToolConfig?.({ buildingDrawMode: '3point' })}
                          className={`px-1.5 py-1 rounded text-[10px] font-medium transition cursor-pointer border ${
                            townToolConfig.buildingDrawMode === '3point'
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-semibold'
                              : 'bg-stone-800 border-stone-700 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          3点で長方形
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeTownToolConfig?.({ buildingDrawMode: 'preset' })}
                          className={`px-1.5 py-1 rounded text-[10px] font-medium transition cursor-pointer border ${
                            townToolConfig.buildingDrawMode === 'preset'
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-semibold'
                              : 'bg-stone-800 border-stone-700 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          サイズ指定
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeTownToolConfig?.({ buildingDrawMode: 'polygon' })}
                          className={`px-1.5 py-1 rounded text-[10px] font-medium transition cursor-pointer border ${
                            townToolConfig.buildingDrawMode === 'polygon'
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-semibold'
                              : 'bg-stone-800 border-stone-700 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          多角形
                        </button>
                      </div>
                    </div>

                    {/* Preset Size & Orientation Settings */}
                    {townToolConfig.buildingDrawMode === 'preset' && (
                      <div className="bg-stone-950 p-2 rounded border border-stone-800 space-y-1.5">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-stone-400 block mb-0.5">幅: {townToolConfig.buildingPresetWidthM}m</span>
                            <input
                              type="range"
                              min={3}
                              max={30}
                              step={1}
                              value={townToolConfig.buildingPresetWidthM}
                              onChange={(e) => onChangeTownToolConfig?.({ buildingPresetWidthM: Number(e.target.value) })}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                          <div>
                            <span className="text-stone-400 block mb-0.5">奥行: {townToolConfig.buildingPresetDepthM}m</span>
                            <input
                              type="range"
                              min={3}
                              max={30}
                              step={1}
                              value={townToolConfig.buildingPresetDepthM}
                              onChange={(e) => onChangeTownToolConfig?.({ buildingPresetDepthM: Number(e.target.value) })}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        <div>
                          <span className="text-stone-400 block mb-0.5">向き:</span>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="bOrient"
                                checked={townToolConfig.buildingOrientationMode === 'auto'}
                                onChange={() => onChangeTownToolConfig?.({ buildingOrientationMode: 'auto' })}
                                className="text-amber-500 bg-stone-800"
                              />
                              <span>道に平行に自動</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="bOrient"
                                checked={townToolConfig.buildingOrientationMode === 'fixed'}
                                onChange={() => onChangeTownToolConfig?.({ buildingOrientationMode: 'fixed' })}
                                className="text-amber-500 bg-stone-800"
                              />
                              <span>固定角度</span>
                            </label>
                          </div>
                        </div>

                        {townToolConfig.buildingOrientationMode === 'fixed' && (
                          <div className="flex items-center gap-2 pt-0.5">
                            <span className="text-stone-400 shrink-0">角度: {townToolConfig.buildingFixedAngleDeg}°</span>
                            <input
                              type="range"
                              min={0}
                              max={345}
                              step={15}
                              value={townToolConfig.buildingFixedAngleDeg}
                              onChange={(e) => onChangeTownToolConfig?.({ buildingFixedAngleDeg: Number(e.target.value) })}
                              className="flex-1 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Roof Tone Variation */}
                    <div className="flex items-center justify-between pt-0.5 border-t border-stone-800">
                      <span className="text-stone-400">屋根色のばらつき:</span>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="roofToneRand"
                            checked={townToolConfig.buildingRoofToneRandom}
                            onChange={() => onChangeTownToolConfig?.({ buildingRoofToneRandom: true })}
                            className="text-amber-500 bg-stone-800"
                          />
                          <span>ランダム</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="roofToneRand"
                            checked={!townToolConfig.buildingRoofToneRandom}
                            onChange={() => onChangeTownToolConfig?.({ buildingRoofToneRandom: false })}
                            className="text-amber-500 bg-stone-800"
                          />
                          <span>固定</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* District tool options */}
                {activeTool === 'townDistrict' && (
                  <div className="space-y-1.5 text-[11px]">
                    <div>
                      <span className="text-stone-400 block mb-0.5">区画の種類:</span>
                      <select
                        value={townToolConfig.districtKind}
                        onChange={(e) => onChangeTownToolConfig?.({ districtKind: e.target.value as TownDistrictKind })}
                        className="w-full bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-200 text-xs"
                      >
                        <option value="residential">住宅街 (Residential)</option>
                        <option value="market">市場・商業区 (Market)</option>
                        <option value="noble">貴族街 (Noble)</option>
                        <option value="poor">貧民街・下町 (Poor)</option>
                        <option value="park">庭園・広場 (Park)</option>
                        <option value="farmland">農地・畑 (Farmland)</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Help tip for drawing tools */}
                <div className="text-[10px] text-amber-300/80 flex items-center justify-between pt-1 border-t border-amber-800/30">
                  {activeTool === 'townSelect' && (
                    <span>クリックで選択、ドラッグで移動。上部の青丸で回転。Delで削除。</span>
                  )}
                  {activeTool === 'townRoad' && (
                    <span>クリックで頂点を追加。Enterまたは最後の点を再クリックで確定。Escでキャンセル。</span>
                  )}
                  {activeTool === 'townBuilding' && townToolConfig.buildingDrawMode === '3point' && (
                    <span>1点目と2点目で辺を決め、3点目で奥行きを確定。Shiftで15°固定。</span>
                  )}
                  {activeTool === 'townBuilding' && townToolConfig.buildingDrawMode === 'preset' && (
                    <span>クリック位置に建物を配置。40m以内の最寄りの道に自動で向きを合わせます。</span>
                  )}
                  {activeTool === 'townBuilding' && townToolConfig.buildingDrawMode === 'polygon' && (
                    <span>クリックで頂点を追加(3〜12点)。ダブルクリック/Enterで確定。</span>
                  )}
                  {activeTool === 'townDistrict' && (
                    <span>クリックで頂点を追加。ダブルクリック/Enterで確定。Escでキャンセル。</span>
                  )}
                  {activeTool === 'townWall' && (
                    <span>クリックで頂点を追加。始点クリックでループ閉鎖。Enterで確定。</span>
                  )}
                  {activeTool === 'townPier' && (
                    <span>陸から水上へクリックして頂点を追加。Enterで確定。</span>
                  )}
                </div>
              </div>
            )}

            {/* Selected Object(s) Property Inspector */}
            {selectedObjects.length > 0 && (
              <div className="bg-stone-950/80 border border-amber-500/60 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center justify-between border-b border-stone-800 pb-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                    <MousePointer className="w-3.5 h-3.5" />
                    <span>
                      {selectedObjects.length === 1
                        ? `選択中の部品 (${singleSelected?.kind === 'road' ? '道' : singleSelected?.kind === 'wall' ? '城壁' : singleSelected?.kind === 'pier' ? '桟橋/橋' : singleSelected?.kind === 'building' ? '建物' : '区画'})`
                        : `${selectedObjects.length} 件の部品を選択中`}
                    </span>
                  </div>

                  <button
                    onClick={handleDeleteSelected}
                    className="px-2 py-0.5 bg-red-950/70 hover:bg-red-900 text-red-300 border border-red-800 rounded text-[11px] flex items-center gap-1 transition shadow cursor-pointer"
                    title="選択した部品を削除 (Delete / Backspace)"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                    <span>{selectedObjects.length === 1 ? '削除' : '一括削除'}</span>
                  </button>
                </div>

                {/* Transform & Arrange Actions */}
                <div className="space-y-1.5 pt-0.5 border-b border-stone-800 pb-2">
                  <div className="flex items-center justify-between text-[10px] text-stone-400">
                    <span>回転・反転・複製:</span>
                    <span className="text-stone-500 font-mono text-[9px]">[ / ] 5° (Shift 15°)</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    <button
                      type="button"
                      onClick={(e) => handleRotateSelected(e.shiftKey ? -15 : -5)}
                      className="px-1.5 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded text-[10px] flex items-center justify-center gap-0.5 transition cursor-pointer border border-stone-700"
                      title="左回転 (5°、Shiftで15°)"
                    >
                      <RotateCcw className="w-3 h-3 text-amber-400" />
                      <span>-5°</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRotateSelected(e.shiftKey ? 15 : 5)}
                      className="px-1.5 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded text-[10px] flex items-center justify-center gap-0.5 transition cursor-pointer border border-stone-700"
                      title="右回転 (5°、Shiftで15°)"
                    >
                      <RotateCw className="w-3 h-3 text-amber-400" />
                      <span>+5°</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFlipSelected('x')}
                      className="px-1.5 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded text-[10px] flex items-center justify-center gap-0.5 transition cursor-pointer border border-stone-700"
                      title="左右反転 (選択の重心を軸に反転)"
                    >
                      <FlipHorizontal className="w-3 h-3 text-sky-400" />
                      <span>左右</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFlipSelected('y')}
                      className="px-1.5 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded text-[10px] flex items-center justify-center gap-0.5 transition cursor-pointer border border-stone-700"
                      title="上下反転 (選択の重心を軸に反転)"
                    >
                      <FlipVertical className="w-3 h-3 text-sky-400" />
                      <span>上下</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDuplicateSelected}
                      className="px-1.5 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded text-[10px] flex items-center justify-center gap-0.5 transition cursor-pointer border border-stone-700"
                      title="3mずらして複製 (Ctrl+D)"
                    >
                      <CopyPlus className="w-3 h-3 text-emerald-400" />
                      <span>複製</span>
                    </button>
                  </div>

                  {/* Alignment Tools (when buildings selected) */}
                  {selectedBuildings.length > 0 && (
                    <div className="pt-1.5 border-t border-stone-800/80 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-stone-400">
                        <span>建物の整列:</span>
                        <span className="text-amber-400/80 font-mono">{selectedBuildings.length}棟</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[10px]">
                        <button
                          type="button"
                          onClick={handleAlignParallel}
                          className="px-2 py-1 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded flex items-center justify-center gap-1 transition cursor-pointer border border-stone-700"
                          title="40m以内の最も近い道・城壁の向きに合わせて回転"
                        >
                          <Compass className="w-3 h-3 text-amber-400" />
                          <span>道に平行にする</span>
                        </button>
                        <button
                          type="button"
                          disabled={selectedBuildings.length < 2}
                          onClick={handleAlignToLine}
                          className={`px-2 py-1 rounded flex items-center justify-center gap-1 transition border border-stone-700 ${
                            selectedBuildings.length >= 2
                              ? 'bg-stone-800 hover:bg-stone-700 text-stone-200 cursor-pointer'
                              : 'bg-stone-900 text-stone-600 cursor-not-allowed border-stone-800'
                          }`}
                          title="重心の主軸に垂直な位置を平均に揃えて1本の直線上に並べる (2棟以上)"
                        >
                          <AlignJustify className="w-3 h-3 text-amber-400" />
                          <span>一列に揃える</span>
                        </button>
                        <button
                          type="button"
                          disabled={selectedBuildings.length < 3}
                          onClick={handleDistributeEvenly}
                          className={`px-2 py-1 rounded flex items-center justify-center gap-1 transition border border-stone-700 ${
                            selectedBuildings.length >= 3
                              ? 'bg-stone-800 hover:bg-stone-700 text-stone-200 cursor-pointer'
                              : 'bg-stone-900 text-stone-600 cursor-not-allowed border-stone-800'
                          }`}
                          title="主方向に沿って等間隔に並べる (両端は固定、3棟以上)"
                        >
                          <AlignJustify className="w-3 h-3 text-emerald-400 rotate-90" />
                          <span>等間隔に並べる</span>
                        </button>
                        <button
                          type="button"
                          disabled={!selectedBuildings.some((b) => b.buildingKind !== 'tower')}
                          onClick={handleMinAreaRect}
                          className="px-2 py-1 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded flex items-center justify-center gap-1 transition cursor-pointer border border-stone-700"
                          title="多角形の建物を最小外接長方形に整形 (見張り塔は除く)"
                        >
                          <Ruler className="w-3 h-3 text-sky-400" />
                          <span>長方形に整える</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Single Object Inspector */}
                {singleSelected && (
                  <div className="space-y-2 text-[11px]">
                    {/* Name input */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-stone-400 shrink-0">名前:</span>
                      <input
                        type="text"
                        value={singleSelected.name || ''}
                        placeholder={singleSelected.id}
                        onChange={(e) => {
                          const updated = { ...singleSelected, name: e.target.value };
                          handleUpdateSingleObject(updated, '町部品の名前を変更');
                        }}
                        className="flex-1 bg-stone-800 border border-stone-700 rounded px-2 py-0.5 text-stone-200 text-xs focus:ring-1 focus:ring-amber-500 outline-none"
                      />
                    </div>

                    {/* Road properties */}
                    {singleSelected.kind === 'road' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-stone-400 block mb-0.5">種別:</span>
                            <select
                              value={singleSelected.style}
                              onChange={(e) => {
                                const updated: TownRoad = {
                                  ...singleSelected,
                                  style: e.target.value as TownRoadStyle,
                                };
                                handleUpdateSingleObject(updated, '道路の種別を変更');
                              }}
                              className="w-full bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-200 text-xs"
                            >
                              <option value="main">大通り (石畳)</option>
                              <option value="street">街路 (舗装)</option>
                              <option value="path">小道 (未舗装)</option>
                            </select>
                          </div>

                          <div>
                            <span className="text-stone-400 block mb-0.5">幅: {singleSelected.widthM}m</span>
                            <input
                              type="range"
                              min={2}
                              max={16}
                              step={1}
                              value={singleSelected.widthM}
                              onChange={(e) => {
                                const updated: TownRoad = {
                                  ...singleSelected,
                                  widthM: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '道路の幅を変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={singleSelected.smooth}
                              onChange={(e) => {
                                const updated: TownRoad = {
                                  ...singleSelected,
                                  smooth: e.target.checked,
                                };
                                handleUpdateSingleObject(updated, '曲線の滑らかさを変更');
                              }}
                              className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                            />
                            <span className="text-stone-300">Catmull-Rom曲線</span>
                          </label>

                          <span className="text-stone-400">
                            全長: <strong className="text-amber-200 font-mono">{Math.round(polylineLength(singleSelected.points) * metersPerUnit)}m</strong> ({singleSelected.points.length}頂点)
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Wall properties */}
                    {singleSelected.kind === 'wall' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-stone-400 block mb-0.5">厚み: {singleSelected.thicknessM}m</span>
                            <input
                              type="range"
                              min={2}
                              max={10}
                              step={1}
                              value={singleSelected.thicknessM}
                              onChange={(e) => {
                                const updated: TownWall = {
                                  ...singleSelected,
                                  thicknessM: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '城壁の厚みを変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>

                          <div>
                            <span className="text-stone-400 block mb-0.5">塔半径: {singleSelected.towerRadiusM}m</span>
                            <input
                              type="range"
                              min={2}
                              max={8}
                              step={0.5}
                              value={singleSelected.towerRadiusM}
                              onChange={(e) => {
                                const updated: TownWall = {
                                  ...singleSelected,
                                  towerRadiusM: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '見張り塔半径を変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={singleSelected.towers}
                              onChange={(e) => {
                                const updated: TownWall = {
                                  ...singleSelected,
                                  towers: e.target.checked,
                                };
                                handleUpdateSingleObject(updated, '見張り塔の有無を変更');
                              }}
                              className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                            />
                            <span className="text-stone-300">見張り塔を表示</span>
                          </label>

                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={singleSelected.closed}
                              onChange={(e) => {
                                const updated: TownWall = {
                                  ...singleSelected,
                                  closed: e.target.checked,
                                };
                                handleUpdateSingleObject(updated, '城郭ループの開閉を変更');
                              }}
                              className="w-3 h-3 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                            />
                            <span className="text-stone-300">閉じた城郭</span>
                          </label>
                        </div>

                        {/* Gates Management */}
                        <div className="bg-stone-900 border border-stone-800 rounded p-1.5 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-stone-300 font-semibold">
                              城門: {singleSelected.gates.length} 箇所
                            </span>
                            <button
                              type="button"
                              onClick={() => onToggleAddingGateMode?.(!isAddingGateMode)}
                              className={`px-2 py-0.5 rounded text-[10px] flex items-center gap-1 transition ${
                                isAddingGateMode
                                  ? 'bg-amber-500 text-stone-950 font-bold'
                                  : 'bg-stone-800 hover:bg-stone-700 text-amber-300'
                              }`}
                            >
                              <Plus className="w-2.5 h-2.5" />
                              <span>{isAddingGateMode ? '壁をクリックして門を配置中' : '門を追加'}</span>
                            </button>
                          </div>

                          {singleSelected.gates.length > 0 && (
                            <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                              {singleSelected.gates.map((g, gIdx) => (
                                <div
                                  key={gIdx}
                                  className="flex items-center justify-between bg-stone-950 px-2 py-1 rounded text-[10px]"
                                >
                                  <span className="text-stone-300">
                                    門 #{gIdx + 1}: 区間{g.segmentIndex + 1}
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-stone-400">幅:</span>
                                    <input
                                      type="number"
                                      min={2}
                                      max={16}
                                      step={0.5}
                                      value={g.widthM}
                                      onChange={(e) => {
                                        const w = Math.max(2, Math.min(20, Number(e.target.value) || 4));
                                        const nextGates = [...singleSelected.gates];
                                        nextGates[gIdx] = { ...g, widthM: w };
                                        handleUpdateSingleObject({ ...singleSelected, gates: nextGates }, '城門の幅を変更');
                                      }}
                                      className="w-12 bg-stone-800 border border-stone-700 rounded px-1 py-0.5 text-stone-200 text-[10px]"
                                    />
                                    <span className="text-stone-400">m</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updated = removeGate(singleSelected, gIdx);
                                        handleUpdateSingleObject(updated, '城門の削除');
                                      }}
                                      className="text-stone-500 hover:text-red-400 p-0.5 rounded ml-1"
                                      title="この城門を削除"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Pier properties */}
                    {singleSelected.kind === 'pier' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-2 items-center">
                          <div>
                            <span className="text-stone-400 block mb-0.5">種類:</span>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="singlePierVariant"
                                  checked={singleSelected.variant === 'pier'}
                                  onChange={() => {
                                    const updated: TownPier = { ...singleSelected, variant: 'pier' };
                                    handleUpdateSingleObject(updated, '桟橋に変更');
                                  }}
                                  className="text-amber-500 bg-stone-800"
                                />
                                <span>桟橋</span>
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="singlePierVariant"
                                  checked={singleSelected.variant === 'bridge'}
                                  onChange={() => {
                                    const updated: TownPier = { ...singleSelected, variant: 'bridge' };
                                    handleUpdateSingleObject(updated, '橋に変更');
                                  }}
                                  className="text-amber-500 bg-stone-800"
                                />
                                <span>橋</span>
                              </label>
                            </div>
                          </div>

                          <div>
                            <span className="text-stone-400 block mb-0.5">幅: {singleSelected.widthM}m</span>
                            <input
                              type="range"
                              min={2}
                              max={12}
                              step={1}
                              value={singleSelected.widthM}
                              onChange={(e) => {
                                const updated: TownPier = {
                                  ...singleSelected,
                                  widthM: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '桟橋の幅を変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        <div className="text-right text-stone-400">
                          全長: <strong className="text-amber-200 font-mono">{Math.round(polylineLength(singleSelected.points) * metersPerUnit)}m</strong> ({singleSelected.points.length}頂点)
                        </div>
                      </div>
                    )}

                    {/* Building properties */}
                    {singleSelected.kind === 'building' && (
                      <div className="space-y-2">
                        <div>
                          <span className="text-stone-400 block mb-0.5">建物の種類:</span>
                          <select
                            value={singleSelected.buildingKind}
                            onChange={(e) => {
                              const updated: TownBuilding = {
                                ...singleSelected,
                                buildingKind: e.target.value as TownBuildingKind,
                              };
                              handleUpdateSingleObject(updated, '建物の種類を変更');
                            }}
                            className="w-full bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-200 text-xs"
                          >
                            <option value="house">民家 (House)</option>
                            <option value="shop">商家・工房 (Shop)</option>
                            <option value="hall">大広間・ギルド (Hall)</option>
                            <option value="church">教会・聖堂 (Church)</option>
                            <option value="keep">天守・要塞 (Keep)</option>
                            <option value="tower">見張り塔 (Tower)</option>
                            <option value="barn">納屋・倉庫 (Barn)</option>
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-stone-400 block mb-0.5">高さ: {singleSelected.heightM}m</span>
                            <input
                              type="range"
                              min={4}
                              max={24}
                              step={1}
                              value={singleSelected.heightM}
                              onChange={(e) => {
                                const updated = {
                                  ...singleSelected,
                                  heightM: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '建物の高さを変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>

                          <div>
                            <span className="text-stone-400 block mb-0.5">屋根トーン差: {Math.round(singleSelected.tone * 100)}%</span>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={singleSelected.tone}
                              onChange={(e) => {
                                const updated = {
                                  ...singleSelected,
                                  tone: Number(e.target.value),
                                };
                                handleUpdateSingleObject(updated, '屋根トーンの変更');
                              }}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* District properties */}
                    {singleSelected.kind === 'district' && (
                      <div>
                        <span className="text-stone-400 block mb-0.5">区画の種類:</span>
                        <select
                          value={singleSelected.districtKind}
                          onChange={(e) => {
                            const updated: TownDistrict = {
                              ...singleSelected,
                              districtKind: e.target.value as TownDistrictKind,
                            };
                            handleUpdateSingleObject(updated, '区画の種類を変更');
                          }}
                          className="w-full bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-200 text-xs"
                        >
                          <option value="residential">住宅街 (Residential)</option>
                          <option value="market">市場・商業区 (Market)</option>
                          <option value="noble">貴族街 (Noble)</option>
                          <option value="poor">貧民街・下町 (Poor)</option>
                          <option value="park">庭園・広場 (Park)</option>
                          <option value="farmland">農地・畑 (Farmland)</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* District Auto-Fill Section (when 1 or more districts selected) */}
                {selectedDistricts.length > 0 && (
                  <div className="pt-2 border-t border-amber-800/40 space-y-2">
                    <div className="flex items-center justify-between text-amber-300 font-semibold text-xs">
                      <div className="flex items-center gap-1.5">
                        <Wand2 className="w-3.5 h-3.5 text-amber-400" />
                        <span>建物の自動敷き詰め</span>
                      </div>
                      {selectedDistricts.length > 1 && (
                        <span className="text-[10px] text-amber-400/80 font-mono">
                          ({selectedDistricts.length}区画)
                        </span>
                      )}
                    </div>

                    {!firstNonPark ? (
                      <div className="bg-stone-900 border border-stone-800 rounded p-2 text-stone-400 text-xs">
                        公園には配置できません
                      </div>
                    ) : autoFillConfig ? (
                      <div className="bg-stone-900/90 border border-stone-800 rounded p-2 space-y-2 text-[11px]">
                        {/* 密度 */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-stone-400 shrink-0">
                            密度: {Math.round(autoFillConfig.density * 100)}%
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={autoFillConfig.density}
                            onChange={(e) => updateConfig({ density: Number(e.target.value) })}
                            className="flex-1 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                        </div>

                        {/* 道沿い & 内部チェックボックス */}
                        <div className="flex items-center gap-4 pt-0.5">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={autoFillConfig.frontage}
                              onChange={(e) => updateConfig({ frontage: e.target.checked })}
                              className="w-3.5 h-3.5 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                            />
                            <span className="text-stone-300">道沿いに並べる</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={autoFillConfig.interior}
                              onChange={(e) => updateConfig({ interior: e.target.checked })}
                              className="w-3.5 h-3.5 rounded border-stone-700 bg-stone-800 text-amber-500 focus:ring-0"
                            />
                            <span className="text-stone-300">内部を埋める</span>
                          </label>
                        </div>

                        {/* 道からの距離 & 建物の間隔 */}
                        <div className="grid grid-cols-2 gap-2 pt-0.5">
                          <div>
                            <span className="text-stone-400 block mb-0.5">
                              道からの距離: {autoFillConfig.roadSetbackM}m
                            </span>
                            <input
                              type="range"
                              min={0.5}
                              max={10}
                              step={0.5}
                              value={autoFillConfig.roadSetbackM}
                              onChange={(e) => updateConfig({ roadSetbackM: Number(e.target.value) })}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                          <div>
                            <span className="text-stone-400 block mb-0.5">
                              建物の間隔: {autoFillConfig.gapM}m
                            </span>
                            <input
                              type="range"
                              min={1}
                              max={15}
                              step={0.5}
                              value={autoFillConfig.gapM}
                              onChange={(e) => updateConfig({ gapM: Number(e.target.value) })}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        {/* 区画の端からの距離 & 向きのばらつき */}
                        <div className="grid grid-cols-2 gap-2 pt-0.5">
                          <div>
                            <span className="text-stone-400 block mb-0.5">
                              区画の端から: {autoFillConfig.edgeSetbackM}m
                            </span>
                            <input
                              type="range"
                              min={0.5}
                              max={10}
                              step={0.5}
                              value={autoFillConfig.edgeSetbackM}
                              onChange={(e) => updateConfig({ edgeSetbackM: Number(e.target.value) })}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                          <div>
                            <span className="text-stone-400 block mb-0.5">
                              向きのばらつき: ±{autoFillConfig.angleJitterDeg}°
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={30}
                              step={1}
                              value={autoFillConfig.angleJitterDeg}
                              onChange={(e) => updateConfig({ angleJitterDeg: Number(e.target.value) })}
                              className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        {/* 内部の列の向き */}
                        <div className="space-y-1 pt-0.5 border-t border-stone-800">
                          <div className="flex items-center justify-between">
                            <span className="text-stone-400">内部の列の向き:</span>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="autoFillOrient"
                                  checked={autoFillConfig.orientationMode === 'auto'}
                                  onChange={() => updateConfig({ orientationMode: 'auto' })}
                                  className="text-amber-500 bg-stone-800"
                                />
                                <span>自動</span>
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="autoFillOrient"
                                  checked={autoFillConfig.orientationMode === 'fixed'}
                                  onChange={() => updateConfig({ orientationMode: 'fixed' })}
                                  className="text-amber-500 bg-stone-800"
                                />
                                <span>固定角度</span>
                              </label>
                            </div>
                          </div>

                          {autoFillConfig.orientationMode === 'fixed' && (
                            <div className="flex items-center justify-between gap-2 pt-0.5">
                              <span className="text-stone-400 shrink-0">
                                角度: {autoFillConfig.fixedAngleDeg}°
                              </span>
                              <input
                                type="range"
                                min={0}
                                max={345}
                                step={15}
                                value={autoFillConfig.fixedAngleDeg}
                                onChange={(e) => updateConfig({ fixedAngleDeg: Number(e.target.value) })}
                                className="flex-1 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                              />
                            </div>
                          )}
                        </div>

                        {/* 広場の割合 */}
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <span className="text-stone-400 shrink-0">
                            広場の割合: {Math.round(autoFillConfig.plazaRatio * 100)}%
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={0.6}
                            step={0.05}
                            value={autoFillConfig.plazaRatio}
                            onChange={(e) => updateConfig({ plazaRatio: Number(e.target.value) })}
                            className="flex-1 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                        </div>

                        {/* シード */}
                        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-stone-800">
                          <span className="text-stone-400 shrink-0">シード:</span>
                          <input
                            type="number"
                            value={autoFillSeed}
                            onChange={(e) => {
                              setPreviewDismissed(false);
                              setAutoFillSeed(Number(e.target.value) || 0);
                            }}
                            className="w-24 bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-200 font-mono text-[10px]"
                          />
                          <button
                            type="button"
                            onClick={handleRerollSeed}
                            className="px-2 py-0.5 bg-stone-800 hover:bg-stone-750 text-stone-200 rounded text-[10px] flex items-center gap-1 border border-stone-700 cursor-pointer transition"
                            title="別のシードで再生成"
                          >
                            <RotateCw className="w-3 h-3 text-amber-400" />
                            <span>別のシード</span>
                          </button>
                        </div>

                        {/* プレビュー結果表示 */}
                        {autoFillStats && (
                          <div className="bg-stone-950/80 border border-stone-800 rounded p-1.5 space-y-1 text-[10px]">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-amber-300">
                                プレビュー: {autoFillStats.placed}棟
                              </span>
                              {autoFillStats.hitLimit && (
                                <span className="text-amber-400 bg-amber-950/80 border border-amber-800 px-1 py-0.2 rounded text-[9px] font-bold">
                                  上限に達しました
                                </span>
                              )}
                            </div>
                            <div className="text-stone-400 text-[9px] leading-tight">
                              却下: 道 {autoFillStats.rejectedRoad}・重なり {autoFillStats.rejectedOverlap}・水 {autoFillStats.rejectedWater}・城壁 {autoFillStats.rejectedWall}
                              {autoFillStats.rejectedOutside > 0 && `・区画外 ${autoFillStats.rejectedOutside}`}
                            </div>
                          </div>
                        )}

                        {/* 確定 & キャンセル ボタン */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={!autoFillPreviewBuildings || autoFillPreviewBuildings.length === 0}
                            onClick={handleCommitAutoFill}
                            className="flex-1 px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-stone-950 font-bold rounded text-xs flex items-center justify-center gap-1 shadow cursor-pointer transition"
                            title="プレビューの建物を町マップに追加"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>確定 ({autoFillPreviewBuildings?.length || 0}棟)</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelAutoFill}
                            className="px-2.5 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded text-xs flex items-center justify-center gap-1 border border-stone-700 cursor-pointer transition"
                            title="プレビューを破棄"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>キャンセル</span>
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {/* Template Notification Message Banner */}
            {templateMessage && (
              <div
                className={`text-xs px-2.5 py-1.5 rounded border flex items-start gap-1.5 transition-all ${
                  templateMessage.kind === 'error'
                    ? 'bg-red-950/80 border-red-500/60 text-red-200'
                    : 'bg-amber-950/80 border-amber-500/60 text-amber-200'
                }`}
              >
                <span className="shrink-0 mt-0.5 font-bold">
                  {templateMessage.kind === 'error' ? '⚠' : 'ℹ'}
                </span>
                <span className="leading-snug">{templateMessage.text}</span>
              </div>
            )}

            {/* Town Templates Management Section */}
            <div className="bg-stone-950/70 border border-stone-800 rounded-lg p-2.5 space-y-2">
              <div className="flex items-center justify-between border-b border-stone-800 pb-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                  <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                  <span>町テンプレート</span>
                  <span className="text-[10px] bg-stone-800 text-stone-400 font-mono px-1.5 py-0.2 rounded-full">
                    {townTemplates.length} 件
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleExportTemplates}
                    disabled={townTemplates.length === 0}
                    className="p-1 hover:bg-stone-800 disabled:opacity-40 text-stone-400 hover:text-stone-200 rounded transition cursor-pointer"
                    title="テンプレートライブラリを書き出し (JSON)"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1 hover:bg-stone-800 text-stone-400 hover:text-stone-200 rounded transition cursor-pointer"
                    title="テンプレートライブラリを読み込み (JSON)"
                  >
                    <Upload className="w-3 h-3" />
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImportFile}
                    accept=".json"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setIsTemplatesCollapsed(!isTemplatesCollapsed)}
                    className="p-1 hover:bg-stone-800 text-stone-400 hover:text-stone-200 rounded transition cursor-pointer"
                    title={isTemplatesCollapsed ? '展開' : '折りたたむ'}
                  >
                    {isTemplatesCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {!isTemplatesCollapsed && (
                <div className="space-y-2">
                  {/* Save current selection as template */}
                  <div className="bg-stone-900/80 border border-stone-800/80 rounded p-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-stone-300">
                      <span>選択中の部品を保存:</span>
                      <span className="text-[10px] text-stone-500 font-mono">
                        {selectedObjects.length > 0 ? `${selectedObjects.length}件選択中` : '未選択'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="テンプレート名 (例: 宿場街、城門前広場)"
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && selectedObjects.length > 0) {
                            handleSaveCurrentTemplate();
                          }
                        }}
                        className="flex-1 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        maxLength={60}
                      />
                      <button
                        type="button"
                        disabled={selectedObjects.length === 0}
                        onClick={handleSaveCurrentTemplate}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-stone-950 font-bold rounded text-xs flex items-center gap-1 transition shadow cursor-pointer shrink-0"
                        title={selectedObjects.length === 0 ? '部品を選択するとテンプレートとして保存できます' : '選択中の部品をテンプレートとして保存'}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>保存</span>
                      </button>
                    </div>

                    {selectedObjects.length === 0 && (
                      <div className="text-[10px] text-stone-500">
                        ※ 地図上で部品を選択すると、テンプレートとして保存できます
                      </div>
                    )}
                  </div>

                  {/* Saved Templates List */}
                  {townTemplates.length === 0 ? (
                    <div className="text-[10px] text-stone-500 text-center py-2 border border-dashed border-stone-800 rounded">
                      保存されたテンプレートはありません
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                      {townTemplates.map((template) => {
                        const isPlacingThis = templatePlacement?.template.id === template.id;
                        const isEditingName = editingTemplateId === template.id;
                        const isConfirmingDelete = deleteConfirmId === template.id;

                        return (
                          <div
                            key={template.id}
                            className={`flex items-center gap-2 p-1.5 rounded border transition ${
                              isPlacingThis
                                ? 'bg-amber-950/60 border-amber-500/80 shadow'
                                : 'bg-stone-900/60 hover:bg-stone-900 border-stone-800/80'
                            }`}
                          >
                            {renderTemplateThumbnail(template)}

                            <div className="flex-1 min-w-0 space-y-0.5">
                              {isEditingName ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={editingNameValue}
                                    onChange={(e) => setEditingNameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleCommitRename(template.id);
                                      if (e.key === 'Escape') setEditingTemplateId(null);
                                    }}
                                    className="bg-stone-800 border border-amber-500 rounded px-1 py-0.5 text-[11px] text-stone-200 w-full"
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleCommitRename(template.id)}
                                    className="p-0.5 text-emerald-400 hover:text-emerald-300"
                                    title="保存"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingTemplateId(null)}
                                    className="p-0.5 text-stone-400 hover:text-stone-300"
                                    title="キャンセル"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <span
                                    className="font-medium text-stone-200 text-xs truncate"
                                    title={template.name}
                                  >
                                    {template.name}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleStartRename(template)}
                                    className="text-stone-500 hover:text-stone-300 p-0.5 transition"
                                    title="名前を変更"
                                  >
                                    <Edit2 className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}

                              <div className="text-[10px] text-stone-400 flex items-center gap-1.5 font-mono">
                                <span>{template.sizeM.width}×{template.sizeM.height}m</span>
                                <span>・</span>
                                <span>{template.objects.length}個</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isPlacingThis) {
                                    onCancelTemplatePlacement?.();
                                  } else {
                                    onStartTemplatePlacement?.(template);
                                  }
                                }}
                                className={`px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1 transition cursor-pointer ${
                                  isPlacingThis
                                    ? 'bg-amber-600 text-stone-950 font-bold'
                                    : 'bg-stone-800 hover:bg-stone-750 text-amber-300 border border-stone-700'
                                }`}
                                title={isPlacingThis ? '配置モードを終了' : 'このテンプレートを配置'}
                              >
                                <Stamp className="w-3 h-3" />
                                <span>{isPlacingThis ? '配置中' : '配置'}</span>
                              </button>

                              {isConfirmingDelete ? (
                                <div className="flex items-center gap-0.5 bg-red-950/80 p-0.5 rounded border border-red-800">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onDeleteTemplate?.(template.id);
                                      setDeleteConfirmId(null);
                                    }}
                                    className="text-red-300 hover:text-white px-1 text-[9px] font-bold"
                                    title="本当に削除"
                                  >
                                    削除
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteConfirmId(null)}
                                    className="text-stone-400 hover:text-stone-200 p-0.5"
                                    title="キャンセル"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirmId(template.id)}
                                  className="p-1 text-stone-500 hover:text-red-400 rounded transition cursor-pointer"
                                  title="テンプレートを削除"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Roof Theme Dropdown */}
            <div className="flex items-center justify-between bg-stone-950/60 border border-stone-800/80 rounded px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 text-stone-300">
                <Palette className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-medium">屋根の配色:</span>
              </div>
              <select
                value={roofTheme}
                onChange={(e) => onChangeRoofTheme?.(e.target.value as TownRoofTheme)}
                className="bg-stone-800 hover:bg-stone-750 border border-stone-700 rounded px-2 py-0.5 text-stone-200 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
              >
                <option value="terracotta">赤茶 (テラコッタ)</option>
                <option value="thatch">わら (わら葺き)</option>
                <option value="slate">スレート (青灰色)</option>
                <option value="stone">石 (淡い石色)</option>
              </select>
            </div>

            {/* Custom Textures Section (Collapsible) */}
            <div className="bg-stone-950/60 border border-stone-800/80 rounded overflow-hidden">
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-stone-900/60 border-b border-stone-800/60">
                <div className="flex items-center gap-1.5 text-stone-300">
                  <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[11px] font-semibold text-stone-200">テクスチャ (自作タイル)</span>
                  <span className="text-[10px] text-amber-400/80 font-mono">
                    {townTextures.length > 0 ? `${townTextures.length}件` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => textureUploadInputRef.current?.click()}
                    className="p-1 hover:bg-stone-800 text-stone-400 hover:text-amber-300 rounded transition cursor-pointer"
                    title="テクスチャ画像を追加 (PNG, JPEG, WebP)"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <input
                    type="file"
                    ref={textureUploadInputRef}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        onAddTextures?.(Array.from(e.target.files));
                        e.target.value = '';
                      }
                    }}
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                  />
                  <input
                    type="file"
                    ref={textureImportInputRef}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        onImportTextures?.(e.target.files[0]);
                        e.target.value = '';
                      }
                    }}
                    accept=".json"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setIsTexturesCollapsed(!isTexturesCollapsed)}
                    className="p-1 hover:bg-stone-800 text-stone-400 hover:text-stone-200 rounded transition cursor-pointer"
                    title={isTexturesCollapsed ? '展開' : '折りたたむ'}
                  >
                    {isTexturesCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {!isTexturesCollapsed && (
                <div className="p-2 space-y-2">
                  {/* Status / feedback message */}
                  {textureMessage && (
                    <div
                      className={`text-[10px] px-2 py-1 rounded flex items-center gap-1.5 ${
                        textureMessage.kind === 'error'
                          ? 'bg-red-950/80 border border-red-800 text-red-200'
                          : textureMessage.kind === 'success'
                          ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-200'
                          : 'bg-amber-950/80 border border-amber-800 text-amber-200'
                      }`}
                    >
                      <Sparkles className="w-3 h-3 shrink-0" />
                      <span>{textureMessage.text}</span>
                    </div>
                  )}

                  {/* Sub-tab switcher */}
                  <div className="grid grid-cols-2 gap-1 bg-stone-900/80 p-0.5 rounded border border-stone-800/80 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setActiveTextureTab('assignments')}
                      className={`py-1 rounded font-medium transition cursor-pointer ${
                        activeTextureTab === 'assignments'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      部品への割り当て
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTextureTab('library')}
                      className={`py-1 rounded font-medium transition cursor-pointer flex items-center justify-center gap-1 ${
                        activeTextureTab === 'library'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      <span>画像ライブラリ</span>
                      <span className="font-mono text-[9px] opacity-80">({townTextures.length})</span>
                    </button>
                  </div>

                  {/* SUBSECTION 1: Slot Assignments */}
                  {activeTextureTab === 'assignments' && (
                    <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                      {[
                        {
                          id: 'roof' as const,
                          name: '屋根 (建物)',
                          defaultTileM: 4,
                          slots: [
                            'roof:house',
                            'roof:shop',
                            'roof:hall',
                            'roof:church',
                            'roof:keep',
                            'roof:tower',
                            'roof:barn',
                          ] as TownTextureSlot[],
                        },
                        {
                          id: 'road' as const,
                          name: '道路',
                          defaultTileM: 4,
                          slots: ['road:main', 'road:street', 'road:path'] as TownTextureSlot[],
                        },
                        {
                          id: 'wall' as const,
                          name: '城壁',
                          defaultTileM: 4,
                          slots: ['wall'] as TownTextureSlot[],
                        },
                        {
                          id: 'ground' as const,
                          name: '地面 (区画)',
                          defaultTileM: 16,
                          slots: [
                            'ground:residential',
                            'ground:market',
                            'ground:noble',
                            'ground:poor',
                            'ground:park',
                            'ground:farmland',
                          ] as TownTextureSlot[],
                        },
                      ].map((group) => {
                        // Find representative slot in group with assignment, or first slot
                        const representativeSlot =
                          group.slots.find((s) => textureAssignments[s]?.textureId) || group.slots[0];

                        return (
                          <div
                            key={group.id}
                            className="bg-stone-900/70 border border-stone-800/80 rounded p-2 space-y-1.5"
                          >
                            <div className="flex items-center justify-between border-b border-stone-800/60 pb-1">
                              <span className="text-[11px] font-semibold text-stone-200">
                                {group.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => onApplyTextureGroup?.(group.id, representativeSlot)}
                                className="flex items-center gap-1 text-[9px] text-amber-300 hover:text-amber-200 bg-amber-950/60 hover:bg-amber-900/80 border border-amber-800/70 rounded px-1.5 py-0.5 transition cursor-pointer"
                                title="代表スロットの設定をグループ内の全スロットに一括コピーします"
                              >
                                <Copy className="w-2.5 h-2.5" />
                                <span>グループ全体に適用</span>
                              </button>
                            </div>

                            <div className="space-y-1.5 pt-0.5">
                              {group.slots.map((slot) => {
                                const assign = textureAssignments[slot];
                                const label = getSlotLabel(slot);
                                const isMissingTexture = !!(
                                  assign?.textureId &&
                                  !townTextures.some((t) => t.id === assign.textureId)
                                );

                                return (
                                  <div
                                    key={slot}
                                    className="bg-stone-950/60 border border-stone-800/60 rounded p-1.5 text-[10px] space-y-1.5"
                                  >
                                    <div className="flex items-center justify-between gap-1.5">
                                      <div className="flex items-center gap-1 shrink-0">
                                        <span className="font-medium text-stone-300">
                                          {label}
                                        </span>
                                        {isMissingTexture && (
                                          <span className="text-[9px] text-amber-400 font-normal">
                                            (未登録の画像)
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1 flex-1 justify-end min-w-0">
                                        <select
                                          value={assign?.textureId || ''}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            if (!val) {
                                              onChangeTextureAssignment?.(slot, null);
                                            } else {
                                              onChangeTextureAssignment?.(slot, {
                                                textureId: val,
                                                tileSizeM: assign?.tileSizeM || group.defaultTileM,
                                                tintStrength:
                                                  group.id === 'roof'
                                                    ? assign?.tintStrength ?? 0.25
                                                    : undefined,
                                                alignToObject:
                                                  group.id === 'roof'
                                                    ? assign?.alignToObject ?? true
                                                    : undefined,
                                                opacity:
                                                  group.id === 'ground'
                                                    ? assign?.opacity ?? 0.6
                                                    : undefined,
                                              });
                                            }
                                          }}
                                          className="bg-stone-800 hover:bg-stone-750 border border-stone-700 rounded px-1.5 py-0.5 text-[10px] text-stone-200 font-medium truncate max-w-[140px] focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                                        >
                                          <option value="">なし (標準色)</option>
                                          {isMissingTexture && (
                                            <option value={assign!.textureId}>
                                              (未登録の画像)
                                            </option>
                                          )}
                                          {townTextures.map((tex) => (
                                            <option key={tex.id} value={tex.id}>
                                              {tex.name}
                                            </option>
                                          ))}
                                        </select>

                                        {assign && (
                                          <button
                                            type="button"
                                            onClick={() => onChangeTextureAssignment?.(slot, null)}
                                            className="p-0.5 text-stone-500 hover:text-red-400 rounded transition cursor-pointer"
                                            title="割り当てをクリア"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* Assignment details when texture is selected */}
                                    {assign && (
                                      <div className="pt-1 border-t border-stone-800/50 space-y-1 pl-1">
                                        {/* Tile size */}
                                        <div className="flex items-center justify-between gap-2 text-stone-400">
                                          <span>タイル幅:</span>
                                          <div className="flex items-center gap-1">
                                            <input
                                              type="number"
                                              min="0.25"
                                              max="64"
                                              step="0.25"
                                              value={assign.tileSizeM}
                                              onChange={(e) => {
                                                const val = parseFloat(e.target.value);
                                                if (Number.isFinite(val) && val > 0) {
                                                  onChangeTextureAssignment?.(slot, {
                                                    ...assign,
                                                    tileSizeM: Math.min(64, Math.max(0.25, val)),
                                                  });
                                                }
                                              }}
                                              className="w-14 bg-stone-800 border border-stone-700 rounded px-1 py-0.5 text-right font-mono text-stone-200 text-[10px]"
                                            />
                                            <span className="text-[9px] text-stone-400">m</span>
                                          </div>
                                        </div>

                                        {/* Roof options */}
                                        {group.id === 'roof' && (
                                          <>
                                            <div className="flex items-center justify-between gap-2 text-stone-400">
                                              <span>色合いの濃淡:</span>
                                              <div className="flex items-center gap-1.5">
                                                <input
                                                  type="range"
                                                  min="0"
                                                  max="1"
                                                  step="0.05"
                                                  value={assign.tintStrength ?? 0.25}
                                                  onChange={(e) => {
                                                    onChangeTextureAssignment?.(slot, {
                                                      ...assign,
                                                      tintStrength: parseFloat(e.target.value),
                                                    });
                                                  }}
                                                  className="w-16 accent-amber-500 h-1 cursor-pointer"
                                                />
                                                <span className="w-7 text-right font-mono text-[9px] text-stone-300">
                                                  {Math.round((assign.tintStrength ?? 0.25) * 100)}%
                                                </span>
                                              </div>
                                            </div>

                                            <div className="flex items-center justify-between gap-2 text-stone-400">
                                              <span>建物に向きを合わせる:</span>
                                              <input
                                                type="checkbox"
                                                checked={assign.alignToObject !== false}
                                                onChange={(e) => {
                                                  onChangeTextureAssignment?.(slot, {
                                                    ...assign,
                                                    alignToObject: e.target.checked,
                                                  });
                                                }}
                                                className="accent-amber-500 cursor-pointer"
                                              />
                                            </div>
                                          </>
                                        )}

                                        {/* Ground options */}
                                        {group.id === 'ground' && (
                                          <div className="flex items-center justify-between gap-2 text-stone-400">
                                            <span>不透明度:</span>
                                            <div className="flex items-center gap-1.5">
                                              <input
                                                type="range"
                                                min="0.1"
                                                max="1"
                                                step="0.05"
                                                value={assign.opacity ?? 0.6}
                                                onChange={(e) => {
                                                  onChangeTextureAssignment?.(slot, {
                                                    ...assign,
                                                    opacity: parseFloat(e.target.value),
                                                  });
                                                }}
                                                className="w-16 accent-amber-500 h-1 cursor-pointer"
                                              />
                                              <span className="w-7 text-right font-mono text-[9px] text-stone-300">
                                                {Math.round((assign.opacity ?? 0.6) * 100)}%
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* SUBSECTION 2: Library */}
                  {activeTextureTab === 'library' && (
                    <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                      {/* Library Action Bar */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => textureUploadInputRef.current?.click()}
                          className="flex-1 flex items-center justify-center gap-1 bg-amber-700/80 hover:bg-amber-600 text-amber-100 font-medium py-1 px-2 rounded text-[10px] transition cursor-pointer"
                          title="画像ファイル(PNG, JPEG, WebP)を追加"
                        >
                          <Plus className="w-3 h-3" />
                          <span>画像を追加</span>
                        </button>
                        <button
                          type="button"
                          onClick={onExportTextures}
                          disabled={townTextures.length === 0}
                          className="flex items-center gap-1 bg-stone-800 hover:bg-stone-750 disabled:opacity-40 disabled:pointer-events-none text-stone-300 py-1 px-2 rounded text-[10px] border border-stone-700 transition cursor-pointer"
                          title="テクスチャライブラリを書き出し (JSON)"
                        >
                          <Download className="w-3 h-3" />
                          <span>書出</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => textureImportInputRef.current?.click()}
                          className="flex items-center gap-1 bg-stone-800 hover:bg-stone-750 text-stone-300 py-1 px-2 rounded text-[10px] border border-stone-700 transition cursor-pointer"
                          title="テクスチャライブラリを読み込み (JSON)"
                        >
                          <Upload className="w-3 h-3" />
                          <span>読込</span>
                        </button>
                      </div>

                      {/* Helpful tip */}
                      <div className="bg-stone-900/80 border border-stone-800/80 rounded p-1.5 text-[9px] text-stone-400 leading-tight">
                        💡 シームレス（継ぎ目のない）な画像を使うと、綺麗に敷き詰められます。最大40件まで登録できます。
                      </div>

                      {/* Texture Items List */}
                      {townTextures.length === 0 ? (
                        <div className="text-center py-4 text-stone-500 text-[10px] bg-stone-900/50 rounded border border-dashed border-stone-800">
                          登録されたテクスチャ画像はありません。<br />
                          「画像を追加」から登録してください。
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {townTextures.map((tex) => {
                            const isEditing = editingTextureId === tex.id;
                            const isDeleting = deleteConfirmTextureId === tex.id;

                            return (
                              <div
                                key={tex.id}
                                className="bg-stone-900/80 border border-stone-800/80 rounded p-1.5 space-y-1.5"
                              >
                                <div className="flex items-center gap-2">
                                  {/* 32x32 Thumbnail with checkerboard background */}
                                  <div
                                    className="w-8 h-8 rounded shrink-0 overflow-hidden border border-stone-700 bg-stone-950 relative"
                                    style={{
                                      backgroundImage:
                                        'linear-gradient(45deg, #374151 25%, transparent 25%), linear-gradient(-45deg, #374151 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #374151 75%), linear-gradient(-45deg, transparent 75%, #374151 75%)',
                                      backgroundSize: '8px 8px',
                                      backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                                    }}
                                  >
                                    <img
                                      src={tex.dataUrl}
                                      alt={tex.name}
                                      className="w-full h-full object-cover"
                                      style={tex.pixelated ? { imageRendering: 'pixelated' } : undefined}
                                    />
                                  </div>

                                  {/* Name & Details / Edit */}
                                  <div className="flex-1 min-w-0">
                                    {isEditing ? (
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="text"
                                          value={editingTextureName}
                                          onChange={(e) => setEditingTextureName(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              if (editingTextureName.trim()) {
                                                onRenameTexture?.(tex.id, editingTextureName.trim());
                                              }
                                              setEditingTextureId(null);
                                            } else if (e.key === 'Escape') {
                                              setEditingTextureId(null);
                                            }
                                          }}
                                          autoFocus
                                          className="bg-stone-800 border border-stone-600 rounded px-1.5 py-0.5 text-[10px] text-stone-100 w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (editingTextureName.trim()) {
                                              onRenameTexture?.(tex.id, editingTextureName.trim());
                                            }
                                            setEditingTextureId(null);
                                          }}
                                          className="p-1 text-emerald-400 hover:text-emerald-300 rounded"
                                          title="保存"
                                        >
                                          <Check className="w-3 h-3" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingTextureId(null)}
                                          className="p-1 text-stone-500 hover:text-stone-300 rounded"
                                          title="キャンセル"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col">
                                        <div className="flex items-center gap-1">
                                          <span
                                            className="text-[11px] font-medium text-stone-200 truncate cursor-pointer hover:text-amber-300"
                                            onClick={() => {
                                              setEditingTextureId(tex.id);
                                              setEditingTextureName(tex.name);
                                            }}
                                            title="クリックして名前を変更"
                                          >
                                            {tex.name}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingTextureId(tex.id);
                                              setEditingTextureName(tex.name);
                                            }}
                                            className="text-stone-500 hover:text-stone-300 p-0.5"
                                            title="名前を変更"
                                          >
                                            <Edit2 className="w-2.5 h-2.5" />
                                          </button>
                                        </div>
                                        <span className="text-[9px] text-stone-500 font-mono">
                                          {tex.width} × {tex.height}px
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Actions: Pixelated toggle & Delete */}
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onToggleTexturePixelated?.(tex.id, !tex.pixelated)
                                      }
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition cursor-pointer ${
                                        tex.pixelated
                                          ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
                                          : 'bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-700/60'
                                      }`}
                                      title="ピクセルアート風の補間（最近傍補間）を切り替えます"
                                    >
                                      {tex.pixelated ? 'PXL:ON' : 'PXL:OFF'}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDeleteConfirmTextureId(isDeleting ? null : tex.id)
                                      }
                                      className={`p-1 rounded transition cursor-pointer ${
                                        isDeleting
                                          ? 'text-red-400 bg-red-950/60'
                                          : 'text-stone-500 hover:text-red-400'
                                      }`}
                                      title="テクスチャを削除"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>

                                {/* Inline delete confirmation */}
                                {isDeleting && (
                                  <div className="bg-red-950/90 border border-red-800/80 rounded p-1.5 text-[9px] space-y-1">
                                    <div className="text-red-200 leading-relaxed">
                                      この画像を使っている割り当ては、残りますが、画像が無い間は、標準の色で描かれます。
                                    </div>
                                    <div className="flex items-center justify-end gap-1.5 pt-0.5">
                                      <button
                                        type="button"
                                        onClick={() => setDeleteConfirmTextureId(null)}
                                        className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded cursor-pointer"
                                      >
                                        いいえ
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onDeleteTexture?.(tex.id);
                                          setDeleteConfirmTextureId(null);
                                        }}
                                        className="px-2 py-0.5 bg-red-700 hover:bg-red-600 text-white font-bold rounded cursor-pointer"
                                      >
                                        はい (削除)
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Counts Breakdown Grid */}
            <div className="grid grid-cols-5 gap-1.5 text-center">
              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Layers className="w-2.5 h-2.5 text-amber-500" />
                  <span>区画</span>
                </div>
                <div className="font-mono font-bold text-amber-300 mt-0.5">{counts.districts}</div>
              </div>

              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Milestone className="w-2.5 h-2.5 text-stone-400" />
                  <span>道路</span>
                </div>
                <div className="font-mono font-bold text-stone-200 mt-0.5">{counts.roads}</div>
              </div>

              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Building2 className="w-2.5 h-2.5 text-amber-600" />
                  <span>建物</span>
                </div>
                <div className="font-mono font-bold text-amber-200 mt-0.5">{counts.buildings}</div>
              </div>

              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Shield className="w-2.5 h-2.5 text-stone-300" />
                  <span>城壁</span>
                </div>
                <div className="font-mono font-bold text-stone-200 mt-0.5">{counts.walls}</div>
              </div>

              <div className="bg-stone-950/50 border border-stone-800/60 rounded p-1">
                <div className="flex items-center justify-center gap-1 text-stone-400 text-[10px]">
                  <Anchor className="w-2.5 h-2.5 text-sky-400" />
                  <span>桟橋</span>
                </div>
                <div className="font-mono font-bold text-sky-300 mt-0.5">{counts.piers}</div>
              </div>
            </div>

            {/* Last Placement Stats Notification */}
            {lastPlacementStats && (
              <div className="bg-stone-950/80 border border-stone-700/80 rounded p-2 text-[11px] space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>サンプルの町を配置しました</span>
                </div>
                <div className="text-stone-300 pl-5 space-y-0.5">
                  <div>
                    ・水の上のため置かなかった建物: <span className="font-mono text-amber-300 font-semibold">{lastPlacementStats.skippedBuildingsCount}</span> 棟
                  </div>
                  <div>
                    ・桟橋: <span className={lastPlacementStats.pierPlaced ? 'text-sky-300 font-medium' : 'text-stone-400'}>
                      {lastPlacementStats.pierPlaced ? '置きました' : '水が近くにないため置きませんでした'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setConfirmDialog('sample')}
                className="flex-1 flex items-center justify-center gap-1.5 bg-amber-700/80 hover:bg-amber-600 active:bg-amber-800 text-amber-100 font-medium py-1.5 px-3 rounded shadow transition-colors"
                title="サンプルの町並みを自動配置してペン画風の描画を確認します"
              >
                <Wand2 className="w-3.5 h-3.5 text-amber-200" />
                <span>サンプルの町を配置 (確認用)</span>
              </button>

              <button
                onClick={() => setConfirmDialog('clear')}
                disabled={counts.total === 0}
                className="flex items-center justify-center gap-1 bg-stone-800 hover:bg-red-950/80 hover:text-red-300 hover:border-red-800 border border-stone-700/80 disabled:opacity-40 disabled:pointer-events-none text-stone-300 font-medium py-1.5 px-2.5 rounded transition-colors"
                title="配置されているすべての町オブジェクトを削除します"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>全削除</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-stone-900 border border-stone-700 rounded-lg p-5 max-w-sm w-full shadow-2xl text-stone-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-950/60 border border-amber-800/80 rounded-full text-amber-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-stone-100 text-sm">
                  {confirmDialog === 'sample' ? 'サンプルの町を配置しますか？' : 'すべての部品を削除しますか？'}
                </h3>
                <p className="text-stone-400 text-xs mt-0.5">
                  {confirmDialog === 'sample'
                    ? '現在の部品は置き換えられます。（水域を避けて配置されます。操作は Undo で元に戻せます）'
                    : '配置されているすべての町部品を消去します。（Undo で元に戻せます）'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-800">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs rounded transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={confirmDialog === 'sample' ? handleConfirmSample : handleConfirmClear}
                className={`px-3 py-1.5 text-xs font-medium rounded shadow transition-colors ${
                  confirmDialog === 'sample'
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-red-700 hover:bg-red-600 text-white'
                }`}
              >
                {confirmDialog === 'sample' ? '置き換えて配置' : 'すべて削除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
