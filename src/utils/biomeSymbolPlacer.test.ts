import test from 'node:test';
import assert from 'node:assert/strict';
import {
  placeBiomeSymbols,
  removeAutoBiomeSymbols,
  countAutoBiomeSymbols,
} from './biomeSymbolPlacer';
import { BiomeType } from '../types/biome';
import { CustomMapAsset, MapSymbolInstance } from '../types/symbols';
import { serializeMapData, deserializeMapData } from './serialization';
import { MapData } from '../types/map';

function createTestSetup() {
  const gridCols = 64;
  const gridRows = 64;
  const mapWidth = 640;
  const mapHeight = 640;
  const seaLevel = 35;

  const biomeGrid = new Uint8Array(gridCols * gridRows);
  const elevationGrid = new Float32Array(gridCols * gridRows);

  // Fill elevation with 50 (land)
  elevationGrid.fill(50);

  // Set top-left quadrant (0..31, 0..31) as Slot 1
  for (let r = 0; r < 32; r++) {
    for (let c = 0; c < 32; c++) {
      biomeGrid[r * gridCols + c] = 1;
    }
  }

  // Set bottom-right quadrant (32..63, 32..63) as Slot 2
  for (let r = 32; r < 64; r++) {
    for (let c = 32; c < 64; c++) {
      biomeGrid[r * gridCols + c] = 2;
    }
  }

  const customAssets: CustomMapAsset[] = [
    {
      id: 'custom_tree_1',
      name: '自作の木',
      category: 'tree',
      dataUrl: 'data:image/png;base64,fake',
      width: 32,
      height: 32,
      originX: 0.5,
      originY: 0.9,
      createdAt: Date.now(),
    },
  ];

  const biomeTypes: BiomeType[] = [
    {
      slot: 1,
      name: '針葉樹林',
      color: '#1f5d3a',
      symbols: [
        {
          kind: 'builtin',
          symbolType: 'tree_pine',
          weight: 1,
          scaleMin: 0.8,
          scaleMax: 1.2,
        },
      ],
      density: 80,
      minDistance: 16,
      flipRandom: true,
    },
    {
      slot: 2,
      name: '広葉樹林',
      color: '#4f9a3c',
      symbols: [
        {
          kind: 'custom',
          customAssetId: 'custom_tree_1',
          weight: 1,
          scaleMin: 0.8,
          scaleMax: 1.2,
        },
      ],
      density: 80,
      minDistance: 16,
      flipRandom: true,
    },
  ];

  return {
    gridCols,
    gridRows,
    mapWidth,
    mapHeight,
    seaLevel,
    biomeGrid,
    elevationGrid,
    biomeTypes,
    customAssets,
  };
}

test('1. Symbols are placed only inside matching slot and never on sea cells (elevation < seaLevel)', () => {
  const setup = createTestSetup();
  // Turn a chunk of slot 1 cells into sea
  for (let r = 5; r < 15; r++) {
    for (let c = 5; c < 15; c++) {
      setup.elevationGrid[r * setup.gridCols + c] = 20; // below seaLevel (35)
    }
  }

  const res = placeBiomeSymbols({
    ...setup,
    targetSlots: [1],
    edgeFade: 0,
    seed: 42,
  });

  assert(res.symbols.length > 0, 'Symbols should be placed');

  for (const sym of res.symbols) {
    const c = Math.floor((sym.x / setup.mapWidth) * setup.gridCols);
    const r = Math.floor((sym.y / setup.mapHeight) * setup.gridRows);
    const idx = r * setup.gridCols + c;

    assert.equal(setup.biomeGrid[idx], 1, `Symbol at (${sym.x}, ${sym.y}) must be inside slot 1`);
    assert(setup.elevationGrid[idx] >= setup.seaLevel, `Symbol at (${sym.x}, ${sym.y}) must not be in sea`);
  }
});

