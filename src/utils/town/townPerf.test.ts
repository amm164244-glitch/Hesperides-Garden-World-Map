import test from 'node:test';
import assert from 'node:assert/strict';
import { townPerf } from './townPerf';

test('townPerf: no-op when disabled', () => {
  townPerf.setEnabled(false);
  townPerf.reset();

  townPerf.start('townObjects');
  townPerf.end('townObjects');
  townPerf.startConfirmation();

  const snap = townPerf.getSnapshot();
  assert.equal(Object.keys(snap.sections).length, 0);
  assert.equal(snap.lastConfirmation, undefined);
});

test('townPerf: records section timing and confirmation duration when enabled', () => {
  townPerf.setEnabled(true);
  townPerf.reset();

  townPerf.start('townObjects');
  // simulate some work
  const start = Date.now();
  while (Date.now() - start < 5) {
    // busy wait
  }
  const dur = townPerf.end('townObjects');
  assert.ok(dur >= 4, `Expected duration >= 4ms, got ${dur}`);

  // Test confirmation tracking
  townPerf.startConfirmation('test road');
  townPerf.start('renderOverlay_total');
  townPerf.end('renderOverlay_total');

  const snap = townPerf.getSnapshot();
  assert.ok(snap.sections['townObjects']);
  assert.equal(snap.sections['townObjects'].count, 1);
  assert.ok(snap.sections['townObjects'].avgMs >= 4);

  assert.ok(snap.lastConfirmation);
  assert.ok(snap.lastConfirmation.durationMs >= 0);
  assert.equal(snap.lastConfirmation.calls, 1);

  townPerf.setEnabled(false);
});
