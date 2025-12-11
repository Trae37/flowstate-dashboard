// Script to reset onboarding and feature tour flags for testing
// This will allow you to test the walkthrough again
// Usage: node reset-onboarding.js <email>

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
  console.log('Database file not found. Nothing to reset.');
  process.exit(1);
}

const email = process.argv[2];

if (!email) {
  console.log('Usage: node reset-onboarding.js <email>');
  console.log('Example: node reset-onboarding.js user@example.com');
  console.log('\nThis will reset onboarding_completed and feature_tour_completed to false for the specified user.');
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
    db.close();
    process.exit(1);
  }

  const userId = userResult[0].values[0][0];
  const userEmail = userResult[0].values[0][1];
  
  console.log(`Found user: ${userEmail} (ID: ${userId})`);
  console.log('Resetting onboarding and feature tour flags...');

  // Reset both flags to false
  db.run(`UPDATE users SET onboarding_completed = 0, feature_tour_completed = 0 WHERE id = ${userId}`);
  
  console.log('✓ Onboarding flag reset to false');
  console.log('✓ Feature tour flag reset to false');

  // Save database
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  db.close();

  console.log('\n✅ Onboarding reset complete!');
  console.log(`You can now test the walkthrough again.`);
  console.log(`\nNext steps:`);
  console.log(`1. Close the FlowState app if it's running`);
  console.log(`2. Restart the app`);
  console.log(`3. Log in with email: ${email}`);
  console.log(`4. You should be redirected to onboarding`);
  console.log(`5. After completing onboarding, the feature tour should appear`);
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error);
  db.close();
  process.exit(1);
}