test('2. Symbol distance constraints: >= minDistance within same type, >= minDistance * 0.6 with other symbols', () => {
  const setup = createTestSetup();
  const res = placeBiomeSymbols({
    ...setup,
    targetSlots: [1, 2],
    seed: 101,
  });

  const slot1Syms = res.symbols.filter((s) => s.autoBiomeSlot === 1);
  const slot2Syms = res.symbols.filter((s) => s.autoBiomeSlot === 2);

  // Check intra-type distance >= minDistance (16)
  for (let i = 0; i < slot1Syms.length; i++) {
    for (let j = i + 1; j < slot1Syms.length; j++) {
      const dist = Math.hypot(slot1Syms[i].x - slot1Syms[j].x, slot1Syms[i].y - slot1Syms[j].y);
      assert(dist >= 15.9, `Slot 1 intra-symbol distance ${dist} must be >= minDistance (16)`);
    }
  }

  // Check inter-type distance >= minDistance * 0.6
  for (const s1 of slot1Syms) {
    for (const s2 of slot2Syms) {
      const dist = Math.hypot(s1.x - s2.x, s1.y - s2.y);
      assert(dist >= 16 * 0.6 - 0.1, `Inter-symbol distance ${dist} must be >= minDistance * 0.6`);
    }
  }
});

test('3. Density control: 0% gives 0 symbols, 100% gives more symbols than 50% (roughly proportional)', () => {
  const setup = createTestSetup();

  // Density 0%
  const setup0 = {
    ...setup,
    biomeTypes: [{ ...setup.biomeTypes[0], density: 0 }],
  };
  const res0 = placeBiomeSymbols({ ...setup0, targetSlots: [1], seed: 777 });
  assert.equal(res0.symbols.length, 0, 'Density 0 should place 0 symbols');

  // Density 50%
  const setup50 = {
    ...setup,
    biomeTypes: [{ ...setup.biomeTypes[0], density: 50 }],
  };
  const res50 = placeBiomeSymbols({ ...setup50, targetSlots: [1], seed: 777 });

  // Density 100%
  const setup100 = {
    ...setup,
    biomeTypes: [{ ...setup.biomeTypes[0], density: 100 }],
  };
  const res100 = placeBiomeSymbols({ ...setup100, targetSlots: [1], seed: 777 });

  assert(res50.symbols.length > 0, 'Density 50 should place symbols');
  assert(res100.symbols.length > res50.symbols.length, 'Density 100 should place more than density 50');

  // Ratio should be approximately 2.0 (e.g. between 1.5 and 2.5)
  const ratio = res100.symbols.length / res50.symbols.length;
  assert(ratio >= 1.5 && ratio <= 2.5, `Ratio ${ratio} should be roughly 2.0`);
});

test('4. PRNG Determinism: Same seed gives identical results, different seed gives different results', () => {
  const setup = createTestSetup();

  const run1 = placeBiomeSymbols({ ...setup, seed: 12345 });
  const run2 = placeBiomeSymbols({ ...setup, seed: 12345 });
  const runDiff = placeBiomeSymbols({ ...setup, seed: 99999 });

  assert.deepEqual(run1.symbols, run2.symbols, 'Identical seed must produce identical symbols');
  assert.deepEqual(run1.stats, run2.stats, 'Identical seed must produce identical stats');

  // With a different seed, coordinates or count should differ
  assert.notDeepEqual(run1.symbols, runDiff.symbols, 'Different seed must produce different symbols');
});

test('5. edgeFade: Larger edgeFade reduces proportion of symbols near mask boundary', () => {
  const setup = createTestSetup();
  // Slot 1 occupies 0..320 on X and 0..320 on Y. The border is along x=320 or y=320.
  // Compare edgeFade = 0 vs edgeFade = 50
  const resNoFade = placeBiomeSymbols({ ...setup, targetSlots: [1], edgeFade: 0, seed: 444 });
  const resFade = placeBiomeSymbols({ ...setup, targetSlots: [1], edgeFade: 50, seed: 444 });

  // Count symbols near boundary (within 30 map units from border x=320 or y=320)
  const isNearBorder = (s: MapSymbolInstance) => Math.min(320 - s.x, 320 - s.y) < 30;

  const nearBorderNoFade = resNoFade.symbols.filter(isNearBorder).length;
  const ratioNoFade = nearBorderNoFade / resNoFade.symbols.length;

  const nearBorderFade = resFade.symbols.filter(isNearBorder).length;
  const ratioFade = nearBorderFade / resFade.symbols.length;

  assert(
    ratioFade < ratioNoFade,
    `Edge fade should reduce near-border symbol ratio (Fade: ${ratioFade.toFixed(3)}, NoFade: ${ratioNoFade.toFixed(3)})`
  );
});

