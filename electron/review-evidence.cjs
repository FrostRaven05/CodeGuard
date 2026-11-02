function diffLines(text) {
  const old = new Map(),
    fresh = new Map();
  let oldLine = 0,
    newLine = 0,
    inHunk = false;
  for (const row of text.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || row.startsWith('\\')) continue;
    if (row.startsWith('+')) fresh.set(newLine++, row.slice(1));
    else if (row.startsWith('-')) old.set(oldLine++, row.slice(1));
    else if (row.startsWith(' ')) {
      old.set(oldLine++, row.slice(1));
      fresh.set(newLine++, row.slice(1));
    }
  }
  return { old, new: fresh };
}

module.exports = { diffLines };
