-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom ENUM types
DO $$ BEGIN
    CREATE TYPE match_status AS ENUM ('WAITING', 'ACTIVE', 'FINISHED', 'ABORTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE match_resolution_reason AS ENUM (
        'ACCEPTED_SUBMISSION', 
        'TIMEOUT', 
        'FORFEIT', 
        'PLAYER_DISCONNECT', 
        'MUTUAL_DRAW', 
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    cf_handle VARCHAR(64) NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
    losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
    draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
    matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leaderboard & lookup indices
CREATE INDEX IF NOT EXISTS idx_users_leaderboard ON users (wins DESC, draws DESC, matches_played ASC);
CREATE INDEX IF NOT EXISTS idx_users_cf_handle ON users (LOWER(cf_handle));

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code VARCHAR(6) NOT NULL,
    player1_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    player2_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    winner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    problem_contest_id INTEGER NOT NULL,
    problem_index VARCHAR(10) NOT NULL,
    problem_name VARCHAR(255) NOT NULL,
    problem_rating INTEGER NOT NULL,
    match_duration_seconds INTEGER NOT NULL CHECK (match_duration_seconds BETWEEN 60 AND 18000),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    status match_status NOT NULL DEFAULT 'WAITING',
    end_reason match_resolution_reason,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Match query indices
CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches (player1_id);
CREATE INDEX IF NOT EXISTS idx_matches_player2 ON matches (player2_id);
CREATE INDEX IF NOT EXISTS idx_matches_room_code ON matches (room_code);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches (status);
