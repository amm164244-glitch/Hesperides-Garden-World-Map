/**
 * Coastal Zone Smoothing (Coast Smoothing)
 * Smooths elevation step discontinuities along coastlines to eliminate
 * steep cliff artifacts and staircase-like rasterization when zoomed in.
 * Preserves small islands and guarantees zero modification outside the coastal band.
 */

export interface CoastSmoothingOptions {
  bandCells?: number;   // Width of the coastal band to dilate (default: 3)
  sigmaCells?: number;  // Gaussian blur sigma for elevation (default: 1.6)
  blend?: number;       // Blending factor 0.0 - 1.0 (default: 1.0)
}

/**
 * Separable 2D Gaussian blur with clamped boundaries in O(cols * rows * radius) time.
 */
function gaussianBlur2D(
  src: Float32Array,
  cols: number,
  rows: number,
  sigma: number
): Float32Array {
  if (sigma <= 0.01) {
    return new Float32Array(src);
  }

  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernelSize = radius * 2 + 1;
  const kernel = new Float32Array(kernelSize);
  let kernelSum = 0;
  const twoSigmaSq = 2 * sigma * sigma;

  for (let i = -radius; i <= radius; i++) {
    const val = Math.exp(-(i * i) / twoSigmaSq);
    kernel[i + radius] = val;
    kernelSum += val;
  }
  for (let i = 0; i < kernelSize; i++) {
    kernel[i] /= kernelSum;
  }

  const total = cols * rows;
  const temp = new Float32Array(total);
  const out = new Float32Array(total);

  // Horizontal pass
  for (let r = 0; r < rows; r++) {
    const rowOffset = r * cols;
    const leftLimit = Math.min(radius, cols);
    const rightLimit = Math.max(radius, cols - radius);

    // Left clamped boundary
    for (let c = 0; c < leftLimit; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let sc = c + k;
        if (sc < 0) sc = 0;
        else if (sc >= cols) sc = cols - 1;
        acc += src[rowOffset + sc] * kernel[k + radius];
      }
      temp[rowOffset + c] = acc;
    }

    // Branchless interior
    for (let c = radius; c < cols - radius; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += src[rowOffset + c + k] * kernel[k + radius];
      }
      temp[rowOffset + c] = acc;
    }

    // Right clamped boundary
    for (let c = rightLimit; c < cols; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let sc = c + k;
        if (sc < 0) sc = 0;
        else if (sc >= cols) sc = cols - 1;
        acc += src[rowOffset + sc] * kernel[k + radius];
      }
      temp[rowOffset + c] = acc;
    }
  }

  // Vertical pass
  const topLimit = Math.min(radius, rows);
  const bottomLimit = Math.max(radius, rows - radius);

  // Top clamped boundary
  for (let r = 0; r < topLimit; r++) {
    const rowOffset = r * cols;
    for (let c = 0; c < cols; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let sr = r + k;
        if (sr < 0) sr = 0;
        else if (sr >= rows) sr = rows - 1;
        acc += temp[sr * cols + c] * kernel[k + radius];
      }
      out[rowOffset + c] = acc;
    }
  }

  // Branchless interior
  for (let r = radius; r < rows - radius; r++) {
    const rowOffset = r * cols;
    for (let c = 0; c < cols; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += temp[(r + k) * cols + c] * kernel[k + radius];
      }
      out[rowOffset + c] = acc;
    }
  }

  // Bottom clamped boundary
  for (let r = bottomLimit; r < rows; r++) {
    const rowOffset = r * cols;
    for (let c = 0; c < cols; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let sr = r + k;
        if (sr < 0) sr = 0;
        else if (sr >= rows) sr = rows - 1;
        acc += temp[sr * cols + c] * kernel[k + radius];
      }
      out[rowOffset + c] = acc;
    }
  }

  return out;
}

interface LandComponent {
  peakCell: number;
  peakElev: number;
  cells: number[];
}

