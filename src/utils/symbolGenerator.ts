/**
 * Cartographic Symbol Auto-Populator & Scatter Brush Generator
 * Generates natural distributions of mountains, forests, settlements, and sea monsters
 * based on elevation, moisture, and temperature biomes.
 */

import { MapData } from '../types/map';
import { MapSymbolInstance, MapSymbolType } from '../types/symbols';

/**
 * Seeded PRNG for reproducible and deterministic generation
 */
function createPrng(seed: number) {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates natural biome-aware fantasy symbols for a MapData object
 */
export function generateBiomeSymbols(
  mapData: MapData,
  densityMultiplier: number = 1.0
): MapSymbolInstance[] {
  const symbols: MapSymbolInstance[] = [];
  const rng = createPrng(mapData.seed || 123456);

  const { width, height, gridCols, gridRows, elevationGrid, temperatureGrid, seaLevel = 35.0 } = mapData;
  const colStep = width / gridCols;
  const rowStep = height / gridRows;

  // Grid occupancy to prevent excessive overlapping
  const cellSize = 24; // 24px clearance grid
  const occCols = Math.ceil(width / cellSize);
  const occRows = Math.ceil(height / cellSize);
  const occupied = new Uint8Array(occCols * occRows);

  const isOcc = (wx: number, wy: number) => {
    const oc = Math.floor(wx / cellSize);
    const or = Math.floor(wy / cellSize);
    if (oc < 0 || oc >= occCols || or < 0 || or >= occRows) return true;
    return occupied[or * occCols + oc] > 0;
  };

  const markOcc = (wx: number, wy: number, radiusCells: number = 1) => {
    const oc = Math.floor(wx / cellSize);
    const or = Math.floor(wy / cellSize);
    for (let r = -radiusCells; r <= radiusCells; r++) {
      for (let c = -radiusCells; c <= radiusCells; c++) {
        const tc = oc + c;
        const tr = or + r;
        if (tc >= 0 && tc < occCols && tr >= 0 && tr < occRows) {
          occupied[tr * occCols + tc] = 1;
        }
      }
    }
  };

  // Helper to read elevation at world coordinate
  const getElevation = (wx: number, wy: number): number => {
    const gc = Math.max(0, Math.min(gridCols - 1, Math.floor(wx / colStep)));
    const gr = Math.max(0, Math.min(gridRows - 1, Math.floor(wy / rowStep)));
    return elevationGrid[gr * gridCols + gc];
  };

  // Helper to read temperature at world coordinate
  const getTemperature = (wx: number, wy: number): number => {
    const gc = Math.max(0, Math.min(gridCols - 1, Math.floor(wx / colStep)));
    const gr = Math.max(0, Math.min(gridRows - 1, Math.floor(wy / rowStep)));
    return temperatureGrid ? temperatureGrid[gr * gridCols + gc] : 50;
  };

  let idCounter = 1;

  // 1. Scan landscape for Mountain Ranges & Peaks
  const mountainStride = Math.max(22, Math.floor(30 / Math.max(0.6, densityMultiplier)));
  for (let y = 60; y < height - 60; y += mountainStride) {
    for (let x = 60; x < width - 60; x += mountainStride) {
      // Jitter coordinate for organic layout
      const jx = x + (rng() - 0.5) * (mountainStride * 0.7);
      const jy = y + (rng() - 0.5) * (mountainStride * 0.7);

      const elev = getElevation(jx, jy);
      if (elev < seaLevel + 12) continue; // Skip coastal lowlands and ocean

      if (isOcc(jx, jy)) continue;

      let type: MapSymbolType | null = null;
      let scale = 0.85 + rng() * 0.35;

      if (elev >= 78) {
        // High alpine ridge / snow peaks
        type = rng() < 0.65 ? 'mountain_snow' : 'mountain_rock';
        scale = 1.05 + rng() * 0.35;
        markOcc(jx, jy, 2);
      } else if (elev >= 62) {
        // Medium rocky mountain range
        const r = rng();
        type = r < 0.45 ? 'mountain_rock' : r < 0.8 ? 'mountain_ridge' : 'mountain_snow';
        scale = 0.9 + rng() * 0.25;
        markOcc(jx, jy, 1);
      } else if (elev >= 48) {
        // Foothills & mounds
        if (rng() < 0.55 * densityMultiplier) {
          type = rng() < 0.65 ? 'hill_mound' : 'mountain_ridge';
          scale = 0.8 + rng() * 0.25;
          markOcc(jx, jy, 1);
        }
      }

      if (type) {
        symbols.push({
          id: `sym_mtn_${idCounter++}`,
          type,
          x: Math.round(jx),
          y: Math.round(jy),
          scale: Number(scale.toFixed(2)),
          flipX: rng() < 0.4,
          variant: Math.floor(rng() * 3),
        });
      }
    }
  }

  // 2. Scan landscape for Forests (Pine and Oak clusters)
  const forestStride = Math.max(18, Math.floor(24 / Math.max(0.6, densityMultiplier)));
  for (let y = 50; y < height - 50; y += forestStride) {
    for (let x = 50; x < width - 50; x += forestStride) {
      const jx = x + (rng() - 0.5) * (forestStride * 0.8);
      const jy = y + (rng() - 0.5) * (forestStride * 0.8);

      const elev = getElevation(jx, jy);
      // Forests grow on land up to mid elevations
      if (elev < seaLevel + 3 || elev > 66) continue;

      if (isOcc(jx, jy)) continue;

      const temp = getTemperature(jx, jy);

      let type: MapSymbolType | null = null;
      let scale = 0.8 + rng() * 0.3;

      if (temp < 42 || elev > 52) {
        // Cold northern forests / high valleys -> Pine trees
        if (rng() < 0.55 * densityMultiplier) {
          type = rng() < 0.55 ? 'tree_pine_cluster' : 'tree_pine';
          markOcc(jx, jy, 1);
        }
      } else if (temp >= 42 && temp <= 75) {
        // Temperate valleys and plains -> Oak forests
        if (rng() < 0.50 * densityMultiplier) {
          type = rng() < 0.55 ? 'tree_oak_cluster' : 'tree_oak';
          markOcc(jx, jy, 1);
        }
      } else if (temp > 75 && elev < 50) {
        // Arid / desolate plains
        if (rng() < 0.08) {
          type = 'tree_dead';
          markOcc(jx, jy, 1);
        }
      }

      if (type) {
        symbols.push({
          id: `sym_forest_${idCounter++}`,
          type,
          x: Math.round(jx),
          y: Math.round(jy),
          scale: Number(scale.toFixed(2)),
          flipX: rng() < 0.45,
          variant: Math.floor(rng() * 3),
        });
      }
    }
  }

  // 3. Strategic Settlement Placement
  // Find prime spots: sheltered bays, fertile river plains, passes
  const settlementCandidates: { x: number; y: number; coastal: boolean; elev: number }[] = [];
  for (let y = 80; y < height - 80; y += 45) {
    for (let x = 80; x < width - 80; x += 45) {
      const elev = getElevation(x, y);
      if (elev >= seaLevel + 4 && elev <= 64) {
        // Check if coastal (water within 30px)
        let isCoastal = false;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          const testX = x + Math.cos(a) * 32;
          const testY = y + Math.sin(a) * 32;
          if (getElevation(testX, testY) < seaLevel) {
            isCoastal = true;
            break;
          }
        }
        settlementCandidates.push({ x, y, coastal: isCoastal, elev });
      }
    }
  }

  // Shuffle candidates
  for (let i = settlementCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [settlementCandidates[i], settlementCandidates[j]] = [settlementCandidates[j], settlementCandidates[i]];
  }

  let citiesPlaced = 0;
  let portsPlaced = 0;
  let towersPlaced = 0;
  let villagesPlaced = 0;
  let dungeonsPlaced = 0;

  for (const cand of settlementCandidates) {
    if (isOcc(cand.x, cand.y)) continue;

    let type: MapSymbolType | null = null;
    let scale = 1.0;

    if (citiesPlaced < 4 && !cand.coastal && cand.elev < 52) {
      // Major inland capital walled cities & canal towns
      const cityTypes: MapSymbolType[] = ['city_spires', 'town_walled', 'town_canal', 'city_hilltop'];
      type = cityTypes[citiesPlaced % cityTypes.length];
      scale = 1.15;
      citiesPlaced++;
      markOcc(cand.x, cand.y, 2);
    } else if (portsPlaced < 3 && cand.coastal) {
      // Coastal ports & lighthouses
      type = rng() < 0.6 ? 'port_harbor' : 'port_lighthouse';
      scale = 1.05;
      portsPlaced++;
      markOcc(cand.x, cand.y, 2);
    } else if (towersPlaced < 3) {
      // Spires & watchtowers (Wizard spire, beacon, bastion)
      if (cand.elev > 45) {
        type = 'tower_wizard'; // Mountain wizard spire
      } else if (cand.coastal) {
        type = 'tower_beacon'; // Coastal beacon
      } else {
        type = 'tower_bastion'; // Frontier bastion
      }
      scale = 1.0;
      towersPlaced++;
      markOcc(cand.x, cand.y, 1);
    } else if (dungeonsPlaced < 4 && cand.elev >= 38) {
      // Dungeons & ruins in wild highland/rocky areas
      const dungTypes: MapSymbolType[] = ['dungeon_cave', 'dungeon_ruins', 'dungeon_crypt', 'dungeon_portal'];
      type = dungTypes[Math.floor(rng() * dungTypes.length)];
      scale = 1.0;
      dungeonsPlaced++;
      markOcc(cand.x, cand.y, 1);
    } else if (villagesPlaced < 9) {
      // Rich village patterns based on geography
      if (cand.coastal) {
        type = 'village_coastal';
      } else if (cand.elev < 35) {
        type = rng() < 0.5 ? 'village_farm' : 'village_hamlet';
      } else {
        type = rng() < 0.5 ? 'village_palisade' : 'village_hamlet';
      }
      scale = 0.95;
      villagesPlaced++;
      markOcc(cand.x, cand.y, 1);
    }

    if (type) {
      symbols.push({
        id: `sym_settlement_${idCounter++}`,
        type,
        x: Math.round(cand.x),
        y: Math.round(cand.y),
        scale,
        variant: 0,
      });
    }

    if (citiesPlaced + portsPlaced + towersPlaced + villagesPlaced + dungeonsPlaced >= 22) break;
  }

  // 4. Maritime Lore: Sea Serpent & Sailing Ship in the ocean
  const oceanCandidates: { x: number; y: number }[] = [];
  for (let y = 120; y < height - 120; y += 60) {
    for (let x = 120; x < width - 120; x += 60) {
      const elev = getElevation(x, y);
      if (elev < seaLevel - 15) {
        // Deep ocean away from land
        oceanCandidates.push({ x, y });
      }
    }
  }

  if (oceanCandidates.length > 0) {
    // Pick 1-2 sea serpent locations
    const serpentSpot = oceanCandidates[Math.floor(rng() * oceanCandidates.length)];
    if (serpentSpot) {
      symbols.push({
        id: `sym_sea_monster_${idCounter++}`,
        type: 'sea_serpent',
        x: serpentSpot.x,
        y: serpentSpot.y,
        scale: 1.15,
        flipX: rng() < 0.5,
        variant: 0,
      });
    }

    // Pick 1-2 sailing ship locations
    const shipSpot = oceanCandidates[(Math.floor(rng() * oceanCandidates.length) + 5) % oceanCandidates.length];
    if (shipSpot && Math.hypot(shipSpot.x - serpentSpot.x, shipSpot.y - serpentSpot.y) > 180) {
      symbols.push({
        id: `sym_ship_${idCounter++}`,
        type: 'sailing_ship',
        x: shipSpot.x,
        y: shipSpot.y,
        scale: 1.0,
        flipX: rng() < 0.5,
        variant: 0,
      });
    }
  }

  return symbols;
}