test('6. Elevation window: elevationMin and elevationMax restrict placement', () => {
  const setup = createTestSetup();

  // Gradient elevation across slot 1: from 35 to 95
  for (let r = 0; r < 32; r++) {
    for (let c = 0; c < 32; c++) {
      setup.elevationGrid[r * setup.gridCols + c] = 35 + (r / 31) * 60; // 35 to 95
    }
  }

  // Rule only allows high elevations: 70 to 90
  const highElevBiome: BiomeType = {
    ...setup.biomeTypes[0],
    symbols: [
      {
        kind: 'builtin',
        symbolType: 'mountain_snow',
        weight: 1,
        scaleMin: 1.0,
        scaleMax: 1.0,
        elevationMin: 70,
        elevationMax: 90,
      },
    ],
  };

  const res = placeBiomeSymbols({
    ...setup,
    biomeTypes: [highElevBiome],
    targetSlots: [1],
    seed: 555,
  });

  assert(res.symbols.length > 0, 'Should place some high elevation symbols');

  for (const sym of res.symbols) {
    const c = Math.floor((sym.x / setup.mapWidth) * setup.gridCols);
    const r = Math.floor((sym.y / setup.mapHeight) * setup.gridRows);
    const elev = setup.elevationGrid[r * setup.gridCols + c];
    assert(elev >= 70 && elev <= 90, `Symbol elevation ${elev} must be in [70, 90]`);
  }

  // If elevation range has no overlap (e.g. 96 to 100), 0 symbols placed
  const unreachableBiome: BiomeType = {
    ...setup.biomeTypes[0],
    symbols: [
      {
        kind: 'builtin',
        symbolType: 'mountain_snow',
        weight: 1,
        scaleMin: 1.0,
        scaleMax: 1.0,
        elevationMin: 96,
        elevationMax: 100,
      },
    ],
  };

  const resEmpty = placeBiomeSymbols({
    ...setup,
    biomeTypes: [unreachableBiome],
    targetSlots: [1],
    seed: 555,
  });
  assert.equal(resEmpty.symbols.length, 0, 'No symbols placed if elevation range is unreachable');
});

test('7. Replace mode vs Append mode', () => {
  const setup = createTestSetup();

  const existingSymbols: MapSymbolInstance[] = [
    {
      id: 'hand_placed_1',
      type: 'tower_wizard',
      x: 100,
      y: 100,
      scale: 1,
      // No autoBiomeSlot -> manually placed!
    },
    {
      id: 'existing_auto_slot_1',
      type: 'tree_pine',
      x: 120,
      y: 120,
      scale: 1,
      autoBiomeSlot: 1, // Auto-placed slot 1
    },
    {
      id: 'existing_auto_slot_2',
      type: 'tree_oak',
      x: 500,
      y: 500,
      scale: 1,
      autoBiomeSlot: 2, // Auto-placed slot 2
    },
  ];

  // Run in replace mode targeting slot 1 only
  const resReplace = placeBiomeSymbols({
    ...setup,
    existingSymbols,
    targetSlots: [1],
    mode: 'replace',
    seed: 888,
  });

  // Hand-placed symbol MUST be kept
  assert(
    resReplace.symbols.some((s) => s.id === 'hand_placed_1'),
    'Hand-placed symbol must survive replace mode'
  );
  // Existing auto slot 2 MUST be kept (not in targetSlots)
  assert(
    resReplace.symbols.some((s) => s.id === 'existing_auto_slot_2'),
    'Existing auto slot 2 must survive when only targeting slot 1'
  );
  // Existing auto slot 1 MUST be removed
  assert(
    !resReplace.symbols.some((s) => s.id === 'existing_auto_slot_1'),
    'Targeted auto slot 1 must be replaced'
  );

  // In append mode, ALL existing symbols must remain
  const resAppend = placeBiomeSymbols({
    ...setup,
    existingSymbols,
    targetSlots: [1],
    mode: 'append',
    seed: 888,
  });

  assert(resAppend.symbols.some((s) => s.id === 'hand_placed_1'));
  assert(resAppend.symbols.some((s) => s.id === 'existing_auto_slot_1'));
  assert(resAppend.symbols.some((s) => s.id === 'existing_auto_slot_2'));
});

