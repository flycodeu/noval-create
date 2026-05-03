const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/styles/global.css');
let content = fs.readFileSync(filePath, 'utf8');

// Remove [data-theme="soft"] blocks
content = content.replace(/\[data-theme="soft"\]\s*\{[\s\S]*?\}/g, '/* removed soft theme */');
content = content.replace(/html\[data-theme="soft"\][\s\S]*?\{[\s\S]*?\}/g, '/* removed soft theme */');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Cleaned up soft theme references in global.css');
