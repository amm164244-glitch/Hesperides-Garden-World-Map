import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoFillDistrict,
  getAutoFillDefaults,
  pickBuildingKind,
  buildingSizeRangeM,
  AutoFillConfig,
} from './townAutoFill';
import {
  Pt,
  TownBuilding,
  TownDistrict,
  TownDistrictKind,
  TownRoad,
  TownWall,
  TownPier,
} from '../../types/town';
import { pointInPolygon, polygonCentroid, metersToUnits } from './townGeometry';
import { pointToSegmentDistance } from './townEdit';
import { makeRng } from '../penSymbols';

// Helper to make a rectangular district in local units
function makeRectDistrict(
  x: number,
  y: number,
  w: number,
  h: number,
  districtKind: TownDistrictKind = 'residential'
): TownDistrict {
  return {
    id: `dist_${districtKind}_1`,
    kind: 'district',
    districtKind,
    polygon: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  };
}

// Helper to make an L-shaped (concave) district
function makeConcaveDistrict(x: number, y: number, size: number): TownDistrict {
  return {
    id: 'dist_concave_1',
    kind: 'district',
    districtKind: 'residential',
    polygon: [
      [x, y],
      [x + size, y],
      [x + size, y + size * 0.5],
      [x + size * 0.5, y + size * 0.5],
      [x + size * 0.5, y + size],
      [x, y + size],
    ],
  };
}

test('getAutoFillDefaults returns expected defaults and null for park', () => {
  assert.equal(getAutoFillDefaults('park'), null);

  const res = getAutoFillDefaults('residential');
  assert.ok(res);
  assert.equal(res.density, 0.75);
  assert.equal(res.gapM, 2);
  assert.equal(res.roadSetbackM, 1.5);
  assert.equal(res.edgeSetbackM, 1.5);

  const market = getAutoFillDefaults('market');
  assert.ok(market);
  assert.equal(market.plazaRatio, 0.25);

  const poor = getAutoFillDefaults('poor');
  assert.ok(poor);
  assert.equal(poor.density, 0.85);
  assert.equal(poor.gapM, 1);
});

test('pickBuildingKind follows composition weights and never produces church, keep, or tower', () => {
  const kinds: TownDistrictKind[] = ['residential', 'poor', 'market', 'noble', 'farmland'];
  const rng = makeRng(12345);

  for (const dk of kinds) {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      const bKind = pickBuildingKind(dk, rng);
      counts[bKind] = (counts[bKind] || 0) + 1;
      assert.notEqual(bKind, 'church');
      assert.notEqual(bKind, 'keep');
      assert.notEqual(bKind, 'tower');
    }

    if (dk === 'poor') {
      assert.equal(counts['house'], 500);
    } else if (dk === 'residential') {
      // house ~90%, shop ~6%, hall ~2%, barn ~2%
      assert.ok(counts['house'] > 400);
      assert.ok((counts['shop'] || 0) > 0);
    } else if (dk === 'market') {
      // shop ~65%, house ~30%, hall ~5%
      assert.ok((counts['shop'] || 0) > 250);
      assert.ok((counts['house'] || 0) > 100);
    } else if (dk === 'noble') {
      // house ~60%, hall ~40%
      assert.ok((counts['house'] || 0) > 200);
      assert.ok((counts['hall'] || 0) > 100);
    } else if (dk === 'farmland') {
      // barn ~70%, house ~30%
      assert.ok((counts['barn'] || 0) > 250);
      assert.ok((counts['house'] || 0) > 100);
    }
  }
});

test('autoFillDistrict is strictly deterministic with seed', () => {
  const district = makeRectDistrict(50, 50, 200, 200, 'residential');
  const config = getAutoFillDefaults('residential')!;
  const metersPerUnit = 1; // 1 unit = 1 meter

  const res1 = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config,
    seed: 98765,
  });

  const res2 = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config,
    seed: 98765,
  });

  const resDifferentSeed = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config,
    seed: 11111,
  });

  assert.equal(res1.buildings.length, res2.buildings.length);
  assert.ok(res1.buildings.length > 10);
  assert.deepEqual(res1.stats, res2.stats);

  // Exact coordinates match
  for (let i = 0; i < res1.buildings.length; i++) {
    assert.deepEqual(res1.buildings[i].polygon, res2.buildings[i].polygon);
    assert.equal(res1.buildings[i].tone, res2.buildings[i].tone);
    assert.equal(res1.buildings[i].heightM, res2.buildings[i].heightM);
  }

  // Different seed produces different placement / tone
  assert.notDeepEqual(res1.buildings[0].polygon, resDifferentSeed.buildings[0].polygon);
});

