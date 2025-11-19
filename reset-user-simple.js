// Simple script to delete a user account from the database
// Usage: node reset-user-simple.js <email>
// Example: node reset-user-simple.js tmayseng21@gmail.com

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get email from command line
const email = process.argv[2];

if (!email) {
  console.log('Usage: node reset-user-simple.js <email>');
  console.log('Example: node reset-user-simple.js user@example.com');
  process.exit(1);
}

// Database location (same as Electron uses)
const userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'flowstate-dashboard');
const dbPath = path.join(userDataPath, 'flowstate.db');

console.log('Database path:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.log('❌ Database file not found at:', dbPath);
  console.log('The app may not have been run yet, or the database is in a different location.');
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
  // Find user
  const userResult = db.exec(`SELECT id, email FROM users WHERE email = '${email.replace(/'/g, "''")}'`);
  
  if (userResult.length === 0 || userResult[0].values.length === 0) {
    console.log(`❌ User with email "${email}" not found.`);
    db.close();
    process.exit(1);
  }

  const userId = userResult[0].values[0][0];
  const userEmail = userResult[0].values[0][1];
  
  console.log(`✓ Found user: ${userEmail} (ID: ${userId})`);
  console.log('Deleting user and all associated data...');

  // Delete user (cascade will delete sessions, captures, assets, settings)
  db.run(`DELETE FROM users WHERE id = ${userId}`);
  
  console.log('✓ User account deleted');
  console.log('✓ All sessions deleted');
  console.log('✓ All captures deleted');
  console.log('✓ All assets deleted');
  console.log('✓ All user settings deleted');

  // Save database
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  db.close();

  console.log('\n✅ User account reset complete!');
  console.log(`You can now sign up again with email: ${email}`);
} catch (error) {
  console.error('❌ Error resetting user:', error.message);
  db.close();
  process.exit(1);
}

