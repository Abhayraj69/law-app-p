const fs = require('fs');
const path = require('path');

const stylesCssPath = path.join(__dirname, 'styles.css');
const stylesNewPath = path.join('C:', 'Users', 'abhay', '.gemini', 'antigravity-ide', 'brain', '41c665de-d9b3-4096-9ddb-54d7ebf09b72', 'scratch', 'styles_new.css');

const stylesNew = fs.readFileSync(stylesNewPath, 'utf8');

fs.appendFileSync(stylesCssPath, '\n' + stylesNew, 'utf8');
console.log('Successfully appended styles to styles.css');
