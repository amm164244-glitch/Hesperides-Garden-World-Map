import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crc32,
  compressDeflateRaw,
  decompressDeflateRaw,
  encodeElevationZigZagDelta,
  decodeElevationZigZagDelta,
  serializeMapDataToFwm,
  deserializeMapDataFromFwm,
  loadUnifiedMapFile,
} from './binaryMapStorage';
import { serializeMapData } from './serialization';
import { MapData } from '../types/map';
import { DEFAULT_BIOME_TYPES } from '../types/biome';
import { CustomMapAsset, CustomSymbolCategory } from '../types/symbols';

function createSampleMap(cols: number = 256, rows: number = 128): MapData {
  const elev = new Float32Array(cols * rows);
  const biome = new Uint8Array(cols * rows);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const v = 35 + Math.sin(x / 15) * 20 + Math.cos(y / 15) * 15;
      elev[idx] = Math.max(0, Math.min(100, v));
      biome[idx] = elev[idx] > 35 ? (idx % 8) : 0;
    }
  }

  // Nested regional maps
  const reg1Cols = 64, reg1Rows = 32;
  const reg1Elev = new Float32Array(reg1Cols * reg1Rows).fill(42.5);
  const reg1Biome = new Uint8Array(reg1Cols * reg1Rows).fill(2);

  const reg2Cols = 32, reg2Rows = 16;
  const reg2Elev = new Float32Array(reg2Cols * reg2Rows).fill(55.1);

  return {
    id: 'test-world-1',
    name: 'エリュシオン世界図',
    width: 2000,
    height: 1000,
    gridCols: cols,
    gridRows: rows,
    cellCount: 100,
    seed: 98765,
    seaLevel: 35.0,
    worldWidthKm: 40000,
    createdAt: '2026-01-01T00:00:00.000Z',
    elevationGrid: elev,
    biomeGrid: biome,
    biomeTypes: DEFAULT_BIOME_TYPES,
    symbols: [
      {
        id: 'sym_1',
        type: 'mountain_snow',
        x: 100,
        y: 200,
        scale: 1.2,
        rotation: 0,
        autoBiomeSlot: 3,
      },
    ],
    cells: [],
    config: {
      seed: 98765,
      gridResolution: `${cols}x${rows}` as any,
      worldWidthKm: 40000,
      plateCount: 12,
      seaRatio: 60,
      continentCount: 4,
      continentSize: 6,
      mountainStrength: 6,
      islandDensity: 5,
      minIslandArea: 15,
    },
    regionalMaps: {
      reg_alpha: {
        id: 'reg_alpha',
        name: 'アルファ地方',
        bounds: { minX: 100, minY: 100, maxX: 400, maxY: 300 },
        zoomScale: 4,
        width: 300,
        height: 200,
        gridCols: reg1Cols,
        gridRows: reg1Rows,
        elevationGrid: reg1Elev,
        biomeGrid: reg1Biome,
        seaLevel: 35.0,
        createdAt: '2026-01-01T01:00:00.000Z',
        parentId: null,
        seed: 11111,
        widthKm: 6000,
        symbols: [],
        outline: [[100, 100], [400, 100], [400, 300], [100, 300]],
      },
      reg_beta_nested: {
        id: 'reg_beta_nested',
        name: 'ベータ細密区 (階層)',
        bounds: { minX: 150, minY: 150, maxX: 250, maxY: 250 },
        zoomScale: 16,
        width: 100,
        height: 100,
        gridCols: reg2Cols,
        gridRows: reg2Rows,
        elevationGrid: reg2Elev,
        seaLevel: 35.0,
        createdAt: '2026-01-01T02:00:00.000Z',
        parentId: 'reg_alpha',
        seed: 22222,
        widthKm: 1500,
        symbols: [],
      },
    },
  };
}

const sampleAssets: CustomMapAsset[] = [
  {
    id: 'asset_test_tree',
    name: '古代神木',
    category: 'tree',
    // 1x1 transparent PNG data URL
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    width: 16,
    height: 16,
    originX: 0.5,
    originY: 0.9,
    createdAt: 1700000000,
  },
];