test('8. Region constraint: restricts placement and protects existing symbols outside region in replace mode', () => {
  const setup = createTestSetup();
  const region = { minX: 50, minY: 50, maxX: 150, maxY: 150 };

  const existingSymbols: MapSymbolInstance[] = [
    {
      id: 'auto_slot1_outside',
      type: 'tree_pine',
      x: 250,
      y: 250,
      scale: 1,
      autoBiomeSlot: 1, // Slot 1, but outside region
    },
    {
      id: 'auto_slot1_inside',
      type: 'tree_pine',
      x: 80,
      y: 80,
      scale: 1,
      autoBiomeSlot: 1, // Slot 1, inside region
    },
  ];

  const res = placeBiomeSymbols({
    ...setup,
    existingSymbols,
    targetSlots: [1],
    region,
    mode: 'replace',
    seed: 123,
  });

  // Existing symbol outside region must NOT be removed
  assert(
    res.symbols.some((s) => s.id === 'auto_slot1_outside'),
    'Existing symbol outside region must be protected'
  );
  // Existing symbol inside region is removed
  assert(
    !res.symbols.some((s) => s.id === 'auto_slot1_inside'),
    'Existing symbol inside region must be replaced'
  );

  // All newly placed symbols must be within region
  const newSymbols = res.symbols.filter((s) => s.id.startsWith('sym_auto_'));
  for (const s of newSymbols) {
    assert(
      s.x >= region.minX && s.x <= region.maxX && s.y >= region.minY && s.y <= region.maxY,
      `New symbol at (${s.x}, ${s.y}) must be inside region bounds`
    );
  }
});

test('9. Rule weights: 3:1 ratio produces roughly 3:1 symbol distribution', () => {
  const setup = createTestSetup();

  const weightedBiome: BiomeType = {
    ...setup.biomeTypes[0],
    symbols: [
      {
        kind: 'builtin',
        symbolType: 'tree_pine',
        weight: 3,
        scaleMin: 1.0,
        scaleMax: 1.0,
      },
      {
        kind: 'builtin',
        symbolType: 'tree_dead',
        weight: 1,
        scaleMin: 1.0,
        scaleMax: 1.0,
      },
    ],
    density: 100,
    minDistance: 8,
  };

  const res = placeBiomeSymbols({
    ...setup,
    biomeTypes: [weightedBiome],
    targetSlots: [1],
    seed: 321,
    maxCount: 2000,
  });

  const pineCount = res.symbols.filter((s) => s.type === 'tree_pine').length;
  const deadCount = res.symbols.filter((s) => s.type === 'tree_dead').length;

  assert(pineCount > 100 && deadCount > 20, 'Should have enough sample symbols');
  const ratio = pineCount / deadCount;
  // Expected ratio is ~3.0 (allowing tolerance 2.2 .. 4.0)
  assert(
    ratio >= 2.2 && ratio <= 4.0,
    `Weight ratio ${ratio.toFixed(2)} should be close to 3.0 (pine: ${pineCount}, dead: ${deadCount})`
  );
});

test('10. Invalid rules handling: Biome with no valid rules is skipped and reason logged', () => {
  const setup = createTestSetup();

  const missingAssetBiome: BiomeType = {
    ...setup.biomeTypes[0],
    symbols: [
      {
        kind: 'custom',
        customAssetId: 'non_existent_asset_id', // Does not exist
        weight: 2,
        scaleMin: 1.0,
        scaleMax: 1.0,
      },
    ],
  };

  const res = placeBiomeSymbols({
    ...setup,
    biomeTypes: [missingAssetBiome],
    targetSlots: [1],
    seed: 123,
  });

  assert.equal(res.symbols.length, 0, 'No symbols should be placed');
  assert.equal(res.stats.placedPerSlot[1], 0);
  assert(
    res.stats.skippedReasons[1] && res.stats.skippedReasons[1].length > 0,
    'Reason must be recorded in stats.skippedReasons'
  );
});

test('11. maxCount cap: Placed symbols do not exceed maxCount and stats.truncated is true', () => {
  const setup = createTestSetup();

  const res = placeBiomeSymbols({
    ...setup,
    targetSlots: [1],
    maxCount: 25,
    seed: 999,
  });

  assert.equal(res.symbols.length, 25, 'Symbols count must equal maxCount cap');
  assert.equal(res.stats.totalPlaced, 25);
  assert.equal(res.stats.truncated, true, 'stats.truncated must be true');
});

