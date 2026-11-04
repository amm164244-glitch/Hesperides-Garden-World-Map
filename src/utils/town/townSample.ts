/**
 * Deterministic Sample Town Procedural Generator
 * Generates an authentic medieval fortified settlement adapted to water and terrain:
 * - Only places piers if a valid shoreline is detected in the map interior.
 * - Prevents buildings from being placed on water.
 * - Fully deterministic with seed.
 */

import {
  Pt,
  TownBuilding,
  TownDistrict,
  TownObject,
  TownPier,
  TownRoad,
  TownWall,
} from '../../types/town';
import { makeRng } from '../penSymbols';
import { metersToUnits, pointInPolygon, polygonCentroid } from './townGeometry';

export interface TerrainWaterSampler {
  isWater: (x: number, y: number) => boolean;
}

export interface SampleTownStats {
  skippedBuildingsCount: number;
  pierPlaced: boolean;
}

export type SampleTownResult = TownObject[] & { stats: SampleTownStats };

/**
 * Creates a smooth bilinear terrain water sampler from an elevation grid.
 * Any coordinate with elevation < seaLevel is identified as water.
 */
export function createTerrainWaterSampler(
  elevationGrid: Float32Array,
  gridCols: number,
  gridRows: number,
  width: number,
  height: number,
  seaLevel: number
): TerrainWaterSampler {
  return {
    isWater: (x: number, y: number): boolean => {
      if (gridCols <= 1 || gridRows <= 1 || width <= 0 || height <= 0) {
        return false;
      }
      const gx = Math.max(0, Math.min(gridCols - 1, (x / width) * (gridCols - 1)));
      const gy = Math.max(0, Math.min(gridRows - 1, (y / height) * (gridRows - 1)));
      const c0 = Math.floor(gx);
      const r0 = Math.floor(gy);
      const c1 = Math.min(gridCols - 1, c0 + 1);
      const r1 = Math.min(gridRows - 1, r0 + 1);
      const fx = gx - c0;
      const fy = gy - r0;

      const e00 = elevationGrid[r0 * gridCols + c0];
      const e10 = elevationGrid[r0 * gridCols + c1];
      const e01 = elevationGrid[r1 * gridCols + c0];
      const e11 = elevationGrid[r1 * gridCols + c1];

      const elev = (e00 * (1 - fx) + e10 * fx) * (1 - fy) + (e01 * (1 - fx) + e11 * fx) * fy;
      return elev < seaLevel;
    },
  };
}

