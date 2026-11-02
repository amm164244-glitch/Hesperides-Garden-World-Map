import { BiomePaintOptions } from '../types/biome';

export interface BiomeCellChange {
  gridIndex: number;
  prev: number;
  next: number;
}

export interface BiomeBoundingBox {
  minC: number;
  minR: number;
  maxC: number;
  maxR: number;
}

export interface BiomePaintResult {
  changes: BiomeCellChange[];
  bounds: BiomeBoundingBox | null;
}

/**
 * Fast, deterministic pseudo-random 32-bit integer hash mapping (c, r) -> [0, 1)
 * Ensures repeatable stochastic stippling without visual flickering on repeated strokes.
 */
export function coordHash(c: number, r: number): number {
  let h = (Math.imul(c, 374761393) + Math.imul(r, 668265263)) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Paints a biome circle onto the Uint8Array grid with optional softness jitter,
 * land-only elevation restriction, and dragLine interpolation between mouse events.
 *
 * Supports both:
 * 1. paintBiomeCircle(grid, cols, rows, mapWidth, mapHeight, wx, wy, radius, biomeId, softness, options, dragLine)
 * 2. paintBiomeCircle(grid, cols, rows, mapWidth, mapHeight, wx, wy, radius, biomeId, options, dragLine)
 */
export function paintBiomeCircle(
  grid: Uint8Array,
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
  wx: number,
  wy: number,
  radius: number,
  biomeId: number,
  softnessOrOptions?: number | BiomePaintOptions,
  optionsOrDragLine?: BiomePaintOptions | { prevX: number; prevY: number },
  dragLineArg?: { prevX: number; prevY: number }
): BiomePaintResult {
  if (cols <= 0 || rows <= 0 || mapWidth <= 0 || mapHeight <= 0) {
    return { changes: [], bounds: null };
  }

  let softnessVal = 0;
  let options: BiomePaintOptions = { softness: 40, landOnly: true };
  let dragLine: { prevX: number; prevY: number } | undefined = undefined;

  if (typeof softnessOrOptions === 'number') {
    softnessVal = softnessOrOptions;
    if (optionsOrDragLine && typeof optionsOrDragLine === 'object' && !('prevX' in optionsOrDragLine)) {
      options = optionsOrDragLine as BiomePaintOptions;
      dragLine = dragLineArg;
    } else if (optionsOrDragLine && 'prevX' in optionsOrDragLine) {
      dragLine = optionsOrDragLine as { prevX: number; prevY: number };
    }
  } else if (softnessOrOptions && typeof softnessOrOptions === 'object') {
    options = softnessOrOptions;
    softnessVal = options.softness ?? 40;
    if (optionsOrDragLine && 'prevX' in optionsOrDragLine) {
      dragLine = optionsOrDragLine as { prevX: number; prevY: number };
    }
  }

  // Normalize softness to [0, 1]
  const softnessNormalized = softnessVal > 1 ? softnessVal / 100 : Math.max(0, softnessVal);
  const solidCoreRadius = radius * (1.0 - softnessNormalized);
  const transitionRange = Math.max(1e-4, radius - solidCoreRadius);

  const landOnly = !!options.landOnly;
  const elevationGrid = options.elevationGrid;
  const seaLevel = options.seaLevel ?? 35.0;

  const cellW = mapWidth / (cols - 1);
  const cellH = mapHeight / (rows - 1);

  // Determine outer bounding box in map coords, expanding if dragLine exists
  const minX = dragLine ? Math.min(wx, dragLine.prevX) : wx;
  const maxX = dragLine ? Math.max(wx, dragLine.prevX) : wx;
  const minY = dragLine ? Math.min(wy, dragLine.prevY) : wy;
  const maxY = dragLine ? Math.max(wy, dragLine.prevY) : wy;

  const minC = Math.max(0, Math.floor((minX - radius) / cellW));
  const maxC = Math.min(cols - 1, Math.ceil((maxX + radius) / cellW));
  const minR = Math.max(0, Math.floor((minY - radius) / cellH));
  const maxR = Math.min(rows - 1, Math.ceil((maxY + radius) / cellH));

  const changes: BiomeCellChange[] = [];
  let dirtyMinC = cols;
  let dirtyMaxC = -1;
  let dirtyMinR = rows;
  let dirtyMaxR = -1;

  // Pre-calculate line segment parameters for dragLine capsule
  const hasLine = !!dragLine;
  const lx1 = dragLine?.prevX ?? wx;
  const ly1 = dragLine?.prevY ?? wy;
  const ldx = wx - lx1;
  const ldy = wy - ly1;
  const lenSq = ldx * ldx + ldy * ldy;

  for (let r = minR; r <= maxR; r++) {
    const gy = r * cellH;
    for (let c = minC; c <= maxC; c++) {
      const gx = c * cellW;

      // Distance from grid sample point to brush circle (or capsule segment)
      let dist = Math.hypot(gx - wx, gy - wy);
      if (hasLine && lenSq > 0) {
        const t = Math.max(0, Math.min(1, ((gx - lx1) * ldx + (gy - ly1) * ldy) / lenSq));
        const projX = lx1 + t * ldx;
        const projY = ly1 + t * ldy;
        dist = Math.hypot(gx - projX, gy - projY);
      }

      if (dist > radius) continue;

      const gridIndex = r * cols + c;

      // Land-only restriction: must be at or above seaLevel
      if (landOnly && elevationGrid && elevationGrid[gridIndex] < seaLevel) {
        continue;
      }

      // Softness falloff test:
      if (softnessNormalized > 0 && dist > solidCoreRadius) {
        const t = (dist - solidCoreRadius) / transitionRange; // 0 at solid boundary, 1 at edge
        // Smooth probability curve: 1.0 -> 0.0
        const prob = Math.max(0, Math.min(1, 1.0 - (3 * t * t - 2 * t * t * t)));
        const rnd = coordHash(c, r);
        if (rnd >= prob) {
          continue; // skipped by stochastic stippling
        }
      }

      const prev = grid[gridIndex];
      if (prev === biomeId) continue;

      grid[gridIndex] = biomeId;
      changes.push({ gridIndex, prev, next: biomeId });

      if (c < dirtyMinC) dirtyMinC = c;
      if (c > dirtyMaxC) dirtyMaxC = c;
      if (r < dirtyMinR) dirtyMinR = r;
      if (r > dirtyMaxR) dirtyMaxR = r;
    }
  }

  const bounds =
    changes.length > 0
      ? { minC: dirtyMinC, minR: dirtyMinR, maxC: dirtyMaxC, maxR: dirtyMaxR }
      : null;

  return { changes, bounds };
}

/**
 * 4-way BFS flood-fill algorithm for biome areas.
 * startIndex と上下左右でつながり、かつ同じ現在値のセルを、biomeId に置き換える。
 * options.landOnly が true なら海のセルは対象外(陸だけでつながる領域)。
 * 2048x1024 でもスタックオーバーフローせず高速に動作。
 */
export function floodFillBiome(
  grid: Uint8Array,
  cols: number,
  rows: number,
  startIndex: number,
  biomeId: number,
  options?: Partial<BiomePaintOptions>
): BiomePaintResult {
  if (cols <= 0 || rows <= 0 || startIndex < 0 || startIndex >= cols * rows) {
    return { changes: [], bounds: null };
  }

  const targetBiomeId = grid[startIndex];
  if (targetBiomeId === biomeId) {
    return { changes: [], bounds: null };
  }

  const landOnly = !!options?.landOnly;
  const elevationGrid = options?.elevationGrid;
  const seaLevel = options?.seaLevel ?? 35.0;

  // If landOnly is active and click is in ocean, do not fill
  if (landOnly && elevationGrid && elevationGrid[startIndex] < seaLevel) {
    return { changes: [], bounds: null };
  }

  const totalCells = cols * rows;
  const visited = new Uint8Array(totalCells);

  // Queue stored as flat indices
  const queue = new Int32Array(totalCells);
  let head = 0;
  let tail = 0;

  queue[tail++] = startIndex;
  visited[startIndex] = 1;

  const changes: BiomeCellChange[] = [];
  let dirtyMinC = cols;
  let dirtyMaxC = -1;
  let dirtyMinR = rows;
  let dirtyMaxR = -1;

  while (head < tail) {
    const idx = queue[head++];
    const c = idx % cols;
    const r = Math.floor(idx / cols);

    const prev = grid[idx];
    grid[idx] = biomeId;
    changes.push({ gridIndex: idx, prev, next: biomeId });

    if (c < dirtyMinC) dirtyMinC = c;
    if (c > dirtyMaxC) dirtyMaxC = c;
    if (r < dirtyMinR) dirtyMinR = r;
    if (r > dirtyMaxR) dirtyMaxR = r;

    // 4 neighbors: Right, Left, Down, Up
    const neighbors = [
      c + 1 < cols ? idx + 1 : -1,
      c - 1 >= 0 ? idx - 1 : -1,
      r + 1 < rows ? idx + cols : -1,
      r - 1 >= 0 ? idx - cols : -1,
    ];

    for (let i = 0; i < 4; i++) {
      const nIdx = neighbors[i];
      if (nIdx === -1 || visited[nIdx]) continue;
      visited[nIdx] = 1;

      // Must match original target biome
      if (grid[nIdx] !== targetBiomeId) continue;

      // Must satisfy landOnly
      if (landOnly && elevationGrid && elevationGrid[nIdx] < seaLevel) continue;

      queue[tail++] = nIdx;
    }
  }

  const bounds =
    changes.length > 0
      ? { minC: dirtyMinC, minR: dirtyMinR, maxC: dirtyMaxC, maxR: dirtyMaxR }
      : null;

  return { changes, bounds };
}

/**
 * Encodes a Uint8Array grid using 16-bit Run-Length Encoding (RLE).
 * Format per run: [value: 1 byte, countLow: 1 byte, countHigh: 1 byte]
 * Maximum run length per chunk: 65535.
 */
export function encodeBiomeGrid(grid: Uint8Array): Uint8Array {
  if (grid.length === 0) return new Uint8Array(0);

  const out: number[] = [];
  let currentVal = grid[0];
  let currentCount = 1;

  for (let i = 1; i < grid.length; i++) {
    const val = grid[i];
    if (val === currentVal && currentCount < 65535) {
      currentCount++;
    } else {
      out.push(currentVal, currentCount & 0xff, (currentCount >> 8) & 0xff);
      currentVal = val;
      currentCount = 1;
    }
  }
  out.push(currentVal, currentCount & 0xff, (currentCount >> 8) & 0xff);

  return new Uint8Array(out);
}

/**
 * Decodes a 16-bit RLE encoded Uint8Array into a full-sized biome Uint8Array.
 */
export function decodeBiomeGrid(data: Uint8Array, targetLength: number): Uint8Array {
  const result = new Uint8Array(targetLength);
  let outIdx = 0;

  for (let i = 0; i + 2 < data.length && outIdx < targetLength; i += 3) {
    const val = data[i];
    const count = data[i + 1] | (data[i + 2] << 8);
    const end = Math.min(targetLength, outIdx + count);
    result.fill(val, outIdx, end);
    outIdx = end;
  }

  return result;
}

/**
 * Serializes biome grid to Base64 via RLE compression.
 */
export function biomeGridToBase64(grid: Uint8Array): string {
  const rle = encodeBiomeGrid(grid);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < rle.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      rle.subarray(i, Math.min(i + chunkSize, rle.length)) as any
    );
  }
  return btoa(binary);
}

/**
 * Deserializes Base64 RLE biome grid back into full Uint8Array.
 */
export function base64ToBiomeGrid(base64: string, targetLength: number): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return decodeBiomeGrid(bytes, targetLength);
}
