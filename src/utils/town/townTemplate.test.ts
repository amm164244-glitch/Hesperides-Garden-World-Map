import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTemplate,
  instantiateTemplate,
  templateBoundsM,
  sanitizeTemplate,
  serializeTemplateLibrary,
  parseTemplateLibrary,
  mergeTemplates,
  TownTemplate,
} from './townTemplate';
import {
  loadTemplates,
  saveTemplates,
  TOWN_TEMPLATES_STORAGE_KEY,
} from './townTemplateStorage';
import { TownBuilding, TownRoad, TownWall } from '../../types/town';

test('createTemplate converts selected objects to relative meters and computes sizeM', () => {
  // Building of 20m x 10m at map units (1 unit = 2m)
  // [100, 100] to [110, 105]
  const sampleBuilding: TownBuilding = {
    id: 'b1',
    kind: 'building',
    buildingKind: 'house',
    polygon: [
      [100, 100],
      [110, 100],
      [110, 105],
      [100, 105],
    ],
    heightM: 6,
    tone: 0.4,
  };

  const template = createTemplate('我が家', [sampleBuilding], 2.0, 'tmpl_test_1', 1234567890);

  assert.equal(template.id, 'tmpl_test_1');
  assert.equal(template.name, '我が家');
  assert.equal(template.createdAt, 1234567890);
  assert.equal(template.objects.length, 1);

  // In relative meters, width is (110 - 100) * 2m = 20m, height is (105 - 100) * 2m = 10m
  assert.equal(template.sizeM.width, 20);
  assert.equal(template.sizeM.height, 10);

  // Default name fallback if empty
  const emptyNameTmpl = createTemplate('   ', [sampleBuilding], 2.0);
  assert.equal(emptyNameTmpl.name, 'テンプレート');

  // Throw error on 0 objects
  assert.throws(() => {
    createTemplate('空', [], 2.0);
  });
});

test('instantiateTemplate places objects with new IDs, handles rotation and flipX', () => {
  const sampleRoad: TownRoad = {
    id: 'r1',
    kind: 'road',
    style: 'main',
    widthM: 6,
    smooth: false,
    points: [
      [10, 0],
      [30, 0],
    ],
  };

  const template = createTemplate('大通り', [sampleRoad], 1.0);

  // Instantiate at [100, 200] with scale 2m/unit
  const placed = instantiateTemplate(template, [100, 200], 2.0, {
    angleDeg: 90,
    flipX: false,
    existingIds: new Set(['r1']),
  });

  assert.equal(placed.length, 1);
  assert.notEqual(placed[0].id, 'r1');
  assert.equal(placed[0].kind, 'road');

  const road = placed[0] as TownRoad;
  assert.equal(road.points.length, 2);

  // The original points relative to centroid [20, 0] in meters: [-10, 0] and [10, 0].
  // Rotated 90 deg: [0, -10] and [0, 10] in meters.
  // In 2m/unit map: [0, -5] and [0, 5].
  // Shifted by anchor [100, 200]: [100, 195] and [100, 205].
  assert.ok(Math.abs(road.points[0][0] - 100) < 1e-4);
  assert.ok(Math.abs(road.points[0][1] - 195) < 1e-4);
  assert.ok(Math.abs(road.points[1][0] - 100) < 1e-4);
  assert.ok(Math.abs(road.points[1][1] - 205) < 1e-4);
});

test('instantiateTemplate preserves wall gates and structure', () => {
  const sampleWall: TownWall = {
    id: 'w1',
    kind: 'wall',
    thicknessM: 3,
    towers: true,
    towerRadiusM: 3,
    closed: false,
    points: [
      [0, 0],
      [100, 0],
    ],
    gates: [
      {
        segmentIndex: 0,
        t: 0.5,
        widthM: 4,
      },
    ],
  };

  const template = createTemplate('城壁門', [sampleWall], 1.0);
  const placed = instantiateTemplate(template, [50, 50], 1.0);
  assert.equal(placed.length, 1);
  const wall = placed[0] as TownWall;
  assert.equal(wall.gates.length, 1);
  assert.equal(wall.gates[0].t, 0.5);
  assert.equal(wall.gates[0].widthM, 4);
});