test('all building corners are strictly inside district and respect edgeSetbackM even for concave polygons', () => {
  const district = makeConcaveDistrict(50, 50, 300);
  const config: AutoFillConfig = {
    ...getAutoFillDefaults('residential')!,
    edgeSetbackM: 3.0,
    gapM: 2.0,
  };
  const metersPerUnit = 1;

  const res = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config,
    seed: 42,
  });

  assert.ok(res.buildings.length > 5);

  const edgeSetbackUnits = config.edgeSetbackM / metersPerUnit;

  for (const bld of res.buildings) {
    for (const corner of bld.polygon) {
      assert.equal(pointInPolygon(corner, district.polygon), true);

      // Distance to all district edges must be >= edgeSetbackM
      let minDist = Infinity;
      for (let i = 0; i < district.polygon.length; i++) {
        const p0 = district.polygon[i];
        const p1 = district.polygon[(i + 1) % district.polygon.length];
        const hit = pointToSegmentDistance(corner, p0, p1);
        if (hit.distance < minDist) minDist = hit.distance;
      }
      assert.ok(
        minDist >= edgeSetbackUnits - 1e-4,
        `Corner [${corner[0]}, ${corner[1]}] dist ${minDist} < setback ${edgeSetbackUnits}`
      );
    }
  }
});

test('buildings never overlap each other or existing buildings and maintain gapM', () => {
  const district = makeRectDistrict(50, 50, 200, 200, 'residential');
  const config = getAutoFillDefaults('residential')!;
  const metersPerUnit = 1;

  // Add an existing obstacle building
  const existingBuilding: TownBuilding = {
    id: 'bld_obstacle_1',
    kind: 'building',
    buildingKind: 'keep',
    polygon: [
      [120, 120],
      [160, 120],
      [160, 160],
      [120, 160],
    ],
    heightM: 18,
    tone: 0.5,
  };

  const res = autoFillDistrict({
    district,
    objects: [existingBuilding],
    metersPerUnit,
    config,
    seed: 555,
  });

  assert.ok(res.buildings.length > 10);
  assert.ok(res.stats.rejectedOverlap > 0);

  const allBuildings = [existingBuilding, ...res.buildings];
  const gapUnits = config.gapM / metersPerUnit;

  // Verify pairwise minimum distance >= gapM
  for (let i = 0; i < allBuildings.length; i++) {
    for (let j = i + 1; j < allBuildings.length; j++) {
      const b1 = allBuildings[i].polygon;
      const b2 = allBuildings[j].polygon;

      for (const v of b1) {
        assert.equal(pointInPolygon(v, b2), false);
      }
      for (const v of b2) {
        assert.equal(pointInPolygon(v, b1), false);
      }

      // Check edge-to-vertex distances
      for (const v of b1) {
        for (let e = 0; e < b2.length; e++) {
          const hit = pointToSegmentDistance(v, b2[e], b2[(e + 1) % b2.length]);
          assert.ok(
            hit.distance >= gapUnits - 1e-4,
            `Distance ${hit.distance.toFixed(3)} < gap ${gapUnits}`
          );
        }
      }
    }
  }
});

test('frontage buildings respect road setback and align with road tangent', () => {
  const district = makeRectDistrict(50, 50, 250, 150, 'residential');
  const metersPerUnit = 1;

  // Road running horizontally along top of district at y = 50
  const road: TownRoad = {
    id: 'road_main_1',
    kind: 'road',
    style: 'main',
    points: [
      [30, 50],
      [320, 50],
    ],
    widthM: 6,
    smooth: false,
  };

  const config: AutoFillConfig = {
    ...getAutoFillDefaults('residential')!,
    frontage: true,
    interior: false, // test frontage only
    roadSetbackM: 2.0,
    angleJitterDeg: 4,
  };

  const res = autoFillDistrict({
    district,
    objects: [road],
    metersPerUnit,
    config,
    seed: 888,
  });

  assert.ok(res.buildings.length > 3);

  // Road half-width is 3m. With allowed frontage setback (2.0 - 0.5 = 1.5m),
  // distance from building to road centerline must be >= 4.5m
  const minRequiredDistance = road.widthM / 2 + config.roadSetbackM - 0.5;

  for (const bld of res.buildings) {
    for (const p of bld.polygon) {
      const hit = pointToSegmentDistance(p, road.points[0], road.points[1]);
      assert.ok(
        hit.distance >= minRequiredDistance - 1e-4,
        `Building point at ${p} has road distance ${hit.distance} < ${minRequiredDistance}`
      );
    }

    // Check tangent orientation (road is horizontal [1, 0], angle ~ 0)
    // Building edge vector:
    const dx = bld.polygon[1][0] - bld.polygon[0][0];
    const dy = bld.polygon[1][1] - bld.polygon[0][1];
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg < -90) angleDeg += 180;
    if (angleDeg > 90) angleDeg -= 180;
    assert.ok(
      Math.abs(angleDeg) <= config.angleJitterDeg + 1.0,
      `Frontage building angle ${angleDeg} exceeds jitter tolerance`
    );
  }
});

