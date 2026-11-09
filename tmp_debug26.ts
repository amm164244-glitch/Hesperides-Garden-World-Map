import { generateTectonicWorld, GeneratorConfig } from './src/utils/tectonicGenerator';
import { sampleElev } from './src/utils/waterGenerator';
import { generateRiversAndLakes } from './src/utils/waterGenerator';
import { computeRiverPointWidthsForExtraction, computeCircumcircleRadius, hasSelfIntersection } from './tmp_test_rivers';

function ccw(p1: [number, number], p2: [number, number], p3: [number, number]): boolean {
  return (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

function segsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): boolean {
  if (
    Math.max(p1[0], p2[0]) < Math.min(p3[0], p4[0]) ||
    Math.min(p1[0], p2[0]) > Math.max(p3[0], p4[0]) ||
    Math.max(p1[1], p2[1]) < Math.min(p3[1], p4[1]) ||
    Math.min(p1[1], p2[1]) > Math.max(p3[1], p4[1])
  ) {
    return false;
  }
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

function movingPointCausesSelfIntersection(
  pts: [number, number][],
  i: number,
  cand: [number, number]
): boolean {
  const n = pts.length;
  const pPrev = pts[i - 1];
  const pNext = pts[i + 1];

  for (let j = 0; j < n - 1; j++) {
    if (j === i - 2 || j === i - 1 || j === i) continue;
    if (segsIntersect(pPrev, cand, pts[j], pts[j + 1])) return true;
  }
  for (let j = 0; j < n - 1; j++) {
    if (j === i - 1 || j === i || j === i + 1) continue;
    if (segsIntersect(cand, pNext, pts[j], pts[j + 1])) return true;
  }
  return false;
}

const config: GeneratorConfig = {
  seed: 7,
  gridResolution: '1024x512',
  worldWidthKm: 40000,
  plateCount: 12,
  seaRatio: 60,
  continentCount: 4,
  continentSize: 5,
  mountainStrength: 5,
  islandDensity: 4,
  coastlineComplexity: 4,
  boundarySoftness: 5,
  polarSoftness: 5,
  minIslandArea: 1,
};
const world = generateTectonicWorld(1024, 512, config);
const { rivers } = generateRiversAndLakes(
  world.elevationGrid,
  world.gridCols,
  world.gridRows,
  world.width,
  world.height,
  world.seaLevel,
  7,
  { riverDensity: 40, meander: 0.6, headExtension: 0.8 }
);

const r = rivers.find((x) => x.id === 'river_7_26')!;
console.log('river_7_26 pts count:', r.points.length);
const widths = computeRiverPointWidthsForExtraction(r.points, r.widthStart, r.widthEnd, 1.2);

const current: [number, number][] = r.points.map((p) => [p[0], p[1]]);
for (let it = 0; it < 60; it++) {
  let anyMoved = false;
  for (let i = 1; i < current.length - 1; i++) {
    const pPrev = current[i - 1];
    const pCurr = current[i];
    const pNext = current[i + 1];
    const R = computeCircumcircleRadius(pPrev, pCurr, pNext);
    const w = widths[i];
    if (R < 0.75 * w) {
      const midX = 0.5 * (pPrev[0] + pNext[0]);
      const midY = 0.5 * (pPrev[1] + pNext[1]);
      const candX = pCurr[0] * 0.4 + midX * 0.6;
      const candY = pCurr[1] * 0.4 + midY * 0.6;
      const cand: [number, number] = [candX, candY];

      const ePrev = sampleElev(world.elevationGrid, world.gridCols, world.gridRows, world.width, world.height, pPrev[0], pPrev[1]);
      const eCand = sampleElev(world.elevationGrid, world.gridCols, world.gridRows, world.width, world.height, candX, candY);
      if (eCand > ePrev + 0.3) {
        console.log(`pt ${i} blocked by elevation: eCand=${eCand.toFixed(3)}, ePrev=${ePrev.toFixed(3)}`);
        continue;
      }
      if (movingPointCausesSelfIntersection(current, i, cand)) {
        console.log(`pt ${i} blocked by self intersection`);
        continue;
      }
      current[i] = cand;
      anyMoved = true;
    }
  }
  if (!anyMoved) {
    console.log(`stopped at it ${it}`);
    break;
  }
}
