const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk(path.resolve(__dirname, '../src'));
let changedCount = 0;

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Replace <Input.TextArea ... rows={2} (or 3, 4) with rows={6}
  const newContent = content.replace(/(<Input\.TextArea[^>]*?)rows=\{[234]\}/g, '$1rows={6}');
  
  if (newContent !== content) {
    fs.writeFileSync(file, newContent, 'utf8');
    changedCount++;
  }
});

console.log(`Updated Input.TextArea rows in ${changedCount} files.`);