test('avoids walls, piers, and water areas', () => {
  const district = makeRectDistrict(50, 50, 200, 200, 'residential');
  const metersPerUnit = 1;

  const wall: TownWall = {
    id: 'wall_1',
    kind: 'wall',
    points: [
      [50, 50],
      [250, 50],
    ],
    closed: false,
    thicknessM: 4,
    towers: false,
    towerRadiusM: 3,
    gates: [],
  };

  const pier: TownPier = {
    id: 'pier_1',
    kind: 'pier',
    variant: 'pier',
    points: [
      [150, 50],
      [150, 150],
    ],
    widthM: 4,
  };

  // Water sampler that marks region x < 80 as water
  const waterSampler = {
    isWater: (x: number) => x < 80,
  };

  const config = getAutoFillDefaults('residential')!;

  const res = autoFillDistrict({
    district,
    objects: [wall, pier],
    metersPerUnit,
    config,
    seed: 777,
    waterSampler,
  });

  assert.ok(res.stats.rejectedWater > 0);
  assert.ok(res.stats.rejectedWall > 0 || res.stats.rejectedRoad > 0);

  for (const bld of res.buildings) {
    // No points in water region
    for (const p of bld.polygon) {
      assert.equal(waterSampler.isWater(p[0]), false);
    }

    // No points too close to wall (wall thickness 4m / 2 + 2m = 4m)
    for (const p of bld.polygon) {
      const hitWall = pointToSegmentDistance(p, wall.points[0], wall.points[1]);
      assert.ok(hitWall.distance >= wall.thicknessM / 2 + 2 - 1e-4);
    }
  }
});

test('density affects building counts', () => {
  const district = makeRectDistrict(50, 50, 250, 250, 'residential');
  const baseConfig = getAutoFillDefaults('residential')!;
  const metersPerUnit = 1;

  const resZero = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config: { ...baseConfig, density: 0, frontage: false },
    seed: 321,
  });
  assert.equal(resZero.buildings.length, 0);

  const resLow = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config: { ...baseConfig, density: 0.3, frontage: false },
    seed: 321,
  });

  const resHigh = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config: { ...baseConfig, density: 0.95, frontage: false },
    seed: 321,
  });

  assert.ok(resLow.buildings.length > 0);
  assert.ok(resHigh.buildings.length > resLow.buildings.length);
});

test('plazaRatio leaves central open space around centroid', () => {
  const district = makeRectDistrict(50, 50, 200, 200, 'market');
  const config = getAutoFillDefaults('market')!;
  assert.equal(config.plazaRatio, 0.25);
  const metersPerUnit = 1;

  const res = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config,
    seed: 456,
  });

  const centroid = polygonCentroid(district.polygon);
  const area = 200 * 200;
  const plazaRadius = config.plazaRatio * Math.sqrt(area / Math.PI);

  assert.ok(res.buildings.length > 5);
  for (const bld of res.buildings) {
    const center = polygonCentroid(bld.polygon);
    const distToCenter = Math.hypot(center[0] - centroid[0], center[1] - centroid[1]);
    assert.ok(
      distToCenter >= plazaRadius - 1e-4,
      `Building center ${center} is inside plaza radius ${plazaRadius}`
    );
  }
});

test('maxBuildings stops placement and sets hitLimit', () => {
  const district = makeRectDistrict(50, 50, 300, 300, 'poor');
  const config: AutoFillConfig = {
    ...getAutoFillDefaults('poor')!,
    maxBuildings: 15,
  };
  const metersPerUnit = 1;

  const res = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config,
    seed: 999,
  });

  assert.equal(res.buildings.length, 15);
  assert.equal(res.stats.hitLimit, true);
});

