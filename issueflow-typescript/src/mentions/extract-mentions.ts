/**
 * Extracts @username tokens from a comment body.
 * - Lookbehind blocks email-like strings (`bob@example.com` won't match `@example`).
 * - Charset + length match CreateUserDto.username.
 * - Returns lowercase, deduplicated, first-occurrence order.
 */
const MENTION_RE = /(?<![\w@])@([a-zA-Z0-9_-]{3,32})/g;

export function extractMentions(content: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const m of content.matchAll(MENTION_RE)) {
    const lower = m[1].toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      order.push(lower);
    }
  }
  return order;
}
