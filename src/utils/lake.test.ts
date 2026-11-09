import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHydrology } from './hydrology';
import {
  extractLakes,
  clampRiverToLakePerimeter,
  findNearestLakePerimeterPoint,
} from './lakeExtraction';
import { pointInPolygon } from './regionShape';
import { hasSelfIntersection } from './riverExtraction';
import { RiverData } from '../types/water';

test('Lake extraction: Circular basin matches theoretical circle within 8% area and 0.6 cell radius error', () => {
  const cols = 256;
  const rows = 128;
  const mapWidth = 2560;
  const mapHeight = 1280;
  const seaLevel = 20.0;
  const cellW = mapWidth / (cols - 1);
  const cellH = mapHeight / (rows - 1);
  const cellSize = (cellW + cellH) * 0.5;
  const grid = new Float32Array(cols * rows);

  const c0 = 128;
  const r0 = 64;
  const radiusCells = 20;
  const cells: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = Math.hypot(c - c0, r - r0);
      grid[r * cols + c] = 20.0 + d * 1.0;
      if (d <= radiusCells) {
        cells.push(r * cols + c);
      }
    }
  }

  const mockHydro = {
    flowReceivers: new Int32Array(cols * rows),
    flowAccumulation: new Float32Array(cols * rows),
    filledElevation: grid,
    depressions: [
      {
        cells,
        area: cells.length,
        maxDepth: 20.0,
        spillElevation: 40.0,
        spillCell: r0 * cols + (c0 + radiusCells),
      },
    ],
    riverPaths: [],
  };

  const lakes = extractLakes(mockHydro as any, grid, {
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    seed: 1234,
    lakeCount: 1,
  });

  assert.equal(lakes.length, 1, 'Should extract exactly 1 lake');
  const lake = lakes[0];
  const poly = lake.polygon;

  // 1. Area within +- 8% of theoretical circle
  const theoryR = radiusCells * cellSize;
  const theoryArea = Math.PI * theoryR * theoryR;

  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  const polyArea = Math.abs(a * 0.5);
  const areaErrorRatio = Math.abs(polyArea - theoryArea) / theoryArea;

  assert.ok(
    areaErrorRatio <= 0.08,
    `Lake area (${polyArea.toFixed(1)}) must be within 8% of theoretical area (${theoryArea.toFixed(1)}), error ratio: ${(areaErrorRatio * 100).toFixed(2)}%`
  );

  // 2. Each vertex within 0.6 * cellSize from theoretical circle
  const center = [c0 * cellW, r0 * cellH];
  for (const p of poly) {
    const distToCenter = Math.hypot(p[0] - center[0], p[1] - center[1]);
    const radialError = Math.abs(distToCenter - theoryR) / cellSize;
    assert.ok(
      radialError <= 0.6,
      `Vertex at (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) radial error (${radialError.toFixed(3)} cells) must be <= 0.6 cells`
    );
  }

  // 3. Smoothness: adjacent edge angle changes >= 60 deg must be <= 2
  let sharpTurns = 0;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[(i - 1 + poly.length) % poly.length];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    const v1 = [p1[0] - p0[0], p1[1] - p0[1]];
    const v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const d1 = Math.hypot(v1[0], v1[1]) || 1;
    const d2 = Math.hypot(v2[0], v2[1]) || 1;
    const dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (d1 * d2);
    const angle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
    if (angle >= 60) {
      sharpTurns++;
    }
  }
  assert.ok(sharpTurns <= 2, `Sharp turns >= 60 deg (${sharpTurns}) must be <= 2`);

  // 4. Not staircase: orientation not concentrated at multiples of 45 deg (+-2 deg) <= 40%
  let count45 = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    const deg = (((Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180) / Math.PI) % 360 + 360) % 360;
    const mod45 = deg % 45;
    const dist45 = Math.min(mod45, 45 - mod45);
    if (dist45 <= 2) {
      count45++;
    }
  }
  const ratio45 = count45 / poly.length;
  assert.ok(ratio45 <= 0.4, `Edges aligned with 45 deg multiples (${(ratio45 * 100).toFixed(1)}%) must be <= 40%`);
});

