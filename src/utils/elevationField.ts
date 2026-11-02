import { Noise2D } from './prng';

/**
 * Continuous Bicubic Elevation Field
 * Evaluates smooth, resolution-independent elevation at any continuous world coordinate (x, y)
 * using Catmull-Rom cubic interpolation and pre-contour high-frequency fractal noise.
 */
export class ElevationField {
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
  readonly grid: Float32Array;
  private microNoise: Noise2D;
  private noiseAmplitude: number;

  constructor(
    width: number,
    height: number,
    cols: number,
    rows: number,
    grid: Float32Array,
    seed: number = 42,
    noiseAmplitude: number = 0.8
  ) {
    this.width = width;
    this.height = height;
    this.cols = cols;
    this.rows = rows;
    this.grid = grid;
    this.microNoise = new Noise2D(seed + 8887);
    this.noiseAmplitude = noiseAmplitude;
  }

  // Safe grid access with edge clamping
  private getVal(c: number, r: number): number {
    const clampedC = Math.max(0, Math.min(this.cols - 1, c));
    const clampedR = Math.max(0, Math.min(this.rows - 1, r));
    return this.grid[clampedR * this.cols + clampedC];
  }

  // 1D Cubic Hermite / Catmull-Rom interpolation
  private cubicHermite(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    const b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
    const c = -0.5 * p0 + 0.5 * p2;
    const d = p1;
    return a * t * t * t + b * t * t + c * t + d;
  }

  /**
   * Sample smooth continuous elevation at world coordinate (x, y)
   * with bicubic interpolation and natural coastline micro-fluctuation.
   */
  sample(x: number, y: number, addMicroNoise: boolean = true): number {
    const u = (x / this.width) * (this.cols - 1);
    const v = (y / this.height) * (this.rows - 1);

    const c1 = Math.floor(u);
    const r1 = Math.floor(v);
    const tx = u - c1;
    const ty = v - r1;

    // 4 rows of 4 horizontal samples for 2D Bicubic
    const col0 = c1 - 1;
    const col1 = c1;
    const col2 = c1 + 1;
    const col3 = c1 + 2;

    const rowSamples: number[] = new Array(4);
    for (let i = 0; i < 4; i++) {
      const r = r1 - 1 + i;
      const v0 = this.getVal(col0, r);
      const v1 = this.getVal(col1, r);
      const v2 = this.getVal(col2, r);
      const v3 = this.getVal(col3, r);
      rowSamples[i] = this.cubicHermite(v0, v1, v2, v3, tx);
    }

    let baseElev = this.cubicHermite(rowSamples[0], rowSamples[1], rowSamples[2], rowSamples[3], ty);

    // Add high-frequency fractal noise BEFORE contour extraction for natural organic coastline wobble
    if (addMicroNoise && this.noiseAmplitude > 0) {
      // Noise scale tuned for subtle organic fractal shoreline roughness
      const n1 = this.microNoise.sample(x * 0.025, y * 0.025);
      const n2 = this.microNoise.sample(x * 0.065, y * 0.065) * 0.5;
      baseElev += (n1 + n2) * this.noiseAmplitude;
    }

    return Math.max(0, Math.min(100, baseElev));
  }

  /**
   * Generates a sub-sampled continuous elevation buffer for marching squares
   */
  generateSampleGrid(targetCols: number, targetRows: number): Float32Array {
    const out = new Float32Array(targetCols * targetRows);
    const stepX = this.width / (targetCols - 1);
    const stepY = this.height / (targetRows - 1);

    for (let r = 0; r < targetRows; r++) {
      const y = r * stepY;
      for (let c = 0; c < targetCols; c++) {
        const x = c * stepX;
        out[r * targetCols + c] = this.sample(x, y, true);
      }
    }
    return out;
  }
}
