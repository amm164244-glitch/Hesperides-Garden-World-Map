/**
 * Benchmark Script for Town Performance:
 * Measures 0, 100, 400, 1000 buildings under:
 * 1. Straight road drawing (mousemove processing time)
 * 2. Road confirmation to screen render latency & renderOverlay call counts
 * 3. Section breakdown to identify the dominant bottleneck
 */

import { Pt, TownBuilding, TownObject, TownRoad } from '../src/types/town';
import { drawTownObjects } from '../src/utils/town/townRenderer';
import { createFrameScheduler } from '../src/utils/frameScheduler';

// Create a realistic mock CanvasRenderingContext2D
function createMockContext(): CanvasRenderingContext2D {
  let transform = [1, 0, 0, 1, 0, 0];
  const noop = () => {};
  const mockCtx: any = {
    canvas: { width: 1200, height: 800 },
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    clip: noop,
    setLineDash: noop,
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      transform = [a, b, c, d, e, f];
    },
    translate: noop,
    rotate: noop,
    scale: noop,
    measureText: (text: string) => ({ width: text.length * 7 }),
    fillText: noop,
    strokeText: noop,
    drawImage: noop,
    createPattern: () => null,
    lineWidth: 1,
    strokeStyle: '#000',
    fillStyle: '#000',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  return mockCtx as CanvasRenderingContext2D;
}

// Generate realistic town buildings
function generateTestBuildings(count: number): TownBuilding[] {
  const buildings: TownBuilding[] = [];
  const cols = Math.ceil(Math.sqrt(count * 1.5));
  let idx = 0;
  for (let r = 0; r < cols && idx < count; r++) {
    for (let c = 0; c < cols && idx < count; c++) {
      const cx = 100 + c * 35;
      const cy = 100 + r * 30;
      const w = 18;
      const h = 14;
      buildings.push({
        id: `bld_${idx}`,
        name: `家 ${idx + 1}`,
        kind: 'building',
        buildingKind: idx % 10 === 0 ? 'church' : idx % 5 === 0 ? 'shop' : 'house',
        polygon: [
          [cx - w / 2, cy - h / 2],
          [cx + w / 2, cy - h / 2],
          [cx + w / 2, cy + h / 2],
          [cx - w / 2, cy + h / 2],
        ],
        heightM: 6 + (idx % 4),
        tone: (idx % 4) / 4,
      });
      idx++;
    }
  }
  return buildings;
}

// Simulate Before Architecture
function runBeforeBenchmark(buildingCount: number) {
  const ctx = createMockContext();
  const buildings = generateTestBuildings(buildingCount);
  const townObjects: TownObject[] = [...buildings];
  const viewBounds = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
  const metersPerUnit = 0.5;
  const zoomPx = 1.0;

  // Section breakdown tracking
  const sections = {
    background: 0,
    biome: 0,
    boundary: 0,
    water: 0,
    townObjects: 0,
    townOverlay: 0,
    symbols: 0,
    compassAndFrame: 0,
  };

  const simulateRenderOverlay = () => {
    // 1. Background
    const t0 = performance.now();
    ctx.clearRect(0, 0, 1200, 800);
    const t1 = performance.now();
    sections.background += t1 - t0;

    // 2. Biome & Boundary
    const t2 = performance.now();
    for (let i = 0; i < 20; i++) {
      ctx.beginPath();
      ctx.rect(i * 10, i * 10, 50, 50);
      ctx.fill();
    }
    const t3 = performance.now();
    sections.biome += t3 - t2;

    // 3. Water
    const t4 = performance.now();
    for (let i = 0; i < 15; i++) {
      ctx.beginPath();
      ctx.moveTo(100, 100);
      ctx.lineTo(200, 200);
      ctx.stroke();
    }
    const t5 = performance.now();
    sections.water += t5 - t4;

    // 4. Town Objects (the big one)
    const t6 = performance.now();
    drawTownObjects(ctx, townObjects, {
      metersPerUnit,
      zoomPx,
      viewBounds,
    });
    const t7 = performance.now();
    sections.townObjects += t7 - t6;

    // 5. In-progress Town Overlay (rubberband line, labels)
    const t8 = performance.now();
    ctx.beginPath();
    ctx.moveTo(100, 100);
    ctx.lineTo(350, 350);
    ctx.stroke();
    ctx.fillText('50m (計 120m)', 225, 225);
    const t9 = performance.now();
    sections.townOverlay += t9 - t8;

    // 6. Symbols & Compass
    const t10 = performance.now();
    ctx.strokeRect(0, 0, 1200, 800);
    const t11 = performance.now();
    sections.compassAndFrame += t11 - t10;
  };

  // Measure MouseMove (Drawing a straight road: 30 mouse move events)
  const mouseMoveTimes: number[] = [];
  for (let m = 0; m < 30; m++) {
    const start = performance.now();
    simulateRenderOverlay();
    mouseMoveTimes.push(performance.now() - start);
  }

  const avgMouseMove = mouseMoveTimes.reduce((a, b) => a + b, 0) / mouseMoveTimes.length;
  const maxMouseMove = Math.max(...mouseMoveTimes);

  // Measure Confirmation (Cascading 5 synchronous useEffect renders)
  const confirmStart = performance.now();
  let confirmOverlayCalls = 0;
  // Cascading useEffects in Before architecture
  for (let c = 0; c < 5; c++) {
    simulateRenderOverlay();
    confirmOverlayCalls++;
  }
  const confirmTime = performance.now() - confirmStart;

  // Normalize sections per render
  const totalRenders = 30 + confirmOverlayCalls;
  const avgSections = {
    background: sections.background / totalRenders,
    biome: sections.biome / totalRenders,
    water: sections.water / totalRenders,
    townObjects: sections.townObjects / totalRenders,
    townOverlay: sections.townOverlay / totalRenders,
    compassAndFrame: sections.compassAndFrame / totalRenders,
  };

  return {
    buildingCount,
    avgMouseMove: Number(avgMouseMove.toFixed(2)),
    maxMouseMove: Number(maxMouseMove.toFixed(2)),
    confirmTime: Number(confirmTime.toFixed(2)),
    confirmOverlayCalls,
    sections: avgSections,
  };
}

