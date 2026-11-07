import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler, RafFunction, CafFunction } from './frameScheduler';

test('frameScheduler: coalesces multiple schedule() calls within the same frame', () => {
  let callbacks: FrameRequestCallback[] = [];
  let nextId = 1;
  const mockRaf: RafFunction = (cb) => {
    callbacks.push(cb);
    return nextId++;
  };
  const mockCaf: CafFunction = (id) => {
    callbacks = [];
  };

  let executionCount = 0;
  const scheduler = createFrameScheduler(
    () => {
      executionCount++;
    },
    mockRaf,
    mockCaf
  );

  assert.equal(scheduler.isPending(), false);

  // Call schedule 5 times
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();

  assert.equal(scheduler.isPending(), true);
  assert.equal(callbacks.length, 1, 'Only one rAF handle should have been queued');
  assert.equal(executionCount, 0, 'Callback should not be executed synchronously');

  // Trigger the queued animation frame
  const queued = callbacks;
  callbacks = [];
  queued.forEach((cb) => cb(100));

  assert.equal(executionCount, 1, 'Callback should only have executed once');
  assert.equal(scheduler.isPending(), false, 'Pending status should be reset after execution');
});

test('frameScheduler: resets flag after execution so subsequent calls can schedule again', () => {
  let callbacks: FrameRequestCallback[] = [];
  let nextId = 1;
  const mockRaf: RafFunction = (cb) => {
    callbacks.push(cb);
    return nextId++;
  };
  const mockCaf: CafFunction = () => {
    callbacks = [];
  };

  let executionCount = 0;
  const scheduler = createFrameScheduler(
    () => {
      executionCount++;
    },
    mockRaf,
    mockCaf
  );

  // First frame
  scheduler.schedule();
  assert.equal(scheduler.isPending(), true);
  const cb1 = callbacks.shift()!;
  cb1(16);
  assert.equal(executionCount, 1);
  assert.equal(scheduler.isPending(), false);

  // Second frame
  scheduler.schedule();
  assert.equal(scheduler.isPending(), true);
  const cb2 = callbacks.shift()!;
  cb2(32);
  assert.equal(executionCount, 2);
  assert.equal(scheduler.isPending(), false);
});

test('frameScheduler: cancel cancels pending frame', () => {
  let cancelledIds: number[] = [];
  let callbacks: Map<number, FrameRequestCallback> = new Map();
  let nextId = 1;
  const mockRaf: RafFunction = (cb) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  };
  const mockCaf: CafFunction = (id) => {
    cancelledIds.push(id);
    callbacks.delete(id);
  };

  let executionCount = 0;
  const scheduler = createFrameScheduler(
    () => {
      executionCount++;
    },
    mockRaf,
    mockCaf
  );

  scheduler.schedule();
  assert.equal(scheduler.isPending(), true);

  scheduler.cancel();
  assert.equal(scheduler.isPending(), false);
  assert.equal(cancelledIds.length, 1);

  // If callbacks are invoked (should be empty), execution count remains 0
  callbacks.forEach((cb) => cb(50));
  assert.equal(executionCount, 0);
});

test('frameScheduler: flush runs pending callback immediately and resets state', () => {
  let callbacks: Map<number, FrameRequestCallback> = new Map();
  let nextId = 1;
  const mockRaf: RafFunction = (cb) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  };
  const mockCaf: CafFunction = (id) => {
    callbacks.delete(id);
  };

  let executionCount = 0;
  const scheduler = createFrameScheduler(
    () => {
      executionCount++;
    },
    mockRaf,
    mockCaf
  );

  scheduler.schedule();
  assert.equal(scheduler.isPending(), true);

  scheduler.flush();
  assert.equal(executionCount, 1);
  assert.equal(scheduler.isPending(), false);
  assert.equal(callbacks.size, 0);
});
