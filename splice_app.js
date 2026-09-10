const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, 'app.js');
const vaultAppPath = path.join('C:', 'Users', 'abhay', '.gemini', 'antigravity-ide', 'brain', '41c665de-d9b3-4096-9ddb-54d7ebf09b72', 'scratch', 'vault_app.js');

let appJs = fs.readFileSync(appJsPath, 'utf8');
const vaultApp = fs.readFileSync(vaultAppPath, 'utf8');

const lines = appJs.split(/\r?\n/);

// Find the start of the vault section
const startIdx = lines.findIndex(line => line.includes('DOCUMENT VAULT BACKEND INTEGRATION'));

if (startIdx !== -1) {
  // We want to replace everything from startIdx - 1 (the comment border) to the end of the file
  lines.splice(startIdx - 1, lines.length - startIdx + 1, vaultApp);
} else {
  console.error("Could not find the bounds for the vault JS section");
  process.exit(1);
}

// Join the lines back
appJs = lines.join('\n');

fs.writeFileSync(appJsPath, appJs, 'utf8');
console.log('Successfully updated app.js');
