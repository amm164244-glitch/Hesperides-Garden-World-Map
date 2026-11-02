/**
 * Simple Geomorphic Erosion Simulation (Thermal + Hydraulic Erosion)
 * Simulates talus slope collapse and water stream sediment transport across grid cells.
 */

export interface ErosionOptions {
  iterations: number; // 0 - 50
  strength: number; // 0.1 - 1.0 (maps from slider 1 - 10)
  seaLevel: number;
}

/**
 * Executes fast cellular thermal and hydraulic erosion on elevationGrid.
 */
export function applyErosion(
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  options: ErosionOptions,
  onProgress?: (progress: number, message: string) => void
): void {
  const { iterations, strength, seaLevel } = options;
  if (iterations <= 0 || strength <= 0) return;

  const total = cols * rows;
  const talusThreshold = 1.6; // Angle of repose height difference
  const talusRate = 0.18 * strength;
  const waterRate = 0.22 * strength;

  for (let it = 0; it < iterations; it++) {
    // 1. Thermal Erosion (崖の土砂崩落・安息角超え斜面の緩和)
    for (let r = 1; r < rows - 1; r++) {
      const rowOffset = r * cols;
      for (let c = 1; c < cols - 1; c++) {
        const idx = rowOffset + c;
        const h = elevationGrid[idx];
        if (h <= seaLevel - 2.0) continue; // Skip underwater abyss

        // 4 cardinal neighbors
        const nTop = idx - cols;
        const nBottom = idx + cols;
        const nLeft = idx - 1;
        const nRight = idx + 1;

        let lowestH = h;
        let lowestIdx = -1;

        if (elevationGrid[nTop] < lowestH) { lowestH = elevationGrid[nTop]; lowestIdx = nTop; }
        if (elevationGrid[nBottom] < lowestH) { lowestH = elevationGrid[nBottom]; lowestIdx = nBottom; }
        if (elevationGrid[nLeft] < lowestH) { lowestH = elevationGrid[nLeft]; lowestIdx = nLeft; }
        if (elevationGrid[nRight] < lowestH) { lowestH = elevationGrid[nRight]; lowestIdx = nRight; }

        if (lowestIdx >= 0) {
          const diff = h - lowestH;
          if (diff > talusThreshold) {
            const transfer = (diff - talusThreshold) * talusRate;
            elevationGrid[idx] -= transfer;
            elevationGrid[lowestIdx] += transfer;
          }
        }
      }
    }

    // 2. Simple Hydraulic / Water Carving (流水による谷の削剥と低地堆積)
    for (let r = 1; r < rows - 1; r++) {
      const rowOffset = r * cols;
      for (let c = 1; c < cols - 1; c++) {
        const idx = rowOffset + c;
        const h = elevationGrid[idx];
        if (h <= seaLevel) continue; // Only carve on subaerial land

        // Fast zero-allocation 8-neighbor steepest descent check
        let minH = h;
        let targetIdx = -1;

        let nh = elevationGrid[idx - cols]; if (nh < minH) { minH = nh; targetIdx = idx - cols; }
        nh = elevationGrid[idx + cols]; if (nh < minH) { minH = nh; targetIdx = idx + cols; }
        nh = elevationGrid[idx - 1]; if (nh < minH) { minH = nh; targetIdx = idx - 1; }
        nh = elevationGrid[idx + 1]; if (nh < minH) { minH = nh; targetIdx = idx + 1; }
        nh = elevationGrid[idx - cols - 1]; if (nh < minH) { minH = nh; targetIdx = idx - cols - 1; }
        nh = elevationGrid[idx - cols + 1]; if (nh < minH) { minH = nh; targetIdx = idx - cols + 1; }
        nh = elevationGrid[idx + cols - 1]; if (nh < minH) { minH = nh; targetIdx = idx + cols - 1; }
        nh = elevationGrid[idx + cols + 1]; if (nh < minH) { minH = nh; targetIdx = idx + cols + 1; }

        if (targetIdx >= 0) {
          const slope = h - minH;
          if (slope > 0.4) {
            // Erosion amount proportional to slope
            const carve = Math.min(1.2, slope * 0.3) * waterRate;
            elevationGrid[idx] -= carve;
            // Deposit most of sediment down the slope (alluvial fans & valley basins)
            elevationGrid[targetIdx] += carve * 0.82;
          }
        }
      }
    }

    if (onProgress && (it % 5 === 0 || it === iterations - 1)) {
      const pct = Math.round(75 + ((it + 1) / iterations) * 15);
      onProgress(pct, `簡易侵食シミュレーション中... (${it + 1}/${iterations}回)`);
    }
  }
}