const sampleCategories: CustomSymbolCategory[] = [
  {
    id: 'cat_legendary',
    name: '伝説の建築物',
    icon: 'sparkles',
    color: '#ffcc00',
    createdAt: 1700000000,
  },
];

test('CRC32 checksum matches standard vectors', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xCBF43926);
});

test('encodeElevationZigZagDelta and decodeElevationZigZagDelta roundtrip', async () => {
  const cols = 128;
  const rows = 64;
  const original = new Float32Array(cols * rows);
  for (let i = 0; i < original.length; i++) {
    original[i] = (i * 0.037) % 100;
  }
  original[0] = 0.0;
  original[1] = 100.0;
  original[2] = 50.0;

  const encoded = await encodeElevationZigZagDelta(original, cols, rows);
  const restored = await decodeElevationZigZagDelta(encoded, cols, rows);

  let maxDiff = 0;
  for (let i = 0; i < original.length; i++) {
    const diff = Math.abs(original[i] - restored[i]);
    if (diff > maxDiff) maxDiff = diff;
  }
  assert.ok(maxDiff <= 0.002, `Max quantization error ${maxDiff} exceeds 0.002`);
});

test('deflate-raw stream compression and decompression roundtrip', async () => {
  const data = new Uint8Array([10, 20, 30, 40, 50, 50, 50, 50, 60, 70, 80]);
  const comp = await compressDeflateRaw(data);
  const decomp = await decompressDeflateRaw(comp);
  assert.deepEqual(decomp, data);
});

test('serializeMapDataToFwm and deserializeMapDataFromFwm full roundtrip', async () => {
  const mapData = createSampleMap(256, 128);
  let progressCount = 0;

  const result = await serializeMapDataToFwm(mapData, sampleAssets, sampleCategories, {
    highPrecision: false,
    onProgress: (_stage, percent) => {
      progressCount++;
      assert.ok(percent >= 0 && percent <= 1.0);
    },
  });

  assert.ok(result.blob.size > 0);
  assert.ok(result.rawBytes > result.compressedBytes, 'Raw size must be greater than compressed size');
  assert.ok(result.reductionPercent > 40, 'Reduction percentage should be significant');
  assert.ok(progressCount > 0, 'onProgress should be called during export');

  // Deserialize
  const loaded = await deserializeMapDataFromFwm(result.blob);
  assert.equal(loaded.mapData.name, mapData.name);
  assert.equal(loaded.mapData.seed, mapData.seed);
  assert.equal(loaded.mapData.gridCols, mapData.gridCols);
  assert.equal(loaded.mapData.gridRows, mapData.gridRows);
  assert.equal(loaded.mapData.elevationGrid.length, mapData.elevationGrid.length);

  // Check regional maps restoration
  assert.ok(loaded.mapData.regionalMaps['reg_alpha']);
  assert.equal(loaded.mapData.regionalMaps['reg_alpha'].parentId, null);
  assert.ok(loaded.mapData.regionalMaps['reg_beta_nested']);
  assert.equal(loaded.mapData.regionalMaps['reg_beta_nested'].parentId, 'reg_alpha');

  // Check custom asset restoration
  assert.equal(loaded.customAssets.length, 1);
  assert.equal(loaded.customAssets[0].id, 'asset_test_tree');
  assert.ok(loaded.customAssets[0].dataUrl.startsWith('data:image/png;base64,'));

  // Check categories restoration
  assert.equal(loaded.customCategories.length, 1);
  assert.equal(loaded.customCategories[0].id, 'cat_legendary');
});

test('High-precision mode produces bit-exact Float32 restoration', async () => {
  const mapData = createSampleMap(64, 32);
  const result = await serializeMapDataToFwm(mapData, [], [], {
    highPrecision: true,
  });

  const loaded = await deserializeMapDataFromFwm(result.blob);
  for (let i = 0; i < mapData.elevationGrid.length; i++) {
    assert.equal(loaded.mapData.elevationGrid[i], mapData.elevationGrid[i]);
  }
});