test('12. dryRun: Returns symbols: [] and identical stats to actual run', () => {
  const setup = createTestSetup();

  const actualRes = placeBiomeSymbols({
    ...setup,
    targetSlots: [1, 2],
    dryRun: false,
    seed: 456,
  });

  const dryRes = placeBiomeSymbols({
    ...setup,
    targetSlots: [1, 2],
    dryRun: true,
    seed: 456,
  });

  assert.equal(dryRes.symbols.length, 0, 'dryRun must return empty symbols array');
  assert.deepEqual(dryRes.stats, actualRes.stats, 'dryRun stats must be identical to actual run');
  assert(dryRes.stats.totalPlaced > 0, 'dryRun must calculate non-zero totalPlaced');
});

test('13. Serialization round-trip: autoBiomeSlot and rule elevationMin/elevationMax are preserved; legacy data loads', () => {
  const dummyMap: Partial<MapData> = {
    seed: 1234,
    width: 1000,
    height: 500,
    gridCols: 64,
    gridRows: 32,
    cells: [],
    elevationGrid: new Float32Array(64 * 32),
    symbols: [
      {
        id: 'sym_auto_1',
        type: 'tree_pine',
        x: 100,
        y: 200,
        scale: 1.1,
        autoBiomeSlot: 3, // Auto biome slot
      },
      {
        id: 'sym_hand_1',
        type: 'village_farm',
        x: 150,
        y: 250,
        scale: 1.0,
      },
    ],
    biomeTypes: [
      {
        slot: 3,
        name: '高山針葉樹',
        color: '#2a5a3a',
        symbols: [
          {
            kind: 'builtin',
            symbolType: 'tree_pine',
            weight: 5,
            scaleMin: 0.8,
            scaleMax: 1.2,
            elevationMin: 60,
            elevationMax: 95,
          },
        ],
        density: 70,
        minDistance: 12,
        flipRandom: true,
      },
    ],
  };

  const serialized = serializeMapData(dummyMap as MapData);
  const deserialized = deserializeMapData(serialized);

  // Check symbols
  assert(deserialized.symbols, 'deserialized.symbols must exist');
  assert.equal(deserialized.symbols.length, 2);
  const autoSym = deserialized.symbols.find((s) => s.id === 'sym_auto_1');
  assert(autoSym, 'autoSym must exist');
  assert.equal(autoSym.autoBiomeSlot, 3, 'autoBiomeSlot must be preserved in round-trip');

  const handSym = deserialized.symbols.find((s) => s.id === 'sym_hand_1');
  assert(handSym, 'handSym must exist');
  assert.equal(handSym.autoBiomeSlot, undefined, 'handSym must not have autoBiomeSlot');

  // Check biome symbol rule elevation range
  assert(deserialized.biomeTypes, 'deserialized.biomeTypes must exist');
  const rule = deserialized.biomeTypes[0]?.symbols[0];
  assert(rule, 'rule must exist');
  assert.equal(rule.elevationMin, 60, 'elevationMin must be preserved');
  assert.equal(rule.elevationMax, 95, 'elevationMax must be preserved');

  // Legacy data without autoBiomeSlot or elevationMin/elevationMax loads cleanly
  const legacyObj = {
    seed: 5678,
    width: 800,
    height: 400,
    gridCols: 32,
    gridRows: 16,
    symbols: [
      {
        id: 'legacy_1',
        type: 'tree_pine',
        x: 50,
        y: 50,
        scale: 1.0,
      },
    ],
    biomeTypes: [
      {
        slot: 1,
        name: '平原',
        color: '#55aa55',
        symbols: [
          {
            kind: 'builtin',
            symbolType: 'tree_oak',
            weight: 2,
            scaleMin: 0.8,
            scaleMax: 1.2,
          },
        ],
        density: 50,
        minDistance: 8,
        flipRandom: true,
      },
    ],
  };

  const legacyData = deserializeMapData(legacyObj);
  assert(legacyData.symbols, 'legacyData.symbols must exist');
  assert.equal(legacyData.symbols[0].id, 'legacy_1');
  assert.equal(legacyData.symbols[0].autoBiomeSlot, undefined);
  assert(legacyData.biomeTypes, 'legacyData.biomeTypes must exist');
  assert.equal(legacyData.biomeTypes[0].symbols[0].elevationMin, undefined);
  assert.equal(legacyData.biomeTypes[0].symbols[0].elevationMax, undefined);
});

