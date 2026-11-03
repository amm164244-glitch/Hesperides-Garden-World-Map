import React from 'react';
import { Compass, Mountain, MapPin } from 'lucide-react';
import { MapCell, MapData, RegionalMapData, Viewport } from '../types/map';
import { formatDistance } from '../utils/regionLayout';

interface InspectorBarProps {
  mapData: MapData;
  activeRegionalMap?: RegionalMapData | null;
  hoveredCell: MapCell | null;
  viewport: Viewport;
}

const InspectorBarComponent: React.FC<InspectorBarProps> = ({
  mapData,
  activeRegionalMap,
  hoveredCell,
  viewport,
}) => {
  const getTerrainLabel = (cell: MapCell, seaLevel: number): string => {
    const elev = cell.elevation;
    if (cell.isWater) {
      if (cell.isLake) return '内陸湖 (Lake)';
      if (elev < 15) return '深海 (Abyss)';
      if (elev < 28) return '大洋 (Ocean)';
      return '沿岸浅海 (Shallows)';
    }

    const landT = (elev - seaLevel) / (100 - seaLevel);
    if (landT < 0.05) return '砂浜・海岸 (Beach)';
    if (landT < 0.28) return '低地平野 (Plains)';
    if (landT < 0.52) return '高原・丘陵 (Highlands)';
    if (landT < 0.74) return '山岳地帯 (Mountains)';
    if (landT < 0.88) return '険峰連峰 (Peaks)';
    return '氷河・万年雪 (Glacier)';
  };

  const totalCells = mapData.cells.length;

  // Calculate land vs water percentage (memoized to avoid looping over 10k cells every render)
  const landPercentage = React.useMemo(() => {
    if (totalCells === 0) return 0;
    let landCells = 0;
    for (let i = 0; i < totalCells; i++) {
      if (!mapData.cells[i].isWater) landCells++;
    }
    return Math.round((landCells / totalCells) * 100);
  }, [mapData.cells, totalCells]);

  return (
    <div className="w-full bg-stone-950/90 backdrop-blur-md text-stone-300 border-t border-stone-800 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
      {/* Left: Hovered cell info */}
      <div className="flex items-center gap-4 flex-wrap">
        {hoveredCell ? (
          <>
            <div className="flex items-center gap-1.5 font-medium text-amber-300">
              <MapPin className="w-3.5 h-3.5 text-amber-400" />
              <span>セル #{hoveredCell.id}</span>
              <span className="font-mono text-stone-400 text-[11px]">
                ({Math.round(hoveredCell.x)}, {Math.round(hoveredCell.y)})
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Mountain className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-stone-400">地形:</span>
              <span className="font-semibold text-stone-100">
                {getTerrainLabel(hoveredCell, mapData.seaLevel)}
              </span>
              <span className="font-mono text-amber-400 text-[11px]">
                [標高 {hoveredCell.elevation.toFixed(1)}/100]
              </span>
            </div>


          </>
        ) : (
          <div className="text-stone-500 italic flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-stone-500" />
            <span>地図上のセルにカーソルを合わせると詳細が表示されます</span>
          </div>
        )}
      </div>

      {/* Right: Map general stats */}
      <div className="flex items-center gap-4 font-mono text-[11px] text-stone-400 flex-wrap">
        <div>
          <span>実寸: </span>
          <span className="text-amber-300 font-semibold">
            {formatDistance(activeRegionalMap ? activeRegionalMap.widthKm : mapData.worldWidthKm || 40000)}
          </span>
        </div>
        <div>
          <span>総セル数: </span>
          <span className="text-amber-400 font-semibold">{totalCells.toLocaleString()}</span>
        </div>
        <div>
          <span>陸地率: </span>
          <span className="text-emerald-400 font-semibold">{landPercentage}%</span>
          <span className="text-stone-600"> / </span>
          <span>海: </span>
          <span className="text-sky-400 font-semibold">{100 - landPercentage}%</span>
        </div>
        <div>
          <span>シード: </span>
          <span className="text-stone-300">{activeRegionalMap ? activeRegionalMap.seed : mapData.seed}</span>
        </div>
        <div>
          <span>倍率: </span>
          <span className="text-amber-400">{Math.round(viewport.zoom * 100)}%</span>
        </div>
      </div>
    </div>
  );
};

export const InspectorBar = React.memo(InspectorBarComponent);
