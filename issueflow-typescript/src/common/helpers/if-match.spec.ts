import { BadRequestException } from '@nestjs/common';
import { parseIfMatch } from './if-match';

describe('parseIfMatch', () => {
  it('returns undefined when header is missing', () => {
    expect(parseIfMatch(undefined)).toBeUndefined();
  });

  it('parses a quoted integer', () => {
    expect(parseIfMatch('"5"')).toBe(5);
    expect(parseIfMatch('"0"')).toBe(0);
    expect(parseIfMatch('"42"')).toBe(42);
  });

  it('rejects unquoted integers', () => {
    expect(() => parseIfMatch('5')).toThrow(BadRequestException);
  });

  it('rejects an empty string', () => {
    expect(() => parseIfMatch('')).toThrow(BadRequestException);
  });

  it('rejects non-numeric quoted strings', () => {
    expect(() => parseIfMatch('"abc"')).toThrow(BadRequestException);
  });

  it('rejects extra characters around the quoted integer', () => {
    expect(() => parseIfMatch('"5" extra')).toThrow(BadRequestException);
  });
});
