const { execSync } = require('child_process');
const path = require('path');

// Change to the directory where this script is located (project root)
process.chdir(__dirname);

// Run TypeScript compiler
try {
  execSync('npx tsc --project tsconfig.main.json', { 
    stdio: 'inherit',
    cwd: __dirname 
  });
  process.exit(0);
} catch (error) {
  process.exit(1);
}

