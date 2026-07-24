function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits `text` into segments around case-insensitive matches of `query`,
 * so a caller can render matched substrings differently (e.g. wrapped in
 * <mark>). Returns [{ text, matched }] - the whole string as one
 * unmatched segment when query is empty or has no match.
 */
export function splitByMatch(text, query) {
  if (!query || !query.trim()) {
    return [{ text, matched: false }];
  }
  const parts = text.split(new RegExp(`(${escapeRegExp(query.trim())})`, 'gi'));
  return parts.filter((part) => part.length > 0).map((part) => ({
    text: part,
    matched: part.toLowerCase() === query.trim().toLowerCase(),
  }));
}
