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
uniform float u_texel_screen_px;

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

// Catmull-Rom cubic weights for Hermite spline with a = -0.5
vec4 catmullRomWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(
    -0.5 * t3 + t2 - 0.5 * t,
     1.5 * t3 - 2.5 * t2 + 1.0,
    -1.5 * t3 + 2.0 * t2 + 0.5 * t,
     0.5 * t3 - 0.5 * t2
  );
}

// Consistent elevation sampling:
// - Zoomed out (< 1.5 screen pixels per texel): fast single-tap bilinear with exact node alignment (n + 0.5) / size
// - Zoomed in (>= 1.5 screen pixels per texel): 4-tap bilinear Catmull-Rom bicubic with 2x2 neighborhood clamp
float sampleSmoothElev(vec2 uv) {
  // Node coordinates n in [0, u_grid_size - 1.0]
  vec2 n = uv * (u_grid_size - vec2(1.0));
  vec2 clampedN = clamp(n, vec2(0.0), u_grid_size - vec2(1.0));

  if (u_texel_screen_px < 1.5) {
    // Single bilinear tap: texCoord = (n + 0.5) / u_grid_size
    vec2 texUV = (clampedN + vec2(0.5)) / u_grid_size;
    return texture(u_elevation_tex, clamp(texUV, vec2(0.0), vec2(1.0))).r * 100.0;
  }

  vec2 i = floor(clampedN);
  vec2 f = clampedN - i;

  vec4 wx = catmullRomWeights(f.x);
  vec4 wy = catmullRomWeights(f.y);

  vec2 W0 = vec2(wx.x + wx.y, wy.x + wy.y);
  vec2 W1 = vec2(wx.z + wx.w, wy.z + wy.w);

  // Safe division to guard against zero weights
  vec2 safeW0 = mix(W0, vec2(1.0), lessThan(abs(W0), vec2(1e-6)));
  vec2 safeW1 = mix(W1, vec2(1.0), lessThan(abs(W1), vec2(1e-6)));

  vec2 offset0 = -vec2(wx.x, wy.x) / safeW0;
  vec2 offset1 = vec2(1.0) + vec2(wx.w, wy.w) / safeW1;

  vec2 pos0 = (i + offset0 + vec2(0.5)) / u_grid_size;
  vec2 pos1 = (i + offset1 + vec2(0.5)) / u_grid_size;

  pos0 = clamp(pos0, vec2(0.0), vec2(1.0));
  pos1 = clamp(pos1, vec2(0.0), vec2(1.0));

  float s00 = texture(u_elevation_tex, vec2(pos0.x, pos0.y)).r * 100.0;
  float s10 = texture(u_elevation_tex, vec2(pos1.x, pos0.y)).r * 100.0;
  float s01 = texture(u_elevation_tex, vec2(pos0.x, pos1.y)).r * 100.0;
  float s11 = texture(u_elevation_tex, vec2(pos1.x, pos1.y)).r * 100.0;

  float row0 = W0.x * s00 + W1.x * s10;
  float row1 = W0.x * s01 + W1.x * s11;
  float elev = W0.y * row0 + W1.y * row1;

  // Clamp to surrounding 2x2 grid points to prevent overshoot/undershoot ringing
  ivec2 iCoord0 = ivec2(i);
  ivec2 iCoord1 = ivec2(min(i + vec2(1.0), u_grid_size - vec2(1.0)));
  float v00 = texelFetch(u_elevation_tex, iCoord0, 0).r * 100.0;
  float v10 = texelFetch(u_elevation_tex, ivec2(iCoord1.x, iCoord0.y), 0).r * 100.0;
  float v01 = texelFetch(u_elevation_tex, ivec2(iCoord0.x, iCoord1.y), 0).r * 100.0;
  float v11 = texelFetch(u_elevation_tex, iCoord1, 0).r * 100.0;

  float minVal = min(min(v00, v10), min(v01, v11));
  float maxVal = max(max(v00, v10), max(v01, v11));

  return clamp(elev, minVal, maxVal);
}