test('Tampered CRC32 throws error upon deserialization', async () => {
  const mapData = createSampleMap(64, 32);
  const result = await serializeMapDataToFwm(mapData, [], [], { highPrecision: false });

  // Tamper a byte inside the blob
  const rawBytes = new Uint8Array(await result.blob.arrayBuffer());
  rawBytes[rawBytes.length - 10] ^= 0xff;

  const tamperedBlob = new Blob([rawBytes]);
  await assert.rejects(async () => {
    await deserializeMapDataFromFwm(tamperedBlob);
  });
});

test('Invalid magic throws error', async () => {
  const corrupted = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
  const blob = new Blob([corrupted]);
  await assert.rejects(async () => {
    await deserializeMapDataFromFwm(blob);
  }, /破損したFWMファイル|無効なFWMマジック/);
});

test('Unified file loader correctly detects .fwm vs legacy .json', async () => {
  const mapData = createSampleMap(64, 32);

  // 1. Load FWM
  const fwmResult = await serializeMapDataToFwm(mapData, sampleAssets, sampleCategories);
  const fwmFile = new File([fwmResult.blob], 'world.fwm');
  const loadedFwm = await loadUnifiedMapFile(fwmFile);
  assert.equal(loadedFwm.format, 'fwm');
  assert.equal(loadedFwm.mapData.seed, mapData.seed);

  // 2. Load legacy JSON (with legacy temperatureGrid to test cleanup)
  const legacySerialized = serializeMapData(mapData, sampleAssets, sampleCategories);
  (legacySerialized as any).temperatureGrid = [1, 2, 3];
  (legacySerialized as any).temperatureGridBase64 = 'AAAA';
  const jsonStr = JSON.stringify(legacySerialized);
  const jsonFile = new File([jsonStr], 'world.json', { type: 'application/json' });

  const loadedJson = await loadUnifiedMapFile(jsonFile);
  assert.equal(loadedJson.format, 'json');
  assert.equal(loadedJson.mapData.seed, mapData.seed);
  assert.equal((loadedJson.mapData as any).temperatureGrid, undefined);
});

test('Higher format version triggers user warning', async () => {
  const mapData = createSampleMap(64, 32);
  const res = await serializeMapDataToFwm(mapData);
  const bytes = new Uint8Array(await res.blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Modify version from 1 to 99
  view.setUint16(4, 99, true);

  const loaded = await deserializeMapDataFromFwm(new Blob([bytes]));
  assert.ok(loaded.warnings.length > 0);
  assert.ok(loaded.warnings[0].includes('v99'));
});

test('Large 2048x1024 realistic map achieves high compression ratio', async () => {
  const cols = 2048, rows = 1024;
  const elev = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      elev[y * cols + x] = 30 + Math.sin(x / 50) * 15 + Math.cos(y / 50) * 15;
    }
  }

  const mapData: MapData = {
    id: 'large-test-map',
    name: '2048x1024 大陸地図',
    width: 2000,
    height: 1000,
    gridCols: cols,
    gridRows: rows,
    cellCount: 1000,
    seed: 42,
    seaLevel: 35.0,
    worldWidthKm: 40000,
    createdAt: '2026-01-01T00:00:00.000Z',
    elevationGrid: elev,
    symbols: [],
    cells: [],
    regionalMaps: {},
    config: {
      seed: 42,
      gridResolution: '2048x1024',
      worldWidthKm: 40000,
      plateCount: 12,
      seaRatio: 60,
      continentCount: 4,
      continentSize: 6,
      mountainStrength: 6,
      islandDensity: 5,
      minIslandArea: 15,
    },
  };

  const res = await serializeMapDataToFwm(mapData);
  // Uncompressed Float32 for 2048x1024 is 8,388,608 bytes (~8.4MB)
  assert.ok(res.rawBytes >= 8388608);
  // Deflate-raw with ZigZag delta should compress to less than 1.5MB (< 20%)
  assert.ok(res.compressedBytes < 1500000, `Compressed size ${res.compressedBytes} should be under 1.5MB`);
  assert.ok(res.reductionPercent >= 80, `Reduction percent ${res.reductionPercent}% should be at least 80%`);

  const loaded = await deserializeMapDataFromFwm(res.blob);
  assert.equal(loaded.mapData.gridCols, 2048);
  assert.equal(loaded.mapData.gridRows, 1024);
  assert.equal(loaded.mapData.elevationGrid.length, 2048 * 1024);
});

