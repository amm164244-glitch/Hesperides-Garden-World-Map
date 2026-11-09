import { generateTectonicWorld, GeneratorConfig } from './src/utils/tectonicGenerator';
import { generateRiversAndLakes } from './src/utils/waterGenerator';
import { computeRiverPointWidthsForExtraction, limitRiverCurvature, smoothRiverGaussian, computeCircumcircleRadius } from './tmp_test_rivers';

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

const cellSize = world.width / (world.gridCols - 1);
const wMin = 1.2;

for (const r of rivers) {
  const origPoints = r.points;
  const widths = computeRiverPointWidthsForExtraction(origPoints, r.widthStart, r.widthEnd, wMin);
  let pts = limitRiverCurvature(origPoints, widths, world.elevationGrid, world.gridCols, world.gridRows, world.width, world.height, 60);
  pts = smoothRiverGaussian(pts, widths, cellSize, world.elevationGrid, world.gridCols, world.gridRows, world.width, world.height);
  pts = limitRiverCurvature(pts, widths, world.elevationGrid, world.gridCols, world.gridRows, world.width, world.height, 60);

  const n = pts.length;
  let cumDists = [0];
  for (let i = 0; i < n - 1; i++) {
    cumDists.push(cumDists[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
  }
  const totalLen = cumDists[n - 1];

  for (let i = 1; i < n - 1; i++) {
    const R = computeCircumcircleRadius(pts[i - 1], pts[i], pts[i + 1]);
    const t = cumDists[i] / totalLen;
    const w = Math.max(r.widthStart + (r.widthEnd - r.widthStart) * t, 0.72);
    const ratio = R / w;
    if (ratio < 0.5) {
      console.log(`River ${r.id} pt ${i}/${n}: ratio=${ratio.toFixed(3)}, R=${R.toFixed(3)}, w=${w.toFixed(3)}, dist=${cumDists[i].toFixed(1)}/${totalLen.toFixed(1)}`);
      console.log(`   pPrev: ${pts[i-1]}, pCurr: ${pts[i]}, pNext: ${pts[i+1]}`);
      const d1 = Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
      const d2 = Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
      console.log(`   segLen1: ${d1.toFixed(3)}, segLen2: ${d2.toFixed(3)}`);
    }
  }
}
