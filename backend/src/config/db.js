const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

let pool = null;
let useMock = false;

// In-memory mock database store for zero-friction local development and testing
const mockStore = {
  users: new Map(),   // id -> user
  matches: new Map() // id -> match
};

if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
  const isNeon = process.env.DATABASE_URL.includes('neon.tech') || process.env.DATABASE_URL.includes('sslmode=require');
  
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isNeon ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
  });
} else {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[DB FATAL] DATABASE_URL is required in production environment. In-memory mock database is disabled in production.');
  }
  useMock = true;
  console.log('[DB] No DATABASE_URL provided. Operating in IN-MEMORY MOCK DATABASE mode (Development Only).');
}

/**
 * Executes a query against PostgreSQL, with transparent in-memory mock fallback.
 */
async function query(text, params = []) {
  if (pool && !useMock) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (process.env.USE_IN_MEMORY_FALLBACK === 'true' && process.env.NODE_ENV !== 'production') {
        console.warn(`[DB] Live PostgreSQL query failed: ${err.message}. Falling back to in-memory store.`);
        useMock = true;
      } else {
        throw err;
      }
    }
  }

  // Handle Mock Queries
  return executeMockQuery(text, params);
}

/**
 * Executes a unit of work inside an ACID transaction
 * @param {Function} callback - Async function receiving client
 */
async function transaction(callback) {
  if (pool && !useMock) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // In-memory mock transaction wrapper
  const mockClient = {
    query: (text, params) => executeMockQuery(text, params)
  };
  return callback(mockClient);
}

function executeMockQuery(text, params = []) {
  const normalized = text.trim().toLowerCase();

  // Transaction control statements
  if (['begin', 'commit', 'rollback'].includes(normalized)) {
    return { rows: [], rowCount: 0 };
  }

  // 1. SELECT from users
  if (normalized.startsWith('select') && normalized.includes('from users')) {
    const users = Array.from(mockStore.users.values());
    
    if (normalized.includes('where id = $1')) {
      const user = users.find(u => u.id === params[0]);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }
    
    if (normalized.includes('where email = $1 or username = $2')) {
      const user = users.find(u => u.email === params[0] || u.username === params[1]);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    if (normalized.includes('where email = $1 or username = $1') || normalized.includes('lower(email) = $1 or lower(username) = $1')) {
      const p = String(params[0]).toLowerCase();
      const user = users.find(u => u.email.toLowerCase() === p || u.username.toLowerCase() === p);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    if (normalized.includes('where email = $1')) {
      const user = users.find(u => u.email === params[0]);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    if (normalized.includes('where username = $1')) {
      const user = users.find(u => u.username === params[0]);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    // Leaderboard query
    if (normalized.includes('order by wins desc')) {
      const sorted = [...users].sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.draws !== a.draws) return b.draws - a.draws;
        return a.matches_played - b.matches_played;
      }).slice(0, 50).map(u => ({
        id: u.id,
        username: u.username,
        cf_handle: u.cf_handle,
        wins: u.wins,
        losses: u.losses,
        draws: u.draws,
        matches_played: u.matches_played,
        win_rate: u.matches_played === 0 ? '0.00' : ((u.wins / u.matches_played) * 100).toFixed(2)
      }));
      return { rows: sorted, rowCount: sorted.length };
    }

    return { rows: users, rowCount: users.length };
  }

  // 2. INSERT into users
  if (normalized.startsWith('insert into users')) {
    const id = require('crypto').randomUUID();
    const [username, email, password_hash, cf_handle] = params;
    
    const newUser = {
      id,
      username,
      email,
      password_hash,
      cf_handle,
      wins: 0,
      losses: 0,
      draws: 0,
      matches_played: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    mockStore.users.set(id, newUser);
    return { rows: [newUser], rowCount: 1 };
  }

  // 3. UPDATE users stats
  if (normalized.startsWith('update users')) {
    const userId = params[params.length - 1]; // WHERE id = $... is last parameter
    const user = mockStore.users.get(userId);
    if (!user) return { rows: [], rowCount: 0 };

    user.matches_played += 1;
    if (normalized.includes('wins = wins + 1')) {
      user.wins += 1;
    } else if (normalized.includes('losses = losses + 1')) {
      user.losses += 1;
    } else if (normalized.includes('draws = draws + 1')) {
      user.draws += 1;
    }

    user.updated_at = new Date().toISOString();
    return { rows: [{ ...user }], rowCount: 1 };
  }

  // 4. INSERT into matches
  if (normalized.startsWith('insert into matches')) {
    const id = require('crypto').randomUUID();
    const [
      room_code, player1_id, player2_id,
      problem_contest_id, problem_index, problem_name, problem_rating,
      match_duration_seconds, started_at
    ] = params;

    const newMatch = {
      id,
      room_code,
      player1_id,
      player2_id,
      winner_id: null,
      problem_contest_id,
      problem_index,
      problem_name,
      problem_rating,
      match_duration_seconds,
      started_at: started_at || new Date().toISOString(),
      ended_at: null,
      status: 'ACTIVE',
      end_reason: null,
      created_at: new Date().toISOString()
    };
    mockStore.matches.set(id, newMatch);
    return { rows: [newMatch], rowCount: 1 };
  }

  // 5. SELECT from matches
  if (normalized.startsWith('select') && normalized.includes('from matches')) {
    const matches = Array.from(mockStore.matches.values());
    if (normalized.includes('where room_code = $1')) {
      const roomCode = params[0];
      let filtered = matches.filter(m => m.room_code === roomCode);
      if (normalized.includes('status = \'active\'') || normalized.includes('status = $2')) {
        filtered = filtered.filter(m => m.status === 'ACTIVE');
      }
      return { rows: filtered, rowCount: filtered.length };
    }
    if (normalized.includes('where id = $1')) {
      const match = mockStore.matches.get(params[0]);
      return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
    }
    return { rows: matches, rowCount: matches.length };
  }

  // 6. UPDATE matches
  if (normalized.startsWith('update matches')) {
    // Parameters: winner_id, end_reason, match_id OR room_code
    // Match update: SET status = 'FINISHED', ended_at = NOW(), winner_id = $1, end_reason = $2 WHERE id = $3 / room_code = $3
    const matches = Array.from(mockStore.matches.values());
    let match = null;

    if (normalized.includes('where id = $3')) {
      match = mockStore.matches.get(params[2]);
    } else if (normalized.includes('where room_code = $3')) {
      match = matches.slice().reverse().find(m => m.room_code === params[2] && m.status === 'ACTIVE');
    }

    if (match) {
      match.status = 'FINISHED';
      match.ended_at = new Date().toISOString();
      match.winner_id = params[0] || null;
      match.end_reason = params[1] || 'ACCEPTED_SUBMISSION';
      return { rows: [{ ...match }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // Fallback default
  return { rows: [], rowCount: 0 };
}

module.exports = {
  query,
  transaction,
  pool,
  isUsingMock: () => useMock,
  setUseMock: (val) => { useMock = val; },
  mockStore
};