// Simulate After Architecture
function runAfterBenchmark(buildingCount: number) {
  const previewCtx = createMockContext();
  const overlayCtx = createMockContext();
  const buildings = generateTestBuildings(buildingCount);
  let townObjects: TownObject[] = [...buildings];
  const viewBounds = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
  const metersPerUnit = 0.5;
  const zoomPx = 1.0;

  // Preview layer only render for mousemove
  const simulatePreviewOverlay = () => {
    previewCtx.clearRect(0, 0, 1200, 800);
    // Draw only the rubberband line, snap point, and distance badge (< 0.2ms)
    previewCtx.beginPath();
    previewCtx.moveTo(100, 100);
    previewCtx.lineTo(350, 350);
    previewCtx.stroke();
    previewCtx.beginPath();
    previewCtx.arc(350, 350, 5, 0, Math.PI * 2);
    previewCtx.stroke();
    previewCtx.fillText('50m (計 120m)', 225, 225);
  };

  // Full overlay render (only on confirmation or map switch)
  const simulateFullOverlay = () => {
    overlayCtx.clearRect(0, 0, 1200, 800);
    drawTownObjects(overlayCtx, townObjects, {
      metersPerUnit,
      zoomPx,
      viewBounds,
    });
    overlayCtx.strokeRect(0, 0, 1200, 800);
  };

  // Measure MouseMove (Drawing a straight road: 30 mouse moves on preview canvas ONLY)
  const mouseMoveTimes: number[] = [];
  for (let m = 0; m < 30; m++) {
    const start = performance.now();
    simulatePreviewOverlay();
    mouseMoveTimes.push(performance.now() - start);
  }

  const avgMouseMove = mouseMoveTimes.reduce((a, b) => a + b, 0) / mouseMoveTimes.length;
  const maxMouseMove = Math.max(...mouseMoveTimes);

  // Measure Confirmation (Coalesced via FrameScheduler to EXACTLY 1 render)
  let confirmOverlayCalls = 0;
  const scheduler = createFrameScheduler(() => {
    simulateFullOverlay();
    confirmOverlayCalls++;
  });

  const confirmStart = performance.now();
  // 5 components / effects request redraw simultaneously:
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  // Flush single animation frame
  scheduler.flush();
  const confirmTime = performance.now() - confirmStart;

  return {
    buildingCount,
    avgMouseMove: Number(avgMouseMove.toFixed(2)),
    maxMouseMove: Number(maxMouseMove.toFixed(2)),
    confirmTime: Number(confirmTime.toFixed(2)),
    confirmOverlayCalls,
  };
}

console.log('=== TOWN PERFORMANCE BENCHMARK ===\n');
const counts = [0, 100, 400, 1000];

console.log('--- BEFORE OPTIMIZATION ---');
const beforeResults = counts.map(runBeforeBenchmark);
console.table(
  beforeResults.map((r) => ({
    '建物数 (個)': r.buildingCount,
    'マウス移動 (平均 ms)': r.avgMouseMove,
    'マウス移動 (最大 ms)': r.maxMouseMove,
    '確定→反映 (ms)': r.confirmTime,
    '確定時 再描画回数': r.confirmOverlayCalls,
    'townObjects 所要時間 (ms)': Number(r.sections.townObjects.toFixed(2)),
  }))
);

console.log('\n--- AFTER OPTIMIZATION ---');
const afterResults = counts.map(runAfterBenchmark);
console.table(
  afterResults.map((r) => ({
    '建物数 (個)': r.buildingCount,
    'マウス移動 (平均 ms)': r.avgMouseMove,
    'マウス移動 (最大 ms)': r.maxMouseMove,
    '確定→反映 (ms)': r.confirmTime,
    '確定時 再描画回数': r.confirmOverlayCalls,
  }))
);
