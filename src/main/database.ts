import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: SqlJsDatabase;
let dbPath: string;
let SQL: any;

export async function initDatabase() {
  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, 'flowstate.db');

  // Initialize sql.js
  SQL = await initSqlJs({
    locateFile: (file: string) => {
      // In development, the compiled file is at dist/main/database.js
      // So we need to go up to project root, then into node_modules
      const isDev = !app.isPackaged;
      if (isDev) {
        // From dist/main to project root is ../../
        return path.join(__dirname, '../../node_modules/sql.js/dist', file);
      } else {
        // In production, resources are packaged differently
        return path.join(process.resourcesPath, 'node_modules/sql.js/dist', file);
      }
    }
  });

  // Load existing database or create new one
  try {
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  } catch (error) {
    // Use safe logging if available, otherwise suppress
    try {
      if (typeof console !== 'undefined' && console.error) {
        console.error('Error loading database, creating new one:', error);
      }
    } catch {
      // Ignore logging errors
    }
    db = new SQL.Database();
  }

  // Create tables with error handling and migration support
  try {
    // Create users table (new)
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        onboarding_completed BOOLEAN DEFAULT 0,
        feature_tour_completed BOOLEAN DEFAULT 0
      );
    `);

    // Create sessions table (new)
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Create or migrate captures table
    // First check if table exists and has user_id column
    let capturesNeedsMigration = false;
    try {
      const tableInfo = db.exec("PRAGMA table_info(captures)");
      if (tableInfo.length > 0) {
        const columns = tableInfo[0].values.map((row: any[]) => row[1]); // Column names are in index 1
        if (!columns.includes('user_id')) {
          capturesNeedsMigration = true;
        }
      }
    } catch {
      // Table doesn't exist, will be created below
    }

    if (capturesNeedsMigration) {
      // Add user_id column to existing table
      try {
        db.run('ALTER TABLE captures ADD COLUMN user_id INTEGER');
        console.log('[Database] Migrated captures table: added user_id column');
      } catch (alterErr: any) {
        console.warn('[Database] Could not add user_id to captures:', alterErr?.message);
      }
    } else {
      // Create table if it doesn't exist
      try {
        db.run(`
          CREATE TABLE IF NOT EXISTS captures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            context_description TEXT
          );
        `);
      } catch (err: any) {
        console.warn('[Database] Error creating captures table:', err?.message);
      }
    }

    // Create assets table (should already exist, but ensure it's correct)
    db.run(`
      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        capture_id INTEGER NOT NULL,
        asset_type TEXT NOT NULL,
        title TEXT,
        path TEXT,
        content TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
      );
    `);

    // Migrate users table to add feature_tour_completed if needed
    try {
      const usersTableInfo = db.exec("PRAGMA table_info(users)");
      if (usersTableInfo.length > 0) {
        const columns = usersTableInfo[0].values.map((row: any[]) => row[1]);
        if (!columns.includes('feature_tour_completed')) {
          db.run('ALTER TABLE users ADD COLUMN feature_tour_completed BOOLEAN DEFAULT 0');
          console.log('[Database] Migrated users table: added feature_tour_completed column');
        }
      }
    } catch (err: any) {
      console.warn('[Database] Could not check/migrate users table:', err?.message);
    }

    // Create or migrate settings table with per-user support
    let settingsTableInfo: any[] = [];
    let settingsHasTable = false;
    let settingsNeedsRebuild = false;

    try {
      settingsTableInfo = db.exec('PRAGMA table_info(settings)');
      settingsHasTable = settingsTableInfo.length > 0;
      if (settingsHasTable) {
        const columns = settingsTableInfo[0].values;
        const columnNames = columns.map((row: any[]) => row[1]);
        const pkColumns = columns.filter((row: any[]) => row[5] > 0).map((row: any[]) => row[1]);
        const hasUserIdColumn = columnNames.includes('user_id');
        const pkIncludesUserId = pkColumns.includes('user_id');

        if (!hasUserIdColumn || !pkIncludesUserId) {
          settingsNeedsRebuild = true;
        }
      } else {
        settingsNeedsRebuild = true;
      }
    } catch (err) {
      console.warn('[Database] Could not inspect settings table:', (err as Error).message);
      settingsNeedsRebuild = true;
    }

    let existingSettings: Array<{ key: string; value: string; user_id: number }> = [];

    if (settingsNeedsRebuild && settingsHasTable) {
      try {
        const existing = db.exec('SELECT key, value, COALESCE(user_id, 0) as user_id FROM settings');
        if (existing.length > 0) {
          const columns = existing[0].columns;
          const values = existing[0].values;
          existingSettings = values.map((row: any[]) => {
            const obj: any = {};
            columns.forEach((col: string, idx: number) => {
              obj[col] = row[idx];
            });
            return obj as { key: string; value: string; user_id: number };
          });
        }
      } catch (readErr) {
        console.warn('[Database] Could not read existing settings during migration:', readErr);
      }

      try {
        db.run('DROP TABLE IF EXISTS settings');
      } catch (dropErr) {
        console.warn('[Database] Could not drop settings table:', dropErr);
      }
    }

    try {
      db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT NOT NULL,
          value TEXT,
          user_id INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (key, user_id)
        );
      `);
    } catch (err: any) {
      console.warn('[Database] Error creating settings table:', err?.message);
    }

    if (existingSettings.length > 0) {
      try {
        const insertSetting = prepare(
          'INSERT OR REPLACE INTO settings (key, value, user_id) VALUES (?, ?, ?)'
        );
        for (const setting of existingSettings) {
          insertSetting.run(setting.key, setting.value, setting.user_id ?? 0);
        }
        console.log('[Database] Migrated settings table with per-user support');
      } catch (insertErr) {
        console.warn('[Database] Failed to reinsert settings after migration:', insertErr);
      }
    }

    // Create indexes
    try {
      db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_assets_capture_id ON assets(capture_id);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_captures_created_at ON captures(created_at DESC);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_captures_user_id ON captures(user_id);`);
    } catch (indexErr) {
      // Indexes might already exist, that's okay
      console.warn('[Database] Some indexes might already exist:', indexErr);
    }
  } catch (tableError) {
    console.error('[Database] Error creating tables:', tableError);
    throw tableError;
  }

  // Save database to disk
  saveDatabase();

  console.log('Database initialized at:', dbPath);

  // Auto-cleanup: keep only last 100 captures
  cleanupOldCaptures(100);

  return db;
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function saveDatabase() {
  if (!db || !dbPath) {
    return;
  }

  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Helper function to execute prepared statements (sql.js compatible)
export function prepare(sql: string) {
  const database = getDatabase();

  return {
    run: (...params: any[]) => {
      database.run(sql, params);

      // Get last insert rowid BEFORE saving (important for sql.js)
      const result = database.exec('SELECT last_insert_rowid() as id');
      const lastInsertRowid = (result[0]?.values[0]?.[0] as number) || 0;

      saveDatabase();

      return { lastInsertRowid };
    },
    get: (...params: any[]) => {
      // sql.js doesn't support parameters in exec(), so we need to manually bind them
      let query = sql;
      if (params && params.length > 0) {
        // Simple parameter replacement (for ? placeholders)
        // Replace each ? with the corresponding parameter value
        let paramIndex = 0;
        query = query.replace(/\?/g, () => {
          if (paramIndex >= params.length) return '?';
          const param = params[paramIndex++];
          if (param === null || param === undefined) {
            return 'NULL';
          }
          return typeof param === 'string' 
            ? `'${param.replace(/'/g, "''")}'` 
            : String(param);
        });
      }
      
      try {
        const result = database.exec(query);
        if (result.length === 0) return null;

        const columns = result[0].columns;
        const values = result[0].values[0];

        if (!values) return null;

        const row: any = {};
        columns.forEach((col: string, idx: number) => {
          row[col] = values[idx];
        });

        return row;
      } catch (error) {
        console.error('SQL query error:', {
          query,
          params,
          error: (error as Error).message,
        });
        throw error;
      }
    },
    all: (...params: any[]) => {
      // sql.js doesn't support parameters in exec(), so we need to manually bind them
      let query = sql;
      if (params && params.length > 0) {
        // Simple parameter replacement (for ? placeholders)
        // Replace each ? with the corresponding parameter value
        let paramIndex = 0;
        query = query.replace(/\?/g, () => {
          if (paramIndex >= params.length) return '?';
          const param = params[paramIndex++];
          if (param === null || param === undefined) {
            return 'NULL';
          }
          return typeof param === 'string' 
            ? `'${param.replace(/'/g, "''")}'` 
            : String(param);
        });
      }
      
      try {
        const result = database.exec(query);
        if (result.length === 0) return [];

        const columns = result[0].columns;
        const values = result[0].values;

        return values.map((row: any[]) => {
          const obj: any = {};
          columns.forEach((col: string, idx: number) => {
            obj[col] = row[idx];
          });
          return obj;
        });
      } catch (error) {
        console.error('SQL query error:', {
          query,
          params,
          error: (error as Error).message,
        });
        throw error;
      }
    }
  };
}

