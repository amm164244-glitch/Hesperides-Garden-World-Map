import { GeneratorConfig, MapData, ParentMapSource, RegionalBounds, ShapeMaskConfig } from '../types/map';
import { generateTectonicWorld, generateBlankOceanWorld } from '../utils/tectonicGenerator';
import { generateRegionalMap } from '../utils/regionGenerator';

self.onmessage = (e: MessageEvent<{
  action?: 'generateWorld' | 'generateRegion' | 'generateBlankOcean';
  width: number;
  height: number;
  config?: GeneratorConfig;
  worldMap?: MapData;
  parentMap?: ParentMapSource | MapData;
  bounds?: RegionalBounds;
  zoomScale?: 4 | 16;
  name?: string;
  shapeMask?: ShapeMaskConfig;
}>) => {
  const { action = 'generateWorld', width, height, config, worldMap, parentMap, bounds, zoomScale, name, shapeMask } = e.data;

  try {
    if (action === 'generateBlankOcean' && config) {
      self.postMessage({ type: 'progress', progress: 50, message: '完全な海（白紙キャンバス）を構築中...' });
      const mapData = generateBlankOceanWorld(width, height, config);
      self.postMessage({ type: 'progress', progress: 100, message: '準備完了！' });
      self.postMessage({ type: 'success', mapData });
    } else if (action === 'generateRegion' && (parentMap || worldMap) && bounds) {
      self.postMessage({ type: 'progress', progress: 20, message: '親マップから地域データをサンプリング中...' });
      const source = (parentMap || worldMap)!;
      const regionData = generateRegionalMap(source, bounds, zoomScale || 4, name, shapeMask);
      self.postMessage({ type: 'progress', progress: 100, message: '地域マップ生成完了！' });
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
