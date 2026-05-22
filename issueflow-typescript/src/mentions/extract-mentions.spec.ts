import { extractMentions } from './extract-mentions';

describe('extractMentions', () => {
  it('returns a single mention', () => {
    expect(extractMentions('hey @jdoe please look')).toEqual(['jdoe']);
  });

  it('preserves first-occurrence order and dedupes', () => {
    expect(extractMentions('@alice @bob @alice @charlie')).toEqual([
      'alice',
      'bob',
      'charlie',
    ]);
  });

  it('is case-insensitive and dedupes across cases', () => {
    expect(extractMentions('@JDoe vs @jdoe')).toEqual(['jdoe']);
  });

  it('skips email-like strings', () => {
    expect(extractMentions('contact bob@example.com')).toEqual([]);
  });

  it('rejects mentions shorter than 3 chars', () => {
    expect(extractMentions('@ab not enough')).toEqual([]);
  });

  it('caps mentions at 32 chars (matches matched, longer would still match prefix)', () => {
    const long = 'a'.repeat(50);
    // The regex matches up to 32 chars of the long name.
    expect(extractMentions(`@${long}`)).toEqual(['a'.repeat(32)]);
  });

  it('returns empty for content with no mentions', () => {
    expect(extractMentions('just some words')).toEqual([]);
    expect(extractMentions('')).toEqual([]);
  });

  it('parses mention at start of string', () => {
    expect(extractMentions('@jdoe please')).toEqual(['jdoe']);
  });
});