export interface Capture {
  id?: number;
  name: string;
  created_at?: string;
  context_description?: string;
  user_id?: number | null;
}

export interface Asset {
  id?: number;
  capture_id: number;
  asset_type: 'code' | 'terminal' | 'browser' | 'notes' | 'other';
  title: string;
  path?: string;
  content?: string;
  metadata?: string;
  created_at?: string;
}

// Settings helpers
export function getSetting(key: string, userId = 0): string | null {
  try {
    const result = prepare('SELECT value FROM settings WHERE key = ? AND user_id = ?').get(
      key,
      userId
    );
    return result?.value || null;
  } catch (error) {
    console.error(`Error getting setting ${key}:`, error);
    return null;
  }
}

export function setSetting(key: string, value: string, userId = 0): void {
  try {
    // Use INSERT OR REPLACE for upsert behavior
    prepare('INSERT OR REPLACE INTO settings (key, value, user_id) VALUES (?, ?, ?)').run(
      key,
      value,
      userId
    );
    console.log(`Setting ${key} = ${value}`);
  } catch (error) {
    console.error(`Error setting ${key}:`, error);
  }
}

export function getAllSettings(userId = 0): Record<string, string> {
  try {
    const results = prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId);
    return results.reduce((acc: Record<string, string>, row: any) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  } catch (error) {
    console.error('Error getting all settings:', error);
    return {};
  }
}

