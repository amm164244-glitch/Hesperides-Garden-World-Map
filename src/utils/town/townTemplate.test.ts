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
  uniqueTemplateName,
  placeTemplate,
  TownTemplate,
} from './townTemplate';
import {
  loadTemplates,
  saveTemplates,
  TOWN_TEMPLATES_STORAGE_KEY,
} from './townTemplateStorage';
import {
  TownBuilding,
  TownRoad,
  TownWall,
  TownDistrict,
  TownPier,
  TownObject,
  Pt,
} from '../../types/town';

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

test('名前の保持: sanitizeTemplate preserves object names and handles invalid names', () => {
  const payload = {
    id: 'tmpl_named',
    name: '名前保持テスト',
    objects: [
      {
        id: 'd1',
        name: '貴族街区',
        kind: 'district',
        districtKind: 'noble',
        polygon: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
      },
      {
        id: 'b1',
        name: '鍛冶屋',
        kind: 'building',
        buildingKind: 'shop',
        polygon: [
          [5, 5],
          [10, 5],
          [10, 10],
          [5, 10],
        ],
      },
      {
        id: 'r1',
        name: '職人通り',
        kind: 'road',
        style: 'street',
        points: [
          [0, 5],
          [20, 5],
        ],
      },
      {
        id: 'w1',
        name: '北城壁',
        kind: 'wall',
        points: [
          [0, 25],
          [20, 25],
        ],
      },
      {
        id: 'p1',
        name: '旧港桟橋',
        kind: 'pier',
        points: [
          [0, -10],
          [0, -20],
        ],
      },
      {
        id: 'b2',
        name: '   ', // whitespace only
        kind: 'building',
        buildingKind: 'house',
        polygon: [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ],
      },
      {
        id: 'b3',
        name: 12345, // non-string
        kind: 'building',
        buildingKind: 'house',
        polygon: [
          [11, 1],
          [13, 1],
          [13, 3],
          [11, 3],
        ],
      },
      {
        id: 'b4',
        name: 'あ'.repeat(120), // > 100 chars
        kind: 'building',
        buildingKind: 'house',
        polygon: [
          [15, 1],
          [17, 1],
          [17, 3],
          [15, 3],
        ],
      },
    ],
  };

  const sanitized = sanitizeTemplate(payload);
  assert.ok(sanitized);
  assert.equal(sanitized?.objects.length, 8);

  const objs = sanitized!.objects;
  assert.equal(objs[0].name, '貴族街区');
  assert.equal(objs[1].name, '鍛冶屋');
  assert.equal(objs[2].name, '職人通り');
  assert.equal(objs[3].name, '北城壁');
  assert.equal(objs[4].name, '旧港桟橋');
  assert.equal(objs[5].name, undefined);
  assert.equal(objs[6].name, undefined);
  assert.equal(objs[7].name?.length, 100);
  assert.equal(objs[7].name, 'あ'.repeat(100));

  // Roundtrip through saveTemplates -> loadTemplates
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
    saveTemplates([sanitized!]);
    const loaded = loadTemplates();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].objects[0].name, '貴族街区');
    assert.equal(loaded[0].objects[1].name, '鍛冶屋');
    assert.equal(loaded[0].objects[2].name, '職人通り');
    assert.equal(loaded[0].objects[3].name, '北城壁');
    assert.equal(loaded[0].objects[4].name, '旧港桟橋');
    assert.equal(loaded[0].objects[5].name, undefined);
  } finally {
    (global as any).window = originalWindow;
  }
});