test('14. Unit test: removeAutoBiomeSymbols strictly preserves hand-placed symbols and filters target slot correctly', () => {
  const symbols: MapSymbolInstance[] = [
    { id: 'hand_1', type: 'tree_pine', x: 10, y: 10, scale: 1 }, // Hand-placed (no autoBiomeSlot)
    { id: 'hand_2', type: 'mountain_rock', x: 50, y: 50, scale: 1.2 }, // Hand-placed
    { id: 'auto_slot1_a', type: 'tree_pine', x: 100, y: 100, scale: 1, autoBiomeSlot: 1 },
    { id: 'auto_slot1_b', type: 'tree_pine', x: 120, y: 120, scale: 1, autoBiomeSlot: 1 },
    { id: 'auto_slot2_a', type: 'tree_oak', x: 200, y: 200, scale: 1, autoBiomeSlot: 2 },
    { id: 'auto_slot3_a', type: 'tree_dead', x: 300, y: 300, scale: 1, autoBiomeSlot: 3 },
  ];

  // Count checks
  assert.equal(countAutoBiomeSymbols(symbols), 4);
  assert.equal(countAutoBiomeSymbols(symbols, 1), 2);
  assert.equal(countAutoBiomeSymbols(symbols, 2), 1);
  assert.equal(countAutoBiomeSymbols(symbols, 3), 1);
  assert.equal(countAutoBiomeSymbols(symbols, 99), 0);

  // 1. Remove only Slot 1
  const delSlot1 = removeAutoBiomeSymbols(symbols, { targetSlot: 1 });
  assert.equal(delSlot1.removedCount, 2);
  assert.equal(delSlot1.remainingSymbols.length, 4);
  // Hand-placed must remain
  assert(delSlot1.remainingSymbols.some((s) => s.id === 'hand_1'));
  assert(delSlot1.remainingSymbols.some((s) => s.id === 'hand_2'));
  // Slot 2 and Slot 3 auto symbols must remain
  assert(delSlot1.remainingSymbols.some((s) => s.id === 'auto_slot2_a'));
  assert(delSlot1.remainingSymbols.some((s) => s.id === 'auto_slot3_a'));
  // Slot 1 auto symbols must be gone
  assert(!delSlot1.remainingSymbols.some((s) => s.id === 'auto_slot1_a'));
  assert(!delSlot1.remainingSymbols.some((s) => s.id === 'auto_slot1_b'));

  // 2. Remove All auto-placed symbols
  const delAll = removeAutoBiomeSymbols(symbols);
  assert.equal(delAll.removedCount, 4);
  assert.equal(delAll.remainingSymbols.length, 2);
  // Only hand-placed symbols must remain
  assert.deepEqual(
    delAll.remainingSymbols.map((s) => s.id),
    ['hand_1', 'hand_2']
  );
  for (const s of delAll.remainingSymbols) {
    assert.equal(s.autoBiomeSlot, undefined, 'Remaining symbols must all be hand-placed');
  }
});

