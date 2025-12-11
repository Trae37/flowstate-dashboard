const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'flowstate-dashboard',
  'flowstate.db'
);

console.log('Database path:', dbPath);

const db = new Database(dbPath, { readonly: true });

// Count total assets
const totalAssets = db.prepare('SELECT COUNT(*) as count FROM assets').get();
console.log('\nTotal assets in database:', totalAssets.count);

// Count captures with assets
const capturesWithAssets = db.prepare(`
  SELECT COUNT(DISTINCT capture_id) as count
  FROM assets
`).get();
console.log('Captures with assets:', capturesWithAssets.count);

// Show sample of captures with asset counts
const sampleCaptures = db.prepare(`
  SELECT
    c.id,
    c.name,
    c.created_at,
    COUNT(a.id) as asset_count
  FROM captures c
  LEFT JOIN assets a ON c.id = a.capture_id
  GROUP BY c.id
  ORDER BY c.created_at DESC
  LIMIT 20
`).all();

console.log('\nSample of recent captures:');
console.log('ID\tAssets\tName\t\t\t\tCreated');
sampleCaptures.forEach(cap => {
  console.log(`${cap.id}\t${cap.asset_count}\t${cap.name.substring(0, 30)}\t${cap.created_at}`);
});

db.close();
