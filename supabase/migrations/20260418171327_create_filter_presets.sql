/*
  # Filter presets for GitLab time tracking

  1. New Tables
    - `filter_presets`
      - `user_id` (uuid, primary key, references auth.users)
      - `instance_url` (text) - GitLab instance URL (non-sensitive)
      - `project_path` (text) - Project URL/path
      - `start_date` (date) - Period start
      - `end_date` (date) - Period end
      - `updated_at` (timestamptz) - Last update

  2. Security
    - Enable RLS on `filter_presets`
    - Users can only read/write their own preset row
    - Token is NEVER stored in this table (remains in sessionStorage only)

  3. Notes
    - One preset row per user (primary key is user_id)
    - Supports anonymous auth via `supabase.auth.signInAnonymously()`
*/

CREATE TABLE IF NOT EXISTS filter_presets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_url text NOT NULL DEFAULT '',
  project_path text NOT NULL DEFAULT '',
  start_date date,
  end_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE filter_presets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'filter_presets' AND policyname = 'Users can read own preset'
  ) THEN
    CREATE POLICY "Users can read own preset"
      ON filter_presets FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'filter_presets' AND policyname = 'Users can insert own preset'
  ) THEN
    CREATE POLICY "Users can insert own preset"
      ON filter_presets FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'filter_presets' AND policyname = 'Users can update own preset'
  ) THEN
    CREATE POLICY "Users can update own preset"
      ON filter_presets FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'filter_presets' AND policyname = 'Users can delete own preset'
  ) THEN
    CREATE POLICY "Users can delete own preset"
      ON filter_presets FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;
