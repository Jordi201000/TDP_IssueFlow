import { UnsupportedMediaTypeException } from '@nestjs/common';
import {
  ALLOWED_MIME,
  attachmentMulterOptions,
  isAllowedMime,
  sanitizeFilename,
} from './multer-options';

describe('isAllowedMime', () => {
  it.each(['image/png', 'image/jpeg', 'application/pdf', 'text/plain'])(
    'allows %s',
    (mime) => {
      expect(isAllowedMime(mime)).toBe(true);
    },
  );

  it.each(['application/zip', 'image/gif', 'video/mp4'])(
    'rejects %s',
    (mime) => {
      expect(isAllowedMime(mime)).toBe(false);
    },
  );
});

describe('sanitizeFilename', () => {
  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeFilename('hello world?.png')).toBe('hello_world_.png');
  });

  it('keeps dots and dashes', () => {
    expect(sanitizeFilename('my-file.v2.txt')).toBe('my-file.v2.txt');
  });

  it('truncates to 200 chars', () => {
    expect(sanitizeFilename('a'.repeat(300))).toHaveLength(200);
  });

  it('blocks path traversal characters', () => {
    // Slashes become underscores; dots are kept (harmless in a final segment).
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
  });
});

describe('attachmentMulterOptions.fileFilter', () => {
  const filter = attachmentMulterOptions.fileFilter!;

  it('passes allowed MIME through callback', (done) => {
    filter({} as never, { mimetype: 'image/png' } as Express.Multer.File, (err, accepted) => {
      expect(err).toBeNull();
      expect(accepted).toBe(true);
      done();
    });
  });

  it('rejects disallowed MIME with UnsupportedMediaTypeException', (done) => {
    filter({} as never, { mimetype: 'application/zip' } as Express.Multer.File, (err) => {
      expect(err).toBeInstanceOf(UnsupportedMediaTypeException);
      done();
    });
  });
});
