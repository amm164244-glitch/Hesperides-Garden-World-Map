import { MapData, RegionalMapData } from '../types/map';
import { BiomeType, DEFAULT_BIOME_TYPES } from '../types/biome';
import { CustomMapAsset, CustomSymbolCategory } from '../types/symbols';
import { deserializeMapData, sanitizeTownObjects, sanitizeTownStyle } from './serialization';

export const CURRENT_FWM_VERSION = 1;

// Pre-computed CRC32 lookup table (IEEE 802.3 polynomial 0xEDB88320)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Calculates standard IEEE 802.3 CRC32 checksum.
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Native stream compression using deflate-raw.
 */
export async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.closed.catch(() => {});
  const reader = cs.readable.getReader();
  reader.closed.catch(() => {});

  const writePromise = (async () => {
    try {
      await writer.write(data as any);
      await writer.close();
    } catch {
      // Ignored if reader aborted or stream errored
    }
  })();

  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
  } finally {
    await writePromise;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Native stream decompression using deflate-raw.
 */
export async function decompressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.closed.catch(() => {});
  const reader = ds.readable.getReader();
  reader.closed.catch(() => {});

  const writePromise = (async () => {
    try {
      await writer.write(data as any);
      await writer.close();
    } catch {
      // Ignored if reader caught error or aborted
    }
  })();

  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
  } finally {
    await writePromise;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Quantizes elevation (0-100) to uint16 and computes row-wise delta with ZigZag encoding.
 * Yields every 256 rows to keep UI responsive.
 */
export async function encodeElevationZigZagDelta(
  elev: Float32Array,
  cols: number,
  rows: number,
  onProgress?: (percent: number) => void
): Promise<Uint16Array> {
  const total = cols * rows;
  const encoded = new Uint16Array(total);
  let prevRowStartQ = 0;

  for (let y = 0; y < rows; y++) {
    if (y > 0 && (y & 255) === 0) {
      await new Promise((r) => setTimeout(r, 0));
      if (onProgress) onProgress(y / rows);
    }

    const rowOffset = y * cols;
    if (y === 0) {
      // Row 0 start
      const e0 = elev[0];
      const q0 = Math.min(65535, Math.max(0, Math.round((e0 / 100) * 65535)));
      const d0 = q0; // delta against 0
      encoded[0] = ((d0 << 1) ^ (d0 >> 15)) & 0xFFFF;
      let prev = q0;
      prevRowStartQ = q0;

      for (let x = 1; x < cols; x++) {
        const e = elev[x];
        const q = Math.min(65535, Math.max(0, Math.round((e / 100) * 65535)));
        let d = (q - prev) & 0xFFFF;
        if (d & 0x8000) d -= 0x10000;
        encoded[x] = ((d << 1) ^ (d >> 15)) & 0xFFFF;
        prev = q;
      }
    } else {
      // Row y start: delta against previous row start
      const e0 = elev[rowOffset];
      const q0 = Math.min(65535, Math.max(0, Math.round((e0 / 100) * 65535)));
      let d0 = (q0 - prevRowStartQ) & 0xFFFF;
      if (d0 & 0x8000) d0 -= 0x10000;
      encoded[rowOffset] = ((d0 << 1) ^ (d0 >> 15)) & 0xFFFF;
      let prev = q0;
      prevRowStartQ = q0;

      for (let x = 1; x < cols; x++) {
        const e = elev[rowOffset + x];
        const q = Math.min(65535, Math.max(0, Math.round((e / 100) * 65535)));
        let d = (q - prev) & 0xFFFF;
        if (d & 0x8000) d -= 0x10000;
        encoded[rowOffset + x] = ((d << 1) ^ (d >> 15)) & 0xFFFF;
        prev = q;
      }
    }
  }

  if (onProgress) onProgress(1.0);
  return encoded;
}

/**
 * Decodes ZigZag delta uint16 array back to Float32Array elevation (0-100).
 * Yields every 256 rows to keep UI responsive.
 */
export async function decodeElevationZigZagDelta(
  encoded: Uint16Array,
  cols: number,
  rows: number,
  onProgress?: (percent: number) => void
): Promise<Float32Array> {
  const total = cols * rows;
  const elev = new Float32Array(total);
  let decPrevRowStartQ = 0;

  for (let y = 0; y < rows; y++) {
    if (y > 0 && (y & 255) === 0) {
      await new Promise((r) => setTimeout(r, 0));
      if (onProgress) onProgress(y / rows);
    }

    const rowOffset = y * cols;
    if (y === 0) {
      const z0 = encoded[0];
      const d0 = (z0 >>> 1) ^ -(z0 & 1);
      const q0 = d0 & 0xFFFF;
      elev[0] = (q0 * 100) / 65535;
      let prev = q0;
      decPrevRowStartQ = q0;

      for (let x = 1; x < cols; x++) {
        const z = encoded[x];
        const d = (z >>> 1) ^ -(z & 1);
        const q = (prev + d) & 0xFFFF;
        elev[x] = (q * 100) / 65535;
        prev = q;
      }
    } else {
      const z0 = encoded[rowOffset];
      const d0 = (z0 >>> 1) ^ -(z0 & 1);
      const q0 = (decPrevRowStartQ + d0) & 0xFFFF;
      elev[rowOffset] = (q0 * 100) / 65535;
      let prev = q0;
      decPrevRowStartQ = q0;

      for (let x = 1; x < cols; x++) {
        const z = encoded[rowOffset + x];
        const d = (z >>> 1) ^ -(z & 1);
        const q = (prev + d) & 0xFFFF;
        elev[rowOffset + x] = (q * 100) / 65535;
        prev = q;
      }
    }
  }

  if (onProgress) onProgress(1.0);
  return elev;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.length)) as any);
  }
  return btoa(binary);
}

