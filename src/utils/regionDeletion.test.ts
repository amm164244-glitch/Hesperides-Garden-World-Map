import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RegionalMapData } from '../types/map';

function collectDescendants(targetId: string, regionalMaps: Record<string, RegionalMapData>): string[] {
  const toDelete = new Set<string>([targetId]);
  const queue = [targetId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const [id, reg] of Object.entries(regionalMaps)) {
      if (reg.parentId === curr && !toDelete.has(id)) {
        toDelete.add(id);
        queue.push(id);
      }
    }
  }

  return Array.from(toDelete);
}

function deleteRegionCascade(
  targetId: string,
  regionalMaps: Record<string, RegionalMapData>,
  activeRegionId: string | null
): {
  nextRegionalMaps: Record<string, RegionalMapData>;
  nextActiveRegionId: string | null;
} {
  const targetMap = regionalMaps[targetId];
  if (!targetMap) {
    return { nextRegionalMaps: regionalMaps, nextActiveRegionId: activeRegionId };
  }

  const toDelete = collectDescendants(targetId, regionalMaps);
  const toDeleteSet = new Set(toDelete);
  const safeParentId = targetMap.parentId ?? null;

  const nextRegionalMaps = { ...regionalMaps };
  for (const id of toDelete) {
    delete nextRegionalMaps[id];
  }

  let nextActiveRegionId = activeRegionId;
  if (activeRegionId && toDeleteSet.has(activeRegionId)) {
    nextActiveRegionId = safeParentId;
  }

  return { nextRegionalMaps, nextActiveRegionId };
}

test('deleteRegionCascade: leaves sibling and parent intact when deleting leaf node', () => {
  const mockMaps: Record<string, RegionalMapData> = {
    reg_1: {
      id: 'reg_1',
      name: 'North Region',
      parentId: null,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      zoomScale: 4,
      width: 1000,
      height: 500,
      gridCols: 1024,
      gridRows: 512,
      elevationGrid: new Float32Array(10),
      seaLevel: 35,
      createdAt: '2026-01-01',
      seed: 1234,
      widthKm: 5000,
    },
    town_1: {
      id: 'town_1',
      name: 'North Port Town',
      kind: 'town',
      parentId: 'reg_1',
      bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
      zoomScale: 16,
      width: 1000,
      height: 500,
      gridCols: 1024,
      gridRows: 512,
      elevationGrid: new Float32Array(10),
      seaLevel: 35,
      createdAt: '2026-01-01',
      seed: 1234,
      widthKm: 50,
    },
  };

  // Delete leaf town_1 while viewing it
  const result = deleteRegionCascade('town_1', mockMaps, 'town_1');
  assert.equal(result.nextActiveRegionId, 'reg_1', 'Should navigate back to parent reg_1');
  assert.equal(result.nextRegionalMaps['town_1'], undefined, 'town_1 should be removed');
  assert.ok(result.nextRegionalMaps['reg_1'], 'reg_1 should remain intact');
});

test('deleteRegionCascade: cascades to delete all descendants and navigates to world map', () => {
  const mockMaps: Record<string, RegionalMapData> = {
    reg_parent: {
      id: 'reg_parent',
      name: 'Parent Region',
      parentId: null,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      zoomScale: 4,
      width: 1000,
      height: 500,
      gridCols: 1024,
      gridRows: 512,
      elevationGrid: new Float32Array(10),
      seaLevel: 35,
      createdAt: '2026-01-01',
      seed: 1234,
      widthKm: 5000,
    },
    reg_child: {
      id: 'reg_child',
      name: 'Sub Region',
      parentId: 'reg_parent',
      bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
      zoomScale: 16,
      width: 1000,
      height: 500,
      gridCols: 1024,
      gridRows: 512,
      elevationGrid: new Float32Array(10),
      seaLevel: 35,
      createdAt: '2026-01-01',
      seed: 1234,
      widthKm: 500,
    },
    town_grandchild: {
      id: 'town_grandchild',
      name: 'Sub Town',
      kind: 'town',
      parentId: 'reg_child',
      bounds: { minX: 15, minY: 15, maxX: 20, maxY: 20 },
      zoomScale: 16,
      width: 1000,
      height: 500,
      gridCols: 1024,
      gridRows: 512,
      elevationGrid: new Float32Array(10),
      seaLevel: 35,
      createdAt: '2026-01-01',
      seed: 1234,
      widthKm: 25,
    },
    reg_unrelated: {
      id: 'reg_unrelated',
      name: 'Unrelated Region',
      parentId: null,
      bounds: { minX: 200, minY: 200, maxX: 300, maxY: 300 },
      zoomScale: 4,
      width: 1000,
      height: 500,
      gridCols: 1024,
      gridRows: 512,
      elevationGrid: new Float32Array(10),
      seaLevel: 35,
      createdAt: '2026-01-01',
      seed: 5678,
      widthKm: 5000,
    },
  };

  // Deleting reg_parent while viewing town_grandchild
  const result = deleteRegionCascade('reg_parent', mockMaps, 'town_grandchild');
  assert.equal(result.nextActiveRegionId, null, 'Active region should fall back to world map (null)');
  assert.equal(result.nextRegionalMaps['reg_parent'], undefined);
  assert.equal(result.nextRegionalMaps['reg_child'], undefined);
  assert.equal(result.nextRegionalMaps['town_grandchild'], undefined);
  assert.ok(result.nextRegionalMaps['reg_unrelated'], 'Unrelated map must not be affected');
});
