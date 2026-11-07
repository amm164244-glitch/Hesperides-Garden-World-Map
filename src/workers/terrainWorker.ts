import { GeneratorConfig, MapData, ParentMapSource, RegionalBounds, ShapeMaskConfig } from '../types/map';
import { generateTectonicWorld, generateBlankOceanWorld } from '../utils/tectonicGenerator';
import { generateRegionalMap } from '../utils/regionGenerator';
import { generateRiversAndLakes, WaterGenOptions } from '../utils/waterGenerator';

self.onmessage = (e: MessageEvent<{
  action?: 'generateWorld' | 'generateRegion' | 'generateBlankOcean' | 'generateWater';
  width: number;
  height: number;
  config?: GeneratorConfig;
  worldMap?: MapData;
  parentMap?: ParentMapSource | MapData;
  bounds?: RegionalBounds;
  zoomScale?: 4 | 16;
  name?: string;
  shapeMask?: ShapeMaskConfig;
  options?: { kind?: 'region' | 'town'; detailScale?: number; coastFidelity?: number };
  // Parameters for generateWater
  elevationGrid?: Float32Array;
  cols?: number;
  rows?: number;
  mapWidth?: number;
  mapHeight?: number;
  seaLevel?: number;
  seed?: number;
  waterOptions?: WaterGenOptions;
}>) => {
  const {
    action = 'generateWorld',
    width,
    height,
    config,
    worldMap,
    parentMap,
    bounds,
    zoomScale,
    name,
    shapeMask,
    options,
    elevationGrid,
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    seed,
    waterOptions,
  } = e.data;

  try {
    if (action === 'generateWater' && elevationGrid && cols && rows && mapWidth && mapHeight) {
      self.postMessage({ type: 'progress', progress: 5, message: '水文解析の準備中...' });
      const result = generateRiversAndLakes(
        elevationGrid,
        cols,
        rows,
        mapWidth,
        mapHeight,
        seaLevel ?? 35.0,
        seed ?? 12345,
        {
          ...waterOptions,
          onProgress: (percent, message) => {
            self.postMessage({ type: 'progress', progress: percent, message });
          },
        }
      );
      self.postMessage({
        type: 'successWater',
        rivers: result.rivers,
        lakes: result.lakes,
        stats: result.stats,
      });
    } else if (action === 'generateBlankOcean' && config) {
      self.postMessage({ type: 'progress', progress: 50, message: '完全な海（白紙キャンバス）を構築中...' });
      const mapData = generateBlankOceanWorld(width, height, config);
      self.postMessage({ type: 'progress', progress: 100, message: '準備完了！' });
      self.postMessage({ type: 'success', mapData });
    } else if (action === 'generateRegion' && (parentMap || worldMap) && bounds) {
      const isTown = options?.kind === 'town';
      self.postMessage({ type: 'progress', progress: 20, message: isTown ? '町マップの地面を親マップから生成中...' : '親マップから地域データをサンプリング中...' });
      const source = (parentMap || worldMap)!;
      const regionData = generateRegionalMap(source, bounds, zoomScale || 4, name, shapeMask, options);
      self.postMessage({ type: 'progress', progress: 100, message: isTown ? '町マップ生成完了！' : '地域マップ生成完了！' });
      self.postMessage({ type: 'successRegion', regionData });
    } else if (config) {
      self.postMessage({ type: 'progress', progress: 10, message: 'プレートテクトニクス世界を生成中...' });
      const mapData = generateTectonicWorld(width, height, config, (percent, msg) => {
        self.postMessage({ type: 'progress', progress: percent, message: msg });
      });
      self.postMessage({ type: 'success', mapData });
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', error: err?.message || '生成処理中にエラーが発生しました' });
  }
};
