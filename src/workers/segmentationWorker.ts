import {
  segmentLandSea,
  SegmentationOptions,
  SegmentationResult,
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
  | { type: 'error'; error: string };

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

      // Return result to main thread
      self.postMessage(
        {
          type: 'complete',
          result,
        },
        // Transfer ArrayBuffers for high performance
        [result.mask.buffer, result.boundaryMask.buffer]
      );
    } catch (err: any) {
      self.postMessage({
        type: 'error',
        error: err?.message || '陸海判定処理中にエラーが発生しました',
      });
    }
  }
};