test('15. Integration test: dryRun estimation count strictly matches actual placement count and newly added symbols', () => {
  const setup = createTestSetup();

  const existingSymbols: MapSymbolInstance[] = [
    { id: 'user_sym_1', type: 'tree_pine', x: 25, y: 25, scale: 1 }, // Hand-placed
    { id: 'prev_auto_1', type: 'tree_pine', x: 100, y: 100, scale: 1, autoBiomeSlot: 1 }, // Old auto slot 1
  ];

  // Test Append Mode
  const appendDry = placeBiomeSymbols({
    ...setup,
    existingSymbols,
    mode: 'append',
    seed: 88214,
    edgeFade: 4,
    maxCount: 500,
    dryRun: true,
  });

  const appendReal = placeBiomeSymbols({
    ...setup,
    existingSymbols,
    mode: 'append',
    seed: 88214,
    edgeFade: 4,
    maxCount: 500,
    dryRun: false,
  });

  assert(appendDry.stats.totalPlaced > 0, 'Estimate must place symbols');
  assert.equal(appendDry.symbols.length, 0, 'dryRun must not return symbol instances');
  assert.equal(
    appendDry.stats.totalPlaced,
    appendReal.stats.totalPlaced,
    'Estimated total must strictly equal actual placed count'
  );
  assert.equal(
    appendReal.symbols.length - existingSymbols.length,
    appendDry.stats.totalPlaced,
    'Newly added symbols in append mode must strictly equal estimated count'
  );
  assert.deepEqual(
    appendDry.stats.placedPerSlot,
    appendReal.stats.placedPerSlot,
    'Per-slot breakdown must match between dryRun and actual execution'
  );

  // Test Replace Mode
  const replaceDry = placeBiomeSymbols({
    ...setup,
    existingSymbols,
    mode: 'replace',
    seed: 94712,
    edgeFade: 6,
    maxCount: 400,
    dryRun: true,
  });

  const replaceReal = placeBiomeSymbols({
    ...setup,
    existingSymbols,
    mode: 'replace',
    seed: 94712,
    edgeFade: 6,
    maxCount: 400,
    dryRun: false,
  });

  assert.equal(
    replaceDry.stats.totalPlaced,
    replaceReal.stats.totalPlaced,
    'Estimated count in replace mode must strictly equal actual placed count'
  );

  // Hand-placed symbol must be preserved
  assert(
    replaceReal.symbols.some((s) => s.id === 'user_sym_1'),
    'Hand-placed symbol must never be removed in replace mode'
  );
  // Old auto slot 1 must have been replaced
  assert(
    !replaceReal.symbols.some((s) => s.id === 'prev_auto_1'),
    'Old auto-placed symbol for target slot must be replaced in replace mode'
  );
});

test('16. waterGrid excludes symbols from river and lake cells (waterGrid >= 128)', () => {
  const setup = createTestSetup();
  const waterGrid = new Uint8Array(setup.gridCols * setup.gridRows);

  // Mark center band of slot 1 quadrant (r: 10..20, c: 0..31) as a river (waterGrid = 255)
  for (let r = 10; r <= 20; r++) {
    for (let c = 0; c < 32; c++) {
      waterGrid[r * setup.gridCols + c] = 255;
    }
  }

  const result = placeBiomeSymbols({
    ...setup,
    waterGrid,
    seed: 55443,
    edgeFade: 0,
    targetSlots: [1],
    dryRun: false,
  });

  assert(result.symbols.length > 0, 'Symbols should be placed on land outside the water grid');

  // Verify that no symbol is placed in the river cells
  for (const sym of result.symbols) {
    const c = Math.floor((sym.x / setup.mapWidth) * setup.gridCols);
    const r = Math.floor((sym.y / setup.mapHeight) * setup.gridRows);
    const idx = r * setup.gridCols + c;
    assert(
      waterGrid[idx] < 128,
      `Symbol at (${sym.x}, ${sym.y}) (grid ${c}, ${r}) was placed on water cell!`
    );
  }
});

test('17. ridgeWeight prioritizes mountain ridge placement and scaleByElevation increases size at higher peaks', () => {
  const setup = createTestSetup();

  // Create a sharp ridge in slot 1: row 16 has elev 90, surrounding rows 10..22 have elev 50
  for (let c = 0; c < 32; c++) {
    setup.elevationGrid[16 * setup.gridCols + c] = 90;
  }

  const ridgeBiome: BiomeType = {
    slot: 1,
    name: '山脈',
    color: '#8c7f74',
    symbols: [
      {
        kind: 'builtin',
        symbolType: 'mountain_rock',
        weight: 10,
        scaleMin: 0.8,
        scaleMax: 1.2,
        scaleByElevation: true,
      },
    ],
    density: 80,
    minDistance: 8,
    flipRandom: true,
    ridgeWeight: 0.8,
  };

  const result = placeBiomeSymbols({
    ...setup,
    biomeTypes: [ridgeBiome],
    targetSlots: [1],
    seed: 42195,
    edgeFade: 0,
  });

  assert(result.symbols.length > 0, 'Symbols should be placed on ridge');

  // Symbols near row 16 (ridge, elev 90) should have larger scale than symbols near row 2 (elev 50)
  const highElevSymbols = result.symbols.filter((s) => {
    const r = Math.floor((s.y / setup.mapHeight) * setup.gridRows);
    return r >= 15 && r <= 17;
  });
  const lowElevSymbols = result.symbols.filter((s) => {
    const r = Math.floor((s.y / setup.mapHeight) * setup.gridRows);
    return r <= 5;
  });

  assert(highElevSymbols.length > 0, 'Should place symbols along the high ridge');
  if (lowElevSymbols.length > 0) {
    const avgHighScale = highElevSymbols.reduce((a, b) => a + b.scale, 0) / highElevSymbols.length;
    const avgLowScale = lowElevSymbols.reduce((a, b) => a + b.scale, 0) / lowElevSymbols.length;
    assert(
      avgHighScale > avgLowScale,
      `Higher elevation symbols should have larger average scale (${avgHighScale} vs ${avgLowScale})`
    );
  }
});

