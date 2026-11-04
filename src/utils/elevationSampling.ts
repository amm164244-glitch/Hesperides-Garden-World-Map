/**
 * Bicubic & Bilinear Elevation Sampling Utilities
 * Provides consistent Catmull-Rom bicubic interpolation across CPU (regional map generation)
 * and GPU (WebGL map renderer).
 */

export interface CatmullRomTaps {
  w: [number, number];       // [W0, W1]
  offsets: [number, number]; // [offset0, offset1] relative to node index i
}

/**
 * Standard Catmull-Rom cubic weights for Hermite spline with tension a = -0.5.
 * Evaluates weights for control points at indices i-1, i, i+1, i+2 given t in [0, 1].
 */
export function catmullRomWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const w0 = -0.5 * t3 + t2 - 0.5 * t;
  const w1 =  1.5 * t3 - 2.5 * t2 + 1.0;
  const w2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
  const w3 =  0.5 * t3 - 0.5 * t2;
  return [w0, w1, w2, w3];
}

/**
 * Calculates weights and offsets to evaluate Catmull-Rom cubic interpolation
 * using two bilinear filter taps per dimension (4 bilinear taps in 2D).
 *
 * Tap 0 combines points (i-1) and (i)
 * Tap 1 combines points (i+1) and (i+2)
 *
 * @param f Fractional sub-node offset in [0, 1]
 * @returns w: pair weights [W0, W1], offsets: coordinate offsets relative to node i
 */
export function catmullRomBilinearTaps(f: number): CatmullRomTaps {
  const [w0, w1, w2, w3] = catmullRomWeights(f);

  const W0 = w0 + w1;
  const W1 = w2 + w3;

  // Offset relative to node i:
  // pos0 = (i - 1) + w1 / (w0 + w1) = i - w0 / (w0 + w1)
  // pos1 = (i + 1) + w3 / (w2 + w3) = i + 1 + w3 / (w2 + w3)
  const offset0 = Math.abs(W0) > 1e-7 ? -w0 / W0 : 0.0;
  const offset1 = Math.abs(W1) > 1e-7 ? 1.0 + w3 / W1 : 1.0;

  return {
    w: [W0, W1],
    offsets: [offset0, offset1],
  };
}

/**
 * Simulates 2D Catmull-Rom interpolation evaluated via 4 bilinear taps.
 * Algebraically equivalent to 16-point 2D bicubic interpolation.
 */
export function evaluateCatmullRom4BilinearTaps(
  grid: Float32Array | number[],
  cols: number,
  rows: number,
  wx: number,
  wy: number,
  mapWidth: number,
  mapHeight: number
): number {
  const clampedX = Math.max(0, Math.min(mapWidth, wx));
  const clampedY = Math.max(0, Math.min(mapHeight, wy));

  const u = (clampedX / mapWidth) * (cols - 1);
  const v = (clampedY / mapHeight) * (rows - 1);

  const c1 = Math.floor(u);
  const r1 = Math.floor(v);
  const tx = u - c1;
  const ty = v - r1;

  const tapsX = catmullRomBilinearTaps(tx);
  const tapsY = catmullRomBilinearTaps(ty);

  const getVal = (c: number, r: number) => {
    const cc = Math.max(0, Math.min(cols - 1, c));
    const rr = Math.max(0, Math.min(rows - 1, r));
    return grid[rr * cols + cc];
  };

  // Tap 0 in X blends c1 - 1 and c1 with fraction alphaX0 = 1 + offsets[0]
  // Tap 1 in X blends c1 + 1 and c1 + 2 with fraction alphaX1 = offsets[1] - 1
  const alphaX0 = 1.0 + tapsX.offsets[0];
  const alphaX1 = tapsX.offsets[1] - 1.0;
  const alphaY0 = 1.0 + tapsY.offsets[0];
  const alphaY1 = tapsY.offsets[1] - 1.0;

  // Bilinear sample helper for a 2x2 patch
  const bilinear = (p00: number, p10: number, p01: number, p11: number, ax: number, ay: number) => {
    const row0 = (1.0 - ax) * p00 + ax * p10;
    const row1 = (1.0 - ax) * p01 + ax * p11;
    return (1.0 - ay) * row0 + ay * row1;
  };

  // 4 Bilinear Taps:
  // Tap 00: patch [c1-1 .. c1] x [r1-1 .. r1]
  const tap00 = bilinear(
    getVal(c1 - 1, r1 - 1), getVal(c1, r1 - 1),
    getVal(c1 - 1, r1), getVal(c1, r1),
    alphaX0, alphaY0
  );

  // Tap 10: patch [c1+1 .. c1+2] x [r1-1 .. r1]
  const tap10 = bilinear(
    getVal(c1 + 1, r1 - 1), getVal(c1 + 2, r1 - 1),
    getVal(c1 + 1, r1), getVal(c1 + 2, r1),
    alphaX1, alphaY0
  );

  // Tap 01: patch [c1-1 .. c1] x [r1+1 .. r1+2]
  const tap01 = bilinear(
    getVal(c1 - 1, r1 + 1), getVal(c1, r1 + 1),
    getVal(c1 - 1, r1 + 2), getVal(c1, r1 + 2),
    alphaX0, alphaY1
  );

  // Tap 11: patch [c1+1 .. c1+2] x [r1+1 .. r1+2]
  const tap11 = bilinear(
    getVal(c1 + 1, r1 + 1), getVal(c1 + 2, r1 + 1),
    getVal(c1 + 1, r1 + 2), getVal(c1 + 2, r1 + 2),
    alphaX1, alphaY1
  );

  const row0 = tapsX.w[0] * tap00 + tapsX.w[1] * tap10;
  const row1 = tapsX.w[0] * tap01 + tapsX.w[1] * tap11;
  return tapsY.w[0] * row0 + tapsY.w[1] * row1;
}

