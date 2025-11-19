// Script to reset user login information
// This will delete the user account and all associated data
// Run with: node reset-user.js

import { initDatabase, prepare, saveDatabase } from './dist/main/database.js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

async function resetUser(email) {
  try {
    console.log('Initializing database...');
    
    // We need to initialize the database
    // Since this is a standalone script, we'll need to handle the path differently
    const userDataPath = app?.getPath('userData') || path.join(process.env.APPDATA || process.env.HOME, 'flowstate-dashboard');
    const dbPath = path.join(userDataPath, 'flowstate.db');
    
    console.log('Database path:', dbPath);
    
    if (!fs.existsSync(dbPath)) {
      console.log('Database not found. Nothing to reset.');
      return;
    }

    // Load sql.js
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({
      locateFile: (file) => {
        return path.join(process.cwd(), 'node_modules/sql.js/dist', file);
      }
    });

    // Load database
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    // Find user by email
    const userResult = db.exec(`SELECT id, email FROM users WHERE email = '${email.replace(/'/g, "''")}'`);
    
    if (userResult.length === 0 || userResult[0].values.length === 0) {
      console.log(`User with email "${email}" not found.`);
      db.close();
      return;
    }

    const userId = userResult[0].values[0][0];
    const userEmail = userResult[0].values[0][1];
    
    console.log(`Found user: ${userEmail} (ID: ${userId})`);
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
    console.error('Error resetting user:', error);
  }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.log('Usage: node reset-user.js <email>');
  console.log('Example: node reset-user.js user@example.com');
  process.exit(1);
}

resetUser(email);


