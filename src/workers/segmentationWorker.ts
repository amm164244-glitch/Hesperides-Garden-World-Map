import {
  segmentLandSea,
  SegmentationOptions,
  SegmentationResult,
  SeedCounts,
  InsufficientSeedsError,
} from '../utils/imageTerrain/segmentLandSea';

export interface SegmentationWorkerRequest {
  type: 'segment';
  imageData: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  };
  options: SegmentationOptions;
}

export type SegmentationWorkerResponse =
  | { type: 'progress'; step: string; percent: number }
  | { type: 'complete'; result: SegmentationResult }
  | { type: 'error'; error: string; seedCounts?: SeedCounts; seedMask?: Uint8Array };

self.onmessage = (e: MessageEvent<SegmentationWorkerRequest>) => {
  const { type, imageData, options } = e.data;

  if (type === 'segment') {
    try {
      const result = segmentLandSea(
        imageData,
        options,
        (step, percent) => {
          self.postMessage({ type: 'progress', step, percent });
        }
      );

      const transferables: Transferable[] = [result.mask.buffer, result.boundaryMask.buffer];
      if (result.seedMask) {
        transferables.push(result.seedMask.buffer);
      }

      // Return result to main thread
      (self.postMessage as (message: any, transfer: Transferable[]) => void)(
        {
          type: 'complete',
          result,
        },
        transferables
      );
    } catch (err: any) {
      if (err instanceof InsufficientSeedsError) {
        self.postMessage({
          type: 'error',
          error: err.message,
          seedCounts: err.seedCounts,
          seedMask: err.seedMask,
        });
      } else {
        self.postMessage({
          type: 'error',
          error: err?.message || '陸海判定処理中にエラーが発生しました',
        });
      }
    }
  }
};