/**
 * Standard Catmull-Rom bicubic sampling of an elevation grid.
 * Matches regionGenerator.ts sampleParentElev logic.
 *
 * @param grid 1D array of elevation values (size cols * rows)
 * @param cols Number of grid columns
 * @param rows Number of grid rows
 * @param mapWidth Map coordinate width
 * @param mapHeight Map coordinate height
 * @param wx World X coordinate
 * @param wy World Y coordinate
 * @param clamp If true (default), clamps the interpolated result to the min/max of the surrounding 2x2 grid points.
 */
export function sampleElevationBicubic(
  grid: Float32Array | number[],
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
  wx: number,
  wy: number,
  clamp: boolean = true
): number {
  const clampedX = Math.max(0, Math.min(mapWidth, wx));
  const clampedY = Math.max(0, Math.min(mapHeight, wy));

  const u = (clampedX / mapWidth) * (cols - 1);
  const v = (clampedY / mapHeight) * (rows - 1);

  const c1 = Math.floor(u);
  const r1 = Math.floor(v);
  const tx = u - c1;
  const ty = v - r1;

  const getVal = (c: number, r: number) => {
    const cc = Math.max(0, Math.min(cols - 1, c));
    const rr = Math.max(0, Math.min(rows - 1, r));
    return grid[rr * cols + cc];
  };

  const hermite = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    const b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
    const c = -0.5 * p0 + 0.5 * p2;
    const d = p1;
    return a * t * t * t + b * t * t + c * t + d;
  };

  const rowsVal: number[] = new Array(4);
  for (let i = 0; i < 4; i++) {
    const r = r1 - 1 + i;
    rowsVal[i] = hermite(getVal(c1 - 1, r), getVal(c1, r), getVal(c1 + 1, r), getVal(c1 + 2, r), tx);
  }

  const val = hermite(rowsVal[0], rowsVal[1], rowsVal[2], rowsVal[3], ty);

  if (!clamp) {
    return val;
  }

  // Clamp to surrounding 4 grid points to eliminate overshoot/undershoot ringing
  const v00 = getVal(c1, r1);
  const v10 = getVal(c1 + 1, r1);
  const v01 = getVal(c1, r1 + 1);
  const v11 = getVal(c1 + 1, r1 + 1);
  const minVal = Math.min(v00, v10, v01, v11);
  const maxVal = Math.max(v00, v10, v01, v11);

  return Math.max(minVal, Math.min(maxVal, val));
}

/**
 * Simulates texture sampling using hardware bilinear interpolation with exact node coordinates:
 * texUV = (nodeCoord + 0.5) / gridSize
 */
export function sampleHardwareBilinearCorrect(
  grid: Float32Array | number[],
  cols: number,
  rows: number,
  uvX: number,
  uvY: number
): number {
  const nX = uvX * (cols - 1);
  const nY = uvY * (rows - 1);

  // Hardware texture coordinate: texCoord = (nX + 0.5) / cols
  const pixelX = Math.max(0.5, Math.min(cols - 0.5, nX + 0.5));
  const pixelY = Math.max(0.5, Math.min(rows - 0.5, nY + 0.5));

  // Sub-pixel hardware bilinear evaluation
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(pixelX - 0.5)));
  const c1 = Math.max(0, Math.min(cols - 1, c0 + 1));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(pixelY - 0.5)));
  const r1 = Math.max(0, Math.min(rows - 1, r0 + 1));

  const fx = pixelX - 0.5 - c0;
  const fy = pixelY - 0.5 - r0;

  const v00 = grid[r0 * cols + c0];
  const v10 = grid[r0 * cols + c1];
  const v01 = grid[r1 * cols + c0];
  const v11 = grid[r1 * cols + c1];

  return (1.0 - fy) * ((1.0 - fx) * v00 + fx * v10) + fy * ((1.0 - fx) * v01 + fx * v11);
}

/**
 * Simulates the previous buggy shader sampling:
 * uses smoothstep deformation f^2 * (3 - 2f) and divisions by (cols - 1).
 */
export function sampleBuggyOldShaderMethod(
  grid: Float32Array | number[],
  cols: number,
  rows: number,
  uvX: number,
  uvY: number
): number {
  // Old shader math:
  // pixelCoord = uv * (grid - 1)
  // f = fract(pixelCoord); f = f*f*(3-2f)
  // smoothUV = (floor(pixelCoord) + 0.5 + f) / grid
  const nX = uvX * (cols - 1);
  const nY = uvY * (rows - 1);

  const iX = Math.floor(nX);
  const iY = Math.floor(nY);
  let fX = nX - iX;
  let fY = nY - iY;

  // Hermite smoothstep curve
  fX = fX * fX * (3.0 - 2.0 * fX);
  fY = fY * fY * (3.0 - 2.0 * fY);

  const pixelX = Math.max(0.5, Math.min(cols - 0.5, iX + fX + 0.5));
  const pixelY = Math.max(0.5, Math.min(rows - 0.5, iY + fY + 0.5));

  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(pixelX - 0.5)));
  const c1 = Math.max(0, Math.min(cols - 1, c0 + 1));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(pixelY - 0.5)));
  const r1 = Math.max(0, Math.min(rows - 1, r0 + 1));

  const subFx = pixelX - 0.5 - c0;
  const subFy = pixelY - 0.5 - r0;

  const v00 = grid[r0 * cols + c0];
  const v10 = grid[r0 * cols + c1];
  const v01 = grid[r1 * cols + c0];
  const v11 = grid[r1 * cols + c1];

  return (1.0 - subFy) * ((1.0 - subFx) * v00 + subFx * v10) + subFy * ((1.0 - subFx) * v01 + subFx * v11);
}