test('handles invalid district polygons gracefully', () => {
  const invalid1: TownDistrict = {
    id: 'd_bad1',
    kind: 'district',
    districtKind: 'residential',
    polygon: [
      [0, 0],
      [10, 10],
    ], // only 2 points
  };

  const res1 = autoFillDistrict({
    district: invalid1,
    objects: [],
    metersPerUnit: 1,
    config: getAutoFillDefaults('residential')!,
    seed: 123,
  });
  assert.equal(res1.buildings.length, 0);
  assert.equal(res1.stats.placed, 0);

  // Self-intersecting bowtie
  const invalid2: TownDistrict = {
    id: 'd_bad2',
    kind: 'district',
    districtKind: 'residential',
    polygon: [
      [0, 0],
      [100, 100],
      [0, 100],
      [100, 0],
    ],
  };

  const res2 = autoFillDistrict({
    district: invalid2,
    objects: [],
    metersPerUnit: 1,
    config: getAutoFillDefaults('residential')!,
    seed: 123,
  });
  assert.equal(res2.buildings.length, 0);
});

test('generates unique IDs avoiding collisions with existing objects', () => {
  const district = makeRectDistrict(50, 50, 100, 100, 'residential');
  const config = getAutoFillDefaults('residential')!;
  const seed = 777;

  // Pre-populate with conflicting IDs
  const existing: TownBuilding[] = [
    {
      id: `bld_af_${seed}_1`,
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
      heightM: 6,
      tone: 0.1,
    },
    {
      id: `bld_af_${seed}_2`,
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [10, 0],
        [15, 0],
        [15, 5],
        [10, 5],
      ],
      heightM: 6,
      tone: 0.1,
    },
  ];

  const res = autoFillDistrict({
    district,
    objects: existing,
    metersPerUnit: 1,
    config,
    seed,
  });

  const idSet = new Set(existing.map((o) => o.id));
  for (const bld of res.buildings) {
    assert.equal(idSet.has(bld.id), false);
    idSet.add(bld.id);
  }
});

test('all building edges are strictly >= 1.5m in length', () => {
  const district = makeRectDistrict(50, 50, 200, 200, 'poor');
  const config = getAutoFillDefaults('poor')!;
  const metersPerUnit = 1;

  const res = autoFillDistrict({
    district,
    objects: [],
    metersPerUnit,
    config,
    seed: 333,
  });

  assert.ok(res.buildings.length > 5);
  for (const bld of res.buildings) {
    const pts = bld.polygon;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % pts.length];
      const lenM = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * metersPerUnit;
      assert.ok(
        lenM >= 1.5 - 1e-4,
        `Building ${bld.id} has edge length ${lenM.toFixed(2)}m < 1.5m`
      );
    }
  }
});

test('multi-district sequential autofill accumulates placed buildings to prevent boundary overlaps', () => {
  // Two adjacent districts touching at x = 150
  const d1 = makeRectDistrict(50, 50, 100, 100, 'residential');
  const d2 = makeRectDistrict(150, 50, 100, 100, 'residential');
  const config = getAutoFillDefaults('residential')!;
  const metersPerUnit = 1;

  // Process d1
  const res1 = autoFillDistrict({
    district: d1,
    objects: [],
    metersPerUnit,
    config,
    seed: 1234,
  });

  // Process d2 passing res1.buildings as existing objects
  const res2 = autoFillDistrict({
    district: d2,
    objects: [...res1.buildings],
    metersPerUnit,
    config,
    seed: 5678,
  });

  const combined = [...res1.buildings, ...res2.buildings];
  const gapUnits = config.gapM / metersPerUnit;

  for (let i = 0; i < combined.length; i++) {
    for (let j = i + 1; j < combined.length; j++) {
      const b1 = combined[i].polygon;
      const b2 = combined[j].polygon;

      for (const v of b1) {
        assert.equal(pointInPolygon(v, b2), false);
      }
      for (const v of b2) {
        assert.equal(pointInPolygon(v, b1), false);
      }
      for (const v of b1) {
        for (let e = 0; e < b2.length; e++) {
          const hit = pointToSegmentDistance(v, b2[e], b2[(e + 1) % b2.length]);
          assert.ok(hit.distance >= gapUnits - 1e-4);
        }
      }
    }
  }
});