/**
 * Smooths the coastal band along land-sea boundaries.
 * Returns a new Float32Array without mutating the original elevationGrid.
 */
export function smoothCoastBand(
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  seaLevel: number,
  options: CoastSmoothingOptions = {}
): Float32Array {
  const bandCells = Math.max(1, Math.round(options.bandCells ?? 3));
  const sigmaCells = Math.max(0.1, options.sigmaCells ?? 1.6);
  const blend = Math.max(0.0, Math.min(1.0, options.blend ?? 1.0));

  const totalCells = cols * rows;
  const out = new Float32Array(elevationGrid);

  // If blend is 0 or no smoothing requested, return exact duplicate
  if (blend <= 0.0) {
    return out;
  }

  // Pre-scan: identify land components (area >= 6) to ensure small islands are not erased
  const visitedLand = new Uint8Array(totalCells);
  const landComponents: LandComponent[] = [];
  const compQueue: number[] = [];

  for (let i = 0; i < totalCells; i++) {
    if (elevationGrid[i] >= seaLevel && visitedLand[i] === 0) {
      compQueue.length = 0;
      compQueue.push(i);
      visitedLand[i] = 1;

      const compCells: number[] = [];
      let peakIdx = i;
      let maxElev = elevationGrid[i];

      let head = 0;
      while (head < compQueue.length) {
        const curr = compQueue[head++];
        compCells.push(curr);

        if (elevationGrid[curr] > maxElev) {
          maxElev = elevationGrid[curr];
          peakIdx = curr;
        }

        const cr = Math.floor(curr / cols);
        const cc = curr % cols;

        // 4-connected neighbors
        const neighbors = [
          cc > 0 ? curr - 1 : -1,
          cc < cols - 1 ? curr + 1 : -1,
          cr > 0 ? curr - cols : -1,
          cr < rows - 1 ? curr + cols : -1,
        ];

        for (const n of neighbors) {
          if (n >= 0 && visitedLand[n] === 0 && elevationGrid[n] >= seaLevel) {
            visitedLand[n] = 1;
            compQueue.push(n);
          }
        }
      }

      if (compCells.length >= 6) {
        landComponents.push({
          peakCell: peakIdx,
          peakElev: maxElev,
          cells: compCells,
        });
      }
    }
  }

  // 1. Detect boundary cells (cells whose 4-neighbors have opposite land/sea state)
  const distToCoast = new Int16Array(totalCells).fill(-1);
  const queue: number[] = [];

  for (let r = 0; r < rows; r++) {
    const rowOffset = r * cols;
    for (let c = 0; c < cols; c++) {
      const idx = rowOffset + c;
      const isLand = elevationGrid[idx] >= seaLevel;

      let hasOpposite = false;
      if (c > 0 && (elevationGrid[idx - 1] >= seaLevel) !== isLand) hasOpposite = true;
      else if (c < cols - 1 && (elevationGrid[idx + 1] >= seaLevel) !== isLand) hasOpposite = true;
      else if (r > 0 && (elevationGrid[idx - cols] >= seaLevel) !== isLand) hasOpposite = true;
      else if (r < rows - 1 && (elevationGrid[idx + cols] >= seaLevel) !== isLand) hasOpposite = true;

      if (hasOpposite) {
        distToCoast[idx] = 0;
        queue.push(idx);
      }
    }
  }

  // If no coastline exists (entire map is 100% land or 100% ocean), return unmodified
  if (queue.length === 0) {
    return out;
  }

  // 2. Dilate boundary cells by bandCells (8-neighborhood distance)
  // Also track distances up to 8 cells to ensure exact cutoff
  const maxSearchDist = Math.max(8, bandCells + 5);
  let qHead = 0;

  while (qHead < queue.length) {
    const curr = queue[qHead++];
    const d = distToCoast[curr];
    if (d >= maxSearchDist) continue;

    const cr = Math.floor(curr / cols);
    const cc = curr % cols;

    for (let dr = -1; dr <= 1; dr++) {
      const nr = cr + dr;
      if (nr < 0 || nr >= rows) continue;
      const nRowOffset = nr * cols;

      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nc = cc + dc;
        if (nc < 0 || nc >= cols) continue;

        const nIdx = nRowOffset + nc;
        if (distToCoast[nIdx] === -1) {
          distToCoast[nIdx] = d + 1;
          queue.push(nIdx);
        }
      }
    }
  }

  // Create binary mask for the dilated band (cells with dist <= bandCells)
  const bandMask = new Float32Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    if (distToCoast[i] >= 0 && distToCoast[i] <= bandCells) {
      bandMask[i] = 1.0;
    }
  }

  // Smooth the band mask with Gaussian blur (sigma = bandCells * 0.5)
  const sigmaBand = bandCells * 0.5;
  const blurredMask = gaussianBlur2D(bandMask, cols, rows, sigmaBand);

  // Compute weights w: blurredMask * 1.6 clamped to [0, 1]
  // Strictly enforce w = 0 at distance >= 8 cells from coast
  const w = new Float32Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    const dist = distToCoast[i];
    if (dist < 0 || dist >= 8) {
      w[i] = 0.0;
    } else {
      const rawW = blurredMask[i] * 1.6;
      if (rawW <= 1e-4) {
        w[i] = 0.0;
      } else {
        w[i] = Math.min(1.0, rawW);
      }
    }
  }

  // 3. Smooth the entire elevation grid with Gaussian blur (sigma = sigmaCells)
  const G = gaussianBlur2D(elevationGrid, cols, rows, sigmaCells);

  // 4. Blend: result = original * (1 - w * blend) + G * (w * blend)
  for (let i = 0; i < totalCells; i++) {
    const factor = w[i] * blend;
    if (factor <= 0.0) {
      out[i] = elevationGrid[i];
    } else {
      out[i] = elevationGrid[i] * (1.0 - factor) + G[i] * factor;
    }
  }

  // 5. Small Island Preservation:
  // If an initial land component (area >= 6) has all its cells submerged (0 land cells),
  // restore its peak cell to the pre-smoothed elevation.
  for (const comp of landComponents) {
    let hasLandRemaining = false;
    for (const cellIdx of comp.cells) {
      if (out[cellIdx] >= seaLevel) {
        hasLandRemaining = true;
        break;
      }
    }

    if (!hasLandRemaining) {
      // Restore peak elevation so the island is not erased
      out[comp.peakCell] = comp.peakElev;
    }
  }

  return out;
}

