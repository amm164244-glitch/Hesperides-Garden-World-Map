/**
 * Town Vector Styling Constants
 * Tolkien & Antique Parchment Ink Palette
 */

import { TownDistrictKind } from '../../types/town';
import { mixHex } from '../penSymbols';

export const TOWN_STYLE = {
  ink: '#2b2118',
  inkFaded: 'rgba(43, 33, 24, 0.65)',
  inkShadow: 'rgba(43, 33, 24, 0.28)',
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

  // Roof tonal palettes
  roofTones: ['#d8bc8f', '#cfae7e', '#c49e6f', '#dcc49b'] as const,

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
 * Returns blended roof color based on tone in [0, 1].
 */
export function getRoofColor(tone: number, isKeep: boolean = false): string {
  if (isKeep) return TOWN_STYLE.keepRoof;
  const tones = TOWN_STYLE.roofTones;
  const clamped = Math.max(0, Math.min(0.999, tone));
  const segment = clamped * (tones.length - 1);
  const idx = Math.floor(segment);
  const frac = segment - idx;
  return mixHex(tones[idx], tones[idx + 1], frac);
}
