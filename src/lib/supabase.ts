import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MapData, SupabaseMapRecord } from '../types/map';
import { serializeMapData, deserializeMapData } from '../utils/serialization';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(customUrl?: string, customKey?: string): SupabaseClient | null {
  const url = customUrl || (import.meta.env.VITE_SUPABASE_URL as string);
  const key = customKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string);

  if (!url || !key || url.includes('your-project') || key.includes('your-anon')) {
    return null;
  }

  if (!supabaseInstance || customUrl || customKey) {
    try {
      supabaseInstance = createClient(url, key);
    } catch (err) {
      console.warn('Failed to initialize Supabase client:', err);
      return null;
    }
  }

  return supabaseInstance;
}

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  return Boolean(url && key && !url.includes('your-project') && !key.includes('your-anon'));
}

export const SUPABASE_SETUP_SQL = `-- Supabaseの「SQL Editor」で実行してください:
CREATE TABLE IF NOT EXISTS maps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  seed BIGINT NOT NULL,
  cell_count INTEGER NOT NULL,
  map_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS (行レベルセキュリティ) を有効化
ALTER TABLE maps ENABLE ROW LEVEL SECURITY;

-- 開発・デモ用ポリシー（誰でも読み書き可能）
CREATE POLICY "Enable all access for demo"
  ON maps FOR ALL
  USING (true)
  WITH CHECK (true);
`;

/**
 * Save map data to Supabase
 */
export async function saveMapToSupabase(
  name: string,
  mapData: MapData,
  customClient?: SupabaseClient | null
): Promise<{ success: boolean; id?: string; error?: string }> {
  const client = customClient || getSupabaseClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabaseの環境変数（VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY）が未設定です。',
    };
  }

  try {
    const serialized = serializeMapData(mapData);
    const { data, error } = await client
      .from('maps')
      .insert([
        {
          name: name.trim() || `世界地図_${new Date().toLocaleDateString('ja-JP')}`,
          seed: mapData.seed,
          cell_count: mapData.cellCount,
          map_data: serialized,
          updated_at: new Date().toISOString(),
        },
      ])
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data.id };
  } catch (err: any) {
    return { success: false, error: err?.message || '保存中にエラーが発生しました' };
  }
}

/**
 * List saved maps from Supabase
 */
export async function listMapsFromSupabase(
  customClient?: SupabaseClient | null
): Promise<{ success: boolean; data?: SupabaseMapRecord[]; error?: string }> {
  const client = customClient || getSupabaseClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabaseが設定されていません。',
    };
  }

  try {
    const { data, error } = await client
      .from('maps')
      .select('id, name, seed, cell_count, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data as any) || [] };
  } catch (err: any) {
    return { success: false, error: err?.message || '一覧取得に失敗しました' };
  }
}

/**
 * Load single map from Supabase
 */
export async function loadMapFromSupabase(
  id: string,
  customClient?: SupabaseClient | null
): Promise<{ success: boolean; mapData?: MapData; name?: string; error?: string }> {
  const client = customClient || getSupabaseClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabaseが設定されていません。',
    };
  }

  try {
    const { data, error } = await client
      .from('maps')
      .select('name, map_data')
      .eq('id', id)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    const deserialized = deserializeMapData(data.map_data);
    return { success: true, mapData: deserialized, name: data.name };
  } catch (err: any) {
    return { success: false, error: err?.message || '地図データの読み込みに失敗しました' };
  }
}
