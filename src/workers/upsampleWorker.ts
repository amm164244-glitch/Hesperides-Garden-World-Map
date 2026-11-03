import { buildElevationFromMask } from '../utils/imageTerrain/upsampleMask';

export interface UpsampleWorkerRequest {
  type: 'upsample';
  sourceMask: Uint8Array;
  srcWidth: number;
  srcHeight: number;
  dstWidth: number;
  dstHeight: number;
  seaLevel: number;
  riaRoughness?: number;
  seed?: number;
}

export type UpsampleWorkerResponse =
  | { type: 'progress'; percent: number; step: string }
  | { type: 'complete'; elevationGrid: Float32Array }
  | { type: 'error'; error: string };

self.onmessage = (e: MessageEvent<UpsampleWorkerRequest>) => {
  const { type, sourceMask, srcWidth, srcHeight, dstWidth, dstHeight, seaLevel, riaRoughness, seed } = e.data;

  if (type === 'upsample') {
    try {
      const elevationGrid = buildElevationFromMask(
        sourceMask,
        srcWidth,
        srcHeight,
        dstWidth,
        dstHeight,
        seaLevel,
        {
          riaRoughness,
          seed,
          onProgress: (percent, step) => {
            self.postMessage({ type: 'progress', percent, step });
          },
        }
      );

      (self.postMessage as (message: any, transfer: Transferable[]) => void)(
        {
          type: 'complete',
          elevationGrid,
        },
        [elevationGrid.buffer]
      );
    } catch (err: any) {
      self.postMessage({
        type: 'error',
        error: 'メモリが足りません。解像度を下げてお試しください',
      });
    }
  }
};
