/**
 * Town Vector Styling Constants & Dynamic Roof Themes
 * Tolkien & Antique Parchment Ink Palette
 */

import { TownBuildingKind, TownDistrictKind, TownRoofTheme } from '../../types/town';
import { mixHex } from '../penSymbols';

export const ROOF_THEMES: readonly TownRoofTheme[] = ['terracotta', 'thatch', 'slate', 'stone'] as const;

export interface RoofPaletteRange {
  min: string;
  max: string;
}

/**
 * Palette ranges [minColor (tone=0), maxColor (tone=1)] per building kind for each theme.
 */
export const ROOF_THEME_PALETTES: Record<TownRoofTheme, Record<TownBuildingKind, RoofPaletteRange>> = {
  terracotta: {
    house: { min: '#b4573b', max: '#c06a45' },
    shop: { min: '#a24a32', max: '#b85f3f' },
    hall: { min: '#8f4a3a', max: '#9c5a46' },
    church: { min: '#6f7a82', max: '#7d8890' }, // Slate accent
    keep: { min: '#d9cdb4', max: '#e6dcc6' },   // Light stone roof with thick outline
    tower: { min: '#8a7a68', max: '#9a8a76' },
    barn: { min: '#8a5a3a', max: '#9a6a44' },
  },
  thatch: {
    house: { min: '#c9a94f', max: '#d6b95f' },
    shop: { min: '#b8973f', max: '#c9a94f' },
    hall: { min: '#a38238', max: '#b8973f' },
    church: { min: '#7d8890', max: '#7d8890' }, // Slate church
    keep: { min: '#d9cdb4', max: '#d9cdb4' },   // Stone keep
    tower: { min: '#8a7a68', max: '#8a7a68' },
    barn: { min: '#b8973f', max: '#c9a94f' },
  },
  slate: {
    // Blue-grey tones: hall & church slightly darker, keep lighter
    house: { min: '#5f6b73', max: '#748088' },
    shop: { min: '#647078', max: '#78848c' },
    hall: { min: '#546068', max: '#68747c' },   // slightly darker
    church: { min: '#525e66', max: '#66727a' }, // slightly darker
    keep: { min: '#7d8890', max: '#8f9aa2' },   // lighter
    tower: { min: '#5a666e', max: '#6e7a82' },
    barn: { min: '#606c74', max: '#748088' },
  },
  stone: {
    // Pale stone tones: stroke and shadow strengthened to read against parchment
    house: { min: '#c9bda0', max: '#d4c8ab' },
    shop: { min: '#c4b89b', max: '#cfc3a6' },
    hall: { min: '#beb295', max: '#c9bda0' },
    church: { min: '#b8ac8f', max: '#c4b89b' },
    keep: { min: '#d0c4a7', max: '#d9cdb4' },
    tower: { min: '#c0b497', max: '#cbbd9d' },
    barn: { min: '#c7bb9e', max: '#d2c6a9' },
  },
};

export const TOWN_STYLE = {
  ink: '#2b2118',
  inkFaded: 'rgba(43, 33, 24, 0.65)',
  inkShadow: 'rgba(43, 33, 24, 0.36)', // Slightly darker base foot shadow for increased contrast
  inkShadowStone: 'rgba(43, 33, 24, 0.44)', // Extra shadow for pale stone theme
  inkHatch: 'rgba(43, 33, 24, 0.45)',

  // Selection outline
  selectionOutline: '#f59e0b', // Amber

  // Stone & masonry
  stoneWall: '#cbbd9d',
  stoneTower: '#d2c5a7',
  keepRoof: '#e6cfab',

  // Roads & paving
  roadMain: '#efe3c0',
  roadStreet: '#ece0ba',
  roadPath: '#e8dcaf',

  // Wood & timber structures
  timberWood: '#b8946a',
  bridgeRailing: '#7e5a38',

  // Districts (low opacity 0.18 - 0.30)
  districtColors: {
    residential: 'rgba(201, 184, 138, 0.24)',
    market: 'rgba(214, 169, 107, 0.28)',
    noble: 'rgba(168, 183, 160, 0.26)',
    poor: 'rgba(181, 157, 122, 0.22)',
    park: 'rgba(157, 179, 122, 0.26)',
    farmland: 'rgba(205, 191, 127, 0.25)',
  } as Record<TownDistrictKind, string>,
} as const;

