/**
 * Frame Scheduler: Coalesces multiple redraw requests in the same animation frame
 * into a single callback invocation.
 */

export interface FrameScheduler {
  schedule: () => void;
  cancel: () => void;
  flush: () => void;
  isPending: () => boolean;
}

export type RafFunction = (callback: FrameRequestCallback) => number;
export type CafFunction = (handle: number) => void;

export function createFrameScheduler(
  callback: () => void,
  customRaf?: RafFunction,
  customCaf?: CafFunction
): FrameScheduler {
  const raf: RafFunction =
    customRaf ??
    (typeof requestAnimationFrame !== 'undefined'
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => (setTimeout(() => cb(Date.now()), 16) as unknown as number));

  const caf: CafFunction =
    customCaf ??
    (typeof cancelAnimationFrame !== 'undefined'
      ? (id) => cancelAnimationFrame(id)
      : (id) => clearTimeout(id as unknown as NodeJS.Timeout));

  let rafId: number | null = null;

  const run = () => {
    rafId = null;
    callback();
  };

  return {
    schedule: () => {
      if (rafId !== null) return;
      rafId = raf(run);
    },
    cancel: () => {
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
    },
    flush: () => {
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
        callback();
      }
    },
    isPending: () => rafId !== null,
  };
}
