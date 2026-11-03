/**
 * Fantasy Cartography Symbol Renderer
 * Procedural Tolkien & Inkarnate style hand-drawn vector art for:
 * - Mountains (Snowy Peaks, Rocky Peaks, Ridges, Hills, Volcanoes)
 * - Trees & Forests (Pine Spires, Pine Clusters, Oak Crowns, Oak Clusters, Dead Trees)
 * - Settlements (Castles, Walled Cities, Towns, Watchtowers, Villages, Ruins)
 * - Maritime (Sea Serpents, Sailing Ships)
 */

import { MapSymbolInstance, MapSymbolType, CustomMapAsset, SymbolColorTheme } from '../types/symbols';

// Palette Constants & Dynamic Theme Colors
export interface ActiveSymbolColors {
  ink: string;
  fill: string;
  roof: string;
  foliage: string;
  accent: string;
}

export let activeColors: ActiveSymbolColors = {
  ink: '#1a1814',
  fill: '#faf6ed',
  roof: '#8f382a',
  foliage: '#1a382b',
  accent: '#c99e38',
};

export let INK_DARK = '#1a1814';
export let INK_OUTLINE = '#26221c';
export let INK_SHADOW = 'rgba(28, 24, 20, 0.42)';
export let INK_HATCH = 'rgba(38, 34, 28, 0.55)';

export let MOUNTAIN_LIGHT = '#faf6ed';
export let MOUNTAIN_SHADE = '#9e9282';
export let MOUNTAIN_DARK_SHADE = '#6b6154';
export const SNOW_WHITE = '#ffffff';

export let PINE_GREEN_DARK = '#1a382b';
export let PINE_GREEN_LIGHT = '#2e5643';
export let OAK_GREEN_DARK = '#3d5228';
export let OAK_GREEN_LIGHT = '#5c753e';
export const TRUNK_BROWN = '#4a3726';

export let STONE_WALL_LIGHT = '#e8dfd1';
export let STONE_WALL_SHADOW = '#a89c89';
export let ROOF_RED = '#82372c';
export let ROOF_BLUE = '#2b4d6b';
export let GOLD_ACCENT = '#c99e38';

// In-memory Image Cache for Custom Assets
const customAssetImageCache = new Map<string, HTMLImageElement>();
let onImageLoadedCallback: (() => void) | null = null;

export function setCustomImageLoadedCallback(cb: (() => void) | null) {
  onImageLoadedCallback = cb;
}

