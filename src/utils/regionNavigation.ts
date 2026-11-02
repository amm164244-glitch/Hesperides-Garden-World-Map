import { RegionalBounds, RegionalMapData, Viewport } from '../types/map';

export const ENTER_MIN_ZOOM = 0.5;
export const EXIT_MAX_ZOOM = 0.3;
export const AUTO_ENTER_MIN_COVERAGE = 0.3;

/**
 * Checks if a child region's bounds aspect ratio matches its own width:height
 * within a 1% error tolerance.
 */
export function isUniformChild(
  child: RegionalMapData,
  _parent?: { width: number; height: number }
): boolean {
  if (!child.bounds) return false;
  const boundsW = child.bounds.maxX - child.bounds.minX;
  const boundsH = child.bounds.maxY - child.bounds.minY;
  if (boundsW <= 0 || boundsH <= 0 || child.width <= 0 || child.height <= 0) {
    return false;
  }
  const boundsRatio = boundsW / boundsH;
  const childRatio = child.width / child.height;
  return Math.abs(boundsRatio - childRatio) / childRatio <= 0.01;
}

/**
 * Transforms parent viewport to child viewport so that the geographical
 * content on screen remains at the exact same screen position and visual size.
 */
export function parentToChildViewport(vp: Viewport, child: RegionalMapData): Viewport {
  const k = (child.bounds.maxX - child.bounds.minX) / child.width;
  const zoom = vp.zoom * k;
  const x = vp.x + vp.zoom * child.bounds.minX;
  const y = vp.y + vp.zoom * child.bounds.minY;
  return { x, y, zoom };
}

/**
 * Transforms child viewport back to parent viewport so that the geographical
 * content on screen remains at the exact same screen position and visual size.
 */
export function childToParentViewport(vp: Viewport, child: RegionalMapData): Viewport {
  const k = (child.bounds.maxX - child.bounds.minX) / child.width;
  const zoom = vp.zoom / k;
  const x = vp.x - zoom * child.bounds.minX;
  const y = vp.y - zoom * child.bounds.minY;
  return { x, y, zoom };
}

/**
 * Computes the visible rectangle in map coordinates given the viewport and screen dimensions.
 */
export function getVisibleRect(
  vp: Viewport,
  screenW: number,
  screenH: number
): RegionalBounds {
  return {
    minX: -vp.x / vp.zoom,
    minY: -vp.y / vp.zoom,
    maxX: (screenW - vp.x) / vp.zoom,
    maxY: (screenH - vp.y) / vp.zoom,
  };
}

/**
 * Finds a qualifying child region to automatically zoom into.
 * Criteria:
 * - Child has uniform aspect ratio with its own width:height (within 1%).
 * - Screen center point is within the child's 10%-shrunk bounds.
 * - Viewport zoom transformed to child exceeds ENTER_MIN_ZOOM (0.5).
 * - Proportion of parent's visible screen overlapping child's bounds >= AUTO_ENTER_MIN_COVERAGE (0.3).
 * If multiple children qualify, selects the one with the smallest bounds area.
 */
export function findChildToEnter(
  vp: Viewport,
  children: RegionalMapData[],
  _parent?: { width: number; height: number },
  screenW: number = window.innerWidth,
  screenH: number = window.innerHeight
): RegionalMapData | null {
  const uniformChildren = children.filter((c) => isUniformChild(c));
  if (uniformChildren.length === 0) return null;

  const centerX = (screenW / 2 - vp.x) / vp.zoom;
  const centerY = (screenH / 2 - vp.y) / vp.zoom;

  const visible = getVisibleRect(vp, screenW, screenH);
  const visW = Math.max(0, visible.maxX - visible.minX);
  const visH = Math.max(0, visible.maxY - visible.minY);
  const visArea = visW * visH;

  const candidates: RegionalMapData[] = [];

  for (const child of uniformChildren) {
    const b = child.bounds;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    if (w <= 0 || h <= 0 || child.width <= 0) continue;

    // Check coverage: overlap area between visible rectangle and child bounds / visible rectangle area
    if (visArea > 0) {
      const ixMin = Math.max(visible.minX, b.minX);
      const ixMax = Math.min(visible.maxX, b.maxX);
      const iyMin = Math.max(visible.minY, b.minY);
      const iyMax = Math.min(visible.maxY, b.maxY);
      const interW = Math.max(0, ixMax - ixMin);
      const interH = Math.max(0, iyMax - iyMin);
      const interArea = interW * interH;
      const coverage = interArea / visArea;
      if (coverage < AUTO_ENTER_MIN_COVERAGE) {
        continue;
      }
    }

    const marginW = w * 0.1;
    const marginH = h * 0.1;
    const inside =
      centerX >= b.minX + marginW &&
      centerX <= b.maxX - marginW &&
      centerY >= b.minY + marginH &&
      centerY <= b.maxY - marginH;

    if (!inside) continue;

    const k = w / child.width;
    const targetZoom = vp.zoom * k;
    if (targetZoom >= ENTER_MIN_ZOOM) {
      candidates.push(child);
    }
  }

  if (candidates.length === 0) return null;

  // Pick candidate with minimum bounds area
  candidates.sort((a, b) => {
    const areaA = (a.bounds.maxX - a.bounds.minX) * (a.bounds.maxY - a.bounds.minY);
    const areaB = (b.bounds.maxX - b.bounds.minX) * (b.bounds.maxY - b.bounds.minY);
    return areaA - areaB;
  });

  return candidates[0];
}

/**
 * Checks if current viewport zoom is low enough to warrant returning to the parent map.
 */
export function shouldExitToParent(vp: Viewport): boolean {
  return vp.zoom < EXIT_MAX_ZOOM;
}

/**
 * Calculates the maximum allowed zoom for the current map, ensuring that
 * users can zoom in far enough to reach the auto-entry threshold of any uniform child.
 */
export function getMaxZoomForMap(
  children: RegionalMapData[],
  _parent?: { width: number; height: number }
): number {
  const uniformChildren = children.filter((c) => isUniformChild(c));
  if (uniformChildren.length === 0) return 12.0;

  const minK = Math.min(...uniformChildren.map((c) => (c.bounds.maxX - c.bounds.minX) / c.width));
  if (minK <= 0) return 12.0;

  return Math.max(12.0, (ENTER_MIN_ZOOM / minK) * 1.1);
}