test('templateBoundsM calculates rotated dimensions', () => {
  const sampleBuilding: TownBuilding = {
    id: 'b1',
    kind: 'building',
    buildingKind: 'house',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
    heightM: 6,
    tone: 0.5,
  };

  const template = createTemplate('長方形建物', [sampleBuilding], 1.0); // 10m x 5m
  const bounds0 = templateBoundsM(template, 0);
  assert.ok(Math.abs(bounds0.width - 10) < 1e-3);
  assert.ok(Math.abs(bounds0.height - 5) < 1e-3);

  const bounds90 = templateBoundsM(template, 90);
  assert.ok(Math.abs(bounds90.width - 5) < 1e-3);
  assert.ok(Math.abs(bounds90.height - 10) < 1e-3);
});

test('sanitizeTemplate handles valid and corrupted template payloads', () => {
  assert.equal(sanitizeTemplate(null), null);
  assert.equal(sanitizeTemplate({}), null);
  assert.equal(sanitizeTemplate({ id: '', name: 'test', objects: [] }), null);

  const valid = {
    id: 'tmpl_1',
    name: '有効なテンプレート',
    createdAt: 1000,
    objects: [
      {
        id: 'b1',
        kind: 'building',
        buildingKind: 'mansion',
        polygon: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        heightM: 8,
        tone: 0.2,
      },
    ],
  };

  const sanitized = sanitizeTemplate(valid);
  assert.ok(sanitized);
  assert.equal(sanitized?.name, '有効なテンプレート');
  assert.equal(sanitized?.sizeM.width, 10);
  assert.equal(sanitized?.sizeM.height, 10);

  // NaN vertices in polygon should be dropped
  const invalidPoly = {
    id: 'tmpl_2',
    name: 'NaNあり',
    objects: [
      {
        id: 'b2',
        kind: 'building',
        polygon: [
          [0, 0],
          [NaN, 10],
          [10, 10],
        ],
      },
    ],
  };
  assert.equal(sanitizeTemplate(invalidPoly), null);
});

test('serializeTemplateLibrary and parseTemplateLibrary handle JSON export/import', () => {
  const sampleBuilding: TownBuilding = {
    id: 'b1',
    kind: 'building',
    buildingKind: 'shop',
    polygon: [
      [0, 0],
      [12, 0],
      [12, 8],
      [0, 8],
    ],
    heightM: 7,
    tone: 0.5,
  };
  const tmpl = createTemplate('酒場', [sampleBuilding], 1.0);

  const json = serializeTemplateLibrary([tmpl]);
  assert.ok(json.includes('hg-town-templates'));
  assert.ok(json.includes('酒場'));

  const parsed = parseTemplateLibrary(json);
  assert.equal(parsed.templates.length, 1);
  assert.equal(parsed.templates[0].name, '酒場');
  assert.equal(parsed.skipped, 0);

  const badJson = parseTemplateLibrary('{ invalid json');
  assert.equal(badJson.templates.length, 0);
  assert.ok(badJson.error);
});

test('mergeTemplates handles duplicate IDs, appends (2) to duplicate names, and caps at maxCount', () => {
  const sampleBuilding: TownBuilding = {
    id: 'b1',
    kind: 'building',
    buildingKind: 'house',
    polygon: [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ],
    heightM: 5,
    tone: 0.5,
  };

  const t1 = createTemplate('市場', [sampleBuilding], 1.0, 'id_1');
  const t2 = createTemplate('市場', [sampleBuilding], 1.0, 'id_1'); // Same ID and same name

  const merged = mergeTemplates([t1], [t2], 100);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'id_1');
  assert.notEqual(merged[1].id, 'id_1');
  assert.equal(merged[0].name, '市場');
  assert.equal(merged[1].name, '市場 (2)');

  // Max count limitation
  const t3 = createTemplate('公園', [sampleBuilding], 1.0, 'id_3');
  const capped = mergeTemplates([t1], [t2, t3], 2);
  assert.equal(capped.length, 2);
});

test('loadTemplates and saveTemplates manage localStorage safely', () => {
  // Mock localStorage
  const store: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    length: 0,
    key: () => null,
  };

  const originalWindow = (global as any).window;
  (global as any).window = { localStorage: mockLocalStorage };

  try {
    const sampleBuilding: TownBuilding = {
      id: 'b1',
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 6],
        [0, 6],
      ],
      heightM: 5,
      tone: 0.5,
    };
    const tmpl = createTemplate('民家', [sampleBuilding], 1.0, 'tmpl_minka');

    const res = saveTemplates([tmpl]);
    assert.equal(res.ok, true);

    const loaded = loadTemplates();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'tmpl_minka');
    assert.equal(loaded[0].name, '民家');
  } finally {
    (global as any).window = originalWindow;
  }
});