export function getCachedCustomImage(asset: CustomMapAsset): HTMLImageElement | null {
  let img = customAssetImageCache.get(asset.id);
  if (!img) {
    img = new Image();
    img.onload = () => {
      onImageLoadedCallback?.();
    };
    img.src = asset.dataUrl;
    customAssetImageCache.set(asset.id, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Draws a single symbol with scaling, rotation, flip, and dynamic theme colors.
 */
export function drawMapSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: MapSymbolInstance,
  zoom: number = 1.0,
  customAssets?: CustomMapAsset[],
  theme?: SymbolColorTheme
): void {
  const { type, x, y, scale = 1.0, rotation = 0, flipX = false, variant = 0, customAssetId } = symbol;

  activeColors = {
    ink: symbol.colorOverride?.ink || theme?.ink || '#1a1814',
    fill: symbol.colorOverride?.fill || theme?.fill || '#faf6ed',
    roof: symbol.colorOverride?.roof || theme?.roof || '#8f382a',
    foliage: symbol.colorOverride?.foliage || theme?.foliage || '#1a382b',
    accent: symbol.colorOverride?.accent || theme?.accent || '#c99e38',
  };

  INK_DARK = activeColors.ink;
  INK_OUTLINE = activeColors.ink;
  MOUNTAIN_LIGHT = activeColors.fill;
  STONE_WALL_LIGHT = activeColors.fill;
  ROOF_RED = activeColors.roof;
  PINE_GREEN_DARK = activeColors.foliage;
  GOLD_ACCENT = activeColors.accent;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(x, y);

  if (rotation) {
    ctx.rotate(rotation);
  }
  if (flipX) {
    ctx.scale(-1, 1);
  }

  // Symbol scale
  ctx.scale(scale, scale);

  if (type === 'custom') {
    if (customAssetId && customAssets) {
      const asset = customAssets.find((a) => a.id === customAssetId);
      if (asset) {
        const img = getCachedCustomImage(asset);
        if (img) {
          // If asset is pixel art, disable smoothing so pixel edges stay crisp and retro
          if (asset.isPixelArt) {
            ctx.imageSmoothingEnabled = false;
          }
          // Render centered at base anchor
          const displayW = 64;
          const displayH = (asset.height / asset.width) * displayW;
          const ox = asset.originX ?? 0.5;
          const oy = asset.originY ?? 0.85;
          ctx.drawImage(img, -ox * displayW, -oy * displayH, displayW, displayH);
        }
      }
    }
    ctx.restore();
    return;
  }

  switch (type) {
    // === MOUNTAINS & HILLS ===
    case 'mountain_snow':
      drawSnowMountain(ctx, variant, zoom * scale);
      break;
    case 'mountain_rock':
      drawRockMountain(ctx, variant, zoom * scale);
      break;
    case 'mountain_ridge':
      drawMountainRidge(ctx, variant, zoom * scale);
      break;
    case 'hill_mound':
      drawHillMound(ctx, variant, zoom * scale);
      break;
    case 'volcano':
      drawVolcano(ctx, variant, zoom * scale);
      break;

    // === TREES & FORESTS ===
    case 'tree_pine':
      drawPineTree(ctx, variant, zoom * scale);
      break;
    case 'tree_pine_cluster':
      drawPineCluster(ctx, variant, zoom * scale);
      break;
    case 'tree_oak':
      drawOakTree(ctx, variant, zoom * scale);
      break;
    case 'tree_oak_cluster':
      drawOakCluster(ctx, variant, zoom * scale);
      break;
    case 'tree_dead':
      drawDeadTree(ctx, variant, zoom * scale);
      break;

    // === VILLAGES (村 - 4 patterns) ===
    case 'village_hamlet':
      drawVillageHamlet(ctx, variant, zoom * scale);
      break;
    case 'village_palisade':
      drawVillagePalisade(ctx, variant, zoom * scale);
      break;
    case 'village_farm':
      drawVillageFarm(ctx, variant, zoom * scale);
      break;
    case 'village_coastal':
      drawVillageCoastal(ctx, variant, zoom * scale);
      break;

    // === TOWNS & CITIES (街 - 4 patterns) ===
    case 'city_spires':
      drawCitySpires(ctx, variant, zoom * scale);
      break;
    case 'town_walled':
      drawTownWalled(ctx, variant, zoom * scale);
      break;
    case 'town_canal':
      drawTownCanal(ctx, variant, zoom * scale);
      break;
    case 'city_hilltop':
      drawCityHilltop(ctx, variant, zoom * scale);
      break;

    // === PORTS & HARBORS (港 - 2 patterns) ===
    case 'port_harbor':
      drawPortHarbor(ctx, variant, zoom * scale);
      break;
    case 'port_lighthouse':
      drawPortLighthouse(ctx, variant, zoom * scale);
      break;

    // === TOWERS & SPIRES (塔 - 3 patterns) ===
    case 'tower_wizard':
      drawTowerWizard(ctx, variant, zoom * scale);
      break;
    case 'tower_beacon':
      drawTowerBeacon(ctx, variant, zoom * scale);
      break;
    case 'tower_bastion':
      drawTowerBastion(ctx, variant, zoom * scale);
      break;

    // === DUNGEONS & CATACOMBS (ダンジョン - 4 patterns) ===
    case 'dungeon_cave':
      drawDungeonCave(ctx, variant, zoom * scale);
      break;
    case 'dungeon_ruins':
      drawDungeonRuins(ctx, variant, zoom * scale);
      break;
    case 'dungeon_crypt':
      drawDungeonCrypt(ctx, variant, zoom * scale);
      break;
    case 'dungeon_portal':
      drawDungeonPortal(ctx, variant, zoom * scale);
      break;

    // === LEGACY FALLBACKS ===
    case 'village':
      drawVillageHamlet(ctx, variant, zoom * scale);
      break;
    case 'town':
      drawTownWalled(ctx, variant, zoom * scale);
      break;
    case 'walled_city':
      drawCitySpires(ctx, variant, zoom * scale);
      break;
    case 'watchtower':
      drawTowerBeacon(ctx, variant, zoom * scale);
      break;
    case 'ruins':
      drawDungeonRuins(ctx, variant, zoom * scale);
      break;
    case 'castle_keep':
      drawTowerBastion(ctx, variant, zoom * scale);
      break;

    // === MARITIME ===
    case 'sea_serpent':
      drawSeaSerpent(ctx, variant, zoom * scale);
      break;
    case 'sailing_ship':
      drawSailingShip(ctx, variant, zoom * scale);
      break;
  }

  ctx.restore();
}

let lastSymbolsInputRef: MapSymbolInstance[] | null = null;
let cachedSortedArray: MapSymbolInstance[] = [];

/**
 * Renders all symbols sorted by Y-coordinate for authentic isometric depth layering.
 * Includes viewport culling for high frame rate performance.
 */
export function drawSortedSymbols(
  ctx: CanvasRenderingContext2D,
  symbols: MapSymbolInstance[],
  zoom: number,
  viewBounds?: { minX: number; minY: number; maxX: number; maxY: number },
  selectedSymbolId?: string | null,
  customAssets?: CustomMapAsset[],
  theme?: SymbolColorTheme
): void {
  if (!symbols || symbols.length === 0) return;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. Sort by Y-coordinate (North to South, cached if array unchanged)
  if (symbols !== lastSymbolsInputRef || symbols.length !== cachedSortedArray.length) {
    lastSymbolsInputRef = symbols;
    cachedSortedArray = [...symbols].sort((a, b) => a.y - b.y);
  }
  const sorted = cachedSortedArray;

  // 2. Render each symbol
  for (const sym of sorted) {
    // Optional viewport culling (with 60px margin)
    if (viewBounds) {
      if (
        sym.x < viewBounds.minX - 60 ||
        sym.x > viewBounds.maxX + 60 ||
        sym.y < viewBounds.minY - 60 ||
        sym.y > viewBounds.maxY + 60
      ) {
        continue;
      }
    }

    drawMapSymbol(ctx, sym, zoom, customAssets, theme);

    // Selected highlight halo
    if (selectedSymbolId && sym.id === selectedSymbolId) {
      ctx.save();
      ctx.translate(sym.x, sym.y);
      ctx.scale(sym.scale, sym.scale);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.8 / (zoom * sym.scale);
      ctx.setLineDash([4 / (zoom * sym.scale), 3 / (zoom * sym.scale)]);
      ctx.strokeRect(-24, -36, 48, 44);
      ctx.restore();
    }
  }
}

/* =========================================================================
   INDIVIDUAL SYMBOL PROCEDURAL DRAWINGS - HIGH RESOLUTION ART
   ========================================================================= */

// 1. Snow Mountain (Majestic Alpine Peak with Realistic Dendritic Snow Chutes & Chiseled Arête)
function drawSnowMountain(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.1 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const w = 36;
  const h = 46;
  const peakX = variant === 1 ? -3 : variant === 2 ? 3 : 0;
  const peakY = -h;

  // Warm sunlit facet fill (left slope)
  const sunGrad = ctx.createLinearGradient(-w, 0, peakX, peakY);
  sunGrad.addColorStop(0, 'rgba(235, 225, 208, 0.45)');
  sunGrad.addColorStop(0.5, 'rgba(250, 246, 237, 0.7)');
  sunGrad.addColorStop(1, 'rgba(255, 255, 255, 0.85)');

  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(-w * 0.35, peakY * 0.58);
  ctx.lineTo(-w * 0.55, peakY * 0.42);
  ctx.lineTo(-w * 0.75, peakY * 0.22);
  ctx.lineTo(-w, 0);
  ctx.lineTo(peakX + 2, 0);
  ctx.lineTo(peakX - 1, peakY * 0.22);
  ctx.lineTo(peakX + 3.5, peakY * 0.46);
  ctx.lineTo(peakX - 1.5, peakY * 0.72);
  ctx.closePath();
  ctx.fillStyle = sunGrad;
  ctx.fill();

  // Shadow facet fill (right slope) with deep atmospheric falloff
  const shadGrad = ctx.createLinearGradient(peakX, peakY, w, 0);
  shadGrad.addColorStop(0, 'rgba(38, 30, 22, 0.35)');
  shadGrad.addColorStop(0.6, 'rgba(52, 42, 32, 0.48)');
  shadGrad.addColorStop(1, 'rgba(30, 24, 18, 0.25)');

  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(peakX - 1.5, peakY * 0.72);
  ctx.lineTo(peakX + 3.5, peakY * 0.46);
  ctx.lineTo(peakX - 1, peakY * 0.22);
  ctx.lineTo(peakX + 2, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w * 0.78, peakY * 0.28);
  ctx.lineTo(peakX + 16, peakY * 0.48);
  ctx.lineTo(peakX + 10, peakY * 0.7);
  ctx.closePath();
  ctx.fillStyle = shadGrad;
  ctx.fill();

  // Snow Cap with realistic dendritic chutes running down both flanks
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  // Left snow rim
  ctx.lineTo(peakX - 12, peakY * 0.62);
  ctx.lineTo(peakX - 8, peakY * 0.68);
  ctx.lineTo(peakX - 5, peakY * 0.55);
  ctx.lineTo(peakX - 2, peakY * 0.62);
  // Center arête snow boundary
  ctx.lineTo(peakX - 1.5, peakY * 0.72);
  // Right shaded snow chutes
  ctx.lineTo(peakX + 4, peakY * 0.66);
  ctx.lineTo(peakX + 7, peakY * 0.58);
  ctx.lineTo(peakX + 13, peakY * 0.5);
  ctx.lineTo(peakX + 6, peakY * 0.78);
  ctx.closePath();
  ctx.fill();

  // Snow cap subtle cool ambient shadow on east side
  ctx.fillStyle = 'rgba(180, 195, 215, 0.4)';
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(peakX - 1.5, peakY * 0.72);
  ctx.lineTo(peakX + 4, peakY * 0.66);
  ctx.lineTo(peakX + 7, peakY * 0.58);
  ctx.lineTo(peakX + 13, peakY * 0.5);
  ctx.lineTo(peakX + 6, peakY * 0.78);
  ctx.closePath();
  ctx.fill();

  // Snow cap rim ink contour
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw * 0.75;
  ctx.beginPath();
  ctx.moveTo(peakX - 12, peakY * 0.62);
  ctx.lineTo(peakX - 8, peakY * 0.68);
  ctx.lineTo(peakX - 5, peakY * 0.55);
  ctx.lineTo(peakX - 2, peakY * 0.62);
  ctx.moveTo(peakX + 2, peakY * 0.68);
  ctx.lineTo(peakX + 7, peakY * 0.58);
  ctx.lineTo(peakX + 13, peakY * 0.5);
  ctx.stroke();

  // Outer Mountain Contour Silhouette
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.beginPath();
  // West ridge (left)
  ctx.moveTo(-w, 0);
  ctx.lineTo(-w * 0.75, peakY * 0.22);
  ctx.lineTo(-w * 0.55, peakY * 0.42);
  ctx.lineTo(-w * 0.35, peakY * 0.58);
  ctx.lineTo(peakX, peakY);
  // East ridge (right)
  ctx.lineTo(peakX + 10, peakY * 0.7);
  ctx.lineTo(peakX + 16, peakY * 0.48);
  ctx.lineTo(w * 0.78, peakY * 0.28);
  ctx.lineTo(w, 0);
  // Base line with small crag baseline anchor
  ctx.lineTo(-w, 0);
  ctx.stroke();

  // Sharp Central Arête (Main winding spine)
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(peakX - 1.5, peakY * 0.72);
  ctx.lineTo(peakX + 3.5, peakY * 0.46);
  ctx.lineTo(peakX - 1, peakY * 0.22);
  ctx.lineTo(peakX + 2, 0);
  ctx.lineWidth = lw * 1.35;
  ctx.stroke();

  // Secondary eastern spur
  ctx.beginPath();
  ctx.moveTo(peakX + 3.5, peakY * 0.46);
  ctx.lineTo(peakX + 16, peakY * 0.18);
  ctx.lineTo(peakX + 19, 0);
  ctx.lineWidth = lw * 0.9;
  ctx.stroke();

  // Detailed Pen Hatching on Shadow Facet (Dense, rhythmic Tolkien ink strokes)
  ctx.lineWidth = lw * 0.62;
  ctx.strokeStyle = activeColors.ink;
  ctx.beginPath();

  // Hatching in upper shadow couloir
  for (let s = 0.28; s <= 0.55; s += 0.04) {
    const yStart = peakY * (1 - s);
    const xStart = peakX + (s * 4.5);
    const len = 4 + (s * 10);
    ctx.moveTo(xStart, yStart);
    ctx.lineTo(xStart + len * 0.75, yStart + len * 0.65);
  }

  // Hatching in mid-to-lower shadow facet
  for (let s = 0.50; s <= 0.94; s += 0.038) {
    const yStart = peakY * (1 - s);
    const xStart = peakX - 2 + (s * 8);
    const len = 6 + ((1 - Math.abs(s - 0.72)) * 13);
    ctx.moveTo(xStart, yStart);
    ctx.lineTo(xStart + len * 0.82, yStart + len * 0.58);
  }

  // Deep cross-hatch in deepest ravine
  for (let s = 0.65; s <= 0.90; s += 0.055) {
    const yStart = peakY * (1 - s) + 2;
    const xStart = peakX + (s * 11);
    ctx.moveTo(xStart, yStart);
    ctx.lineTo(xStart - 4, yStart + 5);
  }

  // Sunny facet rock strata contour lines
  ctx.moveTo(peakX - 8, peakY * 0.42);
  ctx.lineTo(peakX - 4, peakY * 0.34);
  ctx.moveTo(peakX - 16, peakY * 0.24);
  ctx.lineTo(peakX - 10, peakY * 0.18);
  ctx.moveTo(peakX - 22, peakY * 0.12);
  ctx.lineTo(peakX - 16, peakY * 0.08);

  // Scree & talus pebbles at foot
  ctx.moveTo(peakX - 6, -1);
  ctx.lineTo(peakX - 5, -2);
  ctx.moveTo(peakX + 8, -1.5);
  ctx.lineTo(peakX + 10, -2.5);
  ctx.moveTo(w * 0.5, -1);
  ctx.lineTo(w * 0.53, -2);

  ctx.stroke();
}

// 2. Rocky Mountain (Jagged Crags, Layered Rock Strata & Dramatic Chiseled Shading)
function drawRockMountain(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.1 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const w = 32;
  const h = 40;
  const peakX = variant === 1 ? -2 : variant === 2 ? 3 : 1;
  const peakY = -h;

  // Sunlit Facet Gradient (warm weathered granite)
  const sunGrad = ctx.createLinearGradient(-w, 0, peakX, peakY);
  sunGrad.addColorStop(0, 'rgba(230, 222, 208, 0.4)');
  sunGrad.addColorStop(0.6, 'rgba(245, 238, 225, 0.65)');
  sunGrad.addColorStop(1, 'rgba(255, 252, 245, 0.8)');

  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(-w * 0.25, peakY * 0.68);
  ctx.lineTo(-w * 0.45, peakY * 0.55);
  ctx.lineTo(-w * 0.6, peakY * 0.32);
  ctx.lineTo(-w * 0.8, peakY * 0.25);
  ctx.lineTo(-w, 0);
  ctx.lineTo(peakX + 2, 0);
  ctx.lineTo(peakX - 1.5, peakY * 0.35);
  ctx.lineTo(peakX + 2.5, peakY * 0.65);
  ctx.closePath();
  ctx.fillStyle = sunGrad;
  ctx.fill();

  // Shadow Facet Gradient (deep shadowed stone)
  const shadGrad = ctx.createLinearGradient(peakX, peakY, w, 0);
  shadGrad.addColorStop(0, 'rgba(42, 34, 26, 0.36)');
  shadGrad.addColorStop(0.5, 'rgba(56, 45, 34, 0.48)');
  shadGrad.addColorStop(1, 'rgba(32, 26, 20, 0.28)');

  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(peakX + 2.5, peakY * 0.65);
  ctx.lineTo(peakX - 1.5, peakY * 0.35);
  ctx.lineTo(peakX + 2, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w * 0.78, peakY * 0.25);
  ctx.lineTo(w * 0.55, peakY * 0.48);
  ctx.lineTo(w * 0.35, peakY * 0.68);
  ctx.closePath();
  ctx.fillStyle = shadGrad;
  ctx.fill();

  // Jagged Mountain Outline
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(-w * 0.8, peakY * 0.25);
  ctx.lineTo(-w * 0.6, peakY * 0.32);
  ctx.lineTo(-w * 0.45, peakY * 0.55);
  ctx.lineTo(-w * 0.25, peakY * 0.68);
  ctx.lineTo(peakX, peakY);
  ctx.lineTo(w * 0.35, peakY * 0.68);
  ctx.lineTo(w * 0.55, peakY * 0.48);
  ctx.lineTo(w * 0.78, peakY * 0.25);
  ctx.lineTo(w, 0);
  ctx.lineTo(-w, 0);
  ctx.stroke();

  // Central jagged ridge arête
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(peakX + 2.5, peakY * 0.65);
  ctx.lineTo(peakX - 1.5, peakY * 0.35);
  ctx.lineTo(peakX + 2, 0);
  ctx.lineWidth = lw * 1.35;
  ctx.stroke();

  // Secondary rock spur on sunlit face
  ctx.beginPath();
  ctx.moveTo(peakX - 1.5, peakY * 0.35);
  ctx.lineTo(peakX - 14, peakY * 0.16);
  ctx.lineWidth = lw * 0.85;
  ctx.stroke();

  // Dense Shadow Hatching & Rock Strata (Tolkien pen lines)
  ctx.lineWidth = lw * 0.62;
  ctx.strokeStyle = activeColors.ink;
  ctx.beginPath();

  for (let s = 0.20; s <= 0.94; s += 0.044) {
    const yS = peakY * (1 - s);
    const xS = peakX + (s * 5.2);
    const len = 4 + (s * 9);
    ctx.moveTo(xS, yS);
    ctx.lineTo(xS + len * 0.8, yS + len * 0.6);
  }

  // Cross-hatching along the deepest basal crag
  for (let s = 0.62; s <= 0.88; s += 0.065) {
    const yS = peakY * (1 - s);
    const xS = peakX + (s * 7.5);
    ctx.moveTo(xS + 2, yS);
    ctx.lineTo(xS - 3.5, yS + 4);
  }

  // Horizontal craggy rock fractures on illuminated face
  ctx.moveTo(peakX - 6, peakY * 0.75);
  ctx.lineTo(peakX - 1, peakY * 0.72);
  ctx.moveTo(peakX - 14, peakY * 0.5);
  ctx.lineTo(peakX - 7, peakY * 0.48);
  ctx.moveTo(peakX - 20, peakY * 0.28);
  ctx.lineTo(peakX - 12, peakY * 0.26);
  ctx.moveTo(peakX - 9, peakY * 0.18);
  ctx.lineTo(peakX - 4, peakY * 0.16);

  // Talus boulders at base
  ctx.moveTo(-w * 0.35, -1);
  ctx.lineTo(-w * 0.32, -2.5);
  ctx.moveTo(w * 0.35, -1.2);
  ctx.lineTo(w * 0.38, -2.5);

  ctx.stroke();
}

// 3. Mountain Ridge (Interconnected Chain of 3 Peaks with Cirques & Unified Lighting)
function drawMountainRidge(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.1 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const w = 52;
  const h = 38;

  // Multi-tone shadow washes on right side of all 3 crests
  const shadWash = 'rgba(40, 32, 24, 0.22)';
  ctx.fillStyle = shadWash;

  // Shadow of Peak 1 (left)
  ctx.beginPath();
  ctx.moveTo(-w * 0.48, -h * 0.85);
  ctx.lineTo(-w * 0.4, -h * 0.45);
  ctx.lineTo(-w * 0.35, 0);
  ctx.lineTo(-w * 0.15, 0);
  ctx.lineTo(-w * 0.2, -h * 0.5);
  ctx.closePath();
  ctx.fill();

  // Shadow of Peak 2 (center grand peak)
  ctx.beginPath();
  ctx.moveTo(w * 0.08, -h);
  ctx.lineTo(w * 0.18, -h * 0.5);
  ctx.lineTo(w * 0.25, 0);
  ctx.lineTo(w * 0.42, 0);
  ctx.lineTo(w * 0.38, -h * 0.62);
  ctx.closePath();
  ctx.fill();

  // Shadow of Peak 3 (right peak)
  ctx.beginPath();
  ctx.moveTo(w * 0.68, -h * 0.76);
  ctx.lineTo(w * 0.75, -h * 0.38);
  ctx.lineTo(w * 0.82, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w * 0.88, -h * 0.35);
  ctx.closePath();
  ctx.fill();

  // Main Outline of the Ridge
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(-w * 0.7, -h * 0.45);
  ctx.lineTo(-w * 0.48, -h * 0.85);
  ctx.lineTo(-w * 0.2, -h * 0.5);
  ctx.lineTo(w * 0.08, -h);
  ctx.lineTo(w * 0.38, -h * 0.62);
  ctx.lineTo(w * 0.68, -h * 0.76);
  ctx.lineTo(w * 0.88, -h * 0.35);
  ctx.lineTo(w, 0);
  ctx.lineTo(-w, 0);
  ctx.stroke();

  // Distinct Central Arêtes for each peak
  ctx.beginPath();
  // Peak 1 ridge
  ctx.moveTo(-w * 0.48, -h * 0.85);
  ctx.lineTo(-w * 0.4, -h * 0.45);
  ctx.lineTo(-w * 0.35, 0);
  // Peak 2 ridge
  ctx.moveTo(w * 0.08, -h);
  ctx.lineTo(w * 0.18, -h * 0.5);
  ctx.lineTo(w * 0.25, 0);
  // Peak 3 ridge
  ctx.moveTo(w * 0.68, -h * 0.76);
  ctx.lineTo(w * 0.75, -h * 0.38);
  ctx.lineTo(w * 0.82, 0);
  ctx.lineWidth = lw * 1.3;
  ctx.stroke();

  // Detailed Pen Hatching across the shadow cirques
  ctx.lineWidth = lw * 0.62;
  ctx.strokeStyle = activeColors.ink;
  ctx.beginPath();

  // Peak 1 hatching (left)
  for (let s = 0.25; s <= 0.88; s += 0.075) {
    const yS = -h * 0.85 * (1 - s);
    const xS = -w * 0.48 + s * 5;
    ctx.moveTo(xS, yS);
    ctx.lineTo(xS + 5, yS + 4);
  }

  // Peak 2 hatching (center main peak - dense)
  for (let s = 0.20; s <= 0.92; s += 0.052) {
    const yS = -h * (1 - s);
    const xS = w * 0.08 + s * 6;
    const len = 4 + s * 6;
    ctx.moveTo(xS, yS);
    ctx.lineTo(xS + len * 0.75, yS + len * 0.55);
  }

  // Peak 3 hatching (right)
  for (let s = 0.25; s <= 0.85; s += 0.08) {
    const yS = -h * 0.76 * (1 - s);
    const xS = w * 0.68 + s * 4.5;
    ctx.moveTo(xS, yS);
    ctx.lineTo(xS + 4.5, yS + 4);
  }

  // Sunlit facet fractures
  ctx.moveTo(-w * 0.62, -h * 0.28);
  ctx.lineTo(-w * 0.52, -h * 0.22);
  ctx.moveTo(-w * 0.08, -h * 0.65);
  ctx.lineTo(-w * 0.02, -h * 0.58);
  ctx.moveTo(-w * 0.12, -h * 0.35);
  ctx.lineTo(-w * 0.05, -h * 0.30);
  ctx.moveTo(w * 0.52, -h * 0.45);
  ctx.lineTo(w * 0.58, -h * 0.40);

  ctx.stroke();
}

// 4. Rolling Hill Mounds (Volumetric Grassy Knolls with Topographic Contours & Grass Blades)
function drawHillMound(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const rx = 24;
  const ry = 14;

  // Background Hill (Soft rolling shoulder in the rear)
  const bgGrad = ctx.createLinearGradient(rx * 0.2, -ry * 1.3, rx * 0.9, 0);
  bgGrad.addColorStop(0, 'rgba(235, 230, 210, 0.6)');
  bgGrad.addColorStop(0.5, 'rgba(195, 190, 165, 0.4)');
  bgGrad.addColorStop(1, 'rgba(160, 150, 130, 0.25)');

  ctx.beginPath();
  ctx.moveTo(rx * 0.1, 0);
  ctx.bezierCurveTo(rx * 0.2, -ry * 1.25, rx * 0.7, -ry * 1.25, rx * 1.15, 0);
  ctx.closePath();
  ctx.fillStyle = bgGrad;
  ctx.fill();

  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw * 0.85;
  ctx.beginPath();
  ctx.moveTo(rx * 0.15, -ry * 0.3);
  ctx.bezierCurveTo(rx * 0.25, -ry * 1.22, rx * 0.68, -ry * 1.22, rx * 1.12, 0);
  ctx.stroke();

  // Background hill subtle shading lines
  ctx.lineWidth = lw * 0.55;
  ctx.beginPath();
  for (let s = 0.4; s <= 0.85; s += 0.12) {
    const hx = rx * s;
    const hy = -ry * 1.15 * Math.sin((s - 0.15) * Math.PI);
    ctx.moveTo(hx, hy + 2);
    ctx.lineTo(hx - 3, hy + 5);
  }
  ctx.stroke();

  // Foreground Main Hill (Volumetric rolling knoll)
  const fgGrad = ctx.createLinearGradient(-rx * 0.6, -ry * 1.1, rx * 0.8, 0);
  // Highlight on top-left, gentle warm shading on bottom-right
  fgGrad.addColorStop(0, 'rgba(250, 246, 235, 0.85)');
  fgGrad.addColorStop(0.4, 'rgba(235, 228, 205, 0.7)');
  fgGrad.addColorStop(0.75, 'rgba(195, 185, 160, 0.5)');
  fgGrad.addColorStop(1, 'rgba(145, 135, 115, 0.3)');

  ctx.beginPath();
  ctx.moveTo(-rx, 0);
  ctx.bezierCurveTo(-rx * 0.85, -ry * 1.05, -rx * 0.1, -ry * 1.15, rx * 0.05, -ry * 1.1);
  ctx.bezierCurveTo(rx * 0.55, -ry * 1.0, rx * 0.85, -ry * 0.5, rx * 0.95, 0);
  ctx.closePath();
  ctx.fillStyle = fgGrad;
  ctx.fill();

  // Main Foreground Hill Crest Contour
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(-rx, 0);
  ctx.bezierCurveTo(-rx * 0.85, -ry * 1.05, -rx * 0.1, -ry * 1.15, rx * 0.05, -ry * 1.1);
  ctx.bezierCurveTo(rx * 0.55, -ry * 1.0, rx * 0.85, -ry * 0.5, rx * 0.95, 0);
  ctx.stroke();

  // Organic curved topographical contour hatch lines (showing roundness)
  ctx.lineWidth = lw * 0.6;
  ctx.beginPath();
  // Upper brow curve
  ctx.moveTo(-rx * 0.45, -ry * 0.78);
  ctx.quadraticCurveTo(0, -ry * 0.88, rx * 0.45, -ry * 0.68);

  // Soft rhythmic downward shading ticks on eastern slope
  for (let i = 0.2; i <= 0.85; i += 0.11) {
    const xPos = rx * (0.05 + i * 0.85);
    const yTop = -ry * (1.05 - Math.pow(i, 1.8) * 0.9);
    const len = 3 + (1 - i) * 3;
    ctx.moveTo(xPos, yTop + 1.5);
    ctx.lineTo(xPos - 3, yTop + 1.5 + len);
  }
  ctx.stroke();

  // Ground baseline integration with delicate grass tufts
  ctx.lineWidth = lw * 0.75;
  ctx.beginPath();
  // Soft tapered ground lines
  ctx.moveTo(-rx - 4, 0);
  ctx.lineTo(-rx * 0.6, 0);
  ctx.moveTo(rx * 0.5, 0);
  ctx.lineTo(rx * 1.25, 0);

  // Grass tuft 1 (left flank)
  ctx.moveTo(-rx * 0.35, 0);
  ctx.lineTo(-rx * 0.32, -3.5);
  ctx.moveTo(-rx * 0.32, -3.5);
  ctx.lineTo(-rx * 0.28, 0);
  ctx.moveTo(-rx * 0.30, -3.2);
  ctx.lineTo(-rx * 0.25, -2);

  // Grass tuft 2 (center crest)
  ctx.moveTo(rx * 0.08, -ry * 1.1);
  ctx.lineTo(rx * 0.1, -ry * 1.1 - 3);
  ctx.moveTo(rx * 0.1, -ry * 1.1 - 3);
  ctx.lineTo(rx * 0.13, -ry * 1.1);

  // Grass tuft 3 (right base)
  ctx.moveTo(rx * 0.55, 0);
  ctx.lineTo(rx * 0.58, -3.2);
  ctx.moveTo(rx * 0.58, -3.2);
  ctx.lineTo(rx * 0.62, 0);

  ctx.stroke();
}

// 5. Volcano (Stratovolcano with Molten Caldera & Billowing Ash Plume)
function drawVolcano(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.1 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const w = 36;
  const h = 34;

  // Volcano Flank Gradient (obsidian basalt & volcanic ash)
  const flankGrad = ctx.createLinearGradient(-w, 0, w, 0);
  flankGrad.addColorStop(0, 'rgba(120, 105, 95, 0.4)');
  flankGrad.addColorStop(0.35, 'rgba(165, 148, 135, 0.55)');
  flankGrad.addColorStop(0.6, 'rgba(80, 65, 55, 0.7)');
  flankGrad.addColorStop(1, 'rgba(45, 35, 30, 0.8)');

  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(-10, -h);
  ctx.lineTo(10, -h);
  ctx.lineTo(w, 0);
  ctx.closePath();
  ctx.fillStyle = flankGrad;
  ctx.fill();

  // Shadow Flank (Right side)
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(10, -h);
  ctx.lineTo(w, 0);
  ctx.lineTo(4, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(30, 22, 16, 0.35)';
  ctx.fill();

  // Outer Mountain Outlines
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(-10, -h);
  ctx.moveTo(10, -h);
  ctx.lineTo(w, 0);
  ctx.lineTo(-w, 0);
  ctx.stroke();

  // Caldera Lip & Depth
  ctx.beginPath();
  ctx.ellipse(0, -h, 10, 4.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#22140e';
  ctx.fill();
  ctx.stroke();

  // Fiery Molten Magma Glow inside crater
  const magmaGrad = ctx.createRadialGradient(0, -h + 0.8, 1, 0, -h + 0.8, 6);
  magmaGrad.addColorStop(0, '#fef08a'); // yellow heat core
  magmaGrad.addColorStop(0.5, '#ea580c'); // orange magma
  magmaGrad.addColorStop(1, '#991b1b'); // deep red crust

  ctx.beginPath();
  ctx.ellipse(0, -h + 0.8, 6.5, 2.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = magmaGrad;
  ctx.fill();

  // Radiating Ash Couloir Pen Hatching
  ctx.lineWidth = lw * 0.62;
  ctx.beginPath();
  // Shadow couloir hatching (dense)
  for (let s = 0.2; s <= 0.92; s += 0.05) {
    const yS = -h * (1 - s);
    const xS = 3 + s * 16;
    ctx.moveTo(xS, yS);
    ctx.lineTo(xS + 5, yS + 5.5);
  }
  // Sunny couloir accent cracks
  ctx.moveTo(-6, -h * 0.7);
  ctx.lineTo(-13, -h * 0.35);
  ctx.moveTo(-11, -h * 0.3);
  ctx.lineTo(-20, -h * 0.12);
  ctx.stroke();

  // Volumetric Billowing Smoke & Ash Plumes curling into sky
  const smokeGrad = ctx.createRadialGradient(2, -h - 18, 4, 0, -h - 18, 22);
  smokeGrad.addColorStop(0, 'rgba(210, 200, 190, 0.75)');
  smokeGrad.addColorStop(0.7, 'rgba(130, 120, 110, 0.45)');
  smokeGrad.addColorStop(1, 'rgba(90, 80, 70, 0)');

  ctx.beginPath();
  ctx.arc(-2, -h - 9, 5.5, 0, Math.PI * 2);
  ctx.arc(4, -h - 16, 7.5, 0, Math.PI * 2);
  ctx.arc(-3, -h - 24, 8.5, 0, Math.PI * 2);
  ctx.arc(5, -h - 32, 7.0, 0, Math.PI * 2);
  ctx.fillStyle = smokeGrad;
  ctx.fill();

  // Billow Pen Contours
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw * 0.75;
  ctx.beginPath();
  // Left billow curls
  ctx.arc(-2, -h - 9, 5.5, Math.PI * 0.8, Math.PI * 1.5);
  ctx.arc(-3, -h - 24, 8.5, Math.PI * 0.7, Math.PI * 1.4);
  // Right billow curls
  ctx.arc(4, -h - 16, 7.5, -Math.PI * 0.2, Math.PI * 0.4);
  ctx.arc(5, -h - 32, 7.0, -Math.PI * 0.3, Math.PI * 0.3);
  ctx.stroke();

  // Floating volcanic sparks & cinders
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(6, -h - 8, 1, 0, Math.PI * 2);
  ctx.arc(-7, -h - 14, 0.9, 0, Math.PI * 2);
  ctx.arc(9, -h - 22, 1.1, 0, Math.PI * 2);
  ctx.fill();
}

// 6. Pine Tree (Majestic Evergreen Spire with Feathery Tiered Boughs & Woodgrain Trunk)
function drawPineTree(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.6, 0.95 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const h = 28;
  const w = 11;

  // Woody Trunk & Root Spurs
  const trunkGrad = ctx.createLinearGradient(-1.8, 0, 1.8, 0);
  trunkGrad.addColorStop(0, '#543d2b');
  trunkGrad.addColorStop(0.5, '#785539');
  trunkGrad.addColorStop(1, '#3b291c');

  ctx.fillStyle = trunkGrad;
  ctx.beginPath();
  ctx.moveTo(-1.6, 0);
  ctx.lineTo(-1.0, -7);
  ctx.lineTo(1.0, -7);
  ctx.lineTo(1.6, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Root flare baseline tuft
  ctx.beginPath();
  ctx.moveTo(-3.5, 0);
  ctx.lineTo(3.5, 0);
  ctx.stroke();

  // 5 Tiered Evergreen Boughs with drooping feathered needles
  const tiers = [
    { topY: -h, bottomY: -h + 8, halfW: w * 0.38, droop: 1.5 },
    { topY: -h + 5, bottomY: -h + 13.5, halfW: w * 0.58, droop: 2.2 },
    { topY: -h + 10, bottomY: -h + 19, halfW: w * 0.78, droop: 2.8 },
    { topY: -h + 15, bottomY: -h + 24.5, halfW: w * 0.94, droop: 3.2 },
    { topY: -h + 20, bottomY: -4, halfW: w, droop: 3.5 },
  ];

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];

    // Left illuminated needle bough (sunlit spruce green gradient)
    const leftGrad = ctx.createLinearGradient(-t.halfW, t.bottomY, 0, t.topY);
    leftGrad.addColorStop(0, activeColors.foliage);
    leftGrad.addColorStop(1, '#3a664e'); // brighter sunlit needle tips

    ctx.beginPath();
    ctx.moveTo(0, t.topY);
    // Drooping serrated needle sweeps
    ctx.lineTo(-t.halfW * 0.45, t.topY + (t.bottomY - t.topY) * 0.4);
    ctx.lineTo(-t.halfW * 0.35, t.topY + (t.bottomY - t.topY) * 0.52);
    ctx.lineTo(-t.halfW * 0.75, t.topY + (t.bottomY - t.topY) * 0.78);
    ctx.lineTo(-t.halfW * 0.62, t.topY + (t.bottomY - t.topY) * 0.85);
    ctx.lineTo(-t.halfW, t.bottomY);
    ctx.quadraticCurveTo(-t.halfW * 0.4, t.bottomY - t.droop, 0, t.bottomY - 1);
    ctx.closePath();
    ctx.fillStyle = leftGrad;
    ctx.fill();

    // Right shadowed needle bough (deep forest shadow)
    const rightGrad = ctx.createLinearGradient(0, t.topY, t.halfW, t.bottomY);
    rightGrad.addColorStop(0, '#13281e');
    rightGrad.addColorStop(1, '#1b382b');

    ctx.beginPath();
    ctx.moveTo(0, t.topY);
    ctx.lineTo(t.halfW * 0.45, t.topY + (t.bottomY - t.topY) * 0.4);
    ctx.lineTo(t.halfW * 0.35, t.topY + (t.bottomY - t.topY) * 0.52);
    ctx.lineTo(t.halfW * 0.75, t.topY + (t.bottomY - t.topY) * 0.78);
    ctx.lineTo(t.halfW * 0.62, t.topY + (t.bottomY - t.topY) * 0.85);
    ctx.lineTo(t.halfW, t.bottomY);
    ctx.quadraticCurveTo(t.halfW * 0.4, t.bottomY - t.droop, 0, t.bottomY - 1);
    ctx.closePath();
    ctx.fillStyle = rightGrad;
    ctx.fill();

    // Branch & needle ink contours
    ctx.strokeStyle = activeColors.ink;
    ctx.lineWidth = lw * 0.85;
    ctx.beginPath();
    // Left profile
    ctx.moveTo(0, t.topY);
    ctx.lineTo(-t.halfW * 0.45, t.topY + (t.bottomY - t.topY) * 0.4);
    ctx.lineTo(-t.halfW * 0.35, t.topY + (t.bottomY - t.topY) * 0.52);
    ctx.lineTo(-t.halfW * 0.75, t.topY + (t.bottomY - t.topY) * 0.78);
    ctx.lineTo(-t.halfW * 0.62, t.topY + (t.bottomY - t.topY) * 0.85);
    ctx.lineTo(-t.halfW, t.bottomY);
    ctx.quadraticCurveTo(-t.halfW * 0.4, t.bottomY - t.droop, 0, t.bottomY - 1);
    // Right profile
    ctx.lineTo(t.halfW, t.bottomY);
    ctx.lineTo(t.halfW * 0.62, t.topY + (t.bottomY - t.topY) * 0.85);
    ctx.lineTo(t.halfW * 0.75, t.topY + (t.bottomY - t.topY) * 0.78);
    ctx.lineTo(t.halfW * 0.35, t.topY + (t.bottomY - t.topY) * 0.52);
    ctx.lineTo(t.halfW * 0.45, t.topY + (t.bottomY - t.topY) * 0.4);
    ctx.lineTo(0, t.topY);
    ctx.stroke();

    // Central spine and needle texture hatching on shadow half
    ctx.lineWidth = lw * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, t.topY);
    ctx.lineTo(0, t.bottomY - 1);

    // Fine needle hatch marks on right bough
    const midY = t.topY + (t.bottomY - t.topY) * 0.55;
    ctx.moveTo(t.halfW * 0.15, midY);
    ctx.lineTo(t.halfW * 0.55, midY + 2.5);
    ctx.moveTo(t.halfW * 0.25, midY + 3);
    ctx.lineTo(t.halfW * 0.7, midY + 5.5);
    ctx.stroke();
  }
}

// 7. Pine Cluster (Picturesque Staggered Forest Grove of 5 Layered Evergreens)
function drawPineCluster(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  // 5 Staggered Trees: 2 background, 3 foreground
  const trees = [
    { x: -9, y: -6, scale: 0.80 },
    { x: 8, y: -5, scale: 0.85 },
    { x: -14, y: 0, scale: 0.95 },
    { x: 12, y: 1, scale: 0.92 },
    { x: 0, y: 3, scale: 1.08 },
  ];

  for (const t of trees) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);
    drawPineTree(ctx, 0, effectiveZoom);
    ctx.restore();
  }
}

// 8. Oak Tree (Broadleaf Deciduous with Billowing Volumetric Pillows & Gnarled Trunk)
function drawOakTree(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.6, 0.95 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const cy = -17;
  const cr = 14;

  // Gnarled Ancient Trunk with branching boughs
  const trunkGrad = ctx.createLinearGradient(-3, 0, 3, 0);
  trunkGrad.addColorStop(0, '#4e3825');
  trunkGrad.addColorStop(0.5, '#6e4f35');
  trunkGrad.addColorStop(1, '#3b2819');

  ctx.fillStyle = trunkGrad;
  ctx.beginPath();
  ctx.moveTo(-3.2, 0);
  ctx.quadraticCurveTo(-2.5, -7, -4.5, -12);
  ctx.lineTo(-2.8, -12.5);
  ctx.lineTo(-1.2, -8);
  ctx.lineTo(1.2, -8);
  ctx.lineTo(2.8, -13);
  ctx.lineTo(4.5, -12.5);
  ctx.quadraticCurveTo(2.5, -7, 3.2, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Bark grain lines
  ctx.lineWidth = lw * 0.65;
  ctx.beginPath();
  ctx.moveTo(-0.8, -1);
  ctx.quadraticCurveTo(-0.5, -4.5, -1.5, -8);
  ctx.moveTo(0.8, -1);
  ctx.quadraticCurveTo(0.6, -4.5, 1.5, -8.5);
  ctx.stroke();

  // Foliage Pillows (5 overlapping volumetric clouds creating lush canopy)
  const clouds = [
    { ox: -cr * 0.45, oy: cy + cr * 0.15, r: cr * 0.65 },
    { ox: cr * 0.45, oy: cy + cr * 0.15, r: cr * 0.65 },
    { ox: -cr * 0.25, oy: cy - cr * 0.35, r: cr * 0.68 },
    { ox: cr * 0.25, oy: cy - cr * 0.35, r: cr * 0.68 },
    { ox: 0, oy: cy - cr * 0.05, r: cr * 0.75 },
  ];

  // Draw each foliage lobe with soft 3D lighting
  for (const c of clouds) {
    const fGrad = ctx.createRadialGradient(c.ox - c.r * 0.35, c.oy - c.r * 0.35, c.r * 0.1, c.ox, c.oy, c.r * 1.05);
    fGrad.addColorStop(0, '#557a46'); // sunlit warm green
    fGrad.addColorStop(0.55, activeColors.foliage || '#2d4a36');
    fGrad.addColorStop(1, '#182b20'); // deep shadow ambient occlusion

    ctx.beginPath();
    ctx.arc(c.ox, c.oy, c.r, 0, Math.PI * 2);
    ctx.fillStyle = fGrad;
    ctx.fill();
  }

  // Canopy Scalloped Pen Silhouette & Texture
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.beginPath();
  // Outer cloud boundary lobes
  ctx.arc(-cr * 0.55, cy + 2, cr * 0.5, Math.PI * 0.7, Math.PI * 1.4);
  ctx.arc(-cr * 0.35, cy - cr * 0.4, cr * 0.55, Math.PI * 1.1, Math.PI * 1.8);
  ctx.arc(0, cy - cr * 0.55, cr * 0.58, Math.PI * 1.3, Math.PI * 1.9);
  ctx.arc(cr * 0.35, cy - cr * 0.4, cr * 0.55, Math.PI * 1.4, Math.PI * 2.1);
  ctx.arc(cr * 0.55, cy + 2, cr * 0.5, Math.PI * 1.8, Math.PI * 2.5);
  ctx.arc(cr * 0.25, cy + cr * 0.55, cr * 0.45, Math.PI * 2.1, Math.PI * 2.8);
  ctx.arc(-cr * 0.25, cy + cr * 0.55, cr * 0.45, Math.PI * 2.4, Math.PI * 3.1);
  ctx.stroke();

  // Fine crescent shadow hatch marks in lower canopy lobes
  ctx.lineWidth = lw * 0.6;
  ctx.beginPath();
  // Bottom left lobe shadow
  ctx.arc(-cr * 0.3, cy + 3, cr * 0.35, 0.2, 1.2);
  // Bottom right lobe shadow
  ctx.arc(cr * 0.3, cy + 3, cr * 0.35, 0.4, 1.4);
  // Center deep shadow
  ctx.arc(0, cy - 2, cr * 0.45, 0.3, 1.2);
  ctx.stroke();

  // Ground root flare lines and grass
  ctx.beginPath();
  ctx.moveTo(-cr * 0.6, 0);
  ctx.lineTo(-3.5, 0);
  ctx.moveTo(3.5, 0);
  ctx.lineTo(cr * 0.6, 0);
  ctx.stroke();
}

// 9. Oak Cluster (Ancient Deciduous Woodland Grove of 4 Layered Oaks)
function drawOakCluster(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const trees = [
    { x: 0, y: -7, scale: 0.82 },
    { x: -14, y: 0, scale: 0.95 },
    { x: 14, y: 1, scale: 0.95 },
    { x: -2, y: 5, scale: 1.05 },
  ];

  for (const t of trees) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);
    drawOakTree(ctx, 0, effectiveZoom);
    ctx.restore();
  }
}

