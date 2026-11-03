import React from 'react';
import { Viewport } from '../types/map';

interface ScaleBarProps {
  worldWidthKm: number;
  mapWidth: number;
  viewport: Viewport;
}

export const ScaleBar: React.FC<ScaleBarProps> = ({ worldWidthKm, mapWidth, viewport }) => {
  // Screen pixels per kilometer
  const screenPixelsPerKm = (mapWidth * viewport.zoom) / worldWidthKm;

  // Nice round numbers for scale bar in km (supports world, regions, and town scale down to 10m)
  const candidateKm = [
    0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
  ];

  // Target scale bar width between 75px and 200px
  let chosenKm = candidateKm[candidateKm.length - 1];
  for (const km of candidateKm) {
    const px = km * screenPixelsPerKm;
    if (px >= 75 && px <= 200) {
      chosenKm = km;
      break;
    }
  }

  const barPx = Math.round(chosenKm * screenPixelsPerKm);
  const halfKm = chosenKm / 2;

  const formattedLabel =
    chosenKm < 1
      ? `${Math.round(chosenKm * 1000)} m`
      : chosenKm >= 1000
      ? `${(chosenKm / 1000).toLocaleString()}千 km`
      : `${chosenKm} km`;

  const formattedHalfLabel =
    halfKm < 1
      ? `${Math.round(halfKm * 1000)} m`
      : halfKm >= 1000
      ? `${halfKm / 1000}k`
      : `${halfKm}`;

  return (
    <div className="flex flex-col items-start gap-1 bg-stone-950/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-stone-800 shadow-md text-stone-300 font-mono text-[10px] select-none">
      <div className="flex justify-between w-full text-[9px] text-stone-400">
        <span>0</span>
        <span>{formattedHalfLabel}</span>
        <span>{formattedLabel}</span>
      </div>
      {/* Segmented Cartographic Scale Bar */}
      <div className="flex h-2 border border-stone-600 rounded-sm overflow-hidden" style={{ width: `${barPx}px` }}>
        <div className="w-1/2 bg-amber-500/90 h-full border-r border-stone-900" />
        <div className="w-1/2 bg-stone-200/90 h-full" />
      </div>
    </div>
  );
};