test('Lake extraction: Fallback triggers when contour leaks and produces valid polygon', () => {
  const cols = 64;
  const rows = 64;
  const mapWidth = 640;
  const mapHeight = 640;
  const seaLevel = 20.0;
  const grid = new Float32Array(cols * rows);

  // Flat depression where outer terrain is exactly flat at spillElevation (leaks contour)
  const c0 = 32;
  const r0 = 32;
  const radiusCells = 8;
  const cells: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = Math.hypot(c - c0, r - r0);
      if (d <= radiusCells) {
        grid[r * cols + c] = 30.0;
        cells.push(r * cols + c);
      } else {
        grid[r * cols + c] = 40.0;
      }
    }
  }

  const mockHydro = {
    flowReceivers: new Int32Array(cols * rows),
    flowAccumulation: new Float32Array(cols * rows),
    filledElevation: grid,
    depressions: [
      {
        cells,
        area: cells.length,
        maxDepth: 10.0,
        spillElevation: 40.0,
        spillCell: r0 * cols + (c0 + radiusCells),
      },
    ],
    riverPaths: [],
  };

  const lakes = extractLakes(mockHydro as any, grid, {
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    seed: 999,
    lakeCount: 1,
  });

  assert.equal(lakes.length, 1, 'Should extract fallback lake');
  const lake = lakes[0];
  assert.ok(lake.polygon.length >= 3, 'Fallback polygon must have at least 3 vertices');
  assert.equal(hasSelfIntersection(lake.polygon), false, 'Fallback polygon must not self-intersect');
});

test('River-lake clamping: Inflow and outflow river endpoints, containment, and monotonic approach', () => {
  const cellSize = 10;
  // Circular lake polygon centered at (200, 200) radius 50
  const poly: [number, number][] = [];
  for (let i = 0; i < 32; i++) {
    const theta = (i / 32) * Math.PI * 2;
    poly.push([200 + Math.cos(theta) * 50, 200 + Math.sin(theta) * 50]);
  }

  const lake = {
    id: 'lake_test_1',
    name: 'Test Lake',
    polygon: poly,
    elevation: 40,
    depth: 50,
  };

  // 1. Inflow river (terminatesAt === 'lake')
  const inflowPts: [number, number][] = [];
  for (let x = 60; x <= 220; x += 10) {
    inflowPts.push([x, 200]);
  }
  const inflowRiver: RiverData = {
    id: 'river_inflow',
    points: [...inflowPts],
    widthStart: 2,
    widthEnd: 4,
    terminatesAt: 'lake',
    targetLakeId: 'lake_test_1',
  };

  clampRiverToLakePerimeter(inflowRiver, lake, cellSize);

  const lastPt = inflowRiver.points[inflowRiver.points.length - 1];
  const prevPt = inflowRiver.points[inflowRiver.points.length - 2];
  const snapLast = findNearestLakePerimeterPoint(lake.polygon, lastPt);
  const distLastToEdge = Math.hypot(lastPt[0] - snapLast[0], lastPt[1] - snapLast[1]);

  assert.ok(
    distLastToEdge <= 1e-6,
    `Inflow river last point must lie on lake perimeter (dist=${distLastToEdge})`
  );

  // Other points not inside lake
  for (let i = 0; i < inflowRiver.points.length - 1; i++) {
    assert.equal(
      pointInPolygon(inflowRiver.points[i], lake.polygon),
      false,
      `Inflow point ${i} must not be inside lake`
    );
  }

  // Last segment length <= 2 * cellSize
  const lastSegLen = Math.hypot(lastPt[0] - prevPt[0], lastPt[1] - prevPt[1]);
  assert.ok(
    lastSegLen <= 2 * cellSize,
    `Last segment length (${lastSegLen}) must be <= 2 * cellSize (${2 * cellSize})`
  );

  // 2. Outflow river (sourceType === 'lake')
  const outflowPts: [number, number][] = [];
  for (let x = 180; x <= 340; x += 10) {
    outflowPts.push([x, 200]);
  }
  const outflowRiver: RiverData = {
    id: 'river_outflow',
    points: [...outflowPts],
    widthStart: 4,
    widthEnd: 6,
    sourceType: 'lake',
    sourceLakeId: 'lake_test_1',
    terminatesAt: 'ocean',
  };

  clampRiverToLakePerimeter(outflowRiver, lake, cellSize);

  const firstPt = outflowRiver.points[0];
  const snapFirst = findNearestLakePerimeterPoint(lake.polygon, firstPt);
  const distFirstToEdge = Math.hypot(firstPt[0] - snapFirst[0], firstPt[1] - snapFirst[1]);

  assert.ok(
    distFirstToEdge <= 1e-6,
    `Outflow river first point must lie on lake perimeter (dist=${distFirstToEdge})`
  );

  for (let i = 1; i < outflowRiver.points.length; i++) {
    assert.equal(
      pointInPolygon(outflowRiver.points[i], lake.polygon),
      false,
      `Outflow point ${i} must not be inside lake`
    );
  }

  // 3. Monotonic approach for last 15 points
  const approachPts: [number, number][] = [];
  for (let step = 0; step < 25; step++) {
    const t = step / 24;
    approachPts.push([50 + t * 160, 160 + t * 40]);
  }
  const approachRiver: RiverData = {
    id: 'river_approach',
    points: approachPts,
    widthStart: 2,
    widthEnd: 4,
    terminatesAt: 'lake',
    targetLakeId: 'lake_test_1',
  };

  clampRiverToLakePerimeter(approachRiver, lake, cellSize);

  const last15 = approachRiver.points.slice(Math.max(0, approachRiver.points.length - 15));
  const distsToPerimeter = last15.map((p) => {
    const s = findNearestLakePerimeterPoint(lake.polygon, p);
    return Math.hypot(p[0] - s[0], p[1] - s[1]);
  });

  let nonDecreasingCount = 0;
  for (let i = 0; i < distsToPerimeter.length - 1; i++) {
    if (distsToPerimeter[i + 1] > distsToPerimeter[i] + 1e-4) {
      nonDecreasingCount++;
    }
  }
  const nonDecreasingRatio = nonDecreasingCount / (distsToPerimeter.length - 1);
  assert.ok(
    nonDecreasingRatio <= 0.2,
    `Non-decreasing distance segments ratio (${(nonDecreasingRatio * 100).toFixed(1)}%) must be <= 20%`
  );
});

