// Find character records by anchoring on the role string (e.g., "roman general", "roman captain", etc.)
// Then look at the preceding bytes which contain UUIDs.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T3 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 3.sav'));
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// Find ASCII pstr16 strings starting with "roman " — these are character role strings
function findRoleStrings(buf) {
  const positions = [];
  // Possible roles: "roman general", "roman captain", "roman diplomat", "roman spy",
  // "roman assassin", "roman princess", "roman merchant", etc.
  const roles = ['general', 'captain', 'diplomat', 'spy', 'assassin', 'princess', 'merchant', 'admiral'];
  for (const role of roles) {
    const target = Buffer.from('roman ' + role + '\0', 'ascii');
    let p = 0;
    while (true) {
      const idx = buf.indexOf(target, p);
      if (idx === -1) break;
      positions.push({ off: idx, role });
      p = idx + 1;
    }
  }
  return positions;
}

const t3roles = findRoleStrings(T3);
const t4roles = findRoleStrings(T4);
console.log('T3 role strings: ' + t3roles.length);
console.log('T4 role strings: ' + t4roles.length + ' (diff=' + (t4roles.length - t3roles.length) + ')');

// Each role string is preceded by: ...UUIDs... unit_uuid 00 00 00 00 ... [length u16][role string]
// And followed by region UTF-16 name + more data
// The character UUID is at offset role_string - 4 (BodyguardUuid) or further back.

// Show context for first few in T3 and T4
console.log('\nFirst 3 T3 roles:');
for (const r of t3roles.slice(0, 3)) {
  console.log('\n  role "' + r.role + '" @ 0x' + r.off.toString(16) + ':');
  // Show 32 bytes before (UUIDs?) and 32 bytes after (region etc)
  for (let j = -32; j <= 64; j += 16) {
    const hex = Array.from(T3.slice(r.off + j, r.off + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T3.slice(r.off + j, r.off + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    const mark = j === 0 ? '  ← role' : '';
    console.log('    ' + (j >= 0 ? '+' : '') + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|' + mark);
  }
}

// Now find characters with role "roman princess" in T4 — these would be married daughters or unmarried daughters
const t3princess = t3roles.filter(r => r.role === 'princess');
const t4princess = t4roles.filter(r => r.role === 'princess');
console.log('\n\nT3 princesses: ' + t3princess.length);
console.log('T4 princesses: ' + t4princess.length);
for (const r of t3princess.slice(0, 5)) console.log('  T3 princess @ 0x' + r.off.toString(16));
for (const r of t4princess.slice(0, 5)) console.log('  T4 princess @ 0x' + r.off.toString(16));

// Diff each T3 princess with T4 princess (if order matches)
console.log('\n\n=== Per-princess byte diff (T3 vs T4) ===');
for (let i = 0; i < Math.min(t3princess.length, t4princess.length); i++) {
  const o3 = t3princess[i].off;
  const o4 = t4princess[i].off;
  let diffs = 0;
  const diffList = [];
  for (let j = -100; j < 200; j++) {
    const v3 = T3[o3 + j];
    const v4 = T4[o4 + j];
    if (v3 !== v4) {
      diffs++;
      if (diffList.length < 30) diffList.push({ rel: j, t3: v3, t4: v4 });
    }
  }
  console.log('\n  princess ' + i + ' T3@0x' + o3.toString(16) + ' T4@0x' + o4.toString(16) + ' diffs=' + diffs);
  for (const d of diffList) {
    console.log('    +' + d.rel.toString().padStart(4) + ': T3=0x' + d.t3.toString(16).padStart(2, '0') + ' T4=0x' + d.t4.toString(16).padStart(2, '0'));
  }
}
