import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCoastlineContours,
  findNearestCoastlinePoint,
  traceCoastlinePath,
  findEnclosingIslandContour,
} from './coastlineSelection';

test('getCoastlineContours extracts closed contours around landmasses', () => {
  const width = 100;
  const height = 100;
  const cols = 20;
  const rows = 20;
  const grid = new Float32Array(cols * rows).fill(20); // water = 20

  // Create an island at center: rows 6..14, cols 6..14 = 60
  for (let r = 6; r <= 14; r++) {
    for (let c = 6; c <= 14; c++) {
      grid[r * cols + c] = 60;
    }
  }

  const contours = getCoastlineContours(grid, cols, rows, width, height, 35.0);
  assert(contours.length >= 1, 'Should extract at least one contour for the island');

  const islandContour = contours[0];
  assert(islandContour.length >= 4, 'Contour should have multiple vertices');

  // Verify first and last points match (closed ring)
  const first = islandContour[0];
  const last = islandContour[islandContour.length - 1];
  assert.equal(first[0], last[0]);
  assert.equal(first[1], last[1]);
});

test('findNearestCoastlinePoint snaps to the closest coastline coordinate', () => {
  const width = 100;
  const height = 100;
  const cols = 20;
  const rows = 20;
  const grid = new Float32Array(cols * rows).fill(20);

  // Island at center
  for (let r = 6; r <= 14; r++) {
    for (let c = 6; c <= 14; c++) {
      grid[r * cols + c] = 60;
    }
  }

  // Point near the left coast of the island (around x = 30, y = 50)
  const snap = findNearestCoastlinePoint(28, 50, grid, cols, rows, width, height, 35.0, 15);
  assert(snap !== null, 'Should find nearby coastline');
  assert(snap.distance < 10, 'Snap distance should be small');
  assert(Math.abs(snap.point[1] - 50) < 20, 'Y coordinate should align with island coast');
});

test('traceCoastlinePath traces along the coastline contour between two points', () => {
  const width = 100;
  const height = 100;
  const cols = 20;
  const rows = 20;
  const grid = new Float32Array(cols * rows).fill(20);

  for (let r = 6; r <= 14; r++) {
    for (let c = 6; c <= 14; c++) {
      grid[r * cols + c] = 60;
    }
  }

  // Two points along the western coast of the island
  const p1: [number, number] = [30, 40];
  const p2: [number, number] = [30, 60];

  const path = traceCoastlinePath(p1, p2, grid, cols, rows, width, height, 35.0, 15);
  assert(path.length >= 2, 'Path should include points connecting p1 and p2');
  assert.deepEqual(path[0], p1);
  assert.deepEqual(path[path.length - 1], p2);
});

test('findEnclosingIslandContour finds the whole island boundary when clicking inside or near', () => {
  const width = 100;
  const height = 100;
  const cols = 20;
  const rows = 20;
  const grid = new Float32Array(cols * rows).fill(20);

  for (let r = 6; r <= 14; r++) {
    for (let c = 6; c <= 14; c++) {
      grid[r * cols + c] = 60;
    }
  }

  // Click center of the island (x = 50, y = 50)
  const island = findEnclosingIslandContour(50, 50, grid, cols, rows, width, height, 35.0);
  assert(island !== null, 'Should detect island contour');
  assert(island.length >= 4, 'Island contour should have vertices');
});