test('Lake extraction: Determinism and performance on 1024x512 grid under 300ms', () => {
  const cols = 1024;
  const rows = 512;
  const mapWidth = 2048;
  const mapHeight = 1024;
  const seaLevel = 25.0;
  const grid = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      grid[r * cols + c] = 50.0 - v * 20.0 + Math.sin(u * 10) * 5;
    }
  }

  // Carve depressions
  const centers = [
    [200, 150],
    [400, 300],
    [600, 200],
    [800, 350],
  ];
  for (const [bc, br] of centers) {
    for (let r = br - 12; r <= br + 12; r++) {
      for (let c = bc - 12; c <= bc + 12; c++) {
        const d = Math.hypot(c - bc, r - br);
        if (d <= 10) {
          grid[r * cols + c] -= (10 - d) * 1.5;
        }
      }
    }
  }

  const hydro = computeHydrology(grid, cols, rows, seaLevel, { seed: 42 });

  // Determinism check
  const lakes1 = extractLakes(hydro, grid, {
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    seed: 42,
    lakeCount: 4,
  });

  const lakes2 = extractLakes(hydro, grid, {
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    seed: 42,
    lakeCount: 4,
  });

  assert.equal(lakes1.length, lakes2.length);
  for (let i = 0; i < lakes1.length; i++) {
    assert.deepEqual(lakes1[i].polygon, lakes2[i].polygon);
    assert.equal(lakes1[i].elevation, lakes2[i].elevation);
    assert.equal(lakes1[i].depth, lakes2[i].depth);
  }

  // Performance check: extractLakes must complete under 300ms
  const t0 = performance.now();
  extractLakes(hydro, grid, {
    cols,
    rows,
    mapWidth,
    mapHeight,
    seaLevel,
    seed: 42,
    lakeCount: 6,
  });
  const elapsed = performance.now() - t0;

  assert.ok(
    elapsed <= 300,
    `1024x512 lake extraction took ${elapsed.toFixed(2)}ms, must be <= 300ms`
  );
});
