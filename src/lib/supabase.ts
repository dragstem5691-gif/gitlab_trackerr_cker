import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export async function ensureAnonymousSession(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user?.id) {
    return sessionData.session.user.id;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) return null;
  return data.user.id;
}

export interface StoredPreset {
  instance_url: string;
  project_path: string;
  start_date: string | null;
  end_date: string | null;
}

export async function loadPreset(userId: string): Promise<StoredPreset | null> {
  const { data, error } = await supabase
    .from('filter_presets')
    .select('instance_url, project_path, start_date, end_date')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data as StoredPreset;
}

export async function savePreset(userId: string, preset: StoredPreset): Promise<void> {
  await supabase.from('filter_presets').upsert(
    {
      user_id: userId,
      instance_url: preset.instance_url,
      project_path: preset.project_path,
      start_date: preset.start_date,
      end_date: preset.end_date,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
}