export function dataUrlToUint8Array(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const commaIdx = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, commaIdx).split(';')[0] || 'image/png';
  const base64 = dataUrl.slice(commaIdx + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, mime };
}

export interface FwmBlockMeta {
  id: string;
  kind: 'elevation_quantized' | 'elevation_float32' | 'biome_grid' | 'asset_image';
  offset: number;
  compressedLength: number;
  rawLength: number;
  crc32: number;
  cols?: number;
  rows?: number;
  dtype?: 'uint16' | 'float32' | 'uint8' | 'binary';
  mime?: string;
}

export interface FwmSerializeOptions {
  highPrecision?: boolean;
  onProgress?: (stage: string, percent: number) => void;
}

export interface FwmSerializeResult {
  blob: Blob;
  rawBytes: number;
  compressedBytes: number;
  reductionPercent: number;
}

/**
 * Serializes MapData into modern .fwm binary format.
 */
export async function serializeMapDataToFwm(
  mapData: MapData,
  customAssets: CustomMapAsset[] = [],
  customCategories: CustomSymbolCategory[] = [],
  options: FwmSerializeOptions = {}
): Promise<FwmSerializeResult> {
  const { highPrecision = false, onProgress } = options;

  let totalRawBytes = 0;
  const blocks: { meta: FwmBlockMeta; data: Uint8Array }[] = [];

  // 1. Process World Elevation
  onProgress?.('標高データを圧縮中 (世界地図)...', 0.1);
  let worldElevCompressed: Uint8Array;
  let worldElevCrc: number;
  let worldRawLen: number;

  if (highPrecision) {
    const rawBytes = new Uint8Array(
      mapData.elevationGrid.buffer,
      mapData.elevationGrid.byteOffset,
      mapData.elevationGrid.byteLength
    );
    worldRawLen = rawBytes.byteLength;
    worldElevCrc = crc32(rawBytes);
    worldElevCompressed = await compressDeflateRaw(rawBytes);
    blocks.push({
      meta: {
        id: 'elev_world',
        kind: 'elevation_float32',
        offset: 0,
        compressedLength: worldElevCompressed.byteLength,
        rawLength: worldRawLen,
        crc32: worldElevCrc,
        cols: mapData.gridCols,
        rows: mapData.gridRows,
        dtype: 'float32',
      },
      data: worldElevCompressed,
    });
  } else {
    const encoded = await encodeElevationZigZagDelta(
      mapData.elevationGrid,
      mapData.gridCols,
      mapData.gridRows,
      (p) => onProgress?.(`標高データを差分化中 (${Math.round(p * 50)}%)...`, 0.1 + p * 0.2)
    );
    const rawBytes = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    worldRawLen = rawBytes.byteLength;
    worldElevCrc = crc32(rawBytes);
    worldElevCompressed = await compressDeflateRaw(rawBytes);
    blocks.push({
      meta: {
        id: 'elev_world',
        kind: 'elevation_quantized',
        offset: 0,
        compressedLength: worldElevCompressed.byteLength,
        rawLength: worldRawLen,
        crc32: worldElevCrc,
        cols: mapData.gridCols,
        rows: mapData.gridRows,
        dtype: 'uint16',
      },
      data: worldElevCompressed,
    });
  }
  // Count uncompressed float32 in raw size
  totalRawBytes += mapData.gridCols * mapData.gridRows * 4;

  // 2. Process World Biome Grid (if present)
  if (mapData.biomeGrid && mapData.biomeGrid.length > 0) {
    onProgress?.('バイオームデータを圧縮中...', 0.35);
    const biomeCrc = crc32(mapData.biomeGrid);
    const biomeCompressed = await compressDeflateRaw(mapData.biomeGrid);
    blocks.push({
      meta: {
        id: 'biome_world',
        kind: 'biome_grid',
        offset: 0,
        compressedLength: biomeCompressed.byteLength,
        rawLength: mapData.biomeGrid.byteLength,
        crc32: biomeCrc,
        cols: mapData.gridCols,
        rows: mapData.gridRows,
        dtype: 'uint8',
      },
      data: biomeCompressed,
    });
    totalRawBytes += mapData.biomeGrid.byteLength;
  }

  // 3. Process Regional Maps
  const regionalMapsMeta: Record<string, any> = {};
  const regionalList = Object.entries(mapData.regionalMaps || {});
  for (let rIdx = 0; rIdx < regionalList.length; rIdx++) {
    const [regId, reg] = regionalList[rIdx];
    const progressStart = 0.4 + (rIdx / Math.max(1, regionalList.length)) * 0.3;
    onProgress?.(`地域マップを処理中: ${reg.name || regId}...`, progressStart);

    // Regional Elevation
    let regElevComp: Uint8Array;
    let regElevCrc: number;
    let regRawLen: number;

    if (highPrecision) {
      const rawBytes = new Uint8Array(
        reg.elevationGrid.buffer,
        reg.elevationGrid.byteOffset,
        reg.elevationGrid.byteLength
      );
      regRawLen = rawBytes.byteLength;
      regElevCrc = crc32(rawBytes);
      regElevComp = await compressDeflateRaw(rawBytes);
      blocks.push({
        meta: {
          id: `elev_reg_${regId}`,
          kind: 'elevation_float32',
          offset: 0,
          compressedLength: regElevComp.byteLength,
          rawLength: regRawLen,
          crc32: regElevCrc,
          cols: reg.gridCols,
          rows: reg.gridRows,
          dtype: 'float32',
        },
        data: regElevComp,
      });
    } else {
      const encoded = await encodeElevationZigZagDelta(reg.elevationGrid, reg.gridCols, reg.gridRows);
      const rawBytes = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
      regRawLen = rawBytes.byteLength;
      regElevCrc = crc32(rawBytes);
      regElevComp = await compressDeflateRaw(rawBytes);
      blocks.push({
        meta: {
          id: `elev_reg_${regId}`,
          kind: 'elevation_quantized',
          offset: 0,
          compressedLength: regElevComp.byteLength,
          rawLength: regRawLen,
          crc32: regElevCrc,
          cols: reg.gridCols,
          rows: reg.gridRows,
          dtype: 'uint16',
        },
        data: regElevComp,
      });
    }
    totalRawBytes += reg.gridCols * reg.gridRows * 4;

    // Regional Biome (if present)
    if (reg.biomeGrid && reg.biomeGrid.length > 0) {
      const regBiomeCrc = crc32(reg.biomeGrid);
      const regBiomeComp = await compressDeflateRaw(reg.biomeGrid);
      blocks.push({
        meta: {
          id: `biome_reg_${regId}`,
          kind: 'biome_grid',
          offset: 0,
          compressedLength: regBiomeComp.byteLength,
          rawLength: reg.biomeGrid.byteLength,
          crc32: regBiomeCrc,
          cols: reg.gridCols,
          rows: reg.gridRows,
          dtype: 'uint8',
        },
        data: regBiomeComp,
      });
      totalRawBytes += reg.biomeGrid.byteLength;
    }

    // Filter out grids from regional metadata
    const { elevationGrid: _eg, biomeGrid: _bg, ...regMetaOnly } = reg;
    regionalMapsMeta[regId] = regMetaOnly;
  }

  // 4. Process Custom Symbol Assets (PNG / images stored uncompressed as data blocks)
  onProgress?.('自作シンボル画像を処理中...', 0.75);
  const customAssetsMeta: CustomMapAsset[] = [];
  const assetsToProcess = customAssets.length > 0 ? customAssets : mapData.customAssets || [];
  for (const asset of assetsToProcess) {
    if (asset.dataUrl && asset.dataUrl.startsWith('data:')) {
      const { bytes, mime } = dataUrlToUint8Array(asset.dataUrl);
      const assetCrc = crc32(bytes);
      blocks.push({
        meta: {
          id: `asset_${asset.id}`,
          kind: 'asset_image',
          offset: 0,
          compressedLength: bytes.byteLength,
          rawLength: bytes.byteLength,
          crc32: assetCrc,
          mime,
          dtype: 'binary',
        },
        data: bytes,
      });
      totalRawBytes += bytes.byteLength;
      // In JSON metadata, strip dataUrl to avoid huge redundant string
      customAssetsMeta.push({
        ...asset,
        dataUrl: '',
      });
    } else {
      customAssetsMeta.push(asset);
    }
  }

  // 5. Build Header JSON with deterministic block offsets
  onProgress?.('ヘッダを構築中...', 0.85);
  const categoriesToSave = customCategories.length > 0 ? customCategories : mapData.customCategories || [];

  // Compute block offsets relative to the start of the data blocks segment
  let runningRelOffset = 0;
  const blockMetaList: FwmBlockMeta[] = blocks.map((b) => {
    const meta = { ...b.meta, offset: runningRelOffset };
    runningRelOffset += b.meta.compressedLength;
    return meta;
  });

  const baseHeader = {
    format: 'FWM1',
    version: CURRENT_FWM_VERSION,
    createdAt: mapData.createdAt || new Date().toISOString(),
    name: mapData.name || `world_map_seed_${mapData.seed}`,
    gridCols: mapData.gridCols,
    gridRows: mapData.gridRows,
    width: mapData.width,
    height: mapData.height,
    cellCount: mapData.cellCount || 0,
    seed: mapData.seed,
    seaLevel: mapData.seaLevel,
    worldWidthKm: mapData.worldWidthKm,
    config: mapData.config,
    cells: mapData.cells || [],
    plates: mapData.plates,
    coastlines: mapData.coastlines,
    ripples: mapData.ripples,
    symbols: mapData.symbols || [],
    rivers: mapData.rivers,
    lakes: mapData.lakes,
    biomeTypes: mapData.biomeTypes || DEFAULT_BIOME_TYPES,
    regionalMaps: regionalMapsMeta,
    customAssets: customAssetsMeta,
    customCategories: categoriesToSave,
    dataBlocks: blockMetaList,
  };

  const headerJson = JSON.stringify(baseHeader);
  const headerRawBytes = new TextEncoder().encode(headerJson);
  const finalRawHeaderLen = headerRawBytes.byteLength;
  const finalCompressedHeaderBytes = await compressDeflateRaw(headerRawBytes);

  totalRawBytes += finalRawHeaderLen;

  // 6. Build File Preamble (14 bytes)
  const preambleBuf = new ArrayBuffer(14);
  const preambleView = new DataView(preambleBuf);
  // Magic "FWM1"
  preambleView.setUint8(0, 0x46);
  preambleView.setUint8(1, 0x57);
  preambleView.setUint8(2, 0x4D);
  preambleView.setUint8(3, 0x31);
  // Version (uint16 LE)
  preambleView.setUint16(4, CURRENT_FWM_VERSION, true);
  // Compressed header length (uint32 LE)
  preambleView.setUint32(6, finalCompressedHeaderBytes.byteLength, true);
  // Raw header length (uint32 LE)
  preambleView.setUint32(10, finalRawHeaderLen, true);

  // 7. Assemble final Blob using chunks (avoids large buffer duplication)
  const blobParts: any[] = [
    preambleBuf,
    finalCompressedHeaderBytes,
    ...blocks.map((b) => b.data),
  ];

  const blob = new Blob(blobParts, { type: 'application/octet-stream' });
  const compressedBytes = blob.size;
  const reductionPercent = Math.max(0, Math.min(99.9, ((1 - compressedBytes / Math.max(1, totalRawBytes)) * 100)));

  onProgress?.('保存準備完了', 1.0);

  return {
    blob,
    rawBytes: totalRawBytes,
    compressedBytes,
    reductionPercent: Number(reductionPercent.toFixed(1)),
  };
}

