import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rectangleFrom3Points,
  circlePolygon,
  isSimplePolygon,
  rotateObject,
  flipObject,
  nearestSegmentDirection,
  objectsToClipboard,
  clipboardToObjects,
  alignParallel,
  alignToLine,
  distributeEvenly,
  minAreaRect,
  hasEdgeLessThanM,
} from './townBuild';
import {
  TownBuilding,
  TownRoad,
  TownWall,
} from '../../types/town';
import { polygonArea, polygonCentroid } from './townGeometry';
import { getGateWorldPosition } from './townEdit';

describe('townBuild pure geometric & alignment utilities', () => {
  it('rectangleFrom3Points builds accurate rectangle with right angles and signed depth', () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [10, 0];
    // c with positive depth (above AB)
    const c1: [number, number] = [5, 6];
    const rect1 = rectangleFrom3Points(a, b, c1);

    assert.equal(rect1.length, 4);
    assert.deepEqual(rect1[0], [0, 0]);
    assert.deepEqual(rect1[1], [10, 0]);
    assert.deepEqual(rect1[2], [10, 6]);
    assert.deepEqual(rect1[3], [0, 6]);

    // Check right angles (dot products)
    const dot1 = (rect1[1][0] - rect1[0][0]) * (rect1[3][0] - rect1[0][0]) +
                 (rect1[1][1] - rect1[0][1]) * (rect1[3][1] - rect1[0][1]);
    assert.equal(dot1, 0);

    // c with negative depth (below AB)
    const c2: [number, number] = [5, -4];
    const rect2 = rectangleFrom3Points(a, b, c2);
    assert.deepEqual(rect2[2], [10, -4]);
    assert.deepEqual(rect2[3], [0, -4]);
  });

  it('circlePolygon places all vertices on target radius', () => {
    const center: [number, number] = [50, 50];
    const radius = 15;
    const poly = circlePolygon(center, radius, 12);

    assert.equal(poly.length, 12);
    for (const p of poly) {
      const d = Math.hypot(p[0] - center[0], p[1] - center[1]);
      assert.ok(Math.abs(d - radius) < 1e-5);
    }
  });

  it('isSimplePolygon distinguishes simple polygons from self-intersecting bowties', () => {
    // Convex rectangle: true
    const rect: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    assert.equal(isSimplePolygon(rect), true);

    // Bowtie (hourglass crossing at center): false
    const bowtie: [number, number][] = [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ];
    assert.equal(isSimplePolygon(bowtie), false);
  });

  it('hasEdgeLessThanM detects short edges correctly', () => {
    const metersPerUnit = 1;
    const okPoly: [number, number][] = [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ];
    assert.equal(hasEdgeLessThanM(okPoly, 1.5, metersPerUnit), false);

    const shortPoly: [number, number][] = [
      [0, 0],
      [1.0, 0], // 1.0m < 1.5m
      [1.0, 5],
      [0, 5],
    ];
    assert.equal(hasEdgeLessThanM(shortPoly, 1.5, metersPerUnit), true);
  });

  it('rotateObject rotates 360 deg back to original, preserves area, and preserves wall gates', () => {
    const b: TownBuilding = {
      id: 'b1',
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 6],
        [0, 6],
      ],
      heightM: 6,
      tone: 0.5,
    };

    const initialArea = Math.abs(polygonArea(b.polygon));
    const rotated90 = rotateObject(b, [5, 3], Math.PI / 2) as TownBuilding;
    const area90 = Math.abs(polygonArea(rotated90.polygon));
    assert.ok(Math.abs(initialArea - area90) < 1e-4);

    const rotated360 = rotateObject(b, [5, 3], Math.PI * 2) as TownBuilding;
    for (let i = 0; i < b.polygon.length; i++) {
      assert.ok(Math.abs(b.polygon[i][0] - rotated360.polygon[i][0]) < 1e-4);
      assert.ok(Math.abs(b.polygon[i][1] - rotated360.polygon[i][1]) < 1e-4);
    }

    // Wall with gate
    const wall: TownWall = {
      id: 'w1',
      kind: 'wall',
      points: [
        [0, 0],
        [20, 0],
      ],
      closed: false,
      thicknessM: 2,
      towers: false,
      towerRadiusM: 3,
      gates: [{ segmentIndex: 0, t: 0.5, widthM: 4 }],
    };

    const rotatedWall = rotateObject(wall, [10, 0], Math.PI / 2) as TownWall;
    assert.equal(rotatedWall.gates[0].segmentIndex, 0);
    assert.equal(rotatedWall.gates[0].t, 0.5);
    const gatePos = getGateWorldPosition(rotatedWall, rotatedWall.gates[0]);
    // Wall rotated around [10,0] by 90 deg: [0,0]->[10,-10], [20,0]->[10,10]. Midpoint gate is [10, 0]
    assert.ok(Math.abs(gatePos[0] - 10) < 1e-4);
    assert.ok(Math.abs(gatePos[1] - 0) < 1e-4);
  });

  it('flipObject returns to original after 2 flips and preserves gate world location', () => {
    const wall: TownWall = {
      id: 'w1',
      kind: 'wall',
      points: [
        [0, 0],
        [20, 0],
      ],
      closed: false,
      thicknessM: 2,
      towers: false,
      towerRadiusM: 3,
      gates: [{ segmentIndex: 0, t: 0.25, widthM: 4 }],
    };

    const flippedX = flipObject(wall, [10, 0], 'x') as TownWall;
    const flippedBack = flipObject(flippedX, [10, 0], 'x') as TownWall;

    assert.deepEqual(flippedBack.points, wall.points);
    assert.equal(flippedBack.gates[0].t, wall.gates[0].t);

    // Gate on original wall at x=5. Flipped across x=10 should be at x=15.
    const gateFlippedPos = getGateWorldPosition(flippedX, flippedX.gates[0]);
    assert.ok(Math.abs(gateFlippedPos[0] - 15) < 1e-4);
  });

  it('clipboard preserves meter measurements across different metersPerUnit scales and assigns new IDs', () => {
    const road: TownRoad = {
      id: 'r_source',
      kind: 'road',
      style: 'street',
      points: [
        [0, 0],
        [10, 0], // 10 units at 2m/unit = 20 meters long
      ],
      widthM: 5,
      smooth: true,
    };

    const clip = objectsToClipboard([road], 2); // 2 meters per unit
    assert.equal(clip.objects.length, 1);

    // Paste onto a map with 0.5 meters per unit (4x finer resolution) at anchor [100, 100]
    const pasted = clipboardToObjects(clip, [100, 100], 0.5) as TownRoad[];
    assert.equal(pasted.length, 1);
    assert.notEqual(pasted[0].id, road.id);

    // Length of pasted road in map units:
    // 20 meters at 0.5 m/unit = 40 units
    const pastedLen = Math.hypot(
      pasted[0].points[1][0] - pasted[0].points[0][0],
      pasted[0].points[1][1] - pasted[0].points[0][1]
    );
    assert.ok(Math.abs(pastedLen - 40) < 1e-4);
  });

  it('nearestSegmentDirection returns closest angle within 40m and null beyond 40m', () => {
    const road: TownRoad = {
      id: 'r1',
      kind: 'road',
      style: 'street',
      points: [
        [0, 0],
        [100, 0], // Horizontal road along X-axis (angle = 0)
      ],
      widthM: 5,
      smooth: true,
    };

    const metersPerUnit = 1; // 1 unit = 1 meter

    // 10m away from road: within 40m
    const hitNear = nearestSegmentDirection([road], [50, 10], 40, metersPerUnit);
    assert.ok(hitNear !== null);
    assert.ok(Math.abs(hitNear.distanceM - 10) < 1e-4);
    assert.ok(Math.abs(hitNear.angleRad - 0) < 1e-4);

    // 50m away from road: beyond 40m
    const hitFar = nearestSegmentDirection([road], [50, 50], 40, metersPerUnit);
    assert.equal(hitFar, null);
  });

  it('alignParallel aligns building edges to be parallel or perpendicular to road', () => {
    const road: TownRoad = {
      id: 'r1',
      kind: 'road',
      style: 'street',
      points: [
        [0, 0],
        [100, 0], // horizontal road
      ],
      widthM: 5,
      smooth: true,
    };

    // Building oriented at exact 15 degrees to horizontal
    const ang = (15 * Math.PI) / 180;
    const cos15 = Math.cos(ang);
    const sin15 = Math.sin(ang);
    const b: TownBuilding = {
      id: 'b1',
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [40, 10],
        [40 + 10 * cos15, 10 + 10 * sin15],
        [40 + 10 * cos15 - 6 * sin15, 10 + 10 * sin15 + 6 * cos15],
        [40 - 6 * sin15, 10 + 6 * cos15],
      ],
      heightM: 6,
      tone: 0.5,
    };

    const aligned = alignParallel([b], [road], 1);
    assert.equal(aligned.length, 1);
    // After alignment, edge should be horizontal (y values of edge 0-1 match)
    const p0 = aligned[0].polygon[0];
    const p1 = aligned[0].polygon[1];
    assert.ok(Math.abs(p1[1] - p0[1]) < 1e-4);
  });

  it('alignToLine projects centroids onto best-fit line and distributeEvenly spaces evenly', () => {
    const b1: TownBuilding = {
      id: 'b1',
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [0, 2],
        [10, 2],
        [10, 8],
        [0, 8],
      ],
      heightM: 6,
      tone: 0.5,
    };
    const b2: TownBuilding = {
      id: 'b2',
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [20, 10],
        [30, 10],
        [30, 16],
        [20, 16],
      ],
      heightM: 6,
      tone: 0.5,
    };
    const b3: TownBuilding = {
      id: 'b3',
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [70, -2],
        [80, -2],
        [80, 4],
        [70, 4],
      ],
      heightM: 6,
      tone: 0.5,
    };

    // alignToLine
    const alignedLine = alignToLine([b1, b2, b3]);
    const c1 = polygonCentroid(alignedLine[0].polygon);
    const c2 = polygonCentroid(alignedLine[1].polygon);
    const c3 = polygonCentroid(alignedLine[2].polygon);

    // All three centroids must be collinear (area of triangle formed by them is 0)
    const triArea = Math.abs(polygonArea([c1, c2, c3]));
    assert.ok(triArea < 1e-4);

    // distributeEvenly
    const distributed = distributeEvenly([b1, b2, b3]);
    const dc1 = polygonCentroid(distributed[0].polygon);
    const dc2 = polygonCentroid(distributed[1].polygon);
    const dc3 = polygonCentroid(distributed[2].polygon);

    const dist12 = Math.hypot(dc2[0] - dc1[0], dc2[1] - dc1[1]);
    const dist23 = Math.hypot(dc3[0] - dc2[0], dc3[1] - dc2[1]);
    assert.ok(Math.abs(dist12 - dist23) < 1e-4);
  });

  it('minAreaRect returns identical rectangle for rotated rectangle and encloses polygon', () => {
    // 30-degree rotated rectangle
    const angle = Math.PI / 6;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const original: [number, number][] = [
      [0, 0],
      [20 * cosA, 20 * sinA],
      [20 * cosA - 10 * sinA, 20 * sinA + 10 * cosA],
      [-10 * sinA, 10 * cosA],
    ];

    const obb = minAreaRect(original);
    const origArea = Math.abs(polygonArea(original));
    const obbArea = Math.abs(polygonArea(obb));
    assert.ok(Math.abs(origArea - obbArea) < 1e-3);
  });
});
