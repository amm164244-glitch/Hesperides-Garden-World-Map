/**
 * WebGL 2 Fragment Shader Terrain Renderer for Global Planetary World & Regional Maps
 * Supports 2:1 aspect ratio, 1024x512 to 4096x2048 Float32Array grids,
 * antique parchment color planes, 1-2px brown coastline edge, shallow turquoise gradient,
 * and North-West hillshade.
 */

import { ViewMode, Viewport } from '../types/map';

const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_elevation_tex;
uniform vec2 u_resolution;
uniform vec2 u_world_size;
uniform vec2 u_grid_size;
uniform vec4 u_viewport; // x, y, zoom, seaLevel
uniform int u_view_mode;  // 0: elevation, 3: landSea
uniform float u_show_shading;
uniform float u_shallows_width;
uniform float u_show_ripples;

// Fast hardware-friendly PRNG hash without slow trigonometric sin()
float fastHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z) * 2.0 - 1.0;
}

// Optimized 2D value noise (4 textureless lookups, smooth Hermite curve)
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fastHash(i);
  float b = fastHash(i + vec2(1.0, 0.0));
  float c = fastHash(i + vec2(0.0, 1.0));
  float d = fastHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Hardware bilinear sampling with Hermite cubic UV curve for smooth C1 interpolation (1 single texture fetch)
float sampleSmoothElev(vec2 uv) {
  vec2 pixelCoord = uv * (u_grid_size - vec2(1.0)) - 0.5;
  vec2 f = fract(pixelCoord);
  f = f * f * (3.0 - 2.0 * f); // Hermite cubic curve
  vec2 smoothUV = (floor(pixelCoord) + 0.5 + f) / (u_grid_size - vec2(1.0));
  return texture(u_elevation_tex, clamp(smoothUV, 0.0, 1.0)).r * 100.0;
}