/**
 * Auto-cleanup old captures to keep only the most recent N captures
 * @param limit Number of captures to keep (default: 100)
 */
export function cleanupOldCaptures(limit: number = 100): void {
  try {
    const database = getDatabase();

    // Get count of captures before cleanup
    const countBefore = database.exec('SELECT COUNT(*) as count FROM captures');
    const totalBefore = countBefore[0]?.values[0]?.[0] as number || 0;

    if (totalBefore <= limit) {
      console.log(`[Database] No cleanup needed: ${totalBefore} captures (limit: ${limit})`);
      return;
    }

    // Delete old captures keeping only the last N
    // Assets will be automatically deleted due to ON DELETE CASCADE
    database.run(`
      DELETE FROM captures
      WHERE id NOT IN (
        SELECT id FROM captures
        ORDER BY created_at DESC
        LIMIT ${limit}
      )
    `);

    // Get count after cleanup
    const countAfter = database.exec('SELECT COUNT(*) as count FROM captures');
    const totalAfter = countAfter[0]?.values[0]?.[0] as number || 0;
    const deleted = totalBefore - totalAfter;

    if (deleted > 0) {
      saveDatabase();
      console.log(`[Database] Cleanup complete: deleted ${deleted} old capture(s), kept ${totalAfter}`);
    }
  } catch (error) {
    console.error('[Database] Error during cleanup:', error);
  }
}
