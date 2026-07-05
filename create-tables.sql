
-- Create schema if not exists
CREATE SCHEMA IF NOT EXISTS translationapp_coachunder;

-- Set search path to our schema
SET search_path TO translationapp_coachunder;

-- Drop existing tables to start fresh
DROP TABLE IF EXISTS session_listeners;
DROP TABLE IF EXISTS translation_logs;
DROP TABLE IF EXISTS translation_sessions;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

-- Create users table
CREATE TABLE users (
  id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  profile_image_url VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create sessions table for auth
CREATE TABLE sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX IDX_session_expire ON sessions(expire);

-- Create translation sessions table
CREATE TABLE translation_sessions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  target_language VARCHAR(255) NOT NULL,
  target_languages TEXT[] NOT NULL DEFAULT ARRAY['en'],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create translation logs table
CREATE TABLE translation_logs (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES translation_sessions(id) ON DELETE CASCADE,
  original_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_language VARCHAR(255) NOT NULL,
  target_language VARCHAR(255) NOT NULL,
  speaker VARCHAR(255),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create session listeners table
CREATE TABLE session_listeners (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES translation_sessions(id) ON DELETE CASCADE,
  listener_name VARCHAR(255) NOT NULL,
  target_language VARCHAR(255) NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  left_at TIMESTAMP WITH TIME ZONE
);