test('列挙型: districtKind and buildingKind fallback to residential and house when invalid', () => {
  const payload = {
    id: 'tmpl_enums',
    name: '列挙型検査',
    objects: [
      {
        id: 'd_valid',
        kind: 'district',
        districtKind: 'market',
        polygon: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      },
      {
        id: 'd_invalid',
        kind: 'district',
        districtKind: 'spaceport',
        polygon: [
          [20, 0],
          [30, 0],
          [30, 10],
          [20, 10],
        ],
      },
      {
        id: 'b_valid',
        kind: 'building',
        buildingKind: 'church',
        polygon: [
          [0, 20],
          [10, 20],
          [10, 30],
          [0, 30],
        ],
      },
      {
        id: 'b_invalid',
        kind: 'building',
        buildingKind: 'spaceship',
        polygon: [
          [20, 20],
          [30, 20],
          [30, 30],
          [20, 30],
        ],
      },
    ],
  };

  const sanitized = sanitizeTemplate(payload);
  assert.ok(sanitized);

  const objs = sanitized!.objects;
  const dValid = objs[0] as TownDistrict;
  const dInvalid = objs[1] as TownDistrict;
  const bValid = objs[2] as TownBuilding;
  const bInvalid = objs[3] as TownBuilding;

  assert.equal(dValid.districtKind, 'market');
  assert.equal(dInvalid.districtKind, 'residential');
  assert.equal(bValid.buildingKind, 'church');
  assert.equal(bInvalid.buildingKind, 'house');
});

test('門の範囲: gates segmentIndex is strictly validated against wall openness and point count', () => {
  const payload = {
    id: 'tmpl_gates',
    name: '城門検査',
    objects: [
      // Open wall with 3 points: 2 segments (index 0, 1)
      {
        id: 'w_open',
        kind: 'wall',
        closed: false,
        points: [
          [0, 0],
          [10, 0],
          [20, 0],
        ],
        gates: [
          { segmentIndex: -1, t: 0.5, widthM: 4 }, // out of range
          { segmentIndex: 0, t: 0.5, widthM: 4 }, // valid
          { segmentIndex: 1, t: 0.2, widthM: 4 }, // valid
          { segmentIndex: 2, t: 0.5, widthM: 4 }, // out of range (points.length - 1 = 2)
          { segmentIndex: 1.5, t: 0.5, widthM: 4 }, // non-integer
        ],
      },
      // Closed wall with 3 points: 3 segments (index 0, 1, 2)
      {
        id: 'w_closed',
        kind: 'wall',
        closed: true,
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        gates: [
          { segmentIndex: -1, t: 0.5, widthM: 4 }, // out of range
          { segmentIndex: 0, t: 0.5, widthM: 4 }, // valid
          { segmentIndex: 1, t: 0.5, widthM: 4 }, // valid
          { segmentIndex: 2, t: 0.5, widthM: 4 }, // valid (closing edge)
          { segmentIndex: 3, t: 0.5, widthM: 4 }, // out of range
        ],
      },
    ],
  };

  const sanitized = sanitizeTemplate(payload);
  assert.ok(sanitized);

  const wOpen = sanitized!.objects[0] as TownWall;
  const wClosed = sanitized!.objects[1] as TownWall;

  assert.equal(wOpen.gates.length, 2);
  assert.equal(wOpen.gates[0].segmentIndex, 0);
  assert.equal(wOpen.gates[1].segmentIndex, 1);

  assert.equal(wClosed.gates.length, 3);
  assert.equal(wClosed.gates[0].segmentIndex, 0);
  assert.equal(wClosed.gates[1].segmentIndex, 1);
  assert.equal(wClosed.gates[2].segmentIndex, 2);
});

test('idの補完: template with missing, empty, or non-string id is assigned a valid unique id', () => {
  const baseObj = {
    id: 'b1',
    kind: 'building',
    buildingKind: 'house',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  };

  // Missing id
  const t1 = sanitizeTemplate({ name: 'IDなし', objects: [baseObj] });
  assert.ok(t1);
  assert.ok(typeof t1?.id === 'string' && t1.id.startsWith('tmpl_'));

  // Empty string id
  const t2 = sanitizeTemplate({ id: '', name: '空ID', objects: [baseObj] });
  assert.ok(t2);
  assert.ok(typeof t2?.id === 'string' && t2.id.startsWith('tmpl_'));

  // Whitespace id
  const t3 = sanitizeTemplate({ id: '   ', name: '空白ID', objects: [baseObj] });
  assert.ok(t3);
  assert.ok(typeof t3?.id === 'string' && t3.id.startsWith('tmpl_'));

  // Non-string id
  const t4 = sanitizeTemplate({ id: 99999, name: '数値ID', objects: [baseObj] });
  assert.ok(t4);
  assert.ok(typeof t4?.id === 'string' && t4.id.startsWith('tmpl_'));
});

