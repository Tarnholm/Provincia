/* Usage:
   node scripts/debug-json.js public/regions.json
   or: npm run debug:regions
*/
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'public', 'regions.json');
const src = fs.readFileSync(file, 'utf8');

function posToLineCol(text, pos) {
  let line = 1, col = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === '\n') { line++; col = 1; }
    else col++;
  }
  return { line, col };
}

try {
  JSON.parse(src);
  console.log('OK: JSON parses without errors:', file);
} catch (e) {
  console.error('ERROR parsing JSON:', e.message);
  const m = e.message.match(/position\s+(\d+)/i);
  const pos = m ? Number(m[1]) : null;
  if (pos != null) {
    const { line, col } = posToLineCol(src, pos);
    console.error(`At position ${pos} (line ${line}, column ${col})`);

    const lines = src.split(/\r?\n/);
    const start = Math.max(0, line - 6);
    const end = Math.min(lines.length, line + 5);
    console.log('\nContext:');
    for (let i = start; i < end; i++) {
      const prefix = (i + 1 === line) ? '>>' : '  ';
      console.log(prefix + String(i + 1).padStart(6) + ' | ' + lines[i]);
    }

    const errLine = lines[line - 1] || '';
    const caret = ' '.repeat(Math.max(0, col - 1)) + '^';
    console.log('\n' + errLine);
    console.log(caret);
  } else {
    console.error('Could not determine error position.');
  }
  process.exit(1);
}