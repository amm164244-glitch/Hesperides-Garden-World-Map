import { BrushSettings, HistoryRecord, MapCell, MapData } from '../types/map';
import {
  extractClosedContours,
  smoothPolygonChaikin,
} from './marchingSquares';
import { invalidateRenderCache } from './mapRenderer';

export class SpatialIndex {
  private cellSize: number;
  private grid: Map<string, number[]> = new Map();

  constructor(cells: MapCell[], cellSize: number = 60) {
    this.cellSize = cellSize;
    this.rebuild(cells);
  }

  rebuild(cells: MapCell[]) {
    this.grid.clear();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const gx = Math.floor(c.x / this.cellSize);
      const gy = Math.floor(c.y / this.cellSize);
      const key = `${gx},${gy}`;
      let list = this.grid.get(key);
      if (!list) {
        list = [];
        this.grid.set(key, list);
      }
      list.push(c.id);
    }
  }

  findNearby(x: number, y: number, radius: number): number[] {
    const minGx = Math.floor((x - radius) / this.cellSize);
    const maxGx = Math.floor((x + radius) / this.cellSize);
    const minGy = Math.floor((y - radius) / this.cellSize);
    const maxGy = Math.floor((y + radius) / this.cellSize);

    const result: number[] = [];
    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gy = minGy; gy <= maxGy; gy++) {
        const list = this.grid.get(`${gx},${gy}`);
        if (list) {
          for (const id of list) {
            result.push(id);
          }
        }
      }
    }
    return result;
  }
}

/**
 * Applies brush modifications with Gaussian falloff and synchronizes the elevation grid
 * in the dirty bounding box without lagging even at 300,000 cells.
 */
export function applyBrush(
  mapData: MapData,
  spatialIndex: SpatialIndex,
  targetX: number,
  targetY: number,
  settings: BrushSettings,
  dragLine?: { prevX: number; prevY: number }
): { cellId: number; prevElevation: number; newElevation: number }[] {
  const radius = settings.radius;
  const strength = settings.strength;
  const seaLevel = mapData.seaLevel;

  // Spatial search for cells in brush radius
  const candidateIds = spatialIndex.findNearby(targetX, targetY, radius);
  const uniqueIds = Array.from(new Set(candidateIds));

  const changes: { cellId: number; prevElevation: number; newElevation: number }[] = [];

  // Gaussian falloff parameter (2.5 sigma fits nicely in brush radius)
  const sigma = radius / 2.3;
  const twoSigmaSq = 2 * sigma * sigma;

  for (const id of uniqueIds) {
    const cell = mapData.cells[id];
    let dist = Math.hypot(cell.x - targetX, cell.y - targetY);

    // Line projection for mountain ridge dragging
    if (dragLine && settings.mode === 'mountain') {
      const dx = targetX - dragLine.prevX;
      const dy = targetY - dragLine.prevY;
      const len2 = dx * dx + dy * dy;
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, ((cell.x - dragLine.prevX) * dx + (cell.y - dragLine.prevY) * dy) / len2));
        const projX = dragLine.prevX + t * dx;
        const projY = dragLine.prevY + t * dy;
        dist = Math.hypot(cell.x - projX, cell.y - projY);
      }
    }

    if (dist > radius) continue;

    // Smooth Gaussian falloff curve: exp(-d^2 / 2sigma^2)
    const falloff = Math.exp(-(dist * dist) / twoSigmaSq);
    const prevElevation = cell.elevation;
    let newElevation = prevElevation;

    switch (settings.mode) {
      case 'elevate': {
        const delta = strength * 7.5 * falloff;
        newElevation = Math.min(100, prevElevation + delta);
        break;
      }

      case 'depress': {
        const delta = strength * 7.5 * falloff;
        newElevation = Math.max(0, prevElevation - delta);
        break;
      }

      case 'smooth': {
        let sum = prevElevation;
        let count = 1;
        for (const nid of cell.neighbors) {
          sum += mapData.cells[nid].elevation;
          count++;
        }
        const avg = sum / count;
        newElevation = prevElevation + (avg - prevElevation) * strength * falloff * 0.8;
        break;
      }

      case 'flatten': {
        const target = settings.flattenTarget;
        newElevation = prevElevation + (target - prevElevation) * strength * falloff * 0.8;
        break;
      }

      case 'makeLand': {
        const targetElevation = Math.max(prevElevation, seaLevel + 6 + falloff * 14);
        newElevation = prevElevation + (targetElevation - prevElevation) * strength * falloff;
        break;
      }

      case 'makeSea': {
        const targetElevation = Math.min(prevElevation, seaLevel - 8 - falloff * 14);
        newElevation = prevElevation + (targetElevation - prevElevation) * strength * falloff;
        break;
      }

      case 'mountain': {
        const ridgeElevation = 85 + 12 * falloff;
        const delta = (ridgeElevation - prevElevation) * (falloff ** 1.3) * strength;
        if (delta > 0) {
          newElevation = Math.min(100, prevElevation + delta);
        }
        break;
      }

      default:
        break;
    }

    if (Math.abs(newElevation - prevElevation) > 0.005) {
      cell.elevation = newElevation;
      cell.isWater = newElevation <= seaLevel;

      changes.push({
        cellId: id,
        prevElevation,
        newElevation,
      });
    }
  }

  // Synchronize modified cells with high-res elevationGrid in the dirty bounding box
  if (changes.length > 0 && mapData.elevationGrid && mapData.gridCols && mapData.gridRows) {
    const cols = mapData.gridCols;
    const rows = mapData.gridRows;
    const cellW = mapData.width / (cols - 1);
    const cellH = mapData.height / (rows - 1);

    const minC = Math.max(0, Math.floor((targetX - radius) / cellW));
    const maxC = Math.min(cols - 1, Math.ceil((targetX + radius) / cellW));
    const minR = Math.max(0, Math.floor((targetY - radius) / cellH));
    const maxR = Math.min(rows - 1, Math.ceil((targetY + radius) / cellH));

    for (let r = minR; r <= maxR; r++) {
      const gy = r * cellH;
      for (let c = minC; c <= maxC; c++) {
        const gx = c * cellW;
        const d = Math.hypot(gx - targetX, gy - targetY);
        if (d <= radius) {
          const gFalloff = Math.exp(-(d * d) / twoSigmaSq);
          const idx = r * cols + c;
          const currG = mapData.elevationGrid[idx];

          if (settings.mode === 'elevate') {
            mapData.elevationGrid[idx] = Math.min(100, currG + strength * 7.5 * gFalloff);
          } else if (settings.mode === 'depress') {
            mapData.elevationGrid[idx] = Math.max(0, currG - strength * 7.5 * gFalloff);
          } else if (settings.mode === 'mountain') {
            const rElev = 85 + 12 * gFalloff;
            const delta = (rElev - currG) * (gFalloff ** 1.3) * strength;
            if (delta > 0) mapData.elevationGrid[idx] = Math.min(100, currG + delta);
          } else if (settings.mode === 'makeLand') {
            const target = Math.max(currG, seaLevel + 6 + gFalloff * 14);
            mapData.elevationGrid[idx] = currG + (target - currG) * strength * gFalloff;
          } else if (settings.mode === 'makeSea') {
            const target = Math.min(currG, seaLevel - 8 - gFalloff * 14);
            mapData.elevationGrid[idx] = currG + (target - currG) * strength * gFalloff;
          } else if (settings.mode === 'flatten') {
            mapData.elevationGrid[idx] = currG + (settings.flattenTarget - currG) * strength * gFalloff * 0.8;
          }
        }
      }
    }

    invalidateRenderCache();
  }

  return changes;
}

/**
 * Directly applies Gaussian falloff brush to any high-res Float32Array elevation grid.
 * Used for both the World Map and Hierarchical Regional Maps.
 */
export function applyBrushToElevationGrid(
  grid: Float32Array,
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
  targetX: number,
  targetY: number,
  settings: BrushSettings,
  seaLevel: number = 35.0,
  dragLine?: { prevX: number; prevY: number }
): { gridIndex: number; prevElevation: number; newElevation: number }[] {
  const radius = settings.radius;
  const strength = settings.strength;
  const sigma = radius / 2.3;
  const twoSigmaSq = 2 * sigma * sigma;

  const cellW = mapWidth / (cols - 1);
  const cellH = mapHeight / (rows - 1);

  const minC = Math.max(0, Math.floor((targetX - radius) / cellW));
  const maxC = Math.min(cols - 1, Math.ceil((targetX + radius) / cellW));
  const minR = Math.max(0, Math.floor((targetY - radius) / cellH));
  const maxR = Math.min(rows - 1, Math.ceil((targetY + radius) / cellH));

  const changes: { gridIndex: number; prevElevation: number; newElevation: number }[] = [];

  for (let r = minR; r <= maxR; r++) {
    const gy = r * cellH;
    for (let c = minC; c <= maxC; c++) {
      const gx = c * cellW;
      let d = Math.hypot(gx - targetX, gy - targetY);

      if (dragLine && settings.mode === 'mountain') {
        const dx = targetX - dragLine.prevX;
        const dy = targetY - dragLine.prevY;
        const len2 = dx * dx + dy * dy;
        if (len2 > 0) {
          const t = Math.max(0, Math.min(1, ((gx - dragLine.prevX) * dx + (gy - dragLine.prevY) * dy) / len2));
          const projX = dragLine.prevX + t * dx;
          const projY = dragLine.prevY + t * dy;
          d = Math.hypot(gx - projX, gy - projY);
        }
      }

      if (d > radius) continue;

      const gFalloff = Math.exp(-(d * d) / twoSigmaSq);
      const idx = r * cols + c;
      const currG = grid[idx];
      let newElev = currG;

      switch (settings.mode) {
        case 'elevate':
          newElev = Math.min(100, currG + strength * 8.0 * gFalloff);
          break;
        case 'depress':
          newElev = Math.max(0, currG - strength * 8.0 * gFalloff);
          break;
        case 'mountain': {
          const rElev = 85 + 14 * gFalloff;
          const delta = (rElev - currG) * (gFalloff ** 1.3) * strength;
          if (delta > 0) newElev = Math.min(100, currG + delta);
          break;
        }
        case 'makeLand': {
          const target = Math.max(currG, seaLevel + 6 + gFalloff * 14);
          newElev = currG + (target - currG) * strength * gFalloff;
          break;
        }
        case 'makeSea': {
          const target = Math.min(currG, seaLevel - 8 - gFalloff * 14);
          newElev = currG + (target - currG) * strength * gFalloff;
          break;
        }
        case 'flatten':
          newElev = currG + (settings.flattenTarget - currG) * strength * gFalloff * 0.8;
          break;
        case 'smooth': {
          let sum = currG;
          let count = 1;
          if (c > 0) { sum += grid[r * cols + c - 1]; count++; }
          if (c < cols - 1) { sum += grid[r * cols + c + 1]; count++; }
          if (r > 0) { sum += grid[(r - 1) * cols + c]; count++; }
          if (r < rows - 1) { sum += grid[(r + 1) * cols + c]; count++; }
          const avg = sum / count;
          newElev = currG + (avg - currG) * strength * gFalloff * 0.8;
          break;
        }
      }

      if (Math.abs(newElev - currG) > 0.005) {
        grid[idx] = newElev;
        changes.push({
          gridIndex: idx,
          prevElevation: currG,
          newElevation: newElev,
        });
      }
    }
  }

  (changes as any).bounds = { minC, minR, maxC, maxR };
  return changes;
}

/**
 * Re-evaluates Ocean vs Lake classification and re-extracts Marching Squares coastlines after stroke completes.
 */
export function refreshWaterBodies(mapData: MapData) {
  const cellCount = mapData.cells.length;
  const width = mapData.width;
  const height = mapData.height;
  const visited = new Uint8Array(cellCount);
  const queue: number[] = [];

  for (let i = 0; i < cellCount; i++) {
    const c = mapData.cells[i];
    if (
      c.isWater &&
      (c.x <= width * 0.03 ||
        c.x >= width * 0.97 ||
        c.y <= height * 0.03 ||
        c.y >= height * 0.97)
    ) {
      visited[i] = 1;
      c.isOcean = true;
      c.isLake = false;
      queue.push(i);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const currentId = queue[head++];
    const neighbors = mapData.cells[currentId].neighbors;
    for (const nid of neighbors) {
      if (!visited[nid] && mapData.cells[nid].isWater) {
        visited[nid] = 1;
        mapData.cells[nid].isOcean = true;
        mapData.cells[nid].isLake = false;
        queue.push(nid);
      }
    }
  }

  for (let i = 0; i < cellCount; i++) {
    const c = mapData.cells[i];
    if (c.isWater) {
      if (!visited[i]) {
        c.isLake = true;
        c.isOcean = false;
      }
    } else {
      c.isLake = false;
      c.isOcean = false;
    }
  }

  // Recompute Marching Squares closed coastlines
  if (mapData.elevationGrid && mapData.gridCols && mapData.gridRows) {
    const minArea = mapData.config.minIslandArea ?? 45;
    const rawPolygons = extractClosedContours(
      mapData.elevationGrid,
      mapData.gridCols,
      mapData.gridRows,
      width,
      height,
      mapData.seaLevel,
      minArea
    );
    mapData.coastlines = rawPolygons.map((poly) => {
      const sm = smoothPolygonChaikin(poly, 2);
      return sm.map((p) => [p.x, p.y]);
    });

    const ripplePolys = extractClosedContours(
      mapData.elevationGrid,
      mapData.gridCols,
      mapData.gridRows,
      width,
      height,
      mapData.seaLevel - 1.5,
      minArea * 1.2
    );
    mapData.ripples = ripplePolys.map((poly) => {
      const sm = smoothPolygonChaikin(poly, 2);
      return sm.map((p) => [p.x, p.y]);
    });
  }

  invalidateRenderCache();
}

/**
 * Rollback history for Undo/Redo
 */
export function applyHistoryRollback(
  mapData: MapData,
  record: HistoryRecord,
  isUndo: boolean
) {
  if (record.changes) {
    for (const change of record.changes) {
      const targetElevation = isUndo ? change.prevElevation : change.newElevation;
      const id = change.cellId ?? change.id;
      if (id !== undefined && mapData.cells[id]) {
        const cell = mapData.cells[id];
        cell.elevation = targetElevation;
        cell.isWater = targetElevation <= mapData.seaLevel;
      }
    }
  }

  // Also update grid
  if (record.changes && mapData.elevationGrid && mapData.gridCols && mapData.gridRows) {
    const cols = mapData.gridCols;
    const rows = mapData.gridRows;
    const cellW = mapData.width / (cols - 1);
    const cellH = mapData.height / (rows - 1);

    for (const change of record.changes) {
      const targetElevation = isUndo ? change.prevElevation : change.newElevation;
      if (change.gridIndex !== undefined) {
        mapData.elevationGrid[change.gridIndex] = targetElevation;
      } else {
        const id = change.cellId ?? change.id;
        if (id !== undefined && mapData.cells[id]) {
          const cell = mapData.cells[id];
          const gc = Math.round(cell.x / cellW);
          const gr = Math.round(cell.y / cellH);
          if (gc >= 0 && gc < cols && gr >= 0 && gr < rows) {
            mapData.elevationGrid[gr * cols + gc] = targetElevation;
          }
        }
      }
    }
  }

  refreshWaterBodies(mapData);
}
