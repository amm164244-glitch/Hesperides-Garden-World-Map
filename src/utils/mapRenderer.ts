import { MapCell, MapData, ViewMode, Viewport } from '../types/map';

// Interpolate between two RGB hex colors
function lerpColor(c1: string, c2: string, t: number): [number, number, number] {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);

  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);

  const clampedT = Math.max(0, Math.min(1, t));
  const r = Math.round(r1 + (r2 - r1) * clampedT);
  const g = Math.round(g1 + (g2 - g1) * clampedT);
  const b = Math.round(b1 + (b2 - b1) * clampedT);

  return [r, g, b];
}

/**
 * High-fidelity medieval fantasy topographic palette
 * Smooth continuous transitions from sandy shores to emerald plains, golden hills, brown crags, and snowy peaks.
 */
export function getElevationRgb(elevation: number, seaLevel: number): [number, number, number] {
  if (elevation <= seaLevel) {
    const t = Math.max(0, Math.min(1, elevation / seaLevel));
    if (t < 0.4) {
      return lerpColor('#0b1d30', '#133352', t / 0.4);
    } else if (t < 0.85) {
      return lerpColor('#133352', '#23597d', (t - 0.4) / 0.45);
    } else {
      return lerpColor('#23597d', '#3e849c', (t - 0.85) / 0.15);
    }
  }

  // Land (seaLevel to 100)
  const landT = (elevation - seaLevel) / (100 - seaLevel);

  // Smooth continuous sand beach (海面 〜 海面+3.25の範囲)
  if (landT < 0.05) {
    return lerpColor('#dfd1a4', '#d2bd85', landT / 0.05);
  } else if (landT < 0.09) {
    // Transition from beach to fertile meadow
    return lerpColor('#d2bd85', '#7ca65c', (landT - 0.05) / 0.04);
  } else if (landT < 0.28) {
    // Lowland plains / Green forests
    return lerpColor('#7ca65c', '#89ae61', (landT - 0.09) / 0.19);
  } else if (landT < 0.52) {
    // Highland / Foothills
    return lerpColor('#89ae61', '#ada05f', (landT - 0.28) / 0.24);
  } else if (landT < 0.74) {
    // Rocky mountain slopes
    return lerpColor('#9e7a53', '#7a5b3f', (landT - 0.52) / 0.22);
  } else if (landT < 0.88) {
    // High mountain peaks / Slate
    return lerpColor('#7a5b3f', '#584c47', (landT - 0.74) / 0.14);
  } else {
    // Snow caps & eternal glaciers
    return lerpColor('#584c47', '#f4f7fb', (landT - 0.88) / 0.12);
  }
}

export function getTemperatureRgb(temp: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, temp / 100));
  if (t < 0.25) return lerpColor('#2a4365', '#3182ce', t / 0.25);
  if (t < 0.5) return lerpColor('#3182ce', '#38a169', (t - 0.25) / 0.25);
  if (t < 0.75) return lerpColor('#38a169', '#d69e2e', (t - 0.5) / 0.25);
  return lerpColor('#d69e2e', '#e53e3e', (t - 0.75) / 0.25);
}

export function getMoistureRgb(moisture: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, moisture / 100));
  if (t < 0.25) return lerpColor('#ecc94b', '#d69e2e', t / 0.25);
  if (t < 0.6) return lerpColor('#d69e2e', '#48bb78', (t - 0.25) / 0.35);
  return lerpColor('#48bb78', '#2b6cb0', (t - 0.6) / 0.4);
}

export interface RenderOptions {
  viewMode: ViewMode;
  showMesh: boolean;
  showShading: boolean;
  showRipples: boolean;
  hoveredCellId: number | null;
  selectedCellId: number | null;
  brushCursor?: { x: number; y: number; radius: number; active: boolean };
}

// Cached raster buffers
let cachedSeaCanvas: HTMLCanvasElement | null = null;
let cachedLandCanvas: HTMLCanvasElement | null = null;
let cachedDataKey: string = '';

/**
 * Unified Path Terrain Renderer
 * Guarantees 100% mathematical alignment between land fill and coastline stroke
 * by clipping the land fill and stroking the exact same vector contour paths.
 */
