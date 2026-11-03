import {
  placeBiomeSymbols,
  PlaceBiomeSymbolsParams,
  PlaceBiomeSymbolsResult,
} from '../utils/biomeSymbolPlacer';

export interface PlacementWorkerRequest {
  id: string;
  params: PlaceBiomeSymbolsParams;
}

export type PlacementWorkerResponse =
  | { type: 'progress'; id: string; progress: number; message: string; slot?: number }
  | { type: 'success'; id: string; result: PlaceBiomeSymbolsResult }
  | { type: 'error'; id: string; error: string };

self.onmessage = (e: MessageEvent<PlacementWorkerRequest>) => {
  const { id, params } = e.data;
  try {
    const result = placeBiomeSymbols({
      ...params,
      onProgress: (progress, message, slot) => {
        self.postMessage({
          type: 'progress',
          id,
          progress,
          message,
          slot,
        } as PlacementWorkerResponse);
      },
    });

    self.postMessage({
      type: 'success',
      id,
      result,
    } as PlacementWorkerResponse);
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      id,
      error: err?.message || 'シンボルの自動配置計算中にエラーが発生しました',
    } as PlacementWorkerResponse);
  }
};
