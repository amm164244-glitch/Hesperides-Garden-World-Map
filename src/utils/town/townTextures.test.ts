import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  TOWN_TEXTURE_SLOTS,
  getSlotLabel,
  sanitizeTextureAssignment,
  sanitizeTownTextures,
  validateTextureFile,
  fitTextureSize,
  averageColorFromRgba,
  serializeTextureLibrary,
  parseTextureLibrary,
  mergeTextures,
  resolveTextureFill,
  createMatrix,
} from './townTextures';
import { sanitizeTownStyle } from '../serialization';
import { TownTexture, TownTextureAssignment, TownTextureSlot } from '../../types/town';

describe('townTextures', () => {
  describe('TOWN_TEXTURE_SLOTS & getSlotLabel', () => {
    it('defines exactly 17 slots across roof, road, wall, and ground', () => {
      assert.strictEqual(TOWN_TEXTURE_SLOTS.length, 17);
      const roofSlots = TOWN_TEXTURE_SLOTS.filter((s) => s.startsWith('roof:'));
      const roadSlots = TOWN_TEXTURE_SLOTS.filter((s) => s.startsWith('road:'));
      const wallSlots = TOWN_TEXTURE_SLOTS.filter((s) => s === 'wall');
      const groundSlots = TOWN_TEXTURE_SLOTS.filter((s) => s.startsWith('ground:'));

      assert.strictEqual(roofSlots.length, 7);
      assert.strictEqual(roadSlots.length, 3);
      assert.strictEqual(wallSlots.length, 1);
      assert.strictEqual(groundSlots.length, 6);
    });

    it('provides Japanese labels for every slot', () => {
      for (const slot of TOWN_TEXTURE_SLOTS) {
        const label = getSlotLabel(slot);
        assert.ok(label && label.length > 0, `Slot ${slot} has empty label`);
      }
      assert.strictEqual(getSlotLabel('roof:house'), '屋根: 民家');
      assert.strictEqual(getSlotLabel('road:main'), '道: 大通り');
      assert.strictEqual(getSlotLabel('wall'), '城壁: 壁面と塔');
      assert.strictEqual(getSlotLabel('ground:residential'), '地面: 住宅街区');
    });
  });

  describe('sanitizeTextureAssignment', () => {
    it('accepts and sanitizes valid assignments', () => {
      const raw = {
        textureId: 'tex_abc123',
        tileSizeM: 12.5,
        tintStrength: 0.35,
        alignToObject: true,
        opacity: 0.75,
      };
      const sanitized = sanitizeTextureAssignment(raw);
      assert.ok(sanitized);
      assert.strictEqual(sanitized?.textureId, 'tex_abc123');
      assert.strictEqual(sanitized?.tileSizeM, 12.5);
      assert.strictEqual(sanitized?.tintStrength, 0.35);
      assert.strictEqual(sanitized?.alignToObject, true);
      assert.strictEqual(sanitized?.opacity, 0.75);
    });

    it('clamps tileSizeM between 0.25 and 64 and defaults to 4', () => {
      const tooSmall = sanitizeTextureAssignment({ textureId: 'tex_1', tileSizeM: 0.1 });
      assert.strictEqual(tooSmall?.tileSizeM, 0.25);

      const tooLarge = sanitizeTextureAssignment({ textureId: 'tex_1', tileSizeM: 500 });
      assert.strictEqual(tooLarge?.tileSizeM, 64);

      const nanVal = sanitizeTextureAssignment({ textureId: 'tex_1', tileSizeM: NaN });
      assert.strictEqual(nanVal?.tileSizeM, 4);

      const unspec = sanitizeTextureAssignment({ textureId: 'tex_1' });
      assert.strictEqual(unspec?.tileSizeM, 4);
    });

    it('clamps tintStrength between 0 and 1', () => {
      const neg = sanitizeTextureAssignment({ textureId: 'tex_1', tileSizeM: 8, tintStrength: -0.5 });
      assert.strictEqual(neg?.tintStrength, 0);

      const high = sanitizeTextureAssignment({ textureId: 'tex_1', tileSizeM: 8, tintStrength: 1.5 });
      assert.strictEqual(high?.tintStrength, 1);
    });

    it('clamps opacity between 0.1 and 1', () => {
      const low = sanitizeTextureAssignment({ textureId: 'tex_1', tileSizeM: 8, opacity: 0.05 });
      assert.strictEqual(low?.opacity, 0.1);

      const high = sanitizeTextureAssignment({ textureId: 'tex_1', tileSizeM: 8, opacity: 2 });
      assert.strictEqual(high?.opacity, 1);
    });

    it('rejects invalid or missing textureId', () => {
      assert.strictEqual(sanitizeTextureAssignment(null), null);
      assert.strictEqual(sanitizeTextureAssignment({}), null);
      assert.strictEqual(sanitizeTextureAssignment({ textureId: '' }), null);
      assert.strictEqual(sanitizeTextureAssignment({ textureId: 123 }), null);
    });
  });

  describe('sanitizeTownTextures', () => {
    it('sanitizes a map of assignments and filters invalid keys', () => {
      const raw = {
        'roof:house': { textureId: 'tex_roof1', tileSizeM: 8 },
        'road:main': { textureId: 'tex_road1', tileSizeM: 6 },
        'invalid:slot': { textureId: 'tex_fake', tileSizeM: 10 },
        wall: { invalid: true },
      };
      const sanitized = sanitizeTownTextures(raw);
      assert.ok(sanitized);
      assert.strictEqual(sanitized['roof:house']?.textureId, 'tex_roof1');
      assert.strictEqual(sanitized['road:main']?.textureId, 'tex_road1');
      assert.strictEqual((sanitized as any)['invalid:slot'], undefined);
      assert.strictEqual(sanitized.wall, undefined);
    });

    it('returns undefined if all assignments are invalid or empty', () => {
      assert.strictEqual(sanitizeTownTextures(null), undefined);
      assert.strictEqual(sanitizeTownTextures({}), undefined);
      assert.strictEqual(sanitizeTownTextures({ 'roof:house': null }), undefined);
    });
  });

  describe('sanitizeTownStyle (integration with serialization)', () => {
    it('(a) returns undefined for non-town maps when raw is missing or invalid', () => {
      assert.strictEqual(sanitizeTownStyle(undefined, 'region'), undefined);
      assert.strictEqual(sanitizeTownStyle(null, 'region'), undefined);
      assert.strictEqual(sanitizeTownStyle('invalid', 'region'), undefined);
    });

    it('(b) returns sanitized townStyle for non-town maps when raw is valid object', () => {
      const raw = {
        roofTheme: 'slate',
        textures: {
          'roof:house': { textureId: 'tex_slate1', tileSizeM: 10 },
        },
      };
      const sanitized = sanitizeTownStyle(raw, 'region');
      assert.ok(sanitized);
      assert.strictEqual(sanitized?.roofTheme, 'slate');
      assert.strictEqual(sanitized?.textures?.['roof:house']?.textureId, 'tex_slate1');
      assert.strictEqual(sanitized?.textures?.['roof:house']?.tileSizeM, 10);
    });

    it('(c) returns default terracotta for town maps when raw is missing or invalid', () => {
      assert.deepStrictEqual(sanitizeTownStyle(undefined, 'town'), { roofTheme: 'terracotta' });
      assert.deepStrictEqual(sanitizeTownStyle(null, 'town'), { roofTheme: 'terracotta' });
      assert.deepStrictEqual(sanitizeTownStyle('invalid', 'town'), { roofTheme: 'terracotta' });
    });

    it('preserves textures alongside roofTheme for town maps', () => {
      const raw = {
        roofTheme: 'slate',
        textures: {
          'roof:house': { textureId: 'tex_slate1', tileSizeM: 10 },
        },
      };
      const sanitized = sanitizeTownStyle(raw, 'town');
      assert.ok(sanitized);
      assert.strictEqual(sanitized?.roofTheme, 'slate');
      assert.strictEqual(sanitized?.textures?.['roof:house']?.textureId, 'tex_slate1');
      assert.strictEqual(sanitized?.textures?.['roof:house']?.tileSizeM, 10);
    });

    it('handles backward compatibility when textures is undefined', () => {
      const oldStyle = { roofTheme: 'thatch' };
      const sanitized = sanitizeTownStyle(oldStyle, 'town');
      assert.ok(sanitized);
      assert.strictEqual(sanitized?.roofTheme, 'thatch');
      assert.strictEqual(sanitized?.textures, undefined);
    });
  });

  describe('validateTextureFile', () => {
    it('accepts valid PNG, JPEG, and WebP files under 15MB', () => {
      assert.ok(validateTextureFile({ name: 'roof.png', type: 'image/png', size: 1024 * 1024 }).ok);
      assert.ok(validateTextureFile({ name: 'stone.jpg', type: 'image/jpeg', size: 2 * 1024 * 1024 }).ok);
      assert.ok(validateTextureFile({ name: 'cobble.webp', type: 'image/webp', size: 500 * 1024 }).ok);
    });

    it('rejects unsupported file formats', () => {
      const gif = validateTextureFile({ name: 'anim.gif', type: 'image/gif', size: 1024 });
      assert.strictEqual(gif.ok, false);

      const pdf = validateTextureFile({ name: 'map.pdf', type: 'application/pdf', size: 1024 });
      assert.strictEqual(pdf.ok, false);
    });

    it('rejects files larger than 4MB', () => {
      const huge = validateTextureFile({ name: 'huge.png', type: 'image/png', size: 20 * 1024 * 1024 });
      assert.strictEqual(huge.ok, false);
      assert.ok(huge.error?.includes('4MB'));
    });
  });

  describe('fitTextureSize', () => {
    it('returns exact dimensions if within max 1024', () => {
      const res = fitTextureSize(512, 512, 1024);
      assert.deepStrictEqual(res, { width: 512, height: 512 });
    });

    it('scales down preserving aspect ratio when width exceeds max', () => {
      const res = fitTextureSize(2048, 1024, 1024);
      assert.deepStrictEqual(res, { width: 1024, height: 512 });
    });

    it('scales down preserving aspect ratio when height exceeds max', () => {
      const res = fitTextureSize(1000, 2000, 1024);
      assert.deepStrictEqual(res, { width: 512, height: 1024 });
    });
  });

  describe('averageColorFromRgba', () => {
    it('computes average hex color correctly', () => {
      // 2 pixels: red [255, 0, 0, 255] and blue [0, 0, 255, 255] -> average [128, 0, 128]
      const rgba = new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 255, 255,
      ]);
      const hex = averageColorFromRgba(rgba);
      assert.strictEqual(hex, '#800080');
    });

    it('ignores transparent pixels with alpha < 16', () => {
      // 1 opaque green pixel + 1 fully transparent red pixel
      const rgba = new Uint8ClampedArray([
        0, 255, 0, 255,
        255, 0, 0, 0,
      ]);
      const hex = averageColorFromRgba(rgba);
      assert.strictEqual(hex, '#00ff00');
    });

    it('defaults to #808080 on empty or fully transparent buffer', () => {
      const rgba = new Uint8ClampedArray([0, 0, 0, 0]);
      assert.strictEqual(averageColorFromRgba(rgba), '#808080');
    });
  });

  describe('serializeTextureLibrary & parseTextureLibrary', () => {
    const sampleTextures: TownTexture[] = [
      {
        id: 'tex_1',
        name: '赤瓦タイル',
        mime: 'image/png',
        width: 256,
        height: 256,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        pixelated: false,
        createdAt: 1000,
      },
      {
        id: 'tex_2',
        name: '石畳',
        mime: 'image/jpeg',
        width: 128,
        height: 128,
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        pixelated: true,
        createdAt: 2000,
      },
    ];

    it('serializes and parses back identically', () => {
      const json = serializeTextureLibrary(sampleTextures);
      const parsed = parseTextureLibrary(json);
      assert.strictEqual(parsed.error, undefined);
      assert.strictEqual(parsed.textures.length, 2);
      assert.strictEqual(parsed.textures[0].id, 'tex_1');
      assert.strictEqual(parsed.textures[0].name, '赤瓦タイル');
      assert.strictEqual(parsed.textures[1].pixelated, true);
    });

    it('handles corrupted JSON cleanly with error message', () => {
      const parsed = parseTextureLibrary('invalid json string');
      assert.ok(parsed.error);
      assert.strictEqual(parsed.textures.length, 0);
    });

    it('skips invalid items in JSON array', () => {
      const corruptedJson = JSON.stringify({
        format: 'hg-town-textures',
        version: 1,
        textures: [
          sampleTextures[0],
          { invalid: 'missing dataUrl' },
          null,
        ],
      });
      const parsed = parseTextureLibrary(corruptedJson);
      assert.strictEqual(parsed.textures.length, 1);
      assert.strictEqual(parsed.skipped, 2);
    });
  });

  describe('mergeTextures', () => {
    const existing: TownTexture[] = [
      {
        id: 'tex_1',
        name: '石畳',
        mime: 'image/png',
        width: 100,
        height: 100,
        dataUrl: 'data:image/png;base64,abc',
        pixelated: false,
        createdAt: 100,
      },
    ];

    it('merges new textures and resolves name collisions', () => {
      const incoming: TownTexture[] = [
        {
          id: 'tex_2',
          name: '石畳', // Duplicate name
          mime: 'image/png',
          width: 100,
          height: 100,
          dataUrl: 'data:image/png;base64,def',
          pixelated: true,
          createdAt: 200,
        },
      ];

      const merged = mergeTextures(existing, incoming, 40);
      assert.strictEqual(merged.length, 2);
      assert.strictEqual(merged[0].name, '石畳');
      assert.strictEqual(merged[1].name, '石畳 (2)');
    });

    it('assigns unique new ID and resolves name when incoming has duplicate ID', () => {
      const incoming: TownTexture[] = [
        {
          id: 'tex_1',
          name: '石畳',
          mime: 'image/png',
          width: 200,
          height: 200,
          dataUrl: 'data:image/png;base64,updated',
          pixelated: true,
          createdAt: 300,
        },
      ];

      const merged = mergeTextures(existing, incoming, 40);
      assert.strictEqual(merged.length, 2);
      assert.strictEqual(merged[0].id, 'tex_1');
      assert.notStrictEqual(merged[1].id, 'tex_1');
      assert.strictEqual(merged[1].name, '石畳 (2)');
    });

    it('respects max limit', () => {
      const incoming: TownTexture[] = Array.from({ length: 50 }, (_, i) => ({
        id: `tex_new_${i}`,
        name: `Tex ${i}`,
        mime: 'image/png' as const,
        width: 64,
        height: 64,
        dataUrl: 'data:image/png;base64,xyz',
        pixelated: false,
        createdAt: i,
      }));

      const merged = mergeTextures(existing, incoming, 10);
      assert.strictEqual(merged.length, 10);
    });
  });

  describe('createMatrix', () => {
    it('creates translation, rotation, and scaling transform', () => {
      const m = createMatrix(10, 20, 45, 2.0);
      assert.ok(m);
      if (typeof DOMMatrix !== 'undefined' && m instanceof DOMMatrix) {
        assert.ok(m.a !== undefined);
      } else {
        assert.strictEqual((m as any).ox, 10);
        assert.strictEqual((m as any).oy, 20);
        assert.strictEqual((m as any).angleDeg, 45);
        assert.strictEqual((m as any).s, 2.0);
      }
    });
  });

  describe('resolveTextureFill (LOD & transforms)', () => {
    const mockPattern = {
      transform: null as any,
      setTransform(matrix: any) {
        this.transform = matrix;
      },
    };

    const mockCtx = {
      imageSmoothingEnabled: true,
    } as any;

    const mockCache = {
      getEntry(id: string) {
        if (id === 'tex_cobble') {
          return {
            image: {} as any,
            width: 256,
            height: 256,
            averageColor: '#654321',
            pixelated: false,
          };
        }
        return null;
      },
      getPattern(ctx: any, id: string) {
        if (id === 'tex_cobble') {
          return mockPattern as any;
        }
        return null;
      },
    };

    const textures = {
      'road:main': {
        textureId: 'tex_cobble',
        tileSizeM: 6.0,
      },
    };

    it('returns null if slot has no assignment', () => {
      const res = resolveTextureFill(mockCtx, 'road:path', textures, 0.5, 1.0, undefined, mockCache);
      assert.strictEqual(res, null);
    });

    it('returns null if texture is not in cache', () => {
      const unassigned = { 'road:main': { textureId: 'missing', tileSizeM: 6.0 } };
      const res = resolveTextureFill(mockCtx, 'road:main', unassigned, 0.5, 1.0, undefined, mockCache);
      assert.strictEqual(res, null);
    });

    it('returns flat average color when tilePx < 6.0 (LOD threshold)', () => {
      // tileSizeM = 6.0m. metersPerUnit = 2.0 (so 6m = 3 units). zoomPx = 1.0 -> tilePx = 3.0 < 6.0
      const res = resolveTextureFill(mockCtx, 'road:main', textures, 2.0, 1.0, undefined, mockCache);
      assert.ok(res);
      assert.strictEqual(res?.kind, 'flat');
      if (res?.kind === 'flat') {
        assert.strictEqual(res.color, '#654321');
      }
    });

    it('returns pattern and sets transform when tilePx >= 6.0', () => {
      // tileSizeM = 6.0m. metersPerUnit = 0.5 (so 6m = 12 units). zoomPx = 1.0 -> tilePx = 12.0 >= 6.0
      const res = resolveTextureFill(
        mockCtx,
        'road:main',
        textures,
        0.5,
        1.0,
        { centroid: [100, 200], firstEdgeAngleRad: Math.PI / 4 },
        mockCache
      );
      assert.ok(res);
      assert.strictEqual(res?.kind, 'pattern');
      if (res?.kind === 'pattern') {
        assert.strictEqual(res.pattern, mockPattern);
        assert.ok(mockPattern.transform);
      }
    });
  });
});