/**
 * Returns blended roof color based on building kind, tone in [0, 1], and roof theme.
 * Backward compatible with older signature `getRoofColor(tone: number, isKeep?: boolean)`.
 */
export function getRoofColor(
  kindOrTone: TownBuildingKind | number,
  toneOrIsKeep: number | boolean = 0.5,
  themeOrIsKeep: TownRoofTheme | boolean = 'terracotta'
): string {
  let kind: TownBuildingKind = 'house';
  let tone = 0.5;
  let theme: TownRoofTheme = 'terracotta';

  if (typeof kindOrTone === 'number') {
    tone = kindOrTone;
    kind = toneOrIsKeep === true ? 'keep' : 'house';
    theme = typeof themeOrIsKeep === 'string' ? themeOrIsKeep : 'terracotta';
  } else {
    kind = kindOrTone;
    tone = typeof toneOrIsKeep === 'number' ? toneOrIsKeep : 0.5;
    theme = typeof themeOrIsKeep === 'string' ? themeOrIsKeep : 'terracotta';
  }

  const clampedTone = Math.max(0, Math.min(1, tone));
  const palette = ROOF_THEME_PALETTES[theme] || ROOF_THEME_PALETTES.terracotta;
  const range = palette[kind] || palette.house;

  return mixHex(range.min, range.max, clampedTone);
}

/**
 * Returns the outline stroke width multiplier based on theme and building kind.
 * Increases base outline to ~1.2x current, with keeps and stone theme further strengthened.
 */
export function getBuildingOutlineMultiplier(
  theme: TownRoofTheme = 'terracotta',
  isKeep: boolean = false,
  isTower: boolean = false
): number {
  let base = isKeep ? 2.3 : isTower ? 1.7 : 1.2;
  if (theme === 'stone') {
    base *= 1.2; // Strengthen outline when pale stone roofs sit directly on parchment
  }
  return base;
}

/**
 * Returns shadow fill color based on the current roof theme.
 */
export function getBuildingShadowColor(theme: TownRoofTheme = 'terracotta'): string {
  return theme === 'stone' ? TOWN_STYLE.inkShadowStone : TOWN_STYLE.inkShadow;
}

// -----------------------------------------------------------------------------
// Color Difference & Lab Utilities for Visual Validation & Unit Tests
// -----------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rL = r / 255;
  let gL = g / 255;
  let bL = b / 255;
  rL = rL > 0.04045 ? Math.pow((rL + 0.055) / 1.055, 2.4) : rL / 12.92;
  gL = gL > 0.04045 ? Math.pow((gL + 0.055) / 1.055, 2.4) : gL / 12.92;
  bL = bL > 0.04045 ? Math.pow((bL + 0.055) / 1.055, 2.4) : bL / 12.92;

  const x = (rL * 0.4124564 + gL * 0.3575761 + bL * 0.1804375) / 0.95047;
  const y = (rL * 0.2126729 + gL * 0.7151522 + bL * 0.0721750) / 1.00000;
  const z = (rL * 0.0193339 + gL * 0.1191920 + bL * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);
  return [L, a, bVal];
}

/**
 * Calculates Euclidean distance in CIE-Lab color space (CIE76 ΔE*ab).
 */
export function colorDistanceLab(hex1: string, hex2: string): number {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const [L1, a1, bVal1] = rgbToLab(r1, g1, b1);
  const [L2, a2, bVal2] = rgbToLab(r2, g2, b2);
  return Math.hypot(L1 - L2, a1 - a2, bVal1 - bVal2);
}
