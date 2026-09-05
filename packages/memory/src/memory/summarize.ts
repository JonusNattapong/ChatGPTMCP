const MAX_SUMMARY_CHARS = 1200;

export function summarizeContent(content: string) {
  const trimmed = content.trim();

  if (trimmed.length <= MAX_SUMMARY_CHARS) {
    return undefined;
  }

  const sentences = trimmed
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  const selected = sentences.slice(0, 5).join(' ');

  if (selected.length > 0) {
    return selected.length <= MAX_SUMMARY_CHARS
      ? selected
      : selected.slice(0, MAX_SUMMARY_CHARS).trim();
  }

  return trimmed.slice(0, MAX_SUMMARY_CHARS).trim();
}
