// Force delete a specific user by email
// This will delete the user even if there are foreign key constraints
// Usage: node force-delete-user.js <email>

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const email = process.argv[2] || 'tmayseng21@gmail.com';

// Database location (same as Electron uses)
const userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'flowstate-dashboard');
const dbPath = path.join(userDataPath, 'flowstate.db');

console.log('Database path:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.log('Database file not found.');
  process.exit(1);
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
  // Disable foreign keys temporarily
  db.run('PRAGMA foreign_keys = OFF');
  
  // Find user
  const userResult = db.exec(`SELECT id, email FROM users WHERE email = '${email.replace(/'/g, "''")}'`);
  
  if (userResult.length === 0 || userResult[0].values.length === 0) {
    console.log(`User with email "${email}" not found in database.`);
    
    // List all users
    const allUsers = db.exec('SELECT id, email FROM users');
    if (allUsers.length > 0 && allUsers[0].values.length > 0) {
      console.log('\nUsers in database:');
      allUsers[0].values.forEach(([id, email]) => {
        console.log(`  - ${email} (ID: ${id})`);
      });
    } else {
      console.log('Database is empty (no users found).');
    }
  } else {
    const userId = userResult[0].values[0][0];
    const userEmail = userResult[0].values[0][1];
    
    console.log(`Found user: ${userEmail} (ID: ${userId})`);
    console.log('Force deleting user and all associated data...');

    // Delete in order to handle foreign keys
    db.run(`DELETE FROM sessions WHERE user_id = ${userId}`);
    db.run(`DELETE FROM assets WHERE capture_id IN (SELECT id FROM captures WHERE user_id = ${userId})`);
    db.run(`DELETE FROM captures WHERE user_id = ${userId}`);
    db.run(`DELETE FROM settings WHERE user_id = ${userId}`);
    db.run(`DELETE FROM users WHERE id = ${userId}`);
    
    console.log('✓ User account deleted');
    console.log('✓ All sessions deleted');
    console.log('✓ All captures deleted');
    console.log('✓ All assets deleted');
    console.log('✓ All user settings deleted');
  }

  // Re-enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Save database
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  db.close();

  console.log('\n✅ Database updated!');
  console.log(`You can now sign up with email: ${email}`);
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error);
  db.close();
  process.exit(1);
}