/**
 * Scatters symbols under a brush stroke (for tree brush or mountain brush)
 */
export function scatterSymbolsUnderBrush(
  centerX: number,
  centerY: number,
  type: MapSymbolType,
  brushRadius: number,
  density: number = 3,
  existingSymbols: MapSymbolInstance[],
  customAssetId?: string
): MapSymbolInstance[] {
  const newSymbols: MapSymbolInstance[] = [];
  const minDistance = type.startsWith('tree') ? 14 : type.startsWith('mountain') ? 28 : 32;

  // Number of items to attempt placing per dab
  const count = Math.max(1, Math.min(8, Math.round(density * (brushRadius / 50))));

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * (brushRadius * 0.85);
    const px = Math.round(centerX + Math.cos(angle) * dist);
    const py = Math.round(centerY + Math.sin(angle) * dist);

    // Check minimum distance to existing symbols
    let tooClose = false;
    for (const sym of existingSymbols) {
      if (Math.hypot(sym.x - px, sym.y - py) < minDistance) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const scale = 0.85 + Math.random() * 0.3;
    const newSym: MapSymbolInstance = {
      id: `sym_paint_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type,
      customAssetId,
      x: px,
      y: py,
      scale: Number(scale.toFixed(2)),
      flipX: Math.random() < 0.5,
      variant: Math.floor(Math.random() * 3),
    };

    newSymbols.push(newSym);
    existingSymbols.push(newSym); // Prevent clumping within same dab
  }

  return newSymbols;
}