test('parseTemplateLibrary: enforces strict format and version check', () => {
  // Wrong format
  const wrongFormat = JSON.stringify({ format: 'wrong-format', version: 1, templates: [] });
  const res1 = parseTemplateLibrary(wrongFormat);
  assert.equal(res1.templates.length, 0);
  assert.equal(res1.error, 'テンプレートファイルの形式が一致しません。');

  // Top level is array
  const topArray = JSON.stringify([{ id: 't1', name: 'test', objects: [] }]);
  const res2 = parseTemplateLibrary(topArray);
  assert.equal(res2.templates.length, 0);
  assert.equal(res2.error, 'テンプレートファイルの形式が一致しません。');

  // templates is not array
  const noTemplates = JSON.stringify({ format: 'hg-town-templates', version: 1, templates: {} });
  const res3 = parseTemplateLibrary(noTemplates);
  assert.equal(res3.templates.length, 0);
  assert.equal(res3.error, 'テンプレートファイルの形式が一致しません。');

  // Newer version (version 2)
  const newerVersion = JSON.stringify({ format: 'hg-town-templates', version: 2, templates: [] });
  const res4 = parseTemplateLibrary(newerVersion);
  assert.equal(res4.templates.length, 0);
  assert.ok(res4.error?.includes('version 2'));

  // Version not a number
  const stringVersion = JSON.stringify({ format: 'hg-town-templates', version: '1', templates: [] });
  const res5 = parseTemplateLibrary(stringVersion);
  assert.equal(res5.templates.length, 0);
  assert.ok(res5.error?.includes('新しい形式'));

  // Partially invalid templates: counts skipped correctly
  const sampleBuilding: TownBuilding = {
    id: 'b1',
    kind: 'building',
    buildingKind: 'house',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    heightM: 6,
    tone: 0.5,
  };
  const validTmpl = createTemplate('有効', [sampleBuilding], 1.0);
  const mixed = JSON.stringify({
    format: 'hg-town-templates',
    version: 1,
    templates: [
      validTmpl,
      { id: 't_bad', name: 'オブジェクトなし', objects: [] },
    ],
  });
  const res6 = parseTemplateLibrary(mixed);
  assert.equal(res6.templates.length, 1);
  assert.equal(res6.skipped, 1);
  assert.equal(res6.templates[0].name, '有効');

  // Serialize -> parse roundtrip matches exactly
  const serialized = serializeTemplateLibrary([validTmpl]);
  const resRoundtrip = parseTemplateLibrary(serialized);
  assert.equal(resRoundtrip.templates.length, 1);
  assert.equal(resRoundtrip.skipped, 0);
  assert.equal(resRoundtrip.templates[0].id, validTmpl.id);
  assert.equal(resRoundtrip.templates[0].name, validTmpl.name);
});

test('uniqueTemplateName: handles collision with (2), (3), case insensitivity, and 60 char cap', () => {
  // No collision
  assert.equal(uniqueTemplateName('町役場', ['商店街', '公園']), '町役場');

  // Collision
  assert.equal(uniqueTemplateName('市場', ['市場']), '市場 (2)');
  assert.equal(uniqueTemplateName('市場', ['市場', '市場 (2)']), '市場 (3)');

  // Case insensitivity
  assert.equal(uniqueTemplateName('Shop', ['shop']), 'Shop (2)');
  assert.equal(uniqueTemplateName('town', ['TOWN', 'Town (2)']), 'town (3)');

  // 60-character length restriction
  const longName = 'あ'.repeat(60);
  const deduplicated = uniqueTemplateName(longName, [longName]);
  assert.ok(deduplicated.length <= 60);
  assert.ok(deduplicated.endsWith(' (2)'));
  assert.equal(deduplicated.length, 60);

  // mergeTemplates uses uniqueTemplateName
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
  const t1 = createTemplate('港町', [sampleBuilding], 1.0, 'id_1');
  const t2 = createTemplate('港町', [sampleBuilding], 1.0, 'id_2');
  const t3 = createTemplate('港町', [sampleBuilding], 1.0, 'id_3');
  const merged = mergeTemplates([t1], [t2, t3]);
  assert.equal(merged[0].name, '港町');
  assert.equal(merged[1].name, '港町 (2)');
  assert.equal(merged[2].name, '港町 (3)');
});

