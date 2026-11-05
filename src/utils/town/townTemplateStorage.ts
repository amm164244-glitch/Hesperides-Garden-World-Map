/**
 * Town Template LocalStorage Persistence
 * Handles safe loading and saving of templates in browser localStorage.
 */

import { TownTemplate, sanitizeTemplate } from './townTemplate';

export const TOWN_TEMPLATES_STORAGE_KEY = 'fantasy_map_town_templates';
export const MAX_TOWN_TEMPLATES = 100;

/**
 * Loads and sanitizes templates from localStorage.
 * Never throws; returns empty array on missing or corrupted data.
 */
export function loadTemplates(): TownTemplate[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }

    const raw = window.localStorage.getItem(TOWN_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const templates: TownTemplate[] = [];
    for (const item of parsed) {
      const sanitized = sanitizeTemplate(item);
      if (sanitized) {
        templates.push(sanitized);
      }
    }

    return templates.slice(0, MAX_TOWN_TEMPLATES);
  } catch (err) {
    console.warn('[townTemplateStorage] Failed to load templates:', err);
    return [];
  }
}

/**
 * Saves templates to localStorage, capping at MAX_TOWN_TEMPLATES (100).
 * Handles quota exceeded and serialization errors safely.
 */
export function saveTemplates(templates: TownTemplate[]): { ok: boolean; error?: string } {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ok: false, error: 'ローカルストレージを利用できません。' };
    }

    const sanitized = templates
      .map((t) => sanitizeTemplate(t))
      .filter((t): t is TownTemplate => t !== null)
      .slice(0, MAX_TOWN_TEMPLATES);

    const json = JSON.stringify(sanitized);
    window.localStorage.setItem(TOWN_TEMPLATES_STORAGE_KEY, json);

    return { ok: true };
  } catch (err) {
    console.error('[townTemplateStorage] Failed to save templates:', err);
    const msg = err instanceof Error ? err.message : '保存に失敗しました。';
    return { ok: false, error: msg };
  }
}
