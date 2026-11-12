/**
 * Persistent Storage Manager for Custom Pixel Art Symbols and Categories.
 * Provides resilient persistence using both LocalStorage and IndexedDB (to exceed 5MB quota limits),
 * plus standalone JSON export/import for lifelong user backup.
 */

import { CustomMapAsset, CustomSymbolCategory } from '../types/symbols';

const ASSETS_LOCAL_STORAGE_KEY = 'fantasy_map_custom_assets';
const CATEGORIES_LOCAL_STORAGE_KEY = 'fantasy_map_custom_categories';
const IDB_NAME = 'FantasyWorldMapCreatorDB';
const IDB_STORE_NAME = 'custom_assets_store';
const IDB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getIDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB not supported in this environment'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

/**
 * Save data to IndexedDB
 */
async function idbSet<T>(key: string, val: T): Promise<void> {
  try {
    const db = await getIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.put({ key, value: val, updatedAt: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[AssetStorage] IndexedDB set failed:', err);
  }
}

/**
 * Get data from IndexedDB
 */
async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await getIDB();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? (req.result.value as T) : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[AssetStorage] IndexedDB get failed:', err);
    return null;
  }
}

/**
 * Synchronous initial load of custom assets from localStorage
 */
export function getInitialAssetsFromLocalStorage(): CustomMapAsset[] {
  try {
    const saved = localStorage.getItem(ASSETS_LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter((a: any) => a && typeof a.id === 'string' && !a.id.startsWith('starter_'));
      }
    }
  } catch (err) {
    console.warn('[AssetStorage] Failed to read assets from localStorage:', err);
  }
  return [];
}

/**
 * Synchronous initial load of custom categories from localStorage
 */
export function getInitialCategoriesFromLocalStorage(): CustomSymbolCategory[] {
  try {
    const saved = localStorage.getItem(CATEGORIES_LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter((c: any) => c && typeof c.id === 'string');
      }
    }
  } catch (err) {
    console.warn('[AssetStorage] Failed to read categories from localStorage:', err);
  }
  return [];
}

/**
 * Asynchronously load full assets, combining localStorage with IndexedDB
 */
export async function loadPersistentAssets(): Promise<CustomMapAsset[]> {
  const local = getInitialAssetsFromLocalStorage();
  const idb = await idbGet<CustomMapAsset[]>('assets');

  if (Array.isArray(idb) && idb.length > 0) {
    // Merge by id, preferring newer
    const map = new Map<string, CustomMapAsset>();
    for (const a of idb) {
      if (a && a.id && !a.id.startsWith('starter_')) map.set(a.id, a);
    }
    for (const a of local) {
      if (a && a.id && !a.id.startsWith('starter_') && !map.has(a.id)) {
        map.set(a.id, a);
      }
    }
    const merged = Array.from(map.values());
    // Keep localStorage in sync if it fits
    try {
      localStorage.setItem(ASSETS_LOCAL_STORAGE_KEY, JSON.stringify(merged));
    } catch {}
    return merged;
  }

  return local;
}

/**
 * Save custom assets to both LocalStorage and IndexedDB
 */
export async function persistCustomAssets(assets: CustomMapAsset[]): Promise<void> {
  const clean = assets.filter((a) => a && !a.id.startsWith('starter_'));
  // Save to LocalStorage
  try {
    localStorage.setItem(ASSETS_LOCAL_STORAGE_KEY, JSON.stringify(clean));
  } catch (err) {
    console.warn('[AssetStorage] LocalStorage quota exceeded for assets, relying on IndexedDB:', err);
  }

  // Save to IndexedDB (virtually unlimited quota)
  await idbSet('assets', clean);
}

/**
 * Save custom categories to both LocalStorage and IndexedDB
 */
export async function persistCustomCategories(categories: CustomSymbolCategory[]): Promise<void> {
  try {
    localStorage.setItem(CATEGORIES_LOCAL_STORAGE_KEY, JSON.stringify(categories));
  } catch (err) {
    console.warn('[AssetStorage] LocalStorage set failed for categories:', err);
  }
  await idbSet('categories', categories);
}

/**
 * Export only custom symbols and categories as a standalone JSON backup file
 */
export function exportSymbolLibraryToJson(
  assets: CustomMapAsset[],
  categories: CustomSymbolCategory[],
  customFilename?: string
): void {
  const payload = {
    version: 1,
    exportDate: new Date().toISOString(),
    assetCount: assets.length,
    categoryCount: categories.length,
    categories,
    assets,
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileName = customFilename
    ? `${customFilename.replace(/[/\\?%*:|"<>]/g, '_')}.json`
    : `fantasy_map_symbols_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parse an imported symbol library JSON string
 */
export function parseSymbolLibraryJson(jsonString: string): {
  assets: CustomMapAsset[];
  categories: CustomSymbolCategory[];
} {
  const parsed = JSON.parse(jsonString);
  let assets: CustomMapAsset[] = [];
  let categories: CustomSymbolCategory[] = [];

  if (Array.isArray(parsed)) {
    // Legacy array format
    assets = parsed.filter((a: any) => a && a.id && a.dataUrl);
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.assets)) {
      assets = parsed.assets.filter((a: any) => a && a.id && a.dataUrl);
    }
    if (Array.isArray(parsed.categories)) {
      categories = parsed.categories.filter((c: any) => c && c.id && c.name);
    }
  }

  if (assets.length === 0 && categories.length === 0) {
    throw new Error('有効なシンボルまたはカテゴリ情報が見つかりませんでした。');
  }

  return { assets, categories };
}