export function renderMap(
  canvas: HTMLCanvasElement,
  mapData: MapData,
  viewport: Viewport,
  options: RenderOptions
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width: viewW, height: viewH } = canvas;

  // Clear canvas
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#08111c';
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.restore();

  // Apply viewport zoom & pan
  ctx.save();
  ctx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y);

  // Viewport culling bounding box in world coordinates
  const visMinX = Math.max(0, -viewport.x / viewport.zoom - 20);
  const visMaxX = Math.min(mapData.width, (viewW - viewport.x) / viewport.zoom + 20);
  const visMinY = Math.max(0, -viewport.y / viewport.zoom - 20);
  const visMaxY = Math.min(mapData.height, (viewH - viewport.y) / viewport.zoom + 20);

  const cols = mapData.gridCols || 350;
  const rows = mapData.gridRows || 225;
  const grid = mapData.elevationGrid;
  const seaLevel = mapData.seaLevel;

  // Build offscreen rasters if needed
  if (grid) {
    const dataKey = `${mapData.seed}_${mapData.cells[0]?.elevation}_${options.viewMode}_${options.showShading}`;

    if (
      !cachedSeaCanvas ||
      !cachedLandCanvas ||
      cachedDataKey !== dataKey ||
      cachedSeaCanvas.width !== cols ||
      cachedSeaCanvas.height !== rows
    ) {
      cachedSeaCanvas = document.createElement('canvas');
      cachedSeaCanvas.width = cols;
      cachedSeaCanvas.height = rows;

      cachedLandCanvas = document.createElement('canvas');
      cachedLandCanvas.width = cols;
      cachedLandCanvas.height = rows;

      const seaCtx = cachedSeaCanvas.getContext('2d');
      const landCtx = cachedLandCanvas.getContext('2d');

      if (seaCtx && landCtx) {
        const seaImgData = seaCtx.createImageData(cols, rows);
        const landImgData = landCtx.createImageData(cols, rows);
        const seaData = seaImgData.data;
        const landData = landImgData.data;

        // Top-left light vector (North-West: 315 deg, dx=-0.7071, dy=-0.7071)
        const lx = -0.7071;
        const ly = -0.7071;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const elev = grid[idx];

            let [red, green, blue] = [0, 0, 0];
            if (options.viewMode === 'elevation') {
              [red, green, blue] = getElevationRgb(elev, seaLevel);
            } else if (options.viewMode === 'temperature') {
              const latNorm = r / rows;
              const lapse = Math.max(0, elev - seaLevel) * 0.65;
              const temp = Math.max(0, Math.min(100, Math.round(20 + latNorm * 65 - lapse)));
              [red, green, blue] = getTemperatureRgb(temp);
            } else if (options.viewMode === 'moisture') {
              const m = elev <= seaLevel ? 95 : Math.max(10, Math.min(90, Math.round(55 - (elev - seaLevel) * 0.4)));
              [red, green, blue] = getMoistureRgb(m);
            } else if (options.viewMode === 'landSea') {
              [red, green, blue] = elev <= seaLevel ? [32, 74, 110] : [115, 158, 86];
            }

            // Top-left hillshading
            if (options.showShading && c > 0 && c < cols - 1 && r > 0 && r < rows - 1) {
              const dzX = (grid[r * cols + (c + 1)] - grid[r * cols + (c - 1)]) * 0.5;
              const dzY = (grid[(r + 1) * cols + c] - grid[(r - 1) * cols + c]) * 0.5;
              const dot = (dzX * lx + dzY * ly) * (elev > seaLevel ? 0.08 : 0.025);

              if (dot > 0) {
                const factor = Math.min(0.35, dot);
                red = Math.min(255, red + Math.round(factor * (255 - red)));
                green = Math.min(255, green + Math.round(factor * (255 - green)));
                blue = Math.min(255, blue + Math.round(factor * (255 - blue)));
              } else {
                const factor = Math.min(0.4, Math.abs(dot));
                red = Math.max(0, red - Math.round(factor * red));
                green = Math.max(0, green - Math.round(factor * green));
                blue = Math.max(0, blue - Math.round(factor * blue));
              }
            }

            const pIdx = idx * 4;
            // Sea buffer has full ocean field
            seaData[pIdx] = red;
            seaData[pIdx + 1] = green;
            seaData[pIdx + 2] = blue;
            seaData[pIdx + 3] = 255;

            // Land buffer has full terrain field
            landData[pIdx] = red;
            landData[pIdx + 1] = green;
            landData[pIdx + 2] = blue;
            landData[pIdx + 3] = 255;
          }
        }

        seaCtx.putImageData(seaImgData, 0, 0);
        landCtx.putImageData(landImgData, 0, 0);
        cachedDataKey = dataKey;
      }
    }
  }

  // 1. Draw Ocean Background
  if (cachedSeaCanvas) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cachedSeaCanvas, 0, 0, mapData.width, mapData.height);
  }

  // 2. Draw Subtle Concentric Ocean Ripples (波紋)
  if (options.showRipples && mapData.ripples && mapData.ripples.length > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(70, 135, 175, 0.35)';
    ctx.lineWidth = 1.2 / Math.min(viewport.zoom, 2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const poly of mapData.ripples) {
      if (poly.length < 3) continue;
      // Viewport culling
      if (
        poly.every(
          (p: [number, number]) =>
            p[0] < visMinX || p[0] > visMaxX || p[1] < visMinY || p[1] > visMaxY
        )
      ) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // 3. UNIFIED LAND RENDERING: Draw Land Fill Clipped to EXACT Path + Stroke Boundary
  if (mapData.coastlines && mapData.coastlines.length > 0 && cachedLandCanvas) {
    for (const poly of mapData.coastlines) {
      if (poly.length < 3) continue;

      // Viewport culling
      if (
        poly.every(
          (p: [number, number]) =>
            p[0] < visMinX || p[0] > visMaxX || p[1] < visMinY || p[1] > visMaxY
        )
      ) {
        continue;
      }

      // 3a. Construct Land Path
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
      }
      ctx.closePath();

      // Clip specifically to this land path
      ctx.clip();

      // Draw the continuous land raster inside the exact path (smooth beach sand + plains + mountains)
      ctx.drawImage(cachedLandCanvas, 0, 0, mapData.width, mapData.height);
      ctx.restore();

      // 3b. Stroke the EXACT SAME path with crisp dark ink coastline
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
      }
      ctx.closePath();

      ctx.strokeStyle = '#18293a';
      ctx.lineWidth = 1.3 / Math.min(viewport.zoom, 2);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  // 4. Optional Voronoi Cell Wireframe
  if (options.showMesh) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 0.5 / viewport.zoom;
    const cells = mapData.cells;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.x < visMinX || cell.x > visMaxX || cell.y < visMinY || cell.y > visMaxY) {
        continue;
      }
      const poly = cell.polygon;
      if (poly && poly.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let p = 1; p < poly.length; p++) {
          ctx.lineTo(poly[p][0], poly[p][1]);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 5. Hovered Cell Highlight
  if (options.hoveredCellId !== null && mapData.cells[options.hoveredCellId]) {
    const hCell = mapData.cells[options.hoveredCellId];
    const poly = hCell.polygon;
    if (poly && poly.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let p = 1; p < poly.length; p++) {
        ctx.lineTo(poly[p][0], poly[p][1]);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 230, 100, 0.4)';
      ctx.fill();
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 2.2 / viewport.zoom;
      ctx.stroke();
    }
  }

  // 6. Brush Cursor
  if (options.brushCursor) {
    const { x, y, radius, active } = options.brushCursor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = active ? 'rgba(255, 75, 43, 0.95)' : 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = (active ? 2.5 : 1.5) / viewport.zoom;
    ctx.stroke();

    ctx.fillStyle = active ? 'rgba(255, 75, 43, 0.18)' : 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
  }

  // 7. Outer Border
  ctx.strokeStyle = '#5a4632';
  ctx.lineWidth = 3 / viewport.zoom;
  ctx.strokeRect(0, 0, mapData.width, mapData.height);

  ctx.restore();
}

/**
 * Invalidates the cached offscreen canvas so modifications immediately re-render
 */
export function invalidateRenderCache() {
  cachedDataKey = '';
}