export interface SmoothStepsOptions {
  jumpThreshold?: number; // 初期値 3.0
  bandCells?: number;     // 初期値 3
  sigmaCells?: number;    // 初期値 1.6
  blend?: number;         // 初期値 1.0
  passes?: number;        // 初期値 2
  includeCoast?: boolean; // 初期値 true
}

/**
 * Smooths elevation step discontinuities (cliffs and coastlines) across the world map.
 * Detects cells with adjacent elevation jumps >= jumpThreshold (and optionally coastlines),
 * dilates by bandCells, and applies smooth Gaussian blending.
 * Preserves mountain peaks and small islands (area >= 6).
 * Does not mutate the input elevationGrid.
 */
export function smoothSteps(
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  seaLevel: number,
  options: SmoothStepsOptions = {}
): Float32Array {
  const jumpThreshold = options.jumpThreshold ?? 3.0;
  const bandCells = Math.max(1, Math.round(options.bandCells ?? 3));
  const sigmaCells = Math.max(0.1, options.sigmaCells ?? 1.6);
  const baseBlend = Math.max(0.0, Math.min(1.0, options.blend ?? 1.0));
  const passes = Math.max(1, Math.round(options.passes ?? 2));
  const includeCoast = options.includeCoast ?? true;

  const totalCells = cols * rows;

  if (baseBlend <= 0.0) {
    return new Float32Array(elevationGrid);
  }

  // 1. Pre-scan: identify land components (area >= 6) to ensure small islands are not erased
  const visitedLand = new Uint8Array(totalCells);
  const landComponents: LandComponent[] = [];
  const compQueue: number[] = [];

  let origMaxElev = -Infinity;
  for (let i = 0; i < totalCells; i++) {
    const val = elevationGrid[i];
    if (val > origMaxElev) {
      origMaxElev = val;
    }

    if (val >= seaLevel && visitedLand[i] === 0) {
      compQueue.length = 0;
      compQueue.push(i);
      visitedLand[i] = 1;

      const compCells: number[] = [];
      let peakIdx = i;
      let maxElev = val;

      let head = 0;
      while (head < compQueue.length) {
        const curr = compQueue[head++];
        compCells.push(curr);

        if (elevationGrid[curr] > maxElev) {
          maxElev = elevationGrid[curr];
          peakIdx = curr;
        }

        const cr = Math.floor(curr / cols);
        const cc = curr % cols;

        // 4-connected neighbors
        const neighbors = [
          cc > 0 ? curr - 1 : -1,
          cc < cols - 1 ? curr + 1 : -1,
          cr > 0 ? curr - cols : -1,
          cr < rows - 1 ? curr + cols : -1,
        ];

        for (const n of neighbors) {
          if (n >= 0 && visitedLand[n] === 0 && elevationGrid[n] >= seaLevel) {
            visitedLand[n] = 1;
            compQueue.push(n);
          }
        }
      }

      if (compCells.length >= 6) {
        landComponents.push({
          peakCell: peakIdx,
          peakElev: maxElev,
          cells: compCells,
        });
      }
    }
  }

  // 2. Helper to execute a single pass of step smoothing
  function executePass(
    input: Float32Array,
    currentJumpThreshold: number,
    currentSigma: number,
    currentBlend: number
  ): Float32Array {
    if (currentBlend <= 0.0) {
      return new Float32Array(input);
    }

    // Step detection: 4-connected neighbors with elevation diff >= currentJumpThreshold,
    // or (if includeCoast) with opposite land/sea state.
    const distToStep = new Int16Array(totalCells).fill(-1);
    const queue = new Int32Array(totalCells);
    let qTail = 0;
    let qHead = 0;

    for (let r = 0; r < rows; r++) {
      const rowOffset = r * cols;
      for (let c = 0; c < cols; c++) {
        const idx = rowOffset + c;
        const elev = input[idx];
        const isLand = elev >= seaLevel;

        let isStep = false;
        if (c > 0) {
          const leftIdx = idx - 1;
          if (Math.abs(elev - input[leftIdx]) >= currentJumpThreshold) isStep = true;
          else if (includeCoast && (input[leftIdx] >= seaLevel) !== isLand) isStep = true;
        }
        if (!isStep && c < cols - 1) {
          const rightIdx = idx + 1;
          if (Math.abs(elev - input[rightIdx]) >= currentJumpThreshold) isStep = true;
          else if (includeCoast && (input[rightIdx] >= seaLevel) !== isLand) isStep = true;
        }
        if (!isStep && r > 0) {
          const upIdx = idx - cols;
          if (Math.abs(elev - input[upIdx]) >= currentJumpThreshold) isStep = true;
          else if (includeCoast && (input[upIdx] >= seaLevel) !== isLand) isStep = true;
        }
        if (!isStep && r < rows - 1) {
          const downIdx = idx + cols;
          if (Math.abs(elev - input[downIdx]) >= currentJumpThreshold) isStep = true;
          else if (includeCoast && (input[downIdx] >= seaLevel) !== isLand) isStep = true;
        }

        if (isStep) {
          distToStep[idx] = 0;
          queue[qTail++] = idx;
        }
      }
    }

    if (qTail === 0) {
      return new Float32Array(input);
    }

    // 8-neighborhood BFS dilation up to cutoffDist (enforces zero modification outside band)
    const cutoffDist = Math.max(8, bandCells + 5);

    while (qHead < qTail) {
      const curr = queue[qHead++];
      const d = distToStep[curr];
      if (d >= cutoffDist) continue;

      const cr = Math.floor(curr / cols);
      const cc = curr % cols;

      for (let dr = -1; dr <= 1; dr++) {
        const nr = cr + dr;
        if (nr < 0 || nr >= rows) continue;
        const nRowOffset = nr * cols;

        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = cc + dc;
          if (nc < 0 || nc >= cols) continue;

          const nIdx = nRowOffset + nc;
          if (distToStep[nIdx] === -1) {
            distToStep[nIdx] = d + 1;
            queue[qTail++] = nIdx;
          }
        }
      }
    }

    // Binary mask for cells with dist <= bandCells
    const bandMask = new Float32Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      if (distToStep[i] >= 0 && distToStep[i] <= bandCells) {
        bandMask[i] = 1.0;
      }
    }

    // Smooth the band mask with Gaussian blur (sigma = bandCells * 0.5)
    const sigmaBand = bandCells * 0.5;
    const blurredMask = gaussianBlur2D(bandMask, cols, rows, sigmaBand);

    // Compute weights w: blurredMask * 1.6 clamped to [0, 1]
    // Strictly enforce w = 0 at distance >= cutoffDist
    const w = new Float32Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      const dist = distToStep[i];
      if (dist < 0 || dist >= cutoffDist) {
        w[i] = 0.0;
      } else {
        const rawW = blurredMask[i] * 1.6;
        if (rawW <= 1e-4) {
          w[i] = 0.0;
        } else {
          w[i] = Math.min(1.0, rawW);
        }
      }
    }

    // Smooth elevation with Gaussian blur (sigma = currentSigma)
    const G = gaussianBlur2D(input, cols, rows, currentSigma);

    // Blend: result = original * (1 - w * blend) + G * (w * blend)
    const out = new Float32Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      const factor = w[i] * currentBlend;
      if (factor <= 0.0) {
        out[i] = input[i];
      } else {
        out[i] = input[i] * (1.0 - factor) + G[i] * factor;
      }
    }

    return out;
  }

  // 3. Peak mountain preservation:
  // If result peak elevation drops below 92% of original max elevation,
  // halve blend and retry (up to 2 retries, 3 attempts total).
  let currentBlend = baseBlend;
  let finalResult: Float32Array = new Float32Array(elevationGrid);

  for (let attempt = 0; attempt < 3; attempt++) {
    // Pass 1
    let passResult = executePass(elevationGrid, jumpThreshold, sigmaCells, currentBlend);

    // Pass 2
    if (passes >= 2) {
      passResult = executePass(
        passResult,
        jumpThreshold * 0.7,
        sigmaCells * 1.4,
        currentBlend
      );
    }

    // Small Island Preservation:
    // If an initial land component (area >= 6) has all its cells submerged (0 land cells),
    // restore its peak cell to the pre-smoothed elevation.
    for (const comp of landComponents) {
      let hasLandRemaining = false;
      for (const cellIdx of comp.cells) {
        if (passResult[cellIdx] >= seaLevel) {
          hasLandRemaining = true;
          break;
        }
      }

      if (!hasLandRemaining) {
        passResult[comp.peakCell] = comp.peakElev;
      }
    }

    // Check peak elevation
    let resMax = -Infinity;
    for (let i = 0; i < totalCells; i++) {
      if (passResult[i] > resMax) {
        resMax = passResult[i];
      }
    }

    finalResult = passResult;

    if (resMax >= origMaxElev * 0.92 || attempt === 2) {
      break;
    }

    currentBlend *= 0.5;
  }

  return finalResult;
}

