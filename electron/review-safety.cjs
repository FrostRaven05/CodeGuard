function sensitive(text) {
  return /-----BEGIN [\w ]*PRIVATE KEY-----|(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["'][^"'\s]{12,}["']|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/i.test(
    text.replaceAll('\\"', '"'),
  );
}

function excluded(relative, patterns) {
  const name = relative.replaceAll('\\', '/');
  if (
    /(^|\/)(?:\.env[^/]*|\.git|\.ssh|\.aws|\.gnupg|\.azure|\.?secrets|\.npmrc|\.pypirc|\.netrc|\.git-credentials|node_modules|dist|build|coverage|vendor|\.venv|target|__pycache__)(\/|$)/i.test(
      name,
    ) ||
    /(?:^|\/)(?:id_rsa[^/]*|id_ed25519[^/]*|credentials[^/]*|secrets?\.[^/]+)$|\.(?:pem|key|p12|pfx|keystore|lock|min\.js|map)$/i.test(
      name,
    )
  )
    return true;
  return patterns
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .some((pattern) => {
      const normalized = pattern.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
      if (!normalized) return false;
      const escaped = normalized
        .split(/(\*\*\/|\*\*|\*|\?)/)
        .map((part) =>
          part === '**/'
            ? '(?:.*/)?'
            : part === '**'
              ? '.*'
              : part === '*'
                ? '[^/]*'
                : part === '?'
                  ? '[^/]'
                  : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        )
        .join('');
      return new RegExp(`(?:^|/)${escaped}(?:$|/)`, 'i').test(name);
    });
}

module.exports = { sensitive, excluded };