test('18. overallDensity scales symbol placement count predictably', () => {
  const setup = createTestSetup();

  const forestBiome: BiomeType = {
    slot: 1,
    name: '森林',
    color: '#1f5d3a',
    symbols: [
      {
        kind: 'builtin',
        symbolType: 'tree_pine',
        weight: 5,
        scaleMin: 0.5,
        scaleMax: 0.8,
      },
    ],
    density: 80,
    minDistance: 6,
    flipRandom: true,
  };

  const res100 = placeBiomeSymbols({
    ...setup,
    biomeTypes: [forestBiome],
    targetSlots: [1],
    seed: 8888,
    edgeFade: 0,
    overallDensity: 1.0,
  });

  const res40 = placeBiomeSymbols({
    ...setup,
    biomeTypes: [forestBiome],
    targetSlots: [1],
    seed: 8888,
    edgeFade: 0,
    overallDensity: 0.4,
  });

  const res10 = placeBiomeSymbols({
    ...setup,
    biomeTypes: [forestBiome],
    targetSlots: [1],
    seed: 8888,
    edgeFade: 0,
    overallDensity: 0.1,
  });

  assert(
    res100.stats.totalPlaced > res40.stats.totalPlaced,
    `100% density (${res100.stats.totalPlaced}) should produce more symbols than 40% density (${res40.stats.totalPlaced})`
  );
  assert(
    res40.stats.totalPlaced > res10.stats.totalPlaced,
    `40% density (${res40.stats.totalPlaced}) should produce more symbols than 10% density (${res10.stats.totalPlaced})`
  );
  assert(
    res10.stats.totalPlaced > 0,
    `10% density should still place some symbols`
  );
});

test('19. coastBuffer strictly excludes symbol placement near water/coastline', () => {
  const setup = createTestSetup();
  // Set sea level so bottom half is land, top half is sea
  const seaLevel = 35;
  for (let r = 0; r < setup.gridRows; r++) {
    for (let c = 0; c < setup.gridCols; c++) {
      const idx = r * setup.gridCols + c;
      setup.elevationGrid[idx] = r < setup.gridRows / 2 ? 10 : 50; // top half is water (elev 10 < 35)
      setup.biomeGrid[idx] = r < setup.gridRows / 2 ? 0 : 1; // bottom half is forest
    }
  }

  const bufferedBiome: BiomeType = {
    slot: 1,
    name: '針葉樹林',
    color: '#1f5d3a',
    symbols: [
      {
        kind: 'builtin',
        symbolType: 'tree_pine',
        weight: 5,
        scaleMin: 0.5,
        scaleMax: 0.8,
      },
    ],
    density: 100,
    minDistance: 4,
    flipRandom: true,
    coastBuffer: 30, // 30 world units from water
  };

  const res = placeBiomeSymbols({
    ...setup,
    seaLevel,
    biomeTypes: [bufferedBiome],
    targetSlots: [1],
    seed: 42,
    edgeFade: 0,
  });

  assert(res.symbols.length > 0, 'Should place symbols away from coast');

  const waterBoundaryY = setup.mapHeight / 2;
  for (const sym of res.symbols) {
    const distToWater = sym.y - waterBoundaryY;
    assert(
      distToWater >= 30,
      `Symbol at y=${sym.y.toFixed(1)} must be at least 30 units away from water boundary ${waterBoundaryY} (actual dist: ${distToWater.toFixed(1)})`
    );
  }
});



