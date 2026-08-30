CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  food TEXT NOT NULL,
  kcal_consumed INTEGER NOT NULL,
  minutes_walked INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  weight_kg NUMERIC(5,1) NOT NULL DEFAULT 90,
  height_cm NUMERIC(5,1) NOT NULL DEFAULT 170,
  age_years INTEGER NOT NULL DEFAULT 26,
  sex TEXT NOT NULL DEFAULT 'H',
  activity_factor NUMERIC(4,3) NOT NULL DEFAULT 1.2,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diary_user_date
  ON diary_entries (user_id, date DESC);