test('実寸: preserves real-world meter distances across different metersPerUnit maps', () => {
  // Two buildings at map units with 20m separation:
  // In map with metersPerUnit = 1.0: centers at [0, 0] and [20, 0] -> 20m
  const b1: TownBuilding = {
    id: 'b1',
    kind: 'building',
    buildingKind: 'house',
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
    heightM: 5,
    tone: 0.5,
  };
  const b2: TownBuilding = {
    id: 'b2',
    kind: 'building',
    buildingKind: 'shop',
    polygon: [
      [18, -2],
      [22, -2],
      [22, 2],
      [18, 2],
    ],
    heightM: 5,
    tone: 0.5,
  };

  const tmpl = createTemplate('2棟セット', [b1, b2], 1.0);

  // Place on Map A (metersPerUnit = 1.0): 1 unit = 1m
  const placedMapA = instantiateTemplate(tmpl, [100, 100], 1.0);
  const pA1 = placedMapA[0] as TownBuilding;
  const pA2 = placedMapA[1] as TownBuilding;
  const distUnitsA = Math.hypot(
    (pA1.polygon[0][0] + pA1.polygon[2][0]) / 2 - (pA2.polygon[0][0] + pA2.polygon[2][0]) / 2,
    (pA1.polygon[0][1] + pA1.polygon[2][1]) / 2 - (pA2.polygon[0][1] + pA2.polygon[2][1]) / 2
  );
  const distMetersA = distUnitsA * 1.0;
  assert.ok(Math.abs(distMetersA - 20) < 1e-3);

  // Place on Map B (metersPerUnit = 2.0): 1 unit = 2m -> units separation should be 10 units
  const placedMapB = instantiateTemplate(tmpl, [100, 100], 2.0);
  const pB1 = placedMapB[0] as TownBuilding;
  const pB2 = placedMapB[1] as TownBuilding;
  const distUnitsB = Math.hypot(
    (pB1.polygon[0][0] + pB1.polygon[2][0]) / 2 - (pB2.polygon[0][0] + pB2.polygon[2][0]) / 2,
    (pB1.polygon[0][1] + pB1.polygon[2][1]) / 2 - (pB2.polygon[0][1] + pB2.polygon[2][1]) / 2
  );
  const distMetersB = distUnitsB * 2.0;
  assert.ok(Math.abs(distUnitsB - 10) < 1e-3);
  assert.ok(Math.abs(distMetersB - 20) < 1e-3);

  // Meter distances match exactly between Map A and Map B!
  assert.ok(Math.abs(distMetersA - distMetersB) < 1e-3);
});

test('往復: createTemplate and instantiateTemplate at centroid preserves vertex coordinates', () => {
  const b1: TownBuilding = {
    id: 'b1',
    kind: 'building',
    buildingKind: 'house',
    polygon: [
      [10, 20],
      [20, 20],
      [20, 30],
      [10, 30],
    ],
    heightM: 6,
    tone: 0.5,
  };
  const r1: TownRoad = {
    id: 'r1',
    kind: 'road',
    style: 'main',
    widthM: 4,
    smooth: false,
    points: [
      [0, 25],
      [30, 25],
    ],
  };

  const metersPerUnit = 1.5;
  const tmpl = createTemplate('往復テスト', [b1, r1], metersPerUnit);

  // Compute centroid of original objects
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of [b1, r1]) {
    const pts = obj.kind === 'building' ? obj.polygon : obj.points;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const centroid: Pt = [(minX + maxX) / 2, (minY + maxY) / 2];

  const placed = instantiateTemplate(tmpl, centroid, metersPerUnit, {
    angleDeg: 0,
    flipX: false,
  });

  assert.equal(placed.length, 2);
  const placedB = placed[0] as TownBuilding;
  const placedR = placed[1] as TownRoad;

  for (let i = 0; i < b1.polygon.length; i++) {
    assert.ok(Math.abs(placedB.polygon[i][0] - b1.polygon[i][0]) < 1e-4);
    assert.ok(Math.abs(placedB.polygon[i][1] - b1.polygon[i][1]) < 1e-4);
  }
  for (let i = 0; i < r1.points.length; i++) {
    assert.ok(Math.abs(placedR.points[i][0] - r1.points[i][0]) < 1e-4);
    assert.ok(Math.abs(placedR.points[i][1] - r1.points[i][1]) < 1e-4);
  }
});