/**
 * Checks if first 4 bytes of a buffer match "FWM1".
 */
export function isFwmBuffer(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x46 &&
    bytes[1] === 0x57 &&
    bytes[2] === 0x4D &&
    bytes[3] === 0x31
  );
}

export interface FwmDeserializeOptions {
  onProgress?: (stage: string, percent: number) => void;
}

export interface FwmDeserializeResult {
  mapData: MapData;
  customAssets: CustomMapAsset[];
  customCategories: CustomSymbolCategory[];
  warnings: string[];
}

/**
 * Deserializes a .fwm binary file/blob into MapData.
 * Uses file.slice() to stream-read individual blocks and maintain low memory footprint.
 */
export async function deserializeMapDataFromFwm(
  fileOrBlob: Blob | File,
  options: FwmDeserializeOptions = {}
): Promise<FwmDeserializeResult> {
  const { onProgress } = options;
  const warnings: string[] = [];

  // 1. Read and parse 14-byte preamble
  onProgress?.('ヘッダを読み込み中...', 0.05);
  const preambleSlice = await fileOrBlob.slice(0, 14).arrayBuffer();
  if (preambleSlice.byteLength < 14) {
    throw new Error('破損したFWMファイルです (ヘッダが短すぎます)');
  }
  const preambleView = new DataView(preambleSlice);
  const magic0 = preambleView.getUint8(0);
  const magic1 = preambleView.getUint8(1);
  const magic2 = preambleView.getUint8(2);
  const magic3 = preambleView.getUint8(3);

  if (magic0 !== 0x46 || magic1 !== 0x57 || magic2 !== 0x4D || magic3 !== 0x31) {
    throw new Error('無効なFWMマジックです (FWM1ではありません)');
  }

  const version = preambleView.getUint16(4, true);
  const compressedHeaderLen = preambleView.getUint32(6, true);
  const _rawHeaderLen = preambleView.getUint32(10, true);

  if (version > CURRENT_FWM_VERSION) {
    warnings.push(
      `このファイルは新しいバージョン (v${version}) で作成されています。一部の機能が反映されないか、読み込めない可能性があります。`
    );
  }

  // 2. Read and decompress Header JSON
  onProgress?.('メタデータを展開中...', 0.12);
  const headerSlice = await fileOrBlob.slice(14, 14 + compressedHeaderLen).arrayBuffer();
  const decompressedHeaderBytes = await decompressDeflateRaw(new Uint8Array(headerSlice));
  const headerJsonStr = new TextDecoder().decode(decompressedHeaderBytes);
  const header = JSON.parse(headerJsonStr);

  const dataBlocks: FwmBlockMeta[] = header.dataBlocks || [];
  const blockMap = new Map<string, FwmBlockMeta>();
  for (const b of dataBlocks) {
    blockMap.set(b.id, b);
  }

  const dataBlocksStart = 14 + compressedHeaderLen;

  // Helper to resolve absolute byte offset of a block
  const getBlockOffset = (b: FwmBlockMeta) => {
    if (dataBlocksStart + b.offset + b.compressedLength <= fileOrBlob.size) {
      return dataBlocksStart + b.offset;
    }
    return b.offset;
  };

  // 3. Restore World Elevation
  onProgress?.('世界マップの標高データを復元中...', 0.25);
  const worldElevBlock = blockMap.get('elev_world');
  if (!worldElevBlock) {
    throw new Error('世界マップの標高ブロックが見つかりません');
  }

  const worldElevOffset = getBlockOffset(worldElevBlock);
  const worldElevSlice = await fileOrBlob
    .slice(worldElevOffset, worldElevOffset + worldElevBlock.compressedLength)
    .arrayBuffer();
  const decompWorldElevBytes = await decompressDeflateRaw(new Uint8Array(worldElevSlice));

  const decompElevCrc = crc32(decompWorldElevBytes);
  if (decompElevCrc !== worldElevBlock.crc32) {
    throw new Error(`世界マップ標高ブロックのCRC32整合性チェックに失敗しました (期待: ${worldElevBlock.crc32.toString(16)}, 実際: ${decompElevCrc.toString(16)})`);
  }

  let worldElevationGrid: Float32Array;
  if (worldElevBlock.kind === 'elevation_float32') {
    worldElevationGrid = new Float32Array(
      decompWorldElevBytes.buffer,
      decompWorldElevBytes.byteOffset,
      decompWorldElevBytes.byteLength / 4
    );
  } else {
    const uint16Encoded = new Uint16Array(
      decompWorldElevBytes.buffer,
      decompWorldElevBytes.byteOffset,
      decompWorldElevBytes.byteLength / 2
    );
    worldElevationGrid = await decodeElevationZigZagDelta(
      uint16Encoded,
      worldElevBlock.cols || header.gridCols,
      worldElevBlock.rows || header.gridRows,
      (p) => onProgress?.(`世界標高を展開中 (${Math.round(p * 100)}%)...`, 0.25 + p * 0.25)
    );
  }

  // 4. Restore World Biome Grid (if present)
  let worldBiomeGrid: Uint8Array | undefined;
  const worldBiomeBlock = blockMap.get('biome_world');
  if (worldBiomeBlock) {
    onProgress?.('世界マップのバイオームを復元中...', 0.55);
    const worldBiomeOffset = getBlockOffset(worldBiomeBlock);
    const biomeSlice = await fileOrBlob
      .slice(worldBiomeOffset, worldBiomeOffset + worldBiomeBlock.compressedLength)
      .arrayBuffer();
    const decompBiomeBytes = await decompressDeflateRaw(new Uint8Array(biomeSlice));
    const decompBiomeCrc = crc32(decompBiomeBytes);
    if (decompBiomeCrc !== worldBiomeBlock.crc32) {
      throw new Error('バイオームブロックのCRC32整合性チェックに失敗しました');
    }
    worldBiomeGrid = decompBiomeBytes;
  }

  // 5. Restore Regional Maps
  const regionalMaps: Record<string, RegionalMapData> = {};
  const regMetaEntries = Object.entries(header.regionalMaps || {});
  for (let idx = 0; idx < regMetaEntries.length; idx++) {
    const [regId, regMeta] = regMetaEntries[idx] as [string, any];
    const progressVal = 0.6 + (idx / Math.max(1, regMetaEntries.length)) * 0.25;
    onProgress?.(`地域マップを展開中: ${regMeta.name || regId}...`, progressVal);

    // Regional elevation
    const regElevBlock = blockMap.get(`elev_reg_${regId}`);
    if (!regElevBlock) {
      throw new Error(`地域マップ ${regId} の標高ブロックが見つかりません`);
    }

    const regElevOffset = getBlockOffset(regElevBlock);
    const regElevSlice = await fileOrBlob
      .slice(regElevOffset, regElevOffset + regElevBlock.compressedLength)
      .arrayBuffer();
    const decompRegElevBytes = await decompressDeflateRaw(new Uint8Array(regElevSlice));
    const regCrc = crc32(decompRegElevBytes);
    if (regCrc !== regElevBlock.crc32) {
      throw new Error(`地域マップ ${regId} のCRC32整合性チェックに失敗しました`);
    }

    let regElevGrid: Float32Array;
    if (regElevBlock.kind === 'elevation_float32') {
      regElevGrid = new Float32Array(
        decompRegElevBytes.buffer,
        decompRegElevBytes.byteOffset,
        decompRegElevBytes.byteLength / 4
      );
    } else {
      const regEncoded = new Uint16Array(
        decompRegElevBytes.buffer,
        decompRegElevBytes.byteOffset,
        decompRegElevBytes.byteLength / 2
      );
      regElevGrid = await decodeElevationZigZagDelta(
        regEncoded,
        regElevBlock.cols || regMeta.gridCols,
        regElevBlock.rows || regMeta.gridRows
      );
    }

    // Regional biome (if present)
    let regBiomeGrid: Uint8Array | undefined;
    const regBiomeBlock = blockMap.get(`biome_reg_${regId}`);
    if (regBiomeBlock) {
      const regBiomeOffset = getBlockOffset(regBiomeBlock);
      const regBiomeSlice = await fileOrBlob
        .slice(regBiomeOffset, regBiomeOffset + regBiomeBlock.compressedLength)
        .arrayBuffer();
      const decompRegBiomeBytes = await decompressDeflateRaw(new Uint8Array(regBiomeSlice));
      if (crc32(decompRegBiomeBytes) !== regBiomeBlock.crc32) {
        throw new Error(`地域マップ ${regId} のバイオームCRC32チェックに失敗しました`);
      }
      regBiomeGrid = decompRegBiomeBytes;
    }

    regionalMaps[regId] = {
      ...regMeta,
      id: regMeta.id || regId,
      gridCols: regElevBlock.cols || regMeta.gridCols,
      gridRows: regElevBlock.rows || regMeta.gridRows,
      elevationGrid: regElevGrid,
      biomeGrid: regBiomeGrid,
      symbols: Array.isArray(regMeta.symbols) ? regMeta.symbols : [],
      outline: Array.isArray(regMeta.outline) ? regMeta.outline : undefined,
      townObjects: sanitizeTownObjects(regMeta.townObjects),
      townStyle: sanitizeTownStyle(regMeta.townStyle, regMeta.kind),
    };
  }

  // 6. Restore Custom Symbol Images
  onProgress?.('自作シンボル画像を復元中...', 0.9);
  const customAssets: CustomMapAsset[] = [];
  const rawAssets: CustomMapAsset[] = header.customAssets || [];
  for (const asset of rawAssets) {
    const assetBlock = blockMap.get(`asset_${asset.id}`);
    if (assetBlock) {
      const assetOffset = getBlockOffset(assetBlock);
      const assetSlice = await fileOrBlob
        .slice(assetOffset, assetOffset + assetBlock.compressedLength)
        .arrayBuffer();
      const assetBytes = new Uint8Array(assetSlice);
      if (crc32(assetBytes) !== assetBlock.crc32) {
        throw new Error(`自作シンボル画像 (${asset.name || asset.id}) のCRC32チェックに失敗しました`);
      }
      const base64 = uint8ArrayToBase64(assetBytes);
      const mime = assetBlock.mime || 'image/png';
      customAssets.push({
        ...asset,
        dataUrl: `data:${mime};base64,${base64}`,
      });
    } else {
      customAssets.push(asset);
    }
  }

  // Biome sanitization
  const biomeTypes: BiomeType[] = Array.isArray(header.biomeTypes) && header.biomeTypes.length > 0
    ? header.biomeTypes
    : DEFAULT_BIOME_TYPES;
  const validSlots = new Set<number>(biomeTypes.map((b) => b.slot));

  if (worldBiomeGrid) {
    for (let i = 0; i < worldBiomeGrid.length; i++) {
      const slot = worldBiomeGrid[i];
      if (slot !== 0 && !validSlots.has(slot)) {
        worldBiomeGrid[i] = 0;
      }
    }
  }

  for (const reg of Object.values(regionalMaps)) {
    if (reg.biomeGrid) {
      for (let i = 0; i < reg.biomeGrid.length; i++) {
        const slot = reg.biomeGrid[i];
        if (slot !== 0 && !validSlots.has(slot)) {
          reg.biomeGrid[i] = 0;
        }
      }
    }
  }

  const mapData: MapData = {
    id: header.id,
    name: header.name,
    width: header.width || 2000,
    height: header.height || 1000,
    gridCols: header.gridCols || 2048,
    gridRows: header.gridRows || 1024,
    cellCount: header.cellCount || 0,
    seed: header.seed,
    seaLevel: header.seaLevel ?? 35.0,
    worldWidthKm: header.worldWidthKm || 40000,
    config: header.config || {
      seed: header.seed || 12345,
      gridResolution: `${header.gridCols}x${header.gridRows}` as any,
      worldWidthKm: header.worldWidthKm || 40000,
      plateCount: 12,
      seaRatio: 60,
      continentCount: 4,
      continentSize: 6,
      mountainStrength: 6,
      islandDensity: 5,
      minIslandArea: 15,
    },
    createdAt: header.createdAt || new Date().toISOString(),
    elevationGrid: worldElevationGrid,
    biomeGrid: worldBiomeGrid,
    biomeTypes,
    symbols: Array.isArray(header.symbols) ? header.symbols : [],
    plates: header.plates,
    cells: Array.isArray(header.cells) ? header.cells : [],
    coastlines: header.coastlines,
    ripples: header.ripples,
    regionalMaps,
    customAssets,
    customCategories: header.customCategories || [],
  };

  onProgress?.('読み込み完了', 1.0);

  return {
    mapData,
    customAssets,
    customCategories: header.customCategories || [],
    warnings,
  };
}

