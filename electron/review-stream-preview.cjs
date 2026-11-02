// Extract only complete public result fields from an unfinished JSON object.
// Incomplete strings/objects, raw JSON and provider reasoning never leave the main process.
function valueEnd(source, start) {
  const first = source[start];
  if (!first) return -1;
  let quoted = first === '"',
    escaped = false;
  const stack = first === '{' || first === '[' ? [first] : [];
  if (!quoted && !stack.length) {
    const end = source.slice(start).search(/[,}\]]/);
    return end < 0 ? -1 : start + end;
  }
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        quoted = false;
        if (!stack.length) return index + 1;
      }
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) return -1;
      if (!stack.length) return index + 1;
    }
  }
  return -1;
}

function reviewStreamPreview(content) {
  const source = content.trimStart().replace(/^```(?:json)?\s*/i, '');
  const result = { summary: '', findings: [] };
  if (source[0] !== '{') return result;
  let index = 1;
  const skip = () => {
    while (/\s/.test(source[index] || '') && index < source.length) index++;
  };
  try {
    while (index < source.length) {
      skip();
      if (source[index] !== '"') break;
      const endKey = valueEnd(source, index);
      if (endKey < 0) break;
      const key = JSON.parse(source.slice(index, endKey));
      index = endKey;
      skip();
      if (source[index++] !== ':') break;
      skip();
      if (key === 'findings' && source[index] === '[') {
        index++;
        for (;;) {
          skip();
          if (source[index] === ']') {
            index++;
            break;
          }
          const end = valueEnd(source, index);
          if (end < 0) return result;
          const finding = JSON.parse(source.slice(index, end));
          if (finding && typeof finding === 'object' && !Array.isArray(finding))
            result.findings.push(finding);
          if (result.findings.length >= 100) return result;
          index = end;
          skip();
          if (source[index] !== ',') {
            if (source[index] === ']') {
              index++;
              break;
            }
            return result;
          }
          index++;
        }
      } else {
        const end = valueEnd(source, index);
        if (end < 0) break;
        if (key === 'summary') {
          const summary = JSON.parse(source.slice(index, end));
          if (typeof summary === 'string' && summary.length <= 6000) result.summary = summary;
        }
        index = end;
      }
      skip();
      if (source[index] !== ',') break;
      index++;
    }
  } catch {
    /* Invalid output is rejected by the final result validator. */
  }
  return result;
}

module.exports = { reviewStreamPreview };
