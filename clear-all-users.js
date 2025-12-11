// Script to completely clear all users from the database
// This will delete ALL user accounts and allow fresh signups
// Usage: node clear-all-users.js

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database location (same as Electron uses)
const userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'flowstate-dashboard');
const dbPath = path.join(userDataPath, 'flowstate.db');

console.log('Database path:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.log('Database file not found. Nothing to clear.');
  process.exit(0);
}

// Load sql.js
const initSqlJs = (await import('sql.js')).default;
const SQL = await initSqlJs({
  locateFile: (file) => {
    return path.join(__dirname, 'node_modules/sql.js/dist', file);
  }
});

// Read database
const buffer = fs.readFileSync(dbPath);
const db = new SQL.Database(buffer);

try {
  // Check current users
  const usersResult = db.exec('SELECT id, email FROM users');
  const userCount = usersResult.length > 0 && usersResult[0].values ? usersResult[0].values.length : 0;
  
  console.log(`Found ${userCount} user(s) in database`);
  
  if (userCount > 0) {
    console.log('Users:');
    usersResult[0].values.forEach(([id, email]) => {
      console.log(`  - ${email} (ID: ${id})`);
    });
  }

  // Delete ALL users (cascade will delete sessions, captures, assets, settings)
  db.run('DELETE FROM users');
  
  // Also explicitly delete sessions, captures, assets, and settings to be sure
  db.run('DELETE FROM sessions');
  db.run('DELETE FROM captures');
  db.run('DELETE FROM assets');
  db.run('DELETE FROM settings');
  
  console.log('\n✓ All users deleted');
  console.log('✓ All sessions deleted');
  console.log('✓ All captures deleted');
  console.log('✓ All assets deleted');
  console.log('✓ All settings deleted');

  // Save database
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  db.close();

  console.log('\n✅ Database completely cleared!');
  console.log('You can now sign up with any email address.');
} catch (error) {
  console.error('❌ Error clearing database:', error.message);
  console.error(error);
  db.close();
  process.exit(1);
}










