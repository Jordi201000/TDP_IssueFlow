import { BadRequestException } from '@nestjs/common';

/**
 * Parses an HTTP `If-Match` header into a numeric version.
 * - undefined → undefined (caller decides whether to require it)
 * - `"<n>"`   → n
 * - anything else → throws BadRequestException
 */
export function parseIfMatch(header: string | undefined): number | undefined {
  if (header === undefined) return undefined;
  const match = header.match(/^"(\d+)"$/);
  if (!match) {
    throw new BadRequestException(
      `Malformed If-Match header: ${JSON.stringify(header)}. Expected quoted integer like "1".`,
    );
  }
  return parseInt(match[1], 10);
}
