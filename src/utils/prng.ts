/**
 * Seeded PRNG and Simplex-style 2D Noise Implementation
 * Provides fully deterministic random numbers and 2D procedural noise for terrain generation.
 */

export function hashStringToSeed(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class Mulberry32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  // Returns float in [0, 1)
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Returns integer in [min, max]
  nextInt(min: number, max: number): number {
    return Math.floor(min + this.next() * (max - min + 1));
  }
}

/**
 * 2D Gradient Noise Generator based on standard Simplex/Perlin principles.
 * Completely deterministic based on permutation table derived from seed.
 */
export class Noise2D {
  private p: Uint8Array = new Uint8Array(512);

  constructor(seed: number) {
    const rng = new Mulberry32(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      perm[i] = i;
    }
    // Fisher-Yates shuffle
    for (let i = 255; i > 0; i--) {
      const j = rng.nextInt(0, i);
      const tmp = perm[i];
      perm[i] = perm[j];
      perm[j] = tmp;
    }
    // Duplicate to avoid index wrap
    for (let i = 0; i < 512; i++) {
      this.p[i] = perm[i & 255];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  /**
   * Sample 2D noise in range [-1, 1]
   */
  sample(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.p[this.p[xi] + yi];
    const ab = this.p[this.p[xi] + yi + 1];
    const ba = this.p[this.p[xi + 1] + yi];
    const bb = this.p[this.p[xi + 1] + yi + 1];

    const x1 = this.lerp(u, this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf));
    const x2 = this.lerp(u, this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1));

    return this.lerp(v, x1, x2);
  }

  /**
   * Fractal Brownian Motion (FBM) noise
   * Octaves, persistence, lacunarity
   */
  fbm(x: number, y: number, octaves: number = 4, persistence: number = 0.5, lacunarity: number = 2.0): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.sample(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue; // Normalized roughly to [-1, 1]
  }

  /**
   * Ridged Multifractal noise (ideal for sharp mountain ridges and tectonic ranges)
   */
  ridged(x: number, y: number, octaves: number = 4, persistence: number = 0.5, lacunarity: number = 2.0): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      let val = 1.0 - Math.abs(this.sample(x * frequency, y * frequency));
      val = val * val; // Sharp crests
      total += val * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue; // Normalized roughly to [0, 1]
  }

  /**
   * Domain Warped FBM Noise
   * Recursively warps coordinates using noise vectors to produce realistic coastlines,
   * natural fractal bays, peninsulas, and inlets.
   */
  domainWarpFBM(
    x: number,
    y: number,
    warpStrength: number = 0.5,
    octaves: number = 4
  ): { value: number; qx: number; qy: number } {
    // 1st warp stage
    const qx = this.fbm(x, y, octaves, 0.5, 2.0);
    const qy = this.fbm(x + 5.2, y + 1.3, octaves, 0.5, 2.0);

    // 2nd warp stage with offset
    const rx = this.fbm(x + warpStrength * 4.0 * qx + 1.7, y + warpStrength * 4.0 * qy + 9.2, octaves, 0.5, 2.0);
    const ry = this.fbm(x + warpStrength * 4.0 * qx + 8.3, y + warpStrength * 4.0 * qy + 2.8, octaves, 0.5, 2.0);

    const val = this.fbm(x + warpStrength * 4.0 * rx, y + warpStrength * 4.0 * ry, octaves, 0.5, 2.0);
    return { value: val, qx: rx, qy: ry };
  }
}