export function generateSampleTown(
  width: number,
  height: number,
  metersPerUnit: number,
  seed: number = 42875,
  terrain?: TerrainWaterSampler
): SampleTownResult {
  const rng = makeRng(seed);
  const objects: TownObject[] = [];

  const cx = width / 2;
  const cy = height / 2;

  // Town diameter scaled to ~60% of map width
  const rx = width * 0.29;
  const ry = Math.min(height * 0.35, rx * (height / width));

  let skippedBuildingsCount = 0;
  let pierPlaced = false;

  const isBuildingOnWater = (poly: Pt[]): boolean => {
    if (!terrain) return false;
    const c = polygonCentroid(poly);
    if (terrain.isWater(c[0], c[1])) return true;
    for (const pt of poly) {
      if (terrain.isWater(pt[0], pt[1])) return true;
    }
    return false;
  };

  // ---------------------------------------------------------------------------
  // 1. Fortified Town Wall (12-vertex oval with corner towers and 2 gates)
  // ---------------------------------------------------------------------------
  const wallVertCount = 12;
  const wallPoints: Pt[] = [];

  for (let i = 0; i < wallVertCount; i++) {
    const angle = (i / wallVertCount) * Math.PI * 2;
    const jitterR = 1.0 + (rng() - 0.5) * 0.08;
    const px = cx + Math.cos(angle) * rx * jitterR;
    const py = cy + Math.sin(angle) * ry * jitterR;
    wallPoints.push([
      Math.max(10, Math.min(width - 10, px)),
      Math.max(10, Math.min(height - 10, py)),
    ]);
  }

  // Gates on East (segment 0/1) and West (segment 6/7)
  const wall: TownWall = {
    id: `wall_${seed}_main`,
    name: '防壁 (城壁)',
    kind: 'wall',
    points: wallPoints,
    closed: true,
    thicknessM: 4.5,
    towers: true,
    towerRadiusM: 5.5,
    gates: [
      { segmentIndex: 0, t: 0.5, widthM: 9.0 },
      { segmentIndex: 6, t: 0.5, widthM: 9.0 },
    ],
  };

  const eastGatePt: Pt = [
    (wallPoints[0][0] + wallPoints[1][0]) / 2,
    (wallPoints[0][1] + wallPoints[1][1]) / 2,
  ];
  const westGatePt: Pt = [
    (wallPoints[6][0] + wallPoints[7][0]) / 2,
    (wallPoints[6][1] + wallPoints[7][1]) / 2,
  ];

  // ---------------------------------------------------------------------------
  // 2. Main Roads & Intersecting Streets
  // ---------------------------------------------------------------------------
  const mainRoadPoints: Pt[] = [
    [westGatePt[0] - width * 0.06, westGatePt[1]],
    westGatePt,
    [cx - rx * 0.35, cy + ry * 0.05],
    [cx, cy],
    [cx + rx * 0.35, cy - ry * 0.04],
    eastGatePt,
    [eastGatePt[0] + width * 0.06, eastGatePt[1]],
  ];

  const mainRoad: TownRoad = {
    id: `road_${seed}_main_thoroughfare`,
    name: '大通り (東大路・西門通り)',
    kind: 'road',
    style: 'main',
    points: mainRoadPoints,
    widthM: 7.5,
    smooth: true,
  };
  objects.push(mainRoad);

  // Cross street (North-South axis)
  const northPt: Pt = [cx - rx * 0.05, cy - ry * 0.88];
  const southPt: Pt = [cx + rx * 0.04, cy + ry * 0.88];
  const northSouthRoad: TownRoad = {
    id: `road_${seed}_north_south`,
    name: '中央通り (南北街路)',
    kind: 'road',
    style: 'street',
    points: [
      northPt,
      [cx - rx * 0.02, cy - ry * 0.4],
      [cx, cy],
      [cx + rx * 0.03, cy + ry * 0.4],
      southPt,
    ],
    widthM: 5.5,
    smooth: true,
  };
  objects.push(northSouthRoad);

  // Alley / Ring Paths following inside perimeter of the wall
  const innerRingPoints: Pt[] = wallPoints.map(([wx, wy]) => {
    return [
      cx + (wx - cx) * 0.86,
      cy + (wy - cy) * 0.86,
    ];
  });
  const innerRingRoad: TownRoad = {
    id: `road_${seed}_inner_ring`,
    name: '城壁沿い小路',
    kind: 'road',
    style: 'path',
    points: innerRingPoints,
    widthM: 3.5,
    smooth: true,
  };
  objects.push(innerRingRoad);

  // ---------------------------------------------------------------------------
  // 3. Zoning Districts
  // ---------------------------------------------------------------------------
  const marketDistrict: TownDistrict = {
    id: `dist_${seed}_market`,
    name: '中央市場広場',
    kind: 'district',
    districtKind: 'market',
    polygon: [
      [cx - rx * 0.28, cy - ry * 0.22],
      [cx + rx * 0.28, cy - ry * 0.22],
      [cx + rx * 0.28, cy + ry * 0.22],
      [cx - rx * 0.28, cy + ry * 0.22],
    ],
  };

  const nobleDistrict: TownDistrict = {
    id: `dist_${seed}_noble`,
    name: '領主・貴族街区',
    kind: 'district',
    districtKind: 'noble',
    polygon: [
      [cx - rx * 0.8, cy - ry * 0.8],
      [cx - rx * 0.05, cy - ry * 0.85],
      [cx - rx * 0.05, cy - ry * 0.25],
      [cx - rx * 0.75, cy - ry * 0.15],
    ],
  };

  const residentialNorthEast: TownDistrict = {
    id: `dist_${seed}_res_ne`,
    name: '北東住宅街区',
    kind: 'district',
    districtKind: 'residential',
    polygon: [
      [cx + rx * 0.08, cy - ry * 0.82],
      [cx + rx * 0.82, cy - ry * 0.75],
      [cx + rx * 0.78, cy - ry * 0.15],
      [cx + rx * 0.08, cy - ry * 0.22],
    ],
  };

  const residentialSouth: TownDistrict = {
    id: `dist_${seed}_res_s`,
    name: '南部職人・居住街区',
    kind: 'district',
    districtKind: 'residential',
    polygon: [
      [cx - rx * 0.75, cy + ry * 0.22],
      [cx + rx * 0.75, cy + ry * 0.22],
      [cx + rx * 0.65, cy + ry * 0.8],
      [cx - rx * 0.65, cy + ry * 0.8],
    ],
  };

  const farmlandOutside: TownDistrict = {
    id: `dist_${seed}_farm`,
    name: '城外農耕地区',
    kind: 'district',
    districtKind: 'farmland',
    polygon: [
      [cx + rx * 0.9, cy + ry * 0.3],
      [width - 15, cy + ry * 0.2],
      [width - 15, height - 15],
      [cx + rx * 0.6, height - 15],
    ],
  };

  objects.push(marketDistrict, nobleDistrict, residentialNorthEast, residentialSouth, farmlandOutside);

  // ---------------------------------------------------------------------------
  // 4. Pier Placement: only where water exists in map interior
  // ---------------------------------------------------------------------------
  if (terrain) {
    const minMarginX = width * 0.05;
    const maxMarginX = width * 0.95;
    const minMarginY = height * 0.05;
    const maxMarginY = height * 0.95;

    // Search 16 directions outward from town center
    interface ShoreCandidate {
      dirIndex: number;
      dx: number;
      dy: number;
      distFromCenter: number;
      shorePt: Pt;
    }
    const candidates: ShoreCandidate[] = [];

    const numDirections = 16;
    const stepSize = Math.max(1.0, metersToUnits(2, metersPerUnit));
    const maxRayDist = Math.hypot(width, height);

    for (let d = 0; d < numDirections; d++) {
      const ang = (d / numDirections) * Math.PI * 2;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);

      let prevIsWater = terrain.isWater(cx, cy);
      let prevX = cx;
      let prevY = cy;

      // March outward from center
      for (let dist = stepSize; dist < maxRayDist; dist += stepSize) {
        const px = cx + dx * dist;
        const py = cy + dy * dist;

        // Stop if outside outer margin
        if (px < minMarginX || px > maxMarginX || py < minMarginY || py > maxMarginY) {
          break;
        }

        const currIsWater = terrain.isWater(px, py);
        if (!prevIsWater && currIsWater) {
          // Found Land -> Water shoreline transition!
          const shoreX = (prevX + px) / 2;
          const shoreY = (prevY + py) / 2;

          candidates.push({
            dirIndex: d,
            dx,
            dy,
            distFromCenter: dist,
            shorePt: [shoreX, shoreY],
          });
          break;
        }

        prevIsWater = currIsWater;
        prevX = px;
        prevY = py;
      }
    }

    if (candidates.length > 0) {
      // Pick direction with the closest shoreline to town center
      candidates.sort((a, b) => a.distFromCenter - b.distFromCenter);
      const best = candidates[0];

      const inshoreUnits = metersToUnits(2, metersPerUnit);
      const pierLenUnits = metersToUnits(25, metersPerUnit);

      // Start on land (~2m inside shore)
      const startX = best.shorePt[0] - best.dx * inshoreUnits;
      const startY = best.shorePt[1] - best.dy * inshoreUnits;

      // End in water (~25m total length, clamped inside map)
      const rawEndX = best.shorePt[0] + best.dx * (pierLenUnits - inshoreUnits);
      const rawEndY = best.shorePt[1] + best.dy * (pierLenUnits - inshoreUnits);
      const endX = Math.max(minMarginX, Math.min(maxMarginX, rawEndX));
      const endY = Math.max(minMarginY, Math.min(maxMarginY, rawEndY));

      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;

      // Ensure start is on land and end is in water
      if (!terrain.isWater(startX, startY) && terrain.isWater(endX, endY)) {
        const townPier: TownPier = {
          id: `pier_${seed}_waterfront`,
          name: '水辺の桟橋 (Pier)',
          kind: 'pier',
          variant: 'pier',
          points: [
            [startX, startY],
            [midX, midY],
            [endX, endY],
          ],
          widthM: 5.5,
        };
        objects.push(townPier);
        pierPlaced = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Buildings Placement (Zero building placed on water)
  // ---------------------------------------------------------------------------
  const buildings: TownBuilding[] = [];
  const placedBoxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [];

  const collides = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
    for (const p of placedBoxes) {
      if (
        !(
          b.maxX < p.minX ||
          b.minX > p.maxX ||
          b.maxY < p.minY ||
          b.minY > p.maxY
        )
      ) {
        return true;
      }
    }
    return false;
  };

  const createRectPoly = (
    bx: number,
    by: number,
    bwUnits: number,
    bhUnits: number,
    angleRad: number
  ): Pt[] => {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const hw = bwUnits / 2;
    const hh = bhUnits / 2;
    const corners: [number, number][] = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    return corners.map(([dx, dy]) => [
      bx + (dx * cos - dy * sin),
      by + (dx * sin + dy * cos),
    ]);
  };

  // Centerpiece 1: The Great Keep (in Noble Quarter)
  const keepX = cx - rx * 0.42;
  const keepY = cy - ry * 0.48;
  const keepW = metersToUnits(18, metersPerUnit);
  const keepH = metersToUnits(24, metersPerUnit);
  const keepPoly = createRectPoly(keepX, keepY, keepW, keepH, 0.08);

  if (isBuildingOnWater(keepPoly)) {
    skippedBuildingsCount++;
  } else {
    placedBoxes.push({
      minX: keepX - keepW / 2 - 2,
      minY: keepY - keepH / 2 - 2,
      maxX: keepX + keepW / 2 + 2,
      maxY: keepY + keepH / 2 + 2,
    });
    buildings.push({
      id: `bld_${seed}_keep`,
      name: '領主の主城 (Keep)',
      kind: 'building',
      buildingKind: 'keep',
      polygon: keepPoly,
      heightM: 22,
      tone: 0.1,
    });
  }

  // Centerpiece 2: Grand Cathedral / Church (near Market)
  const churchX = cx + rx * 0.28;
  const churchY = cy - ry * 0.32;
  const churchW = metersToUnits(16, metersPerUnit);
  const churchH = metersToUnits(26, metersPerUnit);
  const churchPoly = createRectPoly(churchX, churchY, churchW, churchH, -0.15);

  if (isBuildingOnWater(churchPoly)) {
    skippedBuildingsCount++;
  } else {
    placedBoxes.push({
      minX: churchX - churchW / 2 - 2,
      minY: churchY - churchH / 2 - 2,
      maxX: churchX + churchW / 2 + 2,
      maxY: churchY + churchH / 2 + 2,
    });
    buildings.push({
      id: `bld_${seed}_church`,
      name: '大聖堂 (Cathedral)',
      kind: 'building',
      buildingKind: 'church',
      polygon: churchPoly,
      heightM: 19,
      tone: 0.25,
    });
  }

  // Centerpiece 3: Watchtower / Bell Tower
  const towerX = cx + rx * 0.02;
  const towerY = cy - ry * 0.12;
  const towerRadius = metersToUnits(5, metersPerUnit);
  const towerPoly: Pt[] = [];
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    towerPoly.push([
      towerX + Math.cos(ang) * towerRadius,
      towerY + Math.sin(ang) * towerRadius,
    ]);
  }

  if (isBuildingOnWater(towerPoly)) {
    skippedBuildingsCount++;
  } else {
    placedBoxes.push({
      minX: towerX - towerRadius - 2,
      minY: towerY - towerRadius - 2,
      maxX: towerX + towerRadius + 2,
      maxY: towerY + towerRadius + 2,
    });
    buildings.push({
      id: `bld_${seed}_tower`,
      name: '鐘楼・見張り塔',
      kind: 'building',
      buildingKind: 'tower',
      polygon: towerPoly,
      heightM: 17,
      tone: 0.85,
    });
  }

  // Generate townhouses across the inner districts
  const candidateDistricts = [
    { dist: marketDistrict, type: 'shop' as const, count: 32 },
    { dist: nobleDistrict, type: 'hall' as const, count: 28 },
    { dist: residentialNorthEast, type: 'house' as const, count: 48 },
    { dist: residentialSouth, type: 'house' as const, count: 52 },
  ];

  let bldIndex = 1;
  for (const { dist, type, count } of candidateDistricts) {
    let placed = 0;
    let attempts = 0;

    let dMinX = Infinity;
    let dMinY = Infinity;
    let dMaxX = -Infinity;
    let dMaxY = -Infinity;
    for (const [px, py] of dist.polygon) {
      if (px < dMinX) dMinX = px;
      if (py < dMinY) dMinY = py;
      if (px > dMaxX) dMaxX = px;
      if (py > dMaxY) dMaxY = py;
    }

    while (placed < count && attempts < count * 8) {
      attempts++;
      const bx = dMinX + rng() * (dMaxX - dMinX);
      const by = dMinY + rng() * (dMaxY - dMinY);

      if (!pointInPolygon([bx, by], dist.polygon)) continue;
      if (!pointInPolygon([bx, by], wallPoints)) continue;

      const bwM = 6.0 + rng() * 6.0;
      const bhM = 8.0 + rng() * 7.0;
      const bwUnits = metersToUnits(bwM, metersPerUnit);
      const bhUnits = metersToUnits(bhM, metersPerUnit);
      const angle = (rng() - 0.5) * 0.4;

      const poly = createRectPoly(bx, by, bwUnits, bhUnits, angle);

      // Water collision check: Discard building if centroid or vertices sit on water
      if (isBuildingOnWater(poly)) {
        skippedBuildingsCount++;
        continue;
      }

      const halfD = Math.max(bwUnits, bhUnits) * 0.7;
      const box = {
        minX: bx - halfD - 0.8,
        minY: by - halfD - 0.8,
        maxX: bx + halfD + 0.8,
        maxY: by + halfD + 0.8,
      };

      if (collides(box)) continue;

      placedBoxes.push(box);
      placed++;

      buildings.push({
        id: `bld_${seed}_${bldIndex++}`,
        name: type === 'shop' ? '商家・工房' : type === 'hall' ? '邸宅' : '町屋',
        kind: 'building',
        buildingKind: type,
        polygon: poly,
        heightM: 6.0 + rng() * 4.5,
        tone: rng(),
      });
    }
  }

  // Barns and farm cottages in outer farmland
  let barnAttempts = 0;
  let barnsPlaced = 0;
  while (barnsPlaced < 6 && barnAttempts < 50) {
    barnAttempts++;
    const fx = cx + rx * 0.8 + rng() * (width - cx - rx * 0.8 - 25);
    const fy = cy + ry * 0.4 + rng() * (height - cy - ry * 0.4 - 25);

    if (fx >= width - 10 || fy >= height - 10) continue;

    const bwM = 10.0 + rng() * 8.0;
    const bhM = 14.0 + rng() * 8.0;
    const bwUnits = metersToUnits(bwM, metersPerUnit);
    const bhUnits = metersToUnits(bhM, metersPerUnit);

    const poly = createRectPoly(fx, fy, bwUnits, bhUnits, rng() * Math.PI);

    // Water collision check
    if (isBuildingOnWater(poly)) {
      skippedBuildingsCount++;
      continue;
    }

    const halfD = Math.max(bwUnits, bhUnits) * 0.7;
    const box = {
      minX: fx - halfD - 1.5,
      minY: fy - halfD - 1.5,
      maxX: fx + halfD + 1.5,
      maxY: fy + halfD + 1.5,
    };

    if (collides(box)) continue;

    placedBoxes.push(box);
    barnsPlaced++;

    buildings.push({
      id: `bld_${seed}_barn_${barnsPlaced}`,
      name: '納屋・畜舎 (Barn)',
      kind: 'building',
      buildingKind: 'barn',
      polygon: poly,
      heightM: 7.0 + rng() * 2.5,
      tone: rng(),
    });
  }

  // Push buildings
  objects.push(...buildings);

  // Push wall last
  objects.push(wall);

  // Attach execution statistics to the returned array
  const result = objects as SampleTownResult;
  result.stats = {
    skippedBuildingsCount,
    pierPlaced,
  };

  return result;
}
