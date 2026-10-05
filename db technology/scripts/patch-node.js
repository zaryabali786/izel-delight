const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', '@angular', 'cli', 'src', 'utilities', 'node-version.js');

if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('^22.17.0')) {
    content = content.replace("const SUPPORTED_NODE_VERSIONS = '", "const SUPPORTED_NODE_VERSIONS = '^22.17.0 || ");
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('[patch-node] Added support for Node 22.17.x to Angular CLI.');
  }
}