// Antique Parchment & Portolan Palette
// Matches high-end fantasy cartography (Wonderdraft/Tolkien style):
// Teal sea-green ocean, multi-tier ripples, ink coastline, parchment planes
vec3 getParchmentColor(float elev, float seaLevel, vec2 worldPos, float pixelDistToCoast, float slope) {
  // Ocean colors
  if (elev < seaLevel) {
    float depth = (seaLevel - elev);

    // Antique Fantasy Teal / Sea-Green Ocean Palette (matching the reference map)
    vec3 deepSea      = vec3(0.09, 0.22, 0.26); // #173842 deep sea-green / teal abyss
    vec3 midSea       = vec3(0.16, 0.35, 0.38); // #295961 rich ocean teal
    vec3 coastalSea   = vec3(0.24, 0.49, 0.52); // #3d7d85 sea-green shallows
    vec3 paleShallow  = vec3(0.48, 0.77, 0.77); // #7bc5c5 luminous turquoise shallows
    vec3 crestWhite   = vec3(0.85, 0.95, 0.95); // pale froth ripple crest

    float seaT = clamp(elev / seaLevel, 0.0, 1.0);
    vec3 waterCol;
    if (seaT < 0.5) {
      waterCol = mix(deepSea, midSea, seaT / 0.5);
    } else {
      waterCol = mix(midSea, coastalSea, (seaT - 0.5) / 0.5);
    }

    // Pale turquoise shallow water coastal aura (海側の淡い水色の浅瀬の帯)
    float shallowsFactor = smoothstep(u_shallows_width * 1.8, 0.0, depth);
    waterCol = mix(waterCol, paleShallow, shallowsFactor * 0.72);

    // Multi-tier Concentric Echo Waves / Ripples (同心円状の沿岸波紋)
    if (u_show_ripples > 0.5) {
      // 1st ripple (closest to coast)
      float r1 = smoothstep(1.3, 0.0, abs(pixelDistToCoast - 3.8));
      // 2nd ripple
      float r2 = smoothstep(1.4, 0.0, abs(pixelDistToCoast - 8.5));
      // 3rd ripple
      float r3 = smoothstep(1.6, 0.0, abs(pixelDistToCoast - 14.5));
      // 4th ripple (faintest outer echo)
      float r4 = smoothstep(1.8, 0.0, abs(pixelDistToCoast - 22.0));

      float ripplesVal = r1 * 0.55 + r2 * 0.36 + r3 * 0.22 + r4 * 0.12;
      waterCol = mix(waterCol, crestWhite, clamp(ripplesVal, 0.0, 0.85));
    }

    // Crisp ink coastline edge on ocean side (海岸線エッジにクッキリとした暗色インクのアウトライン)
    if (pixelDistToCoast < 1.4) {
      vec3 inkDark = vec3(0.12, 0.10, 0.08); // dark drawing ink
      float inkAlpha = smoothstep(1.4, 0.0, pixelDistToCoast) * 0.92;
      waterCol = mix(waterCol, inkDark, inkAlpha);
    }

    return waterCol;
  }

  // Land (seaLevel to 100)
  float landH = elev - seaLevel;

  // Parchment color planes requested:
  // 低地（黄緑〜黄土）、丘陵（茶）、高地（灰茶）、岩山（灰）、雪（白）
  vec3 beachSand          = vec3(0.85, 0.79, 0.65); // #d9c9a6 parchment dune sand
  vec3 lowlandGreen       = vec3(0.63, 0.67, 0.46); // #a1ab75 antique muted yellow-green
  vec3 plainsOchre        = vec3(0.77, 0.72, 0.51); // #c4b882 muted antique ochre
  vec3 hillsBrown         = vec3(0.63, 0.51, 0.36); // #a1825c warm antique brown
  vec3 highlandsGreyBrown = vec3(0.52, 0.45, 0.39); // #857363 slate grey-brown
  vec3 rockyGrey          = vec3(0.40, 0.38, 0.36); // #66615c rocky slate grey
  vec3 snowWhite          = vec3(0.91, 0.90, 0.87); // #e8e6de antique parchment snow

  vec3 landCol;

  // 1. Sand beach: fine delicate ribbon just inside the coast edge (海面〜海面+1.8)
  if (landH < 1.8) {
    float t = landH / 1.8;
    landCol = mix(beachSand, lowlandGreen, smoothstep(0.3, 1.0, t));
  }
  // 2. Lowland & Plains (黄緑〜黄土)
  else if (landH < 18.0) {
    float t = (landH - 1.8) / 16.2;
    landCol = mix(lowlandGreen, plainsOchre, t);
  }
  // 3. Hills & Foothills (茶)
  else if (landH < 38.0) {
    float t = (landH - 18.0) / 20.0;
    landCol = mix(plainsOchre, hillsBrown, t);
  }
  // 4. Highlands (灰茶)
  else if (landH < 56.0) {
    float t = (landH - 38.0) / 18.0;
    landCol = mix(hillsBrown, highlandsGreyBrown, t);
  }
  // 5. Rocky Mountains (灰)
  else if (landH < 72.0) {
    float t = (landH - 56.0) / 16.0;
    landCol = mix(highlandsGreyBrown, rockyGrey, t);
  }
  // 6. High Peaks & Snow (白)
  else {
    float t = clamp((landH - 72.0) / 12.0, 0.0, 1.0);
    landCol = mix(rockyGrey, snowWhite, t);
  }

  // Slope-dependent rock exposure: steep cliffs reveal rocky grey face
  float rockExposure = smoothstep(0.85, 2.4, slope);
  if (landH > 3.0) {
    vec3 cliffCol = mix(highlandsGreyBrown, rockyGrey, clamp((landH - 10.0) / 30.0, 0.0, 1.0));
    landCol = mix(landCol, cliffCol, rockExposure * 0.70);
  }

  // Crisp ink coastline edge on land side
  if (pixelDistToCoast < 1.4) {
    vec3 inkDark = vec3(0.12, 0.10, 0.08);
    float inkAlpha = smoothstep(1.4, 0.0, pixelDistToCoast) * 0.92;
    landCol = mix(landCol, inkDark, inkAlpha);
  }
  // Antique warm sepia/ochre vignette halo bordering the coast inside the land
  else if (pixelDistToCoast < 12.0) {
    vec3 coastalSepia = vec3(0.55, 0.44, 0.30); // #8c704d warm antique sepia border
    float haloAlpha = smoothstep(12.0, 1.4, pixelDistToCoast) * 0.55;
    landCol = mix(landCol, coastalSepia, haloAlpha);
  }

  return landCol;
}

