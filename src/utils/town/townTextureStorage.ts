/**
 * Town Texture IndexedDB Persistence
 * Manages asynchronous storage for custom town textures in dedicated IndexedDB.
 * Completely separate from 'FantasyWorldMapCreatorDB'.
 */

import { TownTexture } from '../../types/town';
import { sanitizeTownTexture } from './townTextures';

export const TEXTURE_DB_NAME = 'HesperidesTownTexturesDB';
export const TEXTURE_STORE_NAME = 'textures';
export const TEXTURE_DB_VERSION = 1;
export const MAX_TEXTURE_COUNT = 40;
export const MAX_DATA_URL_BYTES = 3 * 1024 * 1024; // ~3 MB

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported'));
      return;
    }

    const request = window.indexedDB.open(TEXTURE_DB_NAME, TEXTURE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(TEXTURE_STORE_NAME)) {
        db.createObjectStore(TEXTURE_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error || new Error('Failed to open database'));
    };
  });
}

/**
 * Loads and sanitizes all textures from IndexedDB.
 * Never throws; returns empty array on failure or unsupported environment.
 */
export async function loadTextures(): Promise<TownTexture[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(TEXTURE_STORE_NAME, 'readonly');
      const store = tx.objectStore(TEXTURE_STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const rawList = request.result;
        if (!Array.isArray(rawList)) {
          resolve([]);
          return;
        }

        const valid: TownTexture[] = [];
        for (const item of rawList) {
          const sanitized = sanitizeTownTexture(item);
          if (sanitized) {
            valid.push(sanitized);
          }
        }
        resolve(valid.slice(0, MAX_TEXTURE_COUNT));
      };

      request.onerror = () => {
        resolve([]);
      };
    });
  } catch (err) {
    console.warn('[townTextureStorage] Failed to load textures:', err);
    return [];
  }
}

/**
 * Puts or updates a texture in IndexedDB.
 */
export async function putTexture(texture: TownTexture): Promise<{ ok: boolean; error?: string }> {
  try {
    const sanitized = sanitizeTownTexture(texture);
    if (!sanitized) {
      return { ok: false, error: 'テクスチャのデータ形式が不正です。' };
    }

    if (sanitized.dataUrl.length > MAX_DATA_URL_BYTES) {
      return { ok: false, error: 'テクスチャのデータサイズが約3MBを超えています。' };
    }

    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(TEXTURE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(TEXTURE_STORE_NAME);
      const request = store.put(sanitized);

      request.onsuccess = () => {
        resolve({ ok: true });
      };

      request.onerror = (event) => {
        const err = (event.target as IDBRequest).error;
        resolve({
          ok: false,
          error: err ? err.message : 'テクスチャの保存に失敗しました。',
        });
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '保存に失敗しました。';
    return { ok: false, error: msg };
  }
}

/**
 * Deletes a texture by id from IndexedDB.
 */
export async function deleteTexture(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(TEXTURE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(TEXTURE_STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve({ ok: true });
      };

      request.onerror = (event) => {
        const err = (event.target as IDBRequest).error;
        resolve({
          ok: false,
          error: err ? err.message : 'テクスチャの削除に失敗しました。',
        });
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '削除に失敗しました。';
    return { ok: false, error: msg };
  }
}