// Antique Parchment & Portolan Palette
// Matches authentic fantasy cartography (reference antique map style):
// Teal sea-green ocean, clean shallow coastal aura, crisp dark ink coastline, warm ochre halo, parchment planes
vec3 getParchmentColor(float elev, float seaLevel, vec2 worldPos, float pixelDistToCoast, float slope) {
  // Ocean colors
  if (elev < seaLevel) {
    float depth = (seaLevel - elev);

    // Antique Fantasy Teal / Sea-Green Ocean Palette
    vec3 deepSea      = vec3(0.10, 0.23, 0.27); // #1a3b45 deep sea-green
    vec3 midSea       = vec3(0.17, 0.36, 0.40); // #2b5c66 rich ocean teal
    vec3 coastalSea   = vec3(0.25, 0.50, 0.53); // #408087 sea-green shallows
    vec3 paleShallow  = vec3(0.48, 0.77, 0.77); // #7bc5c5 luminous turquoise shallows
    vec3 crestWhite   = vec3(0.85, 0.95, 0.95); // pale froth ripple crest

    float seaT = clamp(elev / seaLevel, 0.0, 1.0);
    vec3 waterCol;
    if (seaT < 0.5) {
      waterCol = mix(deepSea, midSea, seaT / 0.5);
    } else {
      waterCol = mix(midSea, coastalSea, (seaT - 0.5) / 0.5);
    }

    // Gentle turquoise coastal shallows aura (海側の淡い水色の浅瀬の帯 - 自然な単一グラデーション)
    float shallowsFactor = smoothstep(12.0, 1.0, pixelDistToCoast);
    waterCol = mix(waterCol, paleShallow, shallowsFactor * 0.55);

    // Single subtle, clean coastal wave echo (穏やかで控えめな単一波紋)
    if (u_show_ripples > 0.5) {
      float r1 = smoothstep(1.3, 0.0, abs(pixelDistToCoast - 5.0)) * 0.32;
      waterCol = mix(waterCol, crestWhite, r1);
    }

    // Crisp ink coastline edge on ocean side (海岸線エッジにクッキリとした暗色インクのアウトライン)
    if (pixelDistToCoast < 1.8) {
      vec3 inkDark = vec3(0.12, 0.10, 0.08); // dark drawing ink
      float inkAlpha = smoothstep(1.8, 0.1, pixelDistToCoast) * 0.95;
      waterCol = mix(waterCol, inkDark, inkAlpha);
    }

    return waterCol;
  }

  // Land (seaLevel to 100)
  float landH = elev - seaLevel;

  // Parchment color planes:
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

  // Antique warm ochre/sepia vignette halo bordering the coast inside the land (reference style)
  if (pixelDistToCoast < 8.0) {
    vec3 coastalSepia = vec3(0.70, 0.56, 0.36); // #b38f5c warm antique ochre/sepia border
    float haloAlpha = smoothstep(8.0, 1.2, pixelDistToCoast) * 0.50;
    landCol = mix(landCol, coastalSepia, haloAlpha);
  }

  // Crisp ink coastline edge on land side
  if (pixelDistToCoast < 1.8) {
    vec3 inkDark = vec3(0.12, 0.10, 0.08);
    float inkAlpha = smoothstep(1.8, 0.1, pixelDistToCoast) * 0.95;
    landCol = mix(landCol, inkDark, inkAlpha);
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
  // Elevation sampled directly from the grid data without synthetic procedural noise
  float elev = clamp(sampleSmoothElev(uv), 0.0, 100.0);
  float seaLevel = u_viewport.w;

  // Accurate screen-space gradient for distance to isocontour (seaLevel)
  vec2 dF = vec2(dFdx(elev), dFdy(elev));
  float gradLen = length(dF);
  float pixelDistToCoast = abs(elev - seaLevel) / max(0.0001, gradLen);

  // Instantaneous hardware screen-space derivatives for terrain slope and hillshading
  float slopeX = dF.x * 1.5;
  float slopeY = dF.y * 1.5;
  float slope = gradLen * 1.5;

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
  } else if (u_view_mode == 3) {
    // 3: Land / Sea mask with crisp ink coastline
    vec3 inkDark = vec3(0.12, 0.10, 0.08);
    vec3 baseCol = elev <= seaLevel ? vec3(0.18, 0.35, 0.45) : vec3(0.72, 0.68, 0.52);
    if (pixelDistToCoast < 1.8) {
      float inkAlpha = smoothstep(1.8, 0.1, pixelDistToCoast) * 0.95;
      col = mix(baseCol, inkDark, inkAlpha);
    } else {
      col = baseCol;
    }
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
  private uTexelScreenPxLoc: WebGLUniformLocation | null = null;

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
    this.uTexelScreenPxLoc = gl.getUniformLocation(program, 'u_texel_screen_px');
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

    const texelScreenPx = viewport.zoom * dpr * (mapWidth / gridCols);
    gl.uniform1f(this.uTexelScreenPxLoc, texelScreenPx);

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
