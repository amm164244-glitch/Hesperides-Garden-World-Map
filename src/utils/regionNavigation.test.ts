import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUniformChild,
  parentToChildViewport,
  childToParentViewport,
  getVisibleRect,
  findChildToEnter,
  shouldExitToParent,
  getMaxZoomForMap,
  ENTER_MIN_ZOOM,
  EXIT_MAX_ZOOM,
} from './regionNavigation.ts';
import { RegionalMapData, Viewport } from '../types/map.ts';

const createDummyRegion = (
  id: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  width = 2000,
  height = 1000
): RegionalMapData => ({
  id,
  name: `Region ${id}`,
  bounds: { minX, minY, maxX, maxY },
  zoomScale: 4,
  width,
  height,
  gridCols: 1024,
  gridRows: 512,
  elevationGrid: new Float32Array(0),
  seaLevel: 35,
  createdAt: new Date().toISOString(),
  parentId: null,
  seed: 12345,
  widthKm: 10000,
});

test('isUniformChild correctly checks aspect ratio matching within 1% tolerance', () => {
  const parent = { width: 2000, height: 1000 };
  // Exactly 2:1 child (500x250) matching 2000x1000 child dimensions
  const childExact = createDummyRegion('r1', 100, 100, 600, 350, 2000, 1000);
  assert.equal(isUniformChild(childExact, parent), true);

  // Non-2:1 child (e.g. 1:1 square: 300x300 bounds matching 1414x1414 child dimensions)
  const childSquare = createDummyRegion('rSquare', 100, 100, 400, 400, 1414, 1414);
  assert.equal(isUniformChild(childSquare, parent), true);

  // 0.8% difference (within 1% tolerance)
  const childClose = createDummyRegion('r2', 100, 100, 600, 352, 2000, 1000);
  assert.equal(isUniformChild(childClose, parent), true);

  // Distorted child (bounds 500x400 => ratio 1.25, but child width/height is 2000/1000 = 2.0)
  const childDistorted = createDummyRegion('r3', 100, 100, 600, 500, 2000, 1000);
  assert.equal(isUniformChild(childDistorted, parent), false);
});

test('parentToChildViewport and childToParentViewport roundtrip exactly', () => {
  const parent = { width: 2000, height: 1000 };
  const child = createDummyRegion('child1', 400, 200, 900, 450); // width: 500, height: 250
  const originalParentVp: Viewport = { x: -300, y: -150, zoom: 2.4 };

  const childVp = parentToChildViewport(originalParentVp, child);
  const backToParentVp = childToParentViewport(childVp, child);

  assert.ok(Math.abs(backToParentVp.x - originalParentVp.x) < 1e-6);
  assert.ok(Math.abs(backToParentVp.y - originalParentVp.y) < 1e-6);
  assert.ok(Math.abs(backToParentVp.zoom - originalParentVp.zoom) < 1e-6);
});

test('Screen point projects to identical world location across transition', () => {
  const child = createDummyRegion('child1', 400, 200, 900, 450);
  const parentVp: Viewport = { x: -200, y: -100, zoom: 3.0 };
  const childVp = parentToChildViewport(parentVp, child);

  // Choose a screen coordinate, say (650, 420)
  const screenX = 650;
  const screenY = 420;

  // In parent coordinates:
  const parentMapX = (screenX - parentVp.x) / parentVp.zoom;
  const parentMapY = (screenY - parentVp.y) / parentVp.zoom;

  // In child coordinates:
  const childMapX = (screenX - childVp.x) / childVp.zoom;
  const childMapY = (screenY - childVp.y) / childVp.zoom;

  // Converting child coordinate back to parent map coordinate:
  const k = (child.bounds.maxX - child.bounds.minX) / child.width;
  const convertedParentX = child.bounds.minX + childMapX * k;
  const convertedParentY = child.bounds.minY + childMapY * k;

  assert.ok(Math.abs(parentMapX - convertedParentX) < 1e-6);
  assert.ok(Math.abs(parentMapY - convertedParentY) < 1e-6);
});

test('findChildToEnter selects valid uniform child whose margin contains screen center and zoom threshold is met', () => {
  const parent = { width: 2000, height: 1000 };
  const screenW = 800;
  const screenH = 600;

  // Child at (400, 200) to (900, 450), width: 500, height: 250
  const child1 = createDummyRegion('c1', 400, 200, 900, 450);

  // Parent viewport centered at center of child (650, 325)
  // screen center is (400, 300).
  // If map point (650, 325) is at screen (400, 300):
  // 400 = vp.x + 650 * vp.zoom => vp.x = 400 - 650 * zoom
  // 300 = vp.y + 325 * vp.zoom => vp.y = 300 - 325 * zoom
  const zoom = 2.5; // k = 500 / 2000 = 0.25 => targetZoom = 2.5 * 0.25 = 0.625 >= 0.5 (ENTER_MIN_ZOOM)
  const vp: Viewport = {
    x: 400 - 650 * zoom,
    y: 300 - 325 * zoom,
    zoom,
  };

  const selected = findChildToEnter(vp, [child1], parent, screenW, screenH);
  assert.equal(selected?.id, 'c1');

  // If zoom is too small (e.g. 1.0 => targetZoom = 0.25 < 0.5), it should not enter
  const lowZoomVp: Viewport = {
    x: 400 - 650 * 1.0,
    y: 300 - 325 * 1.0,
    zoom: 1.0,
  };
  assert.equal(findChildToEnter(lowZoomVp, [child1], parent, screenW, screenH), null);

  // If screen center is outside 10% margin, it should not enter
  // Child bounds: [400, 900], 10% margin is 50px => valid range is [450, 850]
  // Put center at 420 (within outer bounds, but inside the 10% margin edge)
  const edgeVp: Viewport = {
    x: 400 - 420 * zoom,
    y: 300 - 325 * zoom,
    zoom,
  };
  assert.equal(findChildToEnter(edgeVp, [child1], parent, screenW, screenH), null);
});

test('shouldExitToParent returns true when zoom < EXIT_MAX_ZOOM', () => {
  assert.equal(shouldExitToParent({ x: 0, y: 0, zoom: 0.29 }), true);
  assert.equal(shouldExitToParent({ x: 0, y: 0, zoom: 0.31 }), false);
});

test('getMaxZoomForMap calculates appropriate max zoom when uniform children exist', () => {
  const parent = { width: 2000, height: 1000 };
  const child16x = createDummyRegion('c16', 100, 100, 225, 162.5); // w = 125, k = 125 / 2000 = 0.0625
  const maxZ = getMaxZoomForMap([child16x], parent);
  // minK = 0.0625. ENTER_MIN_ZOOM / 0.0625 * 1.1 = (0.5 / 0.0625) * 1.1 = 8 * 1.1 = 8.8.
  // Math.max(12, 8.8) is 12.
  assert.ok(maxZ >= 12);

  // Deeper nested region where k is very small, e.g. 0.02
  const childSmall = createDummyRegion('cSmall', 100, 100, 140, 120); // w = 40, k = 40 / 2000 = 0.02
  const maxZSmall = getMaxZoomForMap([childSmall], parent);
  // 0.5 / 0.02 * 1.1 = 27.5
  assert.ok(maxZSmall >= 27.5);
});
