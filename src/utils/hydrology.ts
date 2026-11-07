/**
 * Topologically Sound Hydrological Analysis
 * Implements Priority-Flood with epsilon (Barnes 2014) to fill depressions,
 * compute deterministic flow directions (D8 receiver pointers),
 * flow accumulation, and depression watershed components.
 */

export interface Depression {
  id: number;
  cells: number[];
  area: number;
  maxDepth: number;
  spillElevation: number;
  spillCell: number;
}

export interface HydrologyOptions {
  seed?: number;
  flatJitter?: number;
  minDepth?: number;
}

export interface HydrologyResult {
  receiver: Int32Array;
  filled: Float64Array;
  accumulation: Float32Array;
  order: Int32Array;
  depressions: Depression[];
}

/**
 * Binary min-heap backed by flat typed arrays for fast Priority-Flood execution.
 */
class FlatMinHeap {
  private keys: Float64Array;
  private indices: Int32Array;
  public size: number = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.indices = new Int32Array(capacity);
  }

  public push(index: number, key: number): void {
    let i = this.size++;
    this.keys[i] = key;
    this.indices[i] = index;

    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[i] < this.keys[p]) {
        const tk = this.keys[i];
        this.keys[i] = this.keys[p];
        this.keys[p] = tk;

        const ti = this.indices[i];
        this.indices[i] = this.indices[p];
        this.indices[p] = ti;

        i = p;
      } else {
        break;
      }
    }
  }

  public pop(): number {
    const retIndex = this.indices[0];
    this.size--;

    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.indices[0] = this.indices[this.size];

      let i = 0;
      while (true) {
        const left = (i << 1) + 1;
        if (left >= this.size) break;
        const right = left + 1;

        let best = i;
        if (this.keys[left] < this.keys[best]) {
          best = left;
        }
        if (right < this.size && this.keys[right] < this.keys[best]) {
          best = right;
        }

        if (best !== i) {
          const tk = this.keys[i];
          this.keys[i] = this.keys[best];
          this.keys[best] = tk;

          const ti = this.indices[i];
          this.indices[i] = this.indices[best];
          this.indices[best] = ti;

          i = best;
        } else {
          break;
        }
      }
    }

    return retIndex;
  }
}

/**
 * Deterministic integer hash to add subtle micro-gradient on perfectly flat terrain.
 */
