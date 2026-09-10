const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, 'index.html');
const vaultNewPath = path.join('C:', 'Users', 'abhay', '.gemini', 'antigravity-ide', 'brain', '41c665de-d9b3-4096-9ddb-54d7ebf09b72', 'scratch', 'vault_new.html');
const modalsNewPath = path.join('C:', 'Users', 'abhay', '.gemini', 'antigravity-ide', 'brain', '41c665de-d9b3-4096-9ddb-54d7ebf09b72', 'scratch', 'modals_new.html');

let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const vaultNew = fs.readFileSync(vaultNewPath, 'utf8');
const modalsNew = fs.readFileSync(modalsNewPath, 'utf8');

const lines = indexHtml.split(/\r?\n/);

// Find <main class="content" id="documentsPage"> (around line 541)
const startIdx = lines.findIndex(line => line.includes('<main class="content" id="documentsPage">'));
// Find the closing </main> for documentsPage (around line 1156)
let endIdx = -1;
for (let i = startIdx + 1; i < lines.length; i++) {
  if (lines[i].includes('</main>')) {
    endIdx = i;
    break;
  }
}

console.log('Start index:', startIdx, 'End index:', endIdx);

if (startIdx !== -1 && endIdx !== -1) {
  // Replace the vault section
  lines.splice(startIdx, endIdx - startIdx + 1, vaultNew);
} else {
  console.error("Could not find the bounds for the vault main section");
  process.exit(1);
}

// Join the lines back
indexHtml = lines.join('\n');

// Inject the modals before </body>
indexHtml = indexHtml.replace('</body>', modalsNew + '\n</body>');

fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
console.log('Successfully updated index.html');