// 10. Dead Tree (Sinister Gnarled Wilderness Deadwood with Hollow Trunk & Splintered Boughs)
function drawDeadTree(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.6, 0.95 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const h = 26;

  // Weathered gray-brown deadwood gradient
  const woodGrad = ctx.createLinearGradient(-3, 0, 3, 0);
  woodGrad.addColorStop(0, '#423b34');
  woodGrad.addColorStop(0.5, '#63594e');
  woodGrad.addColorStop(1, '#2c251f');

  // Twisted hollow trunk
  ctx.fillStyle = woodGrad;
  ctx.beginPath();
  ctx.moveTo(-3, 0);
  ctx.quadraticCurveTo(-1.8, -9, -3.5, -16);
  ctx.lineTo(-2, -18);
  ctx.lineTo(0, -11);
  ctx.lineTo(2, -17);
  ctx.lineTo(3.5, -15);
  ctx.quadraticCurveTo(1.8, -8, 3, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Trunk Hollow (dark rotting knot cavity)
  ctx.fillStyle = '#17120c';
  ctx.beginPath();
  ctx.ellipse(-0.5, -6, 1.2, 2.5, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Spooky crooked bare limbs & twigs
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  // Left branch arm
  ctx.moveTo(-3.5, -16);
  ctx.lineTo(-9, -20);
  ctx.lineTo(-12, -24);
  ctx.moveTo(-9, -20);
  ctx.lineTo(-8, -26);

  // Center splintered spire
  ctx.moveTo(-1, -17);
  ctx.lineTo(0, -h);
  ctx.lineTo(-2, -h - 2);

  // Right branch arm
  ctx.moveTo(3.5, -15);
  ctx.lineTo(9, -19);
  ctx.lineTo(13, -23);
  ctx.moveTo(9, -19);
  ctx.lineTo(10, -25);

  ctx.stroke();

  // Weathered bark splits
  ctx.lineWidth = lw * 0.55;
  ctx.beginPath();
  ctx.moveTo(-1.2, -1);
  ctx.lineTo(-1.0, -4.5);
  ctx.moveTo(1.2, -1);
  ctx.lineTo(1.0, -4.5);
  ctx.stroke();

  // Exposed skeletal root spurs clawing into earth
  ctx.lineWidth = lw * 0.85;
  ctx.beginPath();
  ctx.moveTo(-3, 0);
  ctx.lineTo(-6, 2);
  ctx.moveTo(3, 0);
  ctx.lineTo(6, 2);
  ctx.stroke();
}

/* =========================================================================
   VILLAGE PATTERNS (村 - 4 PATTERNS)
   ========================================================================= */

// 1. Thatched Hamlet (茅葺きの集落 - 3 clustered rustic cottages, stone well, fence)
function drawVillageHamlet(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.0 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  // Ground dirt path & garden plot
  ctx.strokeStyle = 'rgba(120, 95, 60, 0.4)';
  ctx.lineWidth = lw * 1.4;
  ctx.beginPath();
  ctx.moveTo(-16, 2);
  ctx.quadraticCurveTo(-4, 0, 2, 2);
  ctx.quadraticCurveTo(8, 4, 16, 1);
  ctx.stroke();

  // --- Cottage 1 (Center-Left Main House) ---
  const c1x = -6;
  const c1y = 0;
  // Wall
  ctx.fillStyle = '#f5eedb';
  ctx.fillRect(c1x - 7, c1y - 8, 14, 8);
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.strokeRect(c1x - 7, c1y - 8, 14, 8);

  // Timber framing
  ctx.strokeStyle = '#4e3a24';
  ctx.beginPath();
  ctx.moveTo(c1x, c1y - 8);
  ctx.lineTo(c1x, c1y);
  ctx.moveTo(c1x - 7, c1y - 4);
  ctx.lineTo(c1x + 7, c1y - 4);
  ctx.stroke();

  // Door & Window
  ctx.fillStyle = '#261b11';
  ctx.fillRect(c1x - 2, c1y - 5.5, 3.5, 5.5);
  ctx.fillStyle = '#e8d49a';
  ctx.fillRect(c1x + 2.5, c1y - 6, 3, 2.5);

  // Thatched Roof
  ctx.fillStyle = '#8f6e2b';
  ctx.beginPath();
  ctx.moveTo(c1x - 9, c1y - 8);
  ctx.lineTo(c1x, c1y - 17);
  ctx.lineTo(c1x + 9, c1y - 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Roof thatch lines
  ctx.strokeStyle = '#5a4214';
  ctx.beginPath();
  ctx.moveTo(c1x - 5, c1y - 8);
  ctx.lineTo(c1x - 1, c1y - 14);
  ctx.moveTo(c1x + 5, c1y - 8);
  ctx.lineTo(c1x + 1, c1y - 14);
  ctx.stroke();

  // Stone Chimney & Smoke
  ctx.fillStyle = '#80776b';
  ctx.fillRect(c1x + 4, c1y - 16, 2.5, 5);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(c1x + 4, c1y - 16, 2.5, 5);
  // Woodsmoke
  ctx.strokeStyle = 'rgba(150, 140, 130, 0.55)';
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.moveTo(c1x + 5, c1y - 17);
  ctx.quadraticCurveTo(c1x + 7, c1y - 21, c1x + 4, c1y - 24);
  ctx.quadraticCurveTo(c1x + 2, c1y - 27, c1x + 5, c1y - 29);
  ctx.stroke();

  // --- Cottage 2 (Right smaller cottage) ---
  const c2x = 7;
  const c2y = -1;
  ctx.fillStyle = '#f0e6cf';
  ctx.fillRect(c2x - 5, c2y - 6, 10, 6);
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.strokeRect(c2x - 5, c2y - 6, 10, 6);

  ctx.fillStyle = '#886728';
  ctx.beginPath();
  ctx.moveTo(c2x - 6.5, c2y - 6);
  ctx.lineTo(c2x, c2y - 13);
  ctx.lineTo(c2x + 6.5, c2y - 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  ctx.fillStyle = '#261b11';
  ctx.fillRect(c2x - 1.5, c2y - 4, 2.5, 4);

  // --- Cottage 3 / Barn (Back-left) ---
  ctx.fillStyle = '#6e5223';
  ctx.beginPath();
  ctx.moveTo(-14, -7);
  ctx.lineTo(-9, -13);
  ctx.lineTo(-4, -7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Village Stone Well
  ctx.fillStyle = '#9e9484';
  ctx.fillRect(-14, -2, 4, 3);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-14, -2, 4, 3);
  ctx.beginPath();
  ctx.moveTo(-14, -2);
  ctx.lineTo(-12, -5);
  ctx.lineTo(-10, -2);
  ctx.stroke();

  // Split-rail fence
  ctx.strokeStyle = '#4e3a24';
  ctx.lineWidth = lw * 0.85;
  ctx.beginPath();
  ctx.moveTo(13, -2);
  ctx.lineTo(17, -2);
  ctx.moveTo(14, -4);
  ctx.lineTo(14, 0);
  ctx.moveTo(16, -4);
  ctx.lineTo(16, 0);
  ctx.stroke();
}

// 2. Palisade Village (丸太防塞の村 - timber stockade perimeter, watchtower gate, longhouses)
function drawVillagePalisade(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.0 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  // Back palisade logs (spikes)
  ctx.strokeStyle = '#5a4125';
  ctx.fillStyle = '#6d4f2f';
  ctx.beginPath();
  for (let x = -15; x <= 15; x += 3) {
    const yTop = -13 - Math.sin(((x + 15) / 30) * Math.PI) * 2;
    ctx.moveTo(x - 1.2, -6);
    ctx.lineTo(x, yTop);
    ctx.lineTo(x + 1.2, -6);
  }
  ctx.stroke();

  // Central Longhouse inside
  ctx.fillStyle = '#f4ebd8';
  ctx.fillRect(-8, -10, 16, 6);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-8, -10, 16, 6);

  // Thatched Longhouse Roof
  ctx.fillStyle = '#836325';
  ctx.beginPath();
  ctx.moveTo(-10, -10);
  ctx.lineTo(0, -18);
  ctx.lineTo(10, -10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Front Palisade wall with spiked logs
  const wallY = 0;
  ctx.fillStyle = '#6d4f2f';
  for (let x = -17; x <= 17; x += 3.2) {
    if (x > -3.5 && x < 3.5) continue; // Gate opening
    ctx.beginPath();
    ctx.moveTo(x - 1.3, wallY);
    ctx.lineTo(x - 1.3, wallY - 6.5);
    ctx.lineTo(x, wallY - 8.5); // Spiked tip
    ctx.lineTo(x + 1.3, wallY - 6.5);
    ctx.lineTo(x + 1.3, wallY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK_DARK;
    ctx.stroke();
  }

  // Cross horizontal binding logs
  ctx.strokeStyle = '#3b2b19';
  ctx.beginPath();
  ctx.moveTo(-17, wallY - 3);
  ctx.lineTo(-4, wallY - 3);
  ctx.moveTo(4, wallY - 3);
  ctx.lineTo(17, wallY - 3);
  ctx.stroke();

  // Fortified Wooden Gatehouse
  ctx.fillStyle = '#5c4125';
  ctx.fillRect(-4, wallY - 14, 8, 14);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-4, wallY - 14, 8, 14);

  // Sentry Lookout Platform
  ctx.fillStyle = '#48331d';
  ctx.fillRect(-5.5, wallY - 15, 11, 2);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-5.5, wallY - 15, 11, 2);

  // Gate Opening
  ctx.fillStyle = '#1c150c';
  ctx.fillRect(-2.5, wallY - 5.5, 5, 5.5);
}

// 3. Farming Village (風車と農村 - Dutch timber windmill with rotating sails, cottage, haystack)
function drawVillageFarm(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.0 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  // --- Windmill (Left-Center) ---
  const wx = -6;
  const wy = 0;

  // Stone base & timber tower
  ctx.fillStyle = '#8f8373';
  ctx.beginPath();
  ctx.moveTo(wx - 4.5, wy);
  ctx.lineTo(wx - 3.8, wy - 4);
  ctx.lineTo(wx + 3.8, wy - 4);
  ctx.lineTo(wx + 4.5, wy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Wooden smock tower
  ctx.fillStyle = '#61492c';
  ctx.beginPath();
  ctx.moveTo(wx - 3.8, wy - 4);
  ctx.lineTo(wx - 2.5, wy - 17);
  ctx.lineTo(wx + 2.5, wy - 17);
  ctx.lineTo(wx + 3.8, wy - 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Horizontal timber bands
  ctx.strokeStyle = '#3d2d1b';
  ctx.beginPath();
  ctx.moveTo(wx - 3.4, wy - 8);
  ctx.lineTo(wx + 3.4, wy - 8);
  ctx.moveTo(wx - 2.9, wy - 13);
  ctx.lineTo(wx + 2.9, wy - 13);
  ctx.stroke();

  // Windmill Cap Roof
  ctx.fillStyle = '#9e3b2e';
  ctx.beginPath();
  ctx.moveTo(wx - 3.5, wy - 17);
  ctx.lineTo(wx, wy - 21);
  ctx.lineTo(wx + 3.5, wy - 17);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Windmill 4 Lattice Sails (Diagonal X)
  const sailHubY = wy - 17.5;
  const sailLen = 12;
  ctx.strokeStyle = '#2b2014';
  ctx.lineWidth = lw * 1.1;

  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 4) + (i * Math.PI) / 2;
    const endX = wx + Math.cos(angle) * sailLen;
    const endY = sailHubY + Math.sin(angle) * sailLen;

    // Main spar
    ctx.beginPath();
    ctx.moveTo(wx, sailHubY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Lattice vanes
    const perpX = -Math.sin(angle) * 2.8;
    const perpY = Math.cos(angle) * 2.8;
    ctx.lineWidth = lw * 0.75;
    for (let s = 4; s <= sailLen; s += 3.5) {
      const sx = wx + Math.cos(angle) * s;
      const sy = sailHubY + Math.sin(angle) * s;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + perpX, sy + perpY);
      ctx.stroke();
    }
    ctx.lineWidth = lw * 1.1;
  }

  // --- Farmhouse (Right) ---
  const fx = 7;
  const fy = 0;
  ctx.fillStyle = '#f5eedc';
  ctx.fillRect(fx - 5, fy - 6, 10, 6);
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.strokeRect(fx - 5, fy - 6, 10, 6);

  ctx.fillStyle = '#8a6a26';
  ctx.beginPath();
  ctx.moveTo(fx - 6.5, fy - 6);
  ctx.lineTo(fx, fy - 12);
  ctx.lineTo(fx + 6.5, fy - 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  ctx.fillStyle = '#261b11';
  ctx.fillRect(fx - 1, fy - 4, 2, 4);

  // --- Haystack / Grain Silo (Far Right) ---
  ctx.fillStyle = '#d6a849';
  ctx.beginPath();
  ctx.ellipse(15, -3, 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Post & Rail Paddock Fence
  ctx.strokeStyle = '#4e3a24';
  ctx.beginPath();
  ctx.moveTo(2, -1);
  ctx.lineTo(13, -1);
  ctx.moveTo(3, -3);
  ctx.lineTo(3, 1);
  ctx.moveTo(8, -3);
  ctx.lineTo(8, 1);
  ctx.moveTo(13, -3);
  ctx.lineTo(13, 1);
  ctx.stroke();
}

// 4. Coastal Fishing Village (水辺の漁村 - stilt huts, wooden dock, drying nets, rowboat)
function drawVillageCoastal(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.0 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  // Water Ripple Lines
  ctx.strokeStyle = 'rgba(50, 95, 120, 0.45)';
  ctx.beginPath();
  ctx.moveTo(-16, 2);
  ctx.lineTo(-4, 2);
  ctx.moveTo(-1, 3);
  ctx.lineTo(14, 3);
  ctx.moveTo(-10, 5);
  ctx.lineTo(6, 5);
  ctx.stroke();

  // Wooden Boardwalk Pier on Pilings
  const pierY = -2;
  // Pilings
  ctx.strokeStyle = '#3e2c1c';
  ctx.lineWidth = lw * 1.3;
  ctx.beginPath();
  ctx.moveTo(-12, pierY);
  ctx.lineTo(-12, 3);
  ctx.moveTo(-4, pierY);
  ctx.lineTo(-4, 4);
  ctx.moveTo(4, pierY);
  ctx.lineTo(4, 4);
  ctx.moveTo(12, pierY);
  ctx.lineTo(12, 3);
  ctx.stroke();

  // Boardwalk deck
  ctx.fillStyle = '#6d5337';
  ctx.fillRect(-14, pierY - 1.5, 28, 2);
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.strokeRect(-14, pierY - 1.5, 28, 2);

  // Stilt Hut 1 (Left)
  ctx.fillStyle = '#f2ebd8';
  ctx.fillRect(-11, pierY - 8.5, 8, 7);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-11, pierY - 8.5, 8, 7);

  ctx.fillStyle = '#856424';
  ctx.beginPath();
  ctx.moveTo(-12.5, pierY - 8.5);
  ctx.lineTo(-7, pierY - 15);
  ctx.lineTo(-1.5, pierY - 8.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Stilt Hut 2 (Right)
  ctx.fillStyle = '#ebd5ad';
  ctx.fillRect(1, pierY - 7.5, 7, 6);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(1, pierY - 7.5, 7, 6);

  ctx.fillStyle = '#856424';
  ctx.beginPath();
  ctx.moveTo(-0.5, pierY - 7.5);
  ctx.lineTo(4.5, pierY - 13.5);
  ctx.lineTo(9.5, pierY - 7.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Fish Drying Rack with Hanging Net (Right-center)
  ctx.strokeStyle = '#4e3924';
  ctx.beginPath();
  ctx.moveTo(10, pierY - 1.5);
  ctx.lineTo(10, pierY - 6);
  ctx.lineTo(15, pierY - 6);
  ctx.lineTo(15, pierY - 1.5);
  ctx.stroke();

  // Net mesh
  ctx.strokeStyle = 'rgba(80, 70, 55, 0.45)';
  ctx.lineWidth = lw * 0.7;
  for (let nx = 11; nx <= 14; nx += 1) {
    ctx.beginPath();
    ctx.moveTo(nx, pierY - 6);
    ctx.lineTo(nx, pierY - 3);
    ctx.stroke();
  }

  // Moored Wooden Rowboat with Oar
  ctx.fillStyle = '#5c4125';
  ctx.beginPath();
  ctx.moveTo(-15, 2);
  ctx.quadraticCurveTo(-11, 4.5, -6, 2);
  ctx.lineTo(-7, 0.5);
  ctx.lineTo(-14, 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Oar
  ctx.strokeStyle = '#8d6d3d';
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.lineTo(-8, 3.5);
  ctx.stroke();
}

/* =========================================================================
   TOWNS & CITIES (街・都市 - 4 PATTERNS)
   ========================================================================= */

// 1. Spired Cathedral Capital (尖塔大聖堂都市 - Tolkien style like reference image)
function drawCitySpires(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  // --- Tier 1: Lower Curtain Wall & Gatehouse ---
  const wallY = 0;
  ctx.fillStyle = '#f4f0e6';
  ctx.fillRect(-22, wallY - 10, 44, 10);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-22, wallY - 10, 44, 10);

  // Ashlar stone block lines
  ctx.strokeStyle = 'rgba(50, 40, 30, 0.35)';
  ctx.lineWidth = lw * 0.8;
  for (let wy = wallY - 8; wy < wallY; wy += 3) {
    ctx.beginPath();
    ctx.moveTo(-22, wy);
    ctx.lineTo(22, wy);
    ctx.stroke();
  }

  // Crenellations on lower wall
  ctx.fillStyle = '#f4f0e6';
  ctx.lineWidth = lw;
  for (let bx = -22; bx < 22; bx += 4) {
    ctx.fillRect(bx, wallY - 12, 2.5, 2);
    ctx.strokeRect(bx, wallY - 12, 2.5, 2);
  }

  // Grand Arched Gate
  ctx.fillStyle = '#1c150c';
  ctx.beginPath();
  ctx.rect(-3.5, wallY - 7, 7, 7);
  ctx.arc(0, wallY - 7, 3.5, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // --- Tier 2: Mid-tier Gables & Bastions ---
  // Left Gabled Mansions (Terracotta roofs)
  ctx.fillStyle = '#f0ebe0';
  ctx.fillRect(-17, wallY - 20, 10, 10);
  ctx.strokeRect(-17, wallY - 20, 10, 10);

  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(-18, wallY - 20);
  ctx.lineTo(-12, wallY - 28);
  ctx.lineTo(-6, wallY - 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Right Gabled Mansions (Slate Blue roofs)
  ctx.fillStyle = '#f0ebe0';
  ctx.fillRect(7, wallY - 20, 10, 10);
  ctx.strokeRect(7, wallY - 20, 10, 10);

  ctx.fillStyle = '#2d4559';
  ctx.beginPath();
  ctx.moveTo(6, wallY - 20);
  ctx.lineTo(12, wallY - 28);
  ctx.lineTo(18, wallY - 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // --- Tier 3: Flanking Needle Spire Turrets ---
  // Left Spire Tower
  ctx.fillStyle = '#fbf8f0';
  ctx.fillRect(-19, wallY - 32, 5, 22);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-19, wallY - 32, 5, 22);
  // Conical roof
  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(-19.5, wallY - 32);
  ctx.lineTo(-16.5, wallY - 42);
  ctx.lineTo(-13.5, wallY - 32);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Pennant
  ctx.strokeStyle = INK_DARK;
  ctx.beginPath();
  ctx.moveTo(-16.5, wallY - 42);
  ctx.lineTo(-16.5, wallY - 46);
  ctx.stroke();
  ctx.fillStyle = '#c99e38';
  ctx.beginPath();
  ctx.moveTo(-16.5, wallY - 46);
  ctx.lineTo(-12, wallY - 44);
  ctx.lineTo(-16.5, wallY - 42);
  ctx.fill();

  // Right Spire Tower
  ctx.fillStyle = '#fbf8f0';
  ctx.fillRect(14, wallY - 32, 5, 22);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(14, wallY - 32, 5, 22);
  // Conical roof
  ctx.fillStyle = '#2d4559';
  ctx.beginPath();
  ctx.moveTo(13.5, wallY - 32);
  ctx.lineTo(16.5, wallY - 42);
  ctx.lineTo(19.5, wallY - 32);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Pennant
  ctx.strokeStyle = INK_DARK;
  ctx.beginPath();
  ctx.moveTo(16.5, wallY - 42);
  ctx.lineTo(16.5, wallY - 46);
  ctx.stroke();
  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(16.5, wallY - 46);
  ctx.lineTo(21, wallY - 44);
  ctx.lineTo(16.5, wallY - 42);
  ctx.fill();

  // --- Tier 4: Grand High Cathedral (Center) ---
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-7, wallY - 30, 14, 20);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-7, wallY - 30, 14, 20);

  // Gothic Rose Tracery Window
  ctx.fillStyle = '#221b14';
  ctx.beginPath();
  ctx.arc(0, wallY - 24, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c99e38';
  ctx.lineWidth = lw * 0.8;
  ctx.stroke();

  // Flying Buttresses
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(-7, wallY - 28);
  ctx.quadraticCurveTo(-11, wallY - 24, -13, wallY - 20);
  ctx.moveTo(7, wallY - 28);
  ctx.quadraticCurveTo(11, wallY - 24, 13, wallY - 20);
  ctx.stroke();

  // High Soaring Needle Spire (Reaching to y = -48!)
  ctx.fillStyle = '#f8f5ed';
  ctx.fillRect(-3, wallY - 40, 6, 10);
  ctx.strokeRect(-3, wallY - 40, 6, 10);

  ctx.fillStyle = '#3a506b';
  ctx.beginPath();
  ctx.moveTo(-4, wallY - 40);
  ctx.lineTo(0, wallY - 50);
  ctx.lineTo(4, wallY - 40);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Cathedral Spire Finial & Banner
  ctx.strokeStyle = '#c99e38';
  ctx.lineWidth = lw * 1.2;
  ctx.beginPath();
  ctx.moveTo(0, wallY - 50);
  ctx.lineTo(0, wallY - 54);
  ctx.stroke();
  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(0, wallY - 54);
  ctx.lineTo(5, wallY - 52);
  ctx.lineTo(0, wallY - 50);
  ctx.fill();
}

// 2. Medieval Walled Town (城郭中世都市 - fortified gatehouse, curtain walls, dense gables)
function drawTownWalled(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.0 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Background Town Houses (Peeking over walls)
  // House Left
  ctx.fillStyle = '#8f3928';
  ctx.beginPath();
  ctx.moveTo(-16, base - 10);
  ctx.lineTo(-12, base - 18);
  ctx.lineTo(-8, base - 10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // House Right
  ctx.fillStyle = '#8f3928';
  ctx.beginPath();
  ctx.moveTo(8, base - 10);
  ctx.lineTo(13, base - 19);
  ctx.lineTo(17, base - 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Central Civic Bell Tower
  ctx.fillStyle = '#ede5d5';
  ctx.fillRect(-3, base - 22, 6, 14);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-3, base - 22, 6, 14);
  // Pyramid Roof
  ctx.fillStyle = '#324a5e';
  ctx.beginPath();
  ctx.moveTo(-4, base - 22);
  ctx.lineTo(0, base - 29);
  ctx.lineTo(4, base - 22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Belfry bell arch
  ctx.fillStyle = '#1c150c';
  ctx.fillRect(-1.5, base - 18, 3, 4);

  // Left & Right Curtain Walls
  ctx.fillStyle = '#e8dfd1';
  ctx.fillRect(-20, base - 9, 14, 9);
  ctx.strokeRect(-20, base - 9, 14, 9);
  ctx.fillRect(6, base - 9, 14, 9);
  ctx.strokeRect(6, base - 9, 14, 9);

  // Crenellations on Curtain Walls
  for (let wx = -20; wx <= -8; wx += 3) {
    ctx.fillRect(wx, base - 11, 1.8, 2);
    ctx.strokeRect(wx, base - 11, 1.8, 2);
  }
  for (let wx = 8; wx <= 18; wx += 3) {
    ctx.fillRect(wx, base - 11, 1.8, 2);
    ctx.strokeRect(wx, base - 11, 1.8, 2);
  }

  // Twin-Tower Fortress Gatehouse (Center)
  // Left Drum Tower
  ctx.fillStyle = '#f0e6d6';
  ctx.fillRect(-6.5, base - 15, 4.5, 15);
  ctx.strokeRect(-6.5, base - 15, 4.5, 15);
  ctx.fillRect(-7, base - 17, 5.5, 2); // Parapet
  ctx.strokeRect(-7, base - 17, 5.5, 2);

  // Right Drum Tower
  ctx.fillRect(2, base - 15, 4.5, 15);
  ctx.strokeRect(2, base - 15, 4.5, 15);
  ctx.fillRect(1.5, base - 17, 5.5, 2); // Parapet
  ctx.strokeRect(1.5, base - 17, 5.5, 2);

  // Center Gate arch
  ctx.fillStyle = '#dfd3c3';
  ctx.fillRect(-2, base - 12, 4, 12);
  ctx.strokeRect(-2, base - 12, 4, 12);

  // Arched Portcullis Gateway
  ctx.fillStyle = '#1a140d';
  ctx.beginPath();
  ctx.rect(-2, base - 6, 4, 6);
  ctx.arc(0, base - 6, 2, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Lowered Portcullis Iron Grate
  ctx.strokeStyle = '#5a5045';
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  ctx.moveTo(-1, base - 7);
  ctx.lineTo(-1, base - 1);
  ctx.moveTo(1, base - 7);
  ctx.lineTo(1, base - 1);
  ctx.moveTo(-2, base - 4);
  ctx.lineTo(2, base - 4);
  ctx.stroke();
}

// 3. Canal Merchant Town (運河商業街 - Flemish stepped gables, canal bridge, cargo crane)
function drawTownCanal(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.0 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Canal Water with subtle ripple
  ctx.fillStyle = 'rgba(60, 105, 130, 0.4)';
  ctx.fillRect(-18, base - 2, 36, 4);
  ctx.strokeStyle = 'rgba(30, 65, 85, 0.6)';
  ctx.beginPath();
  ctx.moveTo(-16, base);
  ctx.lineTo(-4, base);
  ctx.moveTo(4, base);
  ctx.lineTo(16, base);
  ctx.stroke();

  // Stone Quayside Embankment
  ctx.fillStyle = '#9b9182';
  ctx.fillRect(-18, base - 4, 36, 2.5);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-18, base - 4, 36, 2.5);

  // Arched Stone Bridge across Canal (Center)
  ctx.fillStyle = '#ded5c5';
  ctx.beginPath();
  ctx.moveTo(-4, base - 4);
  ctx.quadraticCurveTo(0, base - 7, 4, base - 4);
  ctx.lineTo(4, base - 2);
  ctx.arc(0, base - 2, 3, 0, Math.PI, true);
  ctx.lineTo(-4, base - 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Guildhall 1 (Left: Stepped Gable)
  const g1x = -12;
  ctx.fillStyle = '#f0e3cc';
  ctx.fillRect(g1x - 5, base - 12, 10, 8);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(g1x - 5, base - 12, 10, 8);
  // Stepped Gable
  ctx.fillStyle = '#923c2c';
  ctx.beginPath();
  ctx.moveTo(g1x - 5, base - 12);
  ctx.lineTo(g1x - 5, base - 14);
  ctx.lineTo(g1x - 3, base - 14);
  ctx.lineTo(g1x - 3, base - 17);
  ctx.lineTo(g1x - 1, base - 17);
  ctx.lineTo(g1x - 1, base - 20);
  ctx.lineTo(g1x + 1, base - 20);
  ctx.lineTo(g1x + 1, base - 17);
  ctx.lineTo(g1x + 3, base - 17);
  ctx.lineTo(g1x + 3, base - 14);
  ctx.lineTo(g1x + 5, base - 14);
  ctx.lineTo(g1x + 5, base - 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Guildhall 2 (Right: Tall Gable)
  const g2x = 9;
  ctx.fillStyle = '#e8dfcd';
  ctx.fillRect(g2x - 5, base - 14, 10, 10);
  ctx.strokeRect(g2x - 5, base - 14, 10, 10);
  ctx.fillStyle = '#314b60';
  ctx.beginPath();
  ctx.moveTo(g2x - 5.5, base - 14);
  ctx.lineTo(g2x, base - 22);
  ctx.lineTo(g2x + 5.5, base - 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Wooden Dock Treadwheel Crane (Far Left)
  ctx.strokeStyle = '#4e3a24';
  ctx.lineWidth = lw * 1.2;
  ctx.beginPath();
  ctx.moveTo(-16, base - 4);
  ctx.lineTo(-16, base - 12);
  ctx.lineTo(-11, base - 9); // Jib
  ctx.stroke();
  // Hoist line
  ctx.strokeStyle = '#221a12';
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  ctx.moveTo(-11, base - 9);
  ctx.lineTo(-11, base - 3);
  ctx.stroke();

  // Moored Canal Barge (Right)
  ctx.fillStyle = '#543e26';
  ctx.beginPath();
  ctx.moveTo(11, base);
  ctx.lineTo(17, base);
  ctx.lineTo(16, base + 2.5);
  ctx.lineTo(12, base + 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();
}

// 4. Hilltop Citadel City (丘上城塞都市 - acropolis terraced citadel, viaducts, dome)
function drawCityHilltop(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.0 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Rocky Crag Hill Foundation
  ctx.fillStyle = '#b3a594';
  ctx.beginPath();
  ctx.moveTo(-20, base);
  ctx.lineTo(-17, base - 8);
  ctx.lineTo(-7, base - 15);
  ctx.lineTo(7, base - 15);
  ctx.lineTo(17, base - 8);
  ctx.lineTo(20, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Rock strata hatching
  ctx.strokeStyle = 'rgba(40, 32, 22, 0.45)';
  ctx.beginPath();
  ctx.moveTo(-14, base - 4);
  ctx.lineTo(-10, base - 7);
  ctx.moveTo(10, base - 7);
  ctx.lineTo(15, base - 4);
  ctx.stroke();

  // Lower Terraced Villas
  ctx.fillStyle = '#f2ebd8';
  ctx.fillRect(-15, base - 14, 8, 7);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-15, base - 14, 8, 7);
  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(-16, base - 14);
  ctx.lineTo(-11, base - 19);
  ctx.lineTo(-6, base - 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f2ebd8';
  ctx.fillRect(8, base - 13, 7, 6);
  ctx.strokeRect(8, base - 13, 7, 6);
  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(7, base - 13);
  ctx.lineTo(11.5, base - 18);
  ctx.lineTo(16, base - 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Arched Stone Viaduct connecting terraces
  ctx.fillStyle = '#ded5c5';
  ctx.fillRect(-7, base - 14, 14, 3);
  ctx.strokeRect(-7, base - 14, 14, 3);
  ctx.beginPath();
  ctx.arc(-3, base - 11, 2, Math.PI, 0);
  ctx.arc(3, base - 11, 2, Math.PI, 0);
  ctx.fillStyle = '#1c150c';
  ctx.fill();

  // Crown Citadel / Acropolis Hall on summit
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-7, base - 23, 14, 9);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-7, base - 23, 14, 9);

  // Colonnade Pillars
  ctx.strokeStyle = '#3d2e1f';
  for (let px = -5; px <= 5; px += 2.5) {
    ctx.beginPath();
    ctx.moveTo(px, base - 23);
    ctx.lineTo(px, base - 15);
    ctx.stroke();
  }

  // Summit Basilica Dome
  ctx.fillStyle = '#36536b';
  ctx.beginPath();
  ctx.arc(0, base - 23, 5.5, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Golden Spire & Pennant
  ctx.strokeStyle = '#c99e38';
  ctx.beginPath();
  ctx.moveTo(0, base - 28.5);
  ctx.lineTo(0, base - 33);
  ctx.stroke();
}

/* =========================================================================
   PORTS & HARBORS (港 - 2 PATTERNS)
   ========================================================================= */

// 1. Maritime Trading Port (交易港・波止場 - curved sea quay, 3-mast ship, dock crane, barrels)
function drawPortHarbor(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Sea Water basin with wave ripples
  ctx.strokeStyle = 'rgba(40, 90, 115, 0.45)';
  ctx.beginPath();
  ctx.moveTo(-20, base);
  ctx.lineTo(-4, base);
  ctx.moveTo(-16, base + 3);
  ctx.lineTo(-1, base + 3);
  ctx.stroke();

  // Curved Stone Breakwater Jetty / Quay
  ctx.fillStyle = '#ded5c5';
  ctx.beginPath();
  ctx.moveTo(-22, base - 3);
  ctx.quadraticCurveTo(-10, base - 8, 4, base - 8);
  ctx.lineTo(20, base - 8);
  ctx.lineTo(22, base - 2);
  ctx.lineTo(6, base - 2);
  ctx.quadraticCurveTo(-6, base - 2, -18, base + 3);
  ctx.lineTo(-22, base - 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Stone Quayside Mooring Bollards
  ctx.fillStyle = '#2b221a';
  ctx.fillRect(-14, base - 4, 1.8, 2.5);
  ctx.fillRect(-3, base - 7, 1.8, 2.5);
  ctx.fillRect(8, base - 7, 1.8, 2.5);

  // Harbor Customs Warehouse (On the quayside right)
  ctx.fillStyle = '#f2ebd8';
  ctx.fillRect(10, base - 18, 10, 10);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(10, base - 18, 10, 10);
  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(9, base - 18);
  ctx.lineTo(15, base - 25);
  ctx.lineTo(21, base - 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Heavy Timber Dock Crane
  ctx.strokeStyle = '#4e3a24';
  ctx.lineWidth = lw * 1.3;
  ctx.beginPath();
  ctx.moveTo(5, base - 7);
  ctx.lineTo(5, base - 17);
  ctx.lineTo(-2, base - 14); // Jib over water
  ctx.stroke();
  // Pulley rope
  ctx.strokeStyle = '#221a12';
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  ctx.moveTo(-2, base - 14);
  ctx.lineTo(-2, base - 4);
  ctx.stroke();

  // Moored 3-Masted Caravel Ship (Left basin)
  const shipX = -10;
  const shipY = base - 3;
  // Wooden Hull
  ctx.fillStyle = '#5c4125';
  ctx.beginPath();
  ctx.moveTo(shipX - 9, shipY);
  ctx.quadraticCurveTo(shipX, shipY + 4, shipX + 9, shipY);
  ctx.lineTo(shipX + 8, shipY - 3.5);
  ctx.lineTo(shipX - 8, shipY - 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.stroke();

  // 3 Masts with cross-spars
  ctx.strokeStyle = '#3d2b18';
  ctx.lineWidth = lw * 1.0;
  // Fore mast
  ctx.beginPath();
  ctx.moveTo(shipX - 5, shipY - 3);
  ctx.lineTo(shipX - 5, shipY - 16);
  ctx.moveTo(shipX - 8, shipY - 12);
  ctx.lineTo(shipX - 2, shipY - 12);
  // Main mast (tallest)
  ctx.moveTo(shipX, shipY - 3);
  ctx.lineTo(shipX, shipY - 21);
  ctx.moveTo(shipX - 4, shipY - 16);
  ctx.lineTo(shipX + 4, shipY - 16);
  // Mizzen mast
  ctx.moveTo(shipX + 5, shipY - 3);
  ctx.lineTo(shipX + 5, shipY - 14);
  ctx.moveTo(shipX + 2, shipY - 10);
  ctx.lineTo(shipX + 8, shipY - 10);
  ctx.stroke();

  // Furled sails (ivory)
  ctx.fillStyle = '#f8f4ec';
  ctx.fillRect(shipX - 7.5, shipY - 12, 5, 2);
  ctx.fillRect(shipX - 3.5, shipY - 16, 7, 2);

  // Iron Anchor on quay
  ctx.strokeStyle = '#241c14';
  ctx.lineWidth = lw * 0.85;
  ctx.beginPath();
  ctx.arc(1, base - 5, 1.5, 0, Math.PI * 2);
  ctx.moveTo(1, base - 3.5);
  ctx.lineTo(1, base - 1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(1, base - 2, 2.5, 0, Math.PI);
  ctx.stroke();
}

// 2. Coastal Lighthouse Haven (灯台港・白亜の灯台 - rock promontory, glowing beacon, keeper's lodge)
function drawPortLighthouse(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Sea Breakers and Waves
  ctx.strokeStyle = 'rgba(40, 95, 125, 0.45)';
  ctx.beginPath();
  ctx.moveTo(-18, base + 2);
  ctx.lineTo(-4, base + 2);
  ctx.moveTo(4, base + 3);
  ctx.lineTo(18, base + 3);
  ctx.stroke();

  // Craggy Rock Promontory Base
  ctx.fillStyle = '#9b9182';
  ctx.beginPath();
  ctx.moveTo(-16, base);
  ctx.lineTo(-12, base - 6);
  ctx.lineTo(-2, base - 8);
  ctx.lineTo(10, base - 7);
  ctx.lineTo(16, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Keeper's Stone Cottage (Right side)
  ctx.fillStyle = '#eee6d8';
  ctx.fillRect(3, base - 14, 9, 7);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(3, base - 14, 9, 7);
  ctx.fillStyle = '#314b60';
  ctx.beginPath();
  ctx.moveTo(2, base - 14);
  ctx.lineTo(7.5, base - 20);
  ctx.lineTo(13, base - 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Chimney smoke
  ctx.strokeStyle = 'rgba(150, 140, 130, 0.5)';
  ctx.beginPath();
  ctx.moveTo(10, base - 20);
  ctx.quadraticCurveTo(12, base - 24, 9, base - 27);
  ctx.stroke();

  // Lighthouse Tower (Left-Center, Tapering upward)
  const lx = -5;
  ctx.fillStyle = '#faf7ef';
  ctx.beginPath();
  ctx.moveTo(lx - 5, base - 7);
  ctx.lineTo(lx - 3, base - 28);
  ctx.lineTo(lx + 3, base - 28);
  ctx.lineTo(lx + 5, base - 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Red/Dark decorative masonry bands
  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(lx - 4.4, base - 14);
  ctx.lineTo(lx - 3.8, base - 19);
  ctx.lineTo(lx + 3.8, base - 19);
  ctx.lineTo(lx + 4.4, base - 14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Lookout Gallery Balcony
  ctx.fillStyle = '#221a12';
  ctx.fillRect(lx - 5, base - 30, 10, 2);

  // Lantern Chamber (Glass with radiant golden glow)
  ctx.fillStyle = '#fde047';
  ctx.fillRect(lx - 3.5, base - 36, 7, 6);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(lx - 3.5, base - 36, 7, 6);

  // Radiating Light Beams
  ctx.strokeStyle = 'rgba(253, 224, 71, 0.65)';
  ctx.lineWidth = lw * 1.5;
  ctx.beginPath();
  ctx.moveTo(lx - 3.5, base - 33);
  ctx.lineTo(lx - 16, base - 36);
  ctx.moveTo(lx - 3.5, base - 33);
  ctx.lineTo(lx - 15, base - 29);
  ctx.moveTo(lx + 3.5, base - 33);
  ctx.lineTo(lx + 16, base - 36);
  ctx.stroke();

  // Conical Copper Cupola Roof
  ctx.fillStyle = '#2d5040';
  ctx.beginPath();
  ctx.moveTo(lx - 4.5, base - 36);
  ctx.lineTo(lx, base - 43);
  ctx.lineTo(lx + 4.5, base - 36);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Spire Pinnacle
  ctx.strokeStyle = '#c99e38';
  ctx.beginPath();
  ctx.moveTo(lx, base - 43);
  ctx.lineTo(lx, base - 46);
  ctx.stroke();
}

/* =========================================================================
   TOWERS & SPIRES (塔 - 3 PATTERNS)
   ========================================================================= */

// 1. Wizard's Solitary Needle Spire (孤高の魔術師の尖塔 - Reference image iconic tall tower)
function drawTowerWizard(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Rocky Spire Foundation Crag
  ctx.fillStyle = '#a69986';
  ctx.beginPath();
  ctx.moveTo(-8, base);
  ctx.lineTo(-5, base - 7);
  ctx.lineTo(5, base - 7);
  ctx.lineTo(8, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Extremely Tall Slender White Marble Tower Shaft (Height 38px!)
  ctx.fillStyle = '#fbf8f0';
  ctx.beginPath();
  ctx.moveTo(-4.5, base - 7);
  ctx.lineTo(-2.2, base - 37);
  ctx.lineTo(2.2, base - 37);
  ctx.lineTo(4.5, base - 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Shaded side hatching (Right facet)
  ctx.fillStyle = 'rgba(40, 32, 22, 0.2)';
  ctx.beginPath();
  ctx.moveTo(0, base - 37);
  ctx.lineTo(2.2, base - 37);
  ctx.lineTo(4.5, base - 7);
  ctx.lineTo(0, base - 7);
  ctx.closePath();
  ctx.fill();

  // Cantilevered Spiral Exterior Stone Walkway
  ctx.strokeStyle = '#3d2e1f';
  ctx.lineWidth = lw * 1.1;
  ctx.beginPath();
  ctx.moveTo(-5.5, base - 12);
  ctx.quadraticCurveTo(0, base - 15, 5.5, base - 18);
  ctx.moveTo(-4.8, base - 23);
  ctx.quadraticCurveTo(0, base - 26, 4.8, base - 29);
  ctx.stroke();

  // Gothic Lancet Windows with Arcane Azure Glow
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(-1, base - 19, 2, 4);
  ctx.fillRect(-1, base - 31, 2, 4);
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw * 0.8;
  ctx.strokeRect(-1, base - 19, 2, 4);
  ctx.strokeRect(-1, base - 31, 2, 4);

  // Cantilevered Observatory Gallery
  ctx.fillStyle = '#ede5d5';
  ctx.fillRect(-4.5, base - 39, 9, 2.5);
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.strokeRect(-4.5, base - 39, 9, 2.5);

  // Needle Conical Roof Spire
  ctx.fillStyle = '#2c4356';
  ctx.beginPath();
  ctx.moveTo(-3.5, base - 39);
  ctx.lineTo(0, base - 49);
  ctx.lineTo(3.5, base - 39);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Levitating Arcane Glowing Crystal Orb above Spire
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(0, base - 53, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e0f2fe';
  ctx.stroke();

  // Radiating Arcane Spark Rays
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.moveTo(0, base - 57);
  ctx.lineTo(0, base - 59);
  ctx.moveTo(-3.5, base - 53);
  ctx.lineTo(-5.5, base - 53);
  ctx.moveTo(3.5, base - 53);
  ctx.lineTo(5.5, base - 53);
  ctx.stroke();

  // Trailing Crimson Banner from Spire
  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(0, base - 49);
  ctx.quadraticCurveTo(5, base - 47, 7, base - 43);
  ctx.quadraticCurveTo(4, base - 44, 0, base - 45);
  ctx.closePath();
  ctx.fill();
}

// 2. Signal Beacon Watchtower (沿岸狼煙台・烽火塔 - square ashlar stone tower, flaming iron brazier)
function drawTowerBeacon(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Square Tapered Ashlar Stone Tower
  ctx.fillStyle = '#ded5c4';
  ctx.beginPath();
  ctx.moveTo(-6, base);
  ctx.lineTo(-4.2, base - 24);
  ctx.lineTo(4.2, base - 24);
  ctx.lineTo(6, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Ashlar stone block courses
  ctx.strokeStyle = 'rgba(50, 40, 30, 0.35)';
  ctx.lineWidth = lw * 0.8;
  for (let y = base - 20; y < base; y += 4.5) {
    ctx.beginPath();
    ctx.moveTo(-5.5, y);
    ctx.lineTo(5.5, y);
    ctx.stroke();
  }

  // Overhanging Corbelled Machicolations (Hoarding)
  ctx.fillStyle = '#f0e6d6';
  ctx.fillRect(-6.5, base - 27, 13, 3);
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.strokeRect(-6.5, base - 27, 13, 3);

  // Parapet battlements
  ctx.fillRect(-6.5, base - 29, 2.5, 2);
  ctx.strokeRect(-6.5, base - 29, 2.5, 2);
  ctx.fillRect(4, base - 29, 2.5, 2);
  ctx.strokeRect(4, base - 29, 2.5, 2);

  // Arrow Slits
  ctx.fillStyle = '#1c150c';
  ctx.fillRect(-0.8, base - 10, 1.6, 4.5);
  ctx.fillRect(-0.8, base - 18, 1.6, 4.5);

  // Heavy Iron Beacon Fire Brazier Basket
  ctx.fillStyle = '#221a14';
  ctx.beginPath();
  ctx.moveTo(-3.5, base - 27);
  ctx.lineTo(-4.5, base - 31);
  ctx.lineTo(4.5, base - 31);
  ctx.lineTo(3.5, base - 27);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Blazing Beacon Fire (Orange & Gold Flame)
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.moveTo(-4, base - 31);
  ctx.quadraticCurveTo(-1, base - 39, 0, base - 42);
  ctx.quadraticCurveTo(3, base - 38, 4, base - 31);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(-2, base - 31);
  ctx.lineTo(0, base - 37);
  ctx.lineTo(2, base - 31);
  ctx.fill();

  // Plumes of Signal Smoke Rising
  ctx.strokeStyle = 'rgba(70, 60, 50, 0.45)';
  ctx.lineWidth = lw * 1.1;
  ctx.beginPath();
  ctx.moveTo(0, base - 42);
  ctx.quadraticCurveTo(4, base - 46, 1, base - 50);
  ctx.quadraticCurveTo(-2, base - 54, 3, base - 58);
  ctx.stroke();
}

// 3. Fortress Bastion Tower (防衛監視砦塔 - round heavy stone keep, crenellations, gonfalon)
function drawTowerBastion(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Round Stone Bastion Body (With batter slope at base)
  ctx.fillStyle = '#e8dfcf';
  ctx.beginPath();
  ctx.moveTo(-8, base);
  ctx.lineTo(-6.5, base - 20);
  ctx.lineTo(6.5, base - 20);
  ctx.lineTo(8, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Shading cross-hatch on right side
  ctx.fillStyle = 'rgba(40, 30, 20, 0.22)';
  ctx.beginPath();
  ctx.moveTo(0, base - 20);
  ctx.lineTo(6.5, base - 20);
  ctx.lineTo(8, base);
  ctx.lineTo(0, base);
  ctx.closePath();
  ctx.fill();

  // Machicolated Cornice
  ctx.fillStyle = '#ded3bf';
  ctx.fillRect(-8.5, base - 23, 17, 3);
  ctx.strokeStyle = INK_DARK;
  ctx.strokeRect(-8.5, base - 23, 17, 3);

  // Crenellated Battlements
  for (let bx = -8.5; bx <= 6.5; bx += 3.8) {
    ctx.fillRect(bx, base - 26, 2.2, 3);
    ctx.strokeRect(bx, base - 26, 2.2, 3);
  }

  // Heavy Arched Timber-Studded Door
  ctx.fillStyle = '#221910';
  ctx.beginPath();
  ctx.rect(-2.5, base - 7, 5, 7);
  ctx.arc(0, base - 7, 2.5, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Cruciform Arrow Slits
  ctx.strokeStyle = '#1a130c';
  ctx.lineWidth = lw * 1.2;
  ctx.beginPath();
  ctx.moveTo(0, base - 12);
  ctx.lineTo(0, base - 17);
  ctx.moveTo(-2, base - 14.5);
  ctx.lineTo(2, base - 14.5);
  ctx.stroke();

  // Flagstaff & Crimson Gonfalon Banner
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(0, base - 23);
  ctx.lineTo(0, base - 35);
  ctx.stroke();

  ctx.fillStyle = '#8f382a';
  ctx.beginPath();
  ctx.moveTo(0, base - 35);
  ctx.lineTo(7, base - 32);
  ctx.lineTo(0, base - 29);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/* =========================================================================
   DUNGEONS & CATACOMBS (ダンジョン - 4 PATTERNS)
   ========================================================================= */

// 1. Dragon Cave Maw (龍の洞窟・魔境の岩穴 - jagged crag cavern mouth, stalactites, bones)
function drawDungeonCave(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Jagged Rock Crag Facade
  ctx.fillStyle = '#8f8272';
  ctx.beginPath();
  ctx.moveTo(-18, base);
  ctx.lineTo(-16, base - 8);
  ctx.lineTo(-11, base - 17);
  ctx.lineTo(-2, base - 20);
  ctx.lineTo(8, base - 18);
  ctx.lineTo(16, base - 10);
  ctx.lineTo(18, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Fractured Stone Strata & Cracks
  ctx.strokeStyle = '#2b2118';
  ctx.beginPath();
  ctx.moveTo(-14, base - 12);
  ctx.lineTo(-8, base - 14);
  ctx.moveTo(5, base - 15);
  ctx.lineTo(12, base - 12);
  ctx.stroke();

  // Gaping Pitch-Black Cavern Entrance Maw
  ctx.fillStyle = '#100d0a';
  ctx.beginPath();
  ctx.moveTo(-9, base);
  ctx.lineTo(-8, base - 8);
  ctx.quadraticCurveTo(-4, base - 13, 0, base - 13);
  ctx.quadraticCurveTo(5, base - 13, 8, base - 7);
  ctx.lineTo(9, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Hanging Sharp Stalactites from Cavern Roof
  ctx.fillStyle = '#c7bca9';
  ctx.beginPath();
  ctx.moveTo(-5, base - 12);
  ctx.lineTo(-4, base - 7);
  ctx.lineTo(-3, base - 12);
  ctx.moveTo(-1, base - 13);
  ctx.lineTo(0, base - 6);
  ctx.lineTo(1, base - 13);
  ctx.moveTo(3, base - 12);
  ctx.lineTo(4, base - 7.5);
  ctx.lineTo(5, base - 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Rising Stalagmites at Threshold
  ctx.beginPath();
  ctx.moveTo(-6, base);
  ctx.lineTo(-5, base - 4);
  ctx.lineTo(-4, base);
  ctx.moveTo(5, base);
  ctx.lineTo(6, base - 3.5);
  ctx.lineTo(7, base);
  ctx.fill();
  ctx.stroke();

  // Ominous Bleached Skull & Rib Bone remnants at entrance
  ctx.fillStyle = '#faf7ed';
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw * 0.8;
  // Skull
  ctx.beginPath();
  ctx.arc(-11, base - 2, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1a130c';
  ctx.fillRect(-11.5, base - 2.5, 0.8, 0.8);
  ctx.fillRect(-10.5, base - 2.5, 0.8, 0.8);
}

// 2. Overgrown Ancient Temple Ruins (古代巨石の崩落神殿 - fluted columns, cracked entablature, stairs, ivy)
function drawDungeonRuins(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const base = 0;

  // Multi-tier Stepped Stone Stylobate / Platform
  const stoneGrad = ctx.createLinearGradient(0, base - 7, 0, base);
  stoneGrad.addColorStop(0, '#ebe3d5');
  stoneGrad.addColorStop(0.7, '#d6ccba');
  stoneGrad.addColorStop(1, '#a89d88');

  // Bottom step
  ctx.fillStyle = stoneGrad;
  ctx.beginPath();
  ctx.rect(-22, base - 2.5, 44, 2.5);
  ctx.fill();
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Top step / plinth
  ctx.beginPath();
  ctx.rect(-19, base - 5.5, 38, 3);
  ctx.fill();
  ctx.stroke();

  // Pavement flagstone cracks
  ctx.lineWidth = lw * 0.65;
  ctx.beginPath();
  ctx.moveTo(-10, base - 2.5);
  ctx.lineTo(-10, base);
  ctx.moveTo(8, base - 2.5);
  ctx.lineTo(8, base);
  ctx.moveTo(-14, base - 5.5);
  ctx.lineTo(-14, base - 2.5);
  ctx.moveTo(12, base - 5.5);
  ctx.lineTo(12, base - 2.5);
  ctx.stroke();

  // Mysterious Subterranean Stairway descending into blackness
  const abyssGrad = ctx.createLinearGradient(0, base - 5.5, 0, base + 1);
  abyssGrad.addColorStop(0, '#100d0a');
  abyssGrad.addColorStop(1, '#050403');
  ctx.fillStyle = abyssGrad;
  ctx.fillRect(-5.5, base - 5.5, 11, 4.5);
  ctx.strokeStyle = activeColors.ink;
  ctx.strokeRect(-5.5, base - 5.5, 11, 4.5);

  // Stepped descent lines
  ctx.strokeStyle = 'rgba(160, 140, 120, 0.6)';
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  ctx.moveTo(-4.5, base - 4.2);
  ctx.lineTo(4.5, base - 4.2);
  ctx.moveTo(-3.5, base - 2.8);
  ctx.lineTo(3.5, base - 2.8);
  ctx.moveTo(-2.5, base - 1.5);
  ctx.lineTo(2.5, base - 1.5);
  ctx.stroke();

  // --- COLUMN 1 (Left: Majestic Standing Fluted Column) ---
  const colW = 4.8;
  const colH = 22;
  const colX = -14.5;
  const colTop = base - 5.5 - colH;

  // Column cylindrical shading gradient
  const colGrad = ctx.createLinearGradient(colX - colW / 2, 0, colX + colW / 2, 0);
  colGrad.addColorStop(0, '#ded5c5');
  colGrad.addColorStop(0.35, '#faf5ec'); // Sunlit highlight on column shaft
  colGrad.addColorStop(0.75, '#c5baa7');
  colGrad.addColorStop(1, '#8f8371'); // Deep shadow on right edge

  // Base molding (Torus & Plinth)
  ctx.fillStyle = '#cfc4b0';
  ctx.beginPath();
  ctx.rect(colX - colW / 2 - 1.2, base - 5.5 - 2, colW + 2.4, 2);
  ctx.fill();
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Column Shaft
  ctx.fillStyle = colGrad;
  ctx.beginPath();
  ctx.rect(colX - colW / 2, colTop, colW, colH);
  ctx.fill();
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Vertical fluting lines
  ctx.strokeStyle = 'rgba(70, 58, 45, 0.45)';
  ctx.lineWidth = lw * 0.6;
  ctx.beginPath();
  ctx.moveTo(colX - 1.1, colTop + 1);
  ctx.lineTo(colX - 1.1, base - 7.5);
  ctx.moveTo(colX + 0.6, colTop + 1);
  ctx.lineTo(colX + 0.6, base - 7.5);
  ctx.stroke();

  // Capital (Carved classical capital with abacus and echinus)
  ctx.fillStyle = '#ede5d6';
  ctx.beginPath();
  ctx.moveTo(colX - colW / 2 - 1.5, colTop);
  ctx.lineTo(colX + colW / 2 + 1.5, colTop);
  ctx.lineTo(colX + colW / 2 + 0.5, colTop + 2.5);
  ctx.lineTo(colX - colW / 2 - 0.5, colTop + 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Broken Architrave / Entablature beam resting on column 1
  ctx.fillStyle = '#dfd6c5';
  ctx.beginPath();
  ctx.moveTo(colX - colW / 2 - 3, colTop - 4.5);
  ctx.lineTo(colX + 10, colTop - 4.5);
  ctx.lineTo(colX + 8, colTop - 1); // jagged fracture break on right
  ctx.lineTo(colX + 9.5, colTop);
  ctx.lineTo(colX - colW / 2 - 3, colTop);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Engraved glowing ancient runes on architrave
  ctx.strokeStyle = activeColors.accent || '#c99e38';
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.moveTo(colX - 3, colTop - 3.5);
  ctx.lineTo(colX - 1, colTop - 1.5);
  ctx.lineTo(colX + 1, colTop - 3.5);
  ctx.moveTo(colX + 3.5, colTop - 3.5);
  ctx.lineTo(colX + 5, colTop - 1.5);
  ctx.lineTo(colX + 6.5, colTop - 3.5);
  ctx.stroke();

  // --- COLUMN 2 (Right: Snapped Broken Column with Tumbled Drums) ---
  const col2X = 14.5;
  const col2H = 9.5;
  const col2Top = base - 5.5 - col2H;

  // Base molding
  ctx.fillStyle = '#cfc4b0';
  ctx.beginPath();
  ctx.rect(col2X - colW / 2 - 1.2, base - 5.5 - 2, colW + 2.4, 2);
  ctx.fill();
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Snapped column shaft with jagged fracture top
  const col2Grad = ctx.createLinearGradient(col2X - colW / 2, 0, col2X + colW / 2, 0);
  col2Grad.addColorStop(0, '#ded5c5');
  col2Grad.addColorStop(0.35, '#faf5ec');
  col2Grad.addColorStop(1, '#8f8371');

  ctx.fillStyle = col2Grad;
  ctx.beginPath();
  ctx.moveTo(col2X - colW / 2, base - 7.5);
  ctx.lineTo(col2X - colW / 2, col2Top + 1.5);
  ctx.lineTo(col2X - 0.5, col2Top);
  ctx.lineTo(col2X + 1.2, col2Top + 3);
  ctx.lineTo(col2X + colW / 2, col2Top + 1.2);
  ctx.lineTo(col2X + colW / 2, base - 7.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Tumbled Column Drum resting on ground
  ctx.fillStyle = '#d5cbba';
  ctx.beginPath();
  ctx.ellipse(col2X - 5.5, base - 3.5, 3.2, 2.2, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Broken Capital Fragment fallen to the right
  ctx.fillStyle = '#ded5c5';
  ctx.beginPath();
  ctx.moveTo(col2X + 3, base - 2.5);
  ctx.lineTo(col2X + 7, base - 5.5);
  ctx.lineTo(col2X + 8.5, base - 3);
  ctx.lineTo(col2X + 6, base - 1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = activeColors.ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Overgrown Ivy Vines climbing column 1 and spilling over steps
  ctx.strokeStyle = '#3e6332';
  ctx.lineWidth = lw * 1.15;
  ctx.beginPath();
  // Main vine winding around column 1
  ctx.moveTo(colX - colW / 2, base - 5.5);
  ctx.quadraticCurveTo(colX - 1, base - 12, colX - colW / 2 - 0.5, base - 18);
  ctx.quadraticCurveTo(colX + 1.5, base - 23, colX - 1, colTop - 2);
  ctx.stroke();

  // Little ivy leaves along the vine
  ctx.fillStyle = '#4f7d3e';
  const leafNodes = [
    { x: colX - 3.2, y: base - 9 },
    { x: colX + 1.2, y: base - 14 },
    { x: colX - 3.5, y: base - 19 },
    { x: colX + 0.5, y: colTop - 1 },
  ];
  for (const leaf of leafNodes) {
    ctx.beginPath();
    ctx.arc(leaf.x, leaf.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Weathered moss patches at the base
  ctx.fillStyle = 'rgba(60, 95, 45, 0.45)';
  ctx.beginPath();
  ctx.ellipse(colX - 4, base - 1, 3, 1.2, 0, 0, Math.PI * 2);
  ctx.ellipse(col2X + 2, base - 1, 3.5, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 3. Subterranean Crypt & Catacombs (地下迷宮・古代霊廟 - barrow mound, skull keystone, portcullis)
function drawDungeonCrypt(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Earthy Barrow Tumulus Mound
  ctx.fillStyle = '#655744';
  ctx.beginPath();
  ctx.moveTo(-18, base);
  ctx.quadraticCurveTo(0, base - 22, 18, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Grassy turf stipples
  ctx.strokeStyle = '#436136';
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.moveTo(-12, base - 7);
  ctx.lineTo(-11, base - 9);
  ctx.moveTo(11, base - 7);
  ctx.lineTo(12, base - 9);
  ctx.moveTo(0, base - 17);
  ctx.lineTo(0, base - 19);
  ctx.stroke();

  // Massive Cyclopean Stone Portal Entry
  ctx.fillStyle = '#ded5c5';
  ctx.beginPath();
  ctx.moveTo(-9, base);
  ctx.lineTo(-9, base - 11);
  ctx.arc(0, base - 11, 9, Math.PI, 0);
  ctx.lineTo(9, base);
  ctx.lineTo(6, base);
  ctx.lineTo(6, base - 11);
  ctx.arc(0, base - 11, 6, 0, Math.PI, true);
  ctx.lineTo(-6, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Dark Subterranean Crypt Void
  ctx.fillStyle = '#120f0c';
  ctx.beginPath();
  ctx.rect(-6, base - 11, 12, 11);
  ctx.arc(0, base - 11, 6, Math.PI, 0);
  ctx.fill();

  // Raised Iron Portcullis Grate
  ctx.strokeStyle = '#4e4338';
  ctx.lineWidth = lw * 0.8;
  for (let gx = -4; gx <= 4; gx += 2) {
    ctx.beginPath();
    ctx.moveTo(gx, base - 16);
    ctx.lineTo(gx, base - 7); // Spikes
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-5, base - 12);
  ctx.lineTo(5, base - 12);
  ctx.stroke();

  // Horned Skull / Gargoyle Keystone above arch
  ctx.fillStyle = '#f8f5eb';
  ctx.beginPath();
  ctx.arc(0, base - 18, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();
  // Skull eye sockets
  ctx.fillStyle = '#1a130c';
  ctx.fillRect(-1, base - 18.5, 0.8, 0.8);
  ctx.fillRect(0.3, base - 18.5, 0.8, 0.8);

  // Twin Stone Torch Sconces Flanking Entry
  ctx.fillStyle = '#f59e0b';
  // Left flame
  ctx.beginPath();
  ctx.arc(-8, base - 8, 1.8, 0, Math.PI * 2);
  ctx.fill();
  // Right flame
  ctx.beginPath();
  ctx.arc(8, base - 8, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

// 4. Mystical Stone Henge Portal (異界の門・ストーンポータル - megalith ring, swirling void rift)
function drawDungeonPortal(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  const base = 0;

  // Mystic Stone Circle Base Ring
  ctx.strokeStyle = 'rgba(100, 75, 140, 0.35)';
  ctx.lineWidth = lw * 1.5;
  ctx.beginPath();
  ctx.ellipse(0, base - 6, 16, 7, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Left Standing Megalith
  ctx.fillStyle = '#d5cbb8';
  ctx.beginPath();
  ctx.moveTo(-10, base);
  ctx.lineTo(-11, base - 19);
  ctx.lineTo(-7, base - 20);
  ctx.lineTo(-6, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw;
  ctx.stroke();

  // Right Standing Megalith
  ctx.fillStyle = '#d5cbb8';
  ctx.beginPath();
  ctx.moveTo(6, base);
  ctx.lineTo(7, base - 20);
  ctx.lineTo(11, base - 19);
  ctx.lineTo(10, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Massive Lintel Capstone
  ctx.fillStyle = '#e2d9c8';
  ctx.beginPath();
  ctx.moveTo(-13, base - 20);
  ctx.lineTo(-12, base - 24);
  ctx.lineTo(12, base - 24);
  ctx.lineTo(13, base - 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_DARK;
  ctx.stroke();

  // Glowing Carved Arcane Runes
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.moveTo(-9, base - 14);
  ctx.lineTo(-8, base - 12);
  ctx.lineTo(-8, base - 8);
  ctx.moveTo(8, base - 14);
  ctx.lineTo(9, base - 11);
  ctx.stroke();

  // Swirling Void Rift Vortex (Center)
  const grad = ctx.createRadialGradient(0, base - 10, 1, 0, base - 10, 8);
  grad.addColorStop(0, '#c084fc');
  grad.addColorStop(0.5, '#4c1d95');
  grad.addColorStop(1, 'rgba(15, 10, 25, 0.9)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, base - 10, 6, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Swirling Energy Sparkles
  ctx.strokeStyle = '#e9d5ff';
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.arc(0, base - 10, 4, 0.5, 2.5);
  ctx.arc(0, base - 10, 4, 3.6, 5.7);
  ctx.stroke();

  // Floating Stone Fragment Defying Gravity
  ctx.fillStyle = '#beb39f';
  ctx.fillRect(-2, base - 28, 4, 2.5);
  ctx.strokeStyle = INK_DARK;
  ctx.lineWidth = lw * 0.75;
  ctx.strokeRect(-2, base - 28, 4, 2.5);
}

/* =========================================================================
   LEGACY COMPATIBILITY REDIRECTS
   ========================================================================= */
function drawCastleKeep(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  drawTowerBastion(ctx, variant, effectiveZoom);
}
function drawWalledCity(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  drawCitySpires(ctx, variant, effectiveZoom);
}
function drawTown(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  drawTownWalled(ctx, variant, effectiveZoom);
}
function drawWatchtower(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  drawTowerBeacon(ctx, variant, effectiveZoom);
}
function drawVillage(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  drawVillageHamlet(ctx, variant, effectiveZoom);
}
function drawRuins(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  drawDungeonRuins(ctx, variant, effectiveZoom);
}

// 17. Sea Serpent / Leviathan (Coiled mythological ocean dragon)
function drawSeaSerpent(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.7, 1.2 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.save();
  // Serpent Coils Fill & Stroke (Emerald Sea Monster)
  ctx.fillStyle = '#265449';
  ctx.strokeStyle = INK_DARK;

  // Coil 1 (Tail loop)
  ctx.beginPath();
  ctx.ellipse(-18, -2, 6, 10, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Coil 2 (Main arched body)
  ctx.beginPath();
  ctx.ellipse(0, -6, 9, 14, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Serpent Neck & Dragon Head
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.quadraticCurveTo(14, -14, 18, -20);
  ctx.lineTo(24, -22); // Snout
  ctx.lineTo(22, -18); // Lower jaw
  ctx.lineTo(16, -14);
  ctx.lineTo(12, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Dragon Horn / Fin Crest
  ctx.fillStyle = '#9b382d';
  ctx.beginPath();
  ctx.moveTo(17, -21);
  ctx.lineTo(19, -28);
  ctx.lineTo(14, -22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Water splashes/ripples at base
  ctx.strokeStyle = '#a5f3fc';
  ctx.lineWidth = lw * 1.1;
  ctx.beginPath();
  ctx.ellipse(-18, 2, 9, 2.5, 0, 0, Math.PI * 2);
  ctx.ellipse(0, 2, 12, 3, 0, 0, Math.PI * 2);
  ctx.ellipse(10, 2, 10, 2.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// 18. Sailing Ship (Caravel / Galleon with billowing sails)
function drawSailingShip(ctx: CanvasRenderingContext2D, variant: number, effectiveZoom: number): void {
  const lw = Math.max(0.65, 1.05 / effectiveZoom);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.save();

  // Hull (Wood)
  ctx.fillStyle = '#5c432d';
  ctx.strokeStyle = INK_DARK;
  ctx.beginPath();
  ctx.moveTo(-16, -2);
  ctx.lineTo(-12, 4);
  ctx.lineTo(14, 4);
  ctx.lineTo(18, -4);
  ctx.lineTo(14, -2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Masts (Main & Fore)
  ctx.strokeStyle = INK_DARK;
  ctx.beginPath();
  ctx.moveTo(1, 0);
  ctx.lineTo(1, -26); // Main mast
  ctx.moveTo(-8, 0);
  ctx.lineTo(-8, -20); // Mizzen mast
  ctx.moveTo(10, 0);
  ctx.lineTo(10, -18); // Fore mast
  ctx.stroke();

  // Billowing White Sails
  ctx.fillStyle = '#faf8f2';

  // Main sail
  ctx.beginPath();
  ctx.moveTo(-4, -18);
  ctx.quadraticCurveTo(3, -15, 6, -18);
  ctx.lineTo(5, -8);
  ctx.quadraticCurveTo(2, -5, -3, -8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Fore sail
  ctx.beginPath();
  ctx.moveTo(7, -14);
  ctx.quadraticCurveTo(11, -12, 14, -14);
  ctx.lineTo(13, -6);
  ctx.quadraticCurveTo(10, -4, 7, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Mizzen sail (lateen triangular sail)
  ctx.beginPath();
  ctx.moveTo(-8, -18);
  ctx.lineTo(-14, -6);
  ctx.lineTo(-8, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Red Pennant Flag
  ctx.fillStyle = ROOF_RED;
  ctx.beginPath();
  ctx.moveTo(1, -26);
  ctx.lineTo(6, -24);
  ctx.lineTo(1, -22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Wake ripples in water
  ctx.strokeStyle = '#a5f3fc';
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.moveTo(-16, 5);
  ctx.lineTo(-24, 7);
  ctx.moveTo(14, 5);
  ctx.lineTo(20, 6);
  ctx.stroke();

  ctx.restore();
}
