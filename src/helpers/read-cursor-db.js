#!/usr/bin/env node
/**
 * Helper script to read Cursor's SQLite database
 * Runs in Node.js (not Electron) to avoid native module issues
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const workspacePath = process.argv[2];

if (!workspacePath) {
  console.error(JSON.stringify({ error: 'Workspace path required' }));
  process.exit(1);
}

try {
  const dbPath = path.join(
    process.env.APPDATA || os.homedir(),
    'Cursor',
    'User',
    'globalStorage',
    'state.vscdb'
  );

  if (!fs.existsSync(dbPath)) {
    console.log(JSON.stringify({ aiEditedFiles: [] }));
    process.exit(0);
  }

  const db = new Database(dbPath, { readonly: true });
  const result = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('aiCodeTrackingLines');
  db.close();

  if (!result) {
    console.log(JSON.stringify({ aiEditedFiles: [] }));
    process.exit(0);
  }

  const aiTracking = JSON.parse(result.value);
  const aiFiles = aiTracking
    .map((item) => item.metadata?.fileName)
    .filter(Boolean)
    .map((filePath) => {
      // Normalize path (remove file:// prefix, convert to relative)
      let normalized = filePath.replace(/^file:\/\/\//, '').replace(/^\/([a-z]):/i, '$1:');
      normalized = normalized.replace(/\//g, '\\');

      // Convert to relative path if it's under workspace
      if (normalized.toLowerCase().startsWith(workspacePath.toLowerCase())) {
        normalized = normalized.substring(workspacePath.length + 1);
      }
      return normalized;
    });

  console.log(JSON.stringify({ aiEditedFiles: [...new Set(aiFiles)] }));
  process.exit(0);
} catch (error) {
  console.error(JSON.stringify({ error: error.message }));
  process.exit(1);
}