test('idの一意性: 500 objects instantiation produces strictly unique IDs avoiding collisions', () => {
  const objects: TownObject[] = [];
  for (let i = 0; i < 500; i++) {
    objects.push({
      id: `src_b_${i}`,
      kind: 'building',
      buildingKind: 'house',
      polygon: [
        [i * 10, 0],
        [i * 10 + 5, 0],
        [i * 10 + 5, 5],
        [i * 10, 5],
      ],
      heightM: 5,
      tone: 0.5,
    });
  }

  const tmpl = createTemplate('巨大テンプレート', objects, 1.0);

  // Populate existingIds with 1000 simulated IDs
  const existingIds = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    existingIds.add(`building_${Date.now()}_${i}`);
  }

  const placed = instantiateTemplate(tmpl, [0, 0], 1.0, { existingIds });
  assert.equal(placed.length, 500);

  const placedIdSet = new Set<string>();
  for (const obj of placed) {
    assert.ok(!existingIds.has(obj.id), `ID ${obj.id} collided with existingIds`);
    assert.ok(!placedIdSet.has(obj.id), `ID ${obj.id} is duplicated within placed objects`);
    placedIdSet.add(obj.id);
  }
  assert.equal(placedIdSet.size, 500);
});

test('placeTemplate: returns newObjects, prevObjects, placedIds with undo capability', () => {
  const existing1: TownBuilding = {
    id: 'existing_1',
    kind: 'building',
    buildingKind: 'house',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    heightM: 6,
    tone: 0.5,
  };
  const existing2: TownRoad = {
    id: 'existing_2',
    kind: 'road',
    style: 'main',
    widthM: 4,
    smooth: false,
    points: [
      [0, 15],
      [30, 15],
    ],
  };
  const townObjects: TownObject[] = [existing1, existing2];

  const tmplBuilding: TownBuilding = {
    id: 'tmpl_b',
    kind: 'building',
    buildingKind: 'shop',
    polygon: [
      [0, 0],
      [8, 0],
      [8, 8],
      [0, 8],
    ],
    heightM: 5,
    tone: 0.4,
  };
  const tmpl = createTemplate('店舗', [tmplBuilding], 1.0);

  const result = placeTemplate(townObjects, tmpl, [100, 100], 1.0, {
    angleDeg: 0,
    flipX: false,
  });

  // prevObjects is exactly the passed array (unchanged)
  assert.equal(result.prevObjects, townObjects);
  assert.equal(result.prevObjects.length, 2);

  // newObjects starts with townObjects and appends placed objects
  assert.equal(result.newObjects.length, 3);
  assert.equal(result.newObjects[0], existing1);
  assert.equal(result.newObjects[1], existing2);

  // placedIds matches the placed object
  assert.equal(result.placedIds.length, 1);
  assert.equal(result.newObjects[2].id, result.placedIds[0]);
  assert.notEqual(result.placedIds[0], 'existing_1');
  assert.notEqual(result.placedIds[0], 'existing_2');

  // Undo restores exact initial objects
  const undoneObjects = result.prevObjects;
  assert.equal(undoneObjects.length, 2);
  assert.equal(undoneObjects[0].id, 'existing_1');
  assert.equal(undoneObjects[1].id, 'existing_2');
});

