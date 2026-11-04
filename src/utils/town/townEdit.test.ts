import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointToSegmentDistance,
  nearestPointOnPolyline,
  hitTestTownObjects,
  translateObject,
  moveVertex,
  insertVertex,
  removeVertex,
  addGate,
  moveGate,
  removeGate,
  getGateWorldPosition,
  snapPoint,
  snapAngle,
  objectsInRect,
  selectionBounds,
} from './townEdit';
import {
  TownBuilding,
  TownDistrict,
  TownPier,
  TownRoad,
  TownWall,
} from '../../types/town';

describe('townEdit geometry & pure helpers', () => {
  it('pointToSegmentDistance calculates accurate projections and distances', () => {
    // Perpendicular hit in middle
    const p1 = pointToSegmentDistance([10, 5], [0, 0], [20, 0]);
    assert.equal(p1.distance, 5);
    assert.deepEqual(p1.projection, [10, 0]);
    assert.equal(p1.t, 0.5);

    // Clamped before start
    const p2 = pointToSegmentDistance([-5, 0], [0, 0], [20, 0]);
    assert.equal(p2.distance, 5);
    assert.deepEqual(p2.projection, [0, 0]);
    assert.equal(p2.t, 0);

    // Clamped after end
    const p3 = pointToSegmentDistance([25, 0], [0, 0], [20, 0]);
    assert.equal(p3.distance, 5);
    assert.deepEqual(p3.projection, [20, 0]);
    assert.equal(p3.t, 1);

    // Degenerate zero-length segment
    const p4 = pointToSegmentDistance([3, 4], [0, 0], [0, 0]);
    assert.equal(p4.distance, 5);
    assert.deepEqual(p4.projection, [0, 0]);
    assert.equal(p4.t, 0);
  });

  it('nearestPointOnPolyline finds closest segment on polyline or closed loop', () => {
    const polyline: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];

    // Near first segment
    const res1 = nearestPointOnPolyline(polyline, [5, 2], false);
    assert.equal(res1.segmentIndex, 0);
    assert.deepEqual(res1.projection, [5, 0]);
    assert.equal(res1.distance, 2);

    // Near second segment
    const res2 = nearestPointOnPolyline(polyline, [12, 5], false);
    assert.equal(res2.segmentIndex, 1);
    assert.deepEqual(res2.projection, [10, 5]);
    assert.equal(res2.distance, 2);

    // Closed loop test (closing edge from [10, 10] to [0, 0])
    const res3 = nearestPointOnPolyline(polyline, [4, 6], true);
    assert.equal(res3.segmentIndex, 2);
  });

  it('hitTestTownObjects enforces priority hierarchy (wall > building > pier > road > district)', () => {
    const metersPerUnit = 1; // 1 unit = 1m
    const toleranceUnits = 2;

    const district: TownDistrict = {
      id: 'd1',
      kind: 'district',
      districtKind: 'residential',
      polygon: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    };

    const road: TownRoad = {
      id: 'r1',
      kind: 'road',
      style: 'street',
      points: [
        [20, 50],
        [80, 50],
      ],
      widthM: 6,
      smooth: false,
    };

    const pier: TownPier = {
      id: 'p1',
      kind: 'pier',
      variant: 'pier',
      points: [
        [40, 50],
        [60, 50],
      ],
      widthM: 6,
    };

    const building: TownBuilding = {
      id: 'b1',
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [45, 45],
        [55, 45],
        [55, 55],
        [45, 55],
      ],
      heightM: 8,
      tone: 0.5,
    };

    const wall: TownWall = {
      id: 'w1',
      kind: 'wall',
      points: [
        [48, 48],
        [52, 52],
      ],
      closed: false,
      thicknessM: 4,
      towers: true,
      towerRadiusM: 3,
      gates: [],
    };

    const allObjects = [district, road, pier, building, wall];

    // Point [50, 50] is inside all 5 objects -> Wall must win due to hierarchy
    const hitWall = hitTestTownObjects(allObjects, [50, 50], toleranceUnits, metersPerUnit);
    assert.equal(hitWall?.id, 'w1');

    // Without wall, building wins
    const withoutWall = [district, road, pier, building];
    const hitBld = hitTestTownObjects(withoutWall, [50, 50], toleranceUnits, metersPerUnit);
    assert.equal(hitBld?.id, 'b1');

    // Without building and wall, pier wins over road
    const withoutBld = [district, road, pier];
    const hitPier = hitTestTownObjects(withoutBld, [42, 50], toleranceUnits, metersPerUnit);
    assert.equal(hitPier?.id, 'p1');

    // Far from pier, road wins over district
    const hitRoad = hitTestTownObjects(withoutBld, [25, 50], toleranceUnits, metersPerUnit);
    assert.equal(hitRoad?.id, 'r1');

    // Far from road, district wins
    const hitDist = hitTestTownObjects(withoutBld, [10, 10], toleranceUnits, metersPerUnit);
    assert.equal(hitDist?.id, 'd1');

    // Far outside everything -> null
    const hitNone = hitTestTownObjects(allObjects, [200, 200], toleranceUnits, metersPerUnit);
    assert.equal(hitNone, null);
  });

  it('translateObject shifts points and polygons cleanly', () => {
    const road: TownRoad = {
      id: 'r1',
      kind: 'road',
      style: 'street',
      points: [
        [10, 10],
        [20, 20],
      ],
      widthM: 4,
      smooth: false,
    };

    const translated = translateObject(road, 5, -2);
    assert.deepEqual(translated.points, [
      [15, 8],
      [25, 18],
    ]);
    // Original unchanged
    assert.deepEqual(road.points, [
      [10, 10],
      [20, 20],
    ]);
  });

  it('moveVertex, insertVertex, and removeVertex respect constraints', () => {
    const road: TownRoad = {
      id: 'r1',
      kind: 'road',
      style: 'street',
      points: [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      widthM: 4,
      smooth: false,
    };

    // Move vertex 1
    const moved = moveVertex(road, 1, [10, 5]);
    assert.deepEqual(moved.points[1], [10, 5]);

    // Insert vertex between 0 and 1 (segmentIndex 0)
    const inserted = insertVertex(moved, 0, [5, 2]);
    assert.equal(inserted.points.length, 4);
    assert.deepEqual(inserted.points[1], [5, 2]);

    // Remove vertex
    const removed = removeVertex(inserted, 1);
    assert.ok(removed);
    assert.equal(removed?.points.length, 3);

    // Cannot remove below minimum 2 for line
    const twoPts: TownRoad = { ...road, points: [[0, 0], [10, 0]] };
    const invalidRemove = removeVertex(twoPts, 0);
    assert.equal(invalidRemove, null);
  });

  it('addGate, moveGate, removeGate manage fortified wall gates and world positions', () => {
    const wall: TownWall = {
      id: 'w1',
      kind: 'wall',
      points: [
        [0, 0],
        [100, 0],
      ],
      closed: false,
      thicknessM: 4,
      towers: true,
      towerRadiusM: 3,
      gates: [],
    };

    const withGate = addGate(wall, 0, 0.4, 6);
    assert.equal(withGate.gates.length, 1);
    assert.equal(withGate.gates[0].t, 0.4);
    assert.equal(withGate.gates[0].widthM, 6);

    const pos = getGateWorldPosition(withGate, withGate.gates[0]);
    assert.deepEqual(pos, [40, 0]);

    const moved = moveGate(withGate, 0, 0, 0.7);
    assert.equal(moved.gates[0].t, 0.7);

    const removed = removeGate(moved, 0);
    assert.equal(removed.gates.length, 0);
  });

  it('snapPoint snaps within tolerance and ignores outside', () => {
    const candidates: [number, number][] = [
      [10, 10],
      [50, 50],
    ];

    const s1 = snapPoint([11, 10], candidates, 3);
    assert.equal(s1.didSnap, true);
    assert.deepEqual(s1.snapped, [10, 10]);

    const s2 = snapPoint([15, 10], candidates, 3);
    assert.equal(s2.didSnap, false);
    assert.deepEqual(s2.snapped, [15, 10]);
  });

  it('snapAngle constrains directions to 15-degree steps', () => {
    const from: [number, number] = [0, 0];
    // Slightly off horizontal (approx 5 degrees)
    const to: [number, number] = [100, 10];
    const snapped = snapAngle(from, to, 15);
    // Should snap to 0 degrees [100.49, 0]
    assert.ok(Math.abs(snapped[1]) < 1e-4);
    assert.ok(snapped[0] > 99);

    // 45 degrees
    const snapped45 = snapAngle(from, [100, 95], 15);
    // 45 deg means x == y
    assert.ok(Math.abs(snapped45[0] - snapped45[1]) < 1e-4);
  });

  it('objectsInRect and selectionBounds correctly identify marquee selections', () => {
    const r1: TownRoad = {
      id: 'r1',
      kind: 'road',
      style: 'street',
      points: [
        [10, 10],
        [20, 20],
      ],
      widthM: 4,
      smooth: false,
    };
    const r2: TownRoad = {
      id: 'r2',
      kind: 'road',
      style: 'street',
      points: [
        [100, 100],
        [120, 120],
      ],
      widthM: 4,
      smooth: false,
    };

    const inBox = objectsInRect([r1, r2], { minX: 5, minY: 5, maxX: 30, maxY: 30 });
    assert.equal(inBox.length, 1);
    assert.equal(inBox[0].id, 'r1');

    const bounds = selectionBounds([r1, r2]);
    assert.deepEqual(bounds, { minX: 10, minY: 10, maxX: 120, maxY: 120 });
  });
});