void main() {
  vec2 screenPos = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 worldPos = (screenPos - u_viewport.xy) / u_viewport.z;

  // Check map world boundary
  if (worldPos.x < 0.0 || worldPos.x > u_world_size.x || worldPos.y < 0.0 || worldPos.y > u_world_size.y) {
    fragColor = vec4(0.03, 0.06, 0.10, 1.0); // Dark border frame
    return;
  }

  vec2 uv = worldPos / u_world_size;
  float baseElev = sampleSmoothElev(uv);

  // High-frequency procedural detail evaluated at continuous world coordinates
  float microDetail = noise(worldPos * 0.04) * 1.5 + noise(worldPos * 0.12) * 0.65;

  float elev = clamp(baseElev + microDetail, 0.0, 100.0);
  float seaLevel = u_viewport.w;

  // Rate of elevation change per screen pixel
  float deltaElevPerPixel = max(0.01, fwidth(elev));
  float pixelDistToCoast = abs(elev - seaLevel) / deltaElevPerPixel;

  // Instantaneous hardware screen-space derivatives for terrain slope and hillshading
  float slopeX = dFdx(elev) * 1.5;
  float slopeY = dFdy(elev) * 1.5;
  float slope = length(vec2(slopeX, slopeY));

  vec3 col = vec3(0.0);

  if (u_view_mode == 0) {
    col = getParchmentColor(elev, seaLevel, worldPos, pixelDistToCoast, slope);

    // North-West Shaded Relief (Light from Top-Left, increased contrast)
    if (u_show_shading > 0.5) {
      vec2 lightDir = normalize(vec2(-1.0, -1.0));
      float dotVal = (slopeX * lightDir.x + slopeY * lightDir.y) * 0.052;

      if (elev > seaLevel) {
        if (dotVal > 0.0) {
          col += vec3(min(0.24, dotVal * 0.85)); // Crisp sunlight
        } else {
          col -= vec3(min(0.28, abs(dotVal) * 0.95)); // Rich soft shadow
        }
      } else {
        if (dotVal < 0.0) {
          col -= vec3(min(0.12, abs(dotVal) * 0.5));
        }
      }
    }

    // Overlay subtle paper fiber / parchment noise texture
    float paperNoise = noise(worldPos * 0.8) * 0.5;
  } else if (u_view_mode == 3) {
    // 3: Land / Sea mask
    col = elev <= seaLevel ? vec3(0.18, 0.35, 0.45) : vec3(0.72, 0.68, 0.52);
  }

  fragColor = vec4(col, 1.0);
}
`;

export class WebGLMapRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private elevationTexture: WebGLTexture | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;

  private uResolutionLoc: WebGLUniformLocation | null = null;
  private uWorldSizeLoc: WebGLUniformLocation | null = null;
  private uGridSizeLoc: WebGLUniformLocation | null = null;
  private uViewportLoc: WebGLUniformLocation | null = null;
  private uViewModeLoc: WebGLUniformLocation | null = null;
  private uShowShadingLoc: WebGLUniformLocation | null = null;
  private uShowRipplesLoc: WebGLUniformLocation | null = null;
  private uShallowsWidthLoc: WebGLUniformLocation | null = null;
  private uElevationTexLoc: WebGLUniformLocation | null = null;

  private currentCols: number = 0;
  private currentRows: number = 0;
  private byteElev: Uint8Array | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      console.warn('WebGL2 not available.');
      return;
    }

    this.gl = gl;
    this.initShaders();
    this.initGeometry();
  }

  private initShaders() {
    const gl = this.gl!;

    const createShader = (type: number, src: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compile failed: ${info}`);
      }
      return shader;
    };

    const vertShader = createShader(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fragShader = createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${info}`);
    }

    this.program = program;

    this.uResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
    this.uWorldSizeLoc = gl.getUniformLocation(program, 'u_world_size');
    this.uGridSizeLoc = gl.getUniformLocation(program, 'u_grid_size');
    this.uViewportLoc = gl.getUniformLocation(program, 'u_viewport');
    this.uViewModeLoc = gl.getUniformLocation(program, 'u_view_mode');
    this.uShowShadingLoc = gl.getUniformLocation(program, 'u_show_shading');
    this.uShowRipplesLoc = gl.getUniformLocation(program, 'u_show_ripples');
    this.uShallowsWidthLoc = gl.getUniformLocation(program, 'u_shallows_width');
    this.uElevationTexLoc = gl.getUniformLocation(program, 'u_elevation_tex');
  }

  private initGeometry() {
    const gl = this.gl!;
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const aPosLoc = gl.getAttribLocation(this.program!, 'a_position');
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  /**
   * Upload elevation grid
   */
  updateGridTextures(
    elevationGrid: Float32Array,
    cols: number,
    rows: number
  ) {
    const gl = this.gl;
    if (!gl) return;

    const totalCells = cols * rows;

    // Elevation texture
    if (!this.elevationTexture) {
      this.elevationTexture = gl.createTexture();
    }
    gl.bindTexture(gl.TEXTURE_2D, this.elevationTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    if (!this.byteElev || this.byteElev.length !== totalCells) {
      this.byteElev = new Uint8Array(totalCells);
    }
    for (let i = 0; i < totalCells; i++) {
      this.byteElev[i] = Math.max(0, Math.min(255, Math.round(elevationGrid[i] * 2.55)));
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cols, rows, 0, gl.RED, gl.UNSIGNED_BYTE, this.byteElev);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.currentCols = cols;
    this.currentRows = rows;
  }

  /**
   * Fast dirty-rectangle upload for brush strokes (avoids copying entire grid)
   */
  updateElevationSubRegion(
    grid: Float32Array,
    cols: number,
    rows: number,
    minC: number,
    minR: number,
    maxC: number,
    maxR: number
  ) {
    const gl = this.gl;
    if (!gl || !this.elevationTexture || !this.byteElev || cols !== this.currentCols || rows !== this.currentRows) {
      this.updateGridTextures(grid, cols, rows);
      return;
    }

    const clampedMinC = Math.max(0, Math.min(cols - 1, minC));
    const clampedMaxC = Math.max(0, Math.min(cols - 1, maxC));
    const clampedMinR = Math.max(0, Math.min(rows - 1, minR));
    const clampedMaxR = Math.max(0, Math.min(rows - 1, maxR));

    const subW = clampedMaxC - clampedMinC + 1;
    const subH = clampedMaxR - clampedMinR + 1;
    if (subW <= 0 || subH <= 0) return;

    const subBuffer = new Uint8Array(subW * subH);
    let subIdx = 0;
    for (let r = clampedMinR; r <= clampedMaxR; r++) {
      const rowOffset = r * cols;
      for (let c = clampedMinC; c <= clampedMaxC; c++) {
        const val = Math.max(0, Math.min(255, Math.round(grid[rowOffset + c] * 2.55)));
        this.byteElev[rowOffset + c] = val;
        subBuffer[subIdx++] = val;
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, this.elevationTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      clampedMinC,
      clampedMinR,
      subW,
      subH,
      gl.RED,
      gl.UNSIGNED_BYTE,
      subBuffer
    );
  }

  /**
   * Render World Map or Regional Map
   */
  render(
    mapWidth: number,
    mapHeight: number,
    gridCols: number,
    gridRows: number,
    elevationGrid: Float32Array,
    seaLevel: number,
    viewport: Viewport,
    options: {
      viewMode: ViewMode;
      showShading: boolean;
      showRipples?: boolean;
    },
    dpr: number = 1.0
  ) {
    const gl = this.gl;
    if (!gl || !this.program || !this.quadVao) return;

    if (!this.elevationTexture || this.currentCols !== gridCols || this.currentRows !== gridRows) {
      this.updateGridTextures(elevationGrid, gridCols, gridRows);
    }

    const displayW = gl.canvas.width;
    const displayH = gl.canvas.height;

    gl.viewport(0, 0, displayW, displayH);
    gl.useProgram(this.program);

    gl.uniform2f(this.uResolutionLoc, displayW, displayH);
    gl.uniform2f(this.uWorldSizeLoc, mapWidth, mapHeight);
    gl.uniform2f(this.uGridSizeLoc, gridCols, gridRows);
    gl.uniform4f(
      this.uViewportLoc,
      viewport.x * dpr,
      viewport.y * dpr,
      viewport.zoom * dpr,
      seaLevel
    );

    const modeMap: Record<ViewMode, number> = {
      elevation: 0,
      landSea: 3,
      plates: 0,
    };
    gl.uniform1i(this.uViewModeLoc, modeMap[options.viewMode]);
    gl.uniform1f(this.uShowShadingLoc, options.showShading ? 1.0 : 0.0);
    gl.uniform1f(this.uShowRipplesLoc, options.showRipples !== false ? 1.0 : 0.0);
    gl.uniform1f(this.uShallowsWidthLoc, 3.2);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.elevationTexture);
    gl.uniform1i(this.uElevationTexLoc, 0);

    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    if (!gl) return;
    if (this.elevationTexture) gl.deleteTexture(this.elevationTexture);
    if (this.quadVao) gl.deleteVertexArray(this.quadVao);
    if (this.program) gl.deleteProgram(this.program);
  }
}