function deterministicJitter(c: number, r: number, seed: number, jitterAmp: number): number {
  if (jitterAmp <= 0) return 0;
  let h = (seed + 1013904223 + c * 374761393 + r * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return ((h / 4294967295) * 2 - 1) * jitterAmp;
}

/**
 * Computes Priority-Flood depression filling (Barnes 2014) with epsilon = 1e-4,
 * guaranteeing downhill paths, exact topological sorting, flow accumulation,
 * and lake depression detection.
 */
export function computeHydrology(
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  seaLevel: number,
  options: HydrologyOptions = {}
): HydrologyResult {
  const seed = options.seed ?? 12345;
  const flatJitter = options.flatJitter ?? 0.01;
  const minDepth = options.minDepth ?? 1.0;
  const epsilon = 1e-4;

  const totalCells = cols * rows;
  const filled = new Float64Array(totalCells);
  const receiver = new Int32Array(totalCells).fill(-1);
  const order = new Int32Array(totalCells);
  let orderCount = 0;
  const visited = new Uint8Array(totalCells);

  const heap = new FlatMinHeap(totalCells);

  // 1. Identify sinks (ocean cells and boundary cells)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const isBorder = c === 0 || c === cols - 1 || r === 0 || r === rows - 1;
      const isOcean = elevationGrid[idx] < seaLevel;

      if (isBorder || isOcean) {
        const jitter = deterministicJitter(c, r, seed, flatJitter);
        const elev = elevationGrid[idx] + jitter;
        filled[idx] = elev;
        receiver[idx] = -1;
        visited[idx] = 1;
        heap.push(idx, elev);
      }
    }
  }

  // 8-neighbor offsets
  const dCols = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dRows = [-1, -1, -1, 0, 0, 1, 1, 1];

  // 2. Priority-Flood with epsilon
  while (heap.size > 0) {
    const curr = heap.pop();
    order[orderCount++] = curr;

    const cr = Math.floor(curr / cols);
    const cc = curr % cols;
    const currFilled = filled[curr];

    for (let k = 0; k < 8; k++) {
      const nc = cc + dCols[k];
      const nr = cr + dRows[k];

      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
        const nIdx = nr * cols + nc;
        if (visited[nIdx] === 0) {
          visited[nIdx] = 1;

          const jitter = deterministicJitter(nc, nr, seed, flatJitter);
          const origElev = elevationGrid[nIdx] + jitter;

          // Priority-Flood + epsilon formula:
          // filled = max(original, lowest spill neighbor + epsilon)
          const nFilled = Math.max(origElev, currFilled + epsilon);
          filled[nIdx] = nFilled;
          receiver[nIdx] = curr;

          heap.push(nIdx, nFilled);
        }
      }
    }
  }

  // 3. Flow Accumulation in reverse topological order
  const accumulation = new Float32Array(totalCells).fill(1);
  for (let i = orderCount - 1; i >= 0; i--) {
    const cell = order[i];
    const rec = receiver[cell];
    if (rec >= 0) {
      accumulation[rec] += accumulation[cell];
    }
  }

  // 4. Identify Depressions (filled - original >= minDepth)
  const isDepression = new Uint8Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    // Only inland/land cells can form lakes
    if (elevationGrid[i] >= seaLevel && filled[i] - elevationGrid[i] >= minDepth) {
      isDepression[i] = 1;
    }
  }

  // 4-connected components for depressions
  const componentVisited = new Uint8Array(totalCells);
  const depressions: Depression[] = [];
  const compDCols = [0, 0, -1, 1];
  const compDRows = [-1, 1, 0, 0];

  for (let i = 0; i < totalCells; i++) {
    if (isDepression[i] === 1 && componentVisited[i] === 0) {
      const compCells: number[] = [];
      const queue: number[] = [i];
      componentVisited[i] = 1;

      let maxDepthInComp = 0;
      let spillElevation = -Infinity;

      while (queue.length > 0) {
        const cIdx = queue.shift()!;
        compCells.push(cIdx);

        const depth = filled[cIdx] - elevationGrid[cIdx];
        if (depth > maxDepthInComp) maxDepthInComp = depth;
        if (filled[cIdx] > spillElevation) spillElevation = filled[cIdx];

        const cr = Math.floor(cIdx / cols);
        const cc = cIdx % cols;

        for (let d = 0; d < 4; d++) {
          const nc = cc + compDCols[d];
          const nr = cr + compDRows[d];
          if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
            const nIdx = nr * cols + nc;
            if (isDepression[nIdx] === 1 && componentVisited[nIdx] === 0) {
              componentVisited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      // Find spill cell: cell in component whose receiver is outside the component
      const cellSet = new Set(compCells);
      let spillCell = compCells[0];
      let maxSpillFilled = -Infinity;

      for (const cIdx of compCells) {
        const rec = receiver[cIdx];
        if (rec >= 0 && !cellSet.has(rec)) {
          if (filled[cIdx] > maxSpillFilled) {
            maxSpillFilled = filled[cIdx];
            spillCell = cIdx;
          }
        }
      }

      depressions.push({
        id: depressions.length,
        cells: compCells,
        area: compCells.length,
        maxDepth: maxDepthInComp,
        spillElevation,
        spillCell,
      });
    }
  }

  return {
    receiver,
    filled,
    accumulation,
    order,
    depressions,
  };
}

/**
 * Downsamples huge elevation grids (e.g. 8192x4096) to manageable hydrological resolution (<= 2048x1024)
 * using conservative block averaging.
 */
export function downsampleForHydrology(
  grid: Float32Array,
  cols: number,
  rows: number,
  maxCells: number = 2048 * 1024
): { grid: Float32Array; cols: number; rows: number; scale: number } {
  let scale = 1;
  while ((cols / scale) * (rows / scale) > maxCells) {
    scale *= 2;
  }

  if (scale === 1) {
    return { grid, cols, rows, scale: 1 };
  }

  const newCols = Math.floor(cols / scale);
  const newRows = Math.floor(rows / scale);
  const downsampled = new Float32Array(newCols * newRows);

  for (let r = 0; r < newRows; r++) {
    for (let c = 0; c < newCols; c++) {
      let sum = 0;
      let count = 0;
      for (let dr = 0; dr < scale; dr++) {
        const sr = r * scale + dr;
        if (sr >= rows) continue;
        for (let dc = 0; dc < scale; dc++) {
          const sc = c * scale + dc;
          if (sc >= cols) continue;
          sum += grid[sr * cols + sc];
          count++;
        }
      }
      downsampled[r * newCols + c] = count > 0 ? sum / count : 0;
    }
  }

  return { grid: downsampled, cols: newCols, rows: newRows, scale };
}