/**
 * Unified file loader that inspects the first 4 bytes to distinguish between
 * modern .fwm binary files and legacy .json files.
 */
export async function loadUnifiedMapFile(
  file: File,
  options: { onProgress?: (stage: string, percent: number) => void } = {}
): Promise<{
  mapData: MapData;
  customAssets: CustomMapAsset[];
  customCategories: CustomSymbolCategory[];
  warnings: string[];
  format: 'fwm' | 'json';
}> {
  // Read first 16 bytes for format detection
  const headSlice = await file.slice(0, 16).arrayBuffer();
  const headBytes = new Uint8Array(headSlice);

  if (isFwmBuffer(headBytes)) {
    const result = await deserializeMapDataFromFwm(file, options);
    return {
      mapData: result.mapData,
      customAssets: result.customAssets,
      customCategories: result.customCategories,
      warnings: result.warnings,
      format: 'fwm',
    };
  }

  // Fallback: Legacy JSON inspection
  options.onProgress?.('従来のJSONファイルを解析中...', 0.3);
  const text = await file.text();
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    throw new Error('未対応のファイル形式です (FWM1バイナリまたはJSONファイルではありません)');
  }

  options.onProgress?.('JSON構造を展開中...', 0.7);
  const raw = JSON.parse(text);
  const mapData = deserializeMapData(raw);
  const assets: CustomMapAsset[] = Array.isArray(raw.customAssets) ? raw.customAssets : [];
  const cats: CustomSymbolCategory[] = Array.isArray(raw.customCategories) ? raw.customCategories : [];

  options.onProgress?.('読み込み完了', 1.0);
  return {
    mapData,
    customAssets: assets,
    customCategories: cats,
    warnings: [],
    format: 'json',
  };
}
