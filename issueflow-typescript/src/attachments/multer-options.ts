import { UnsupportedMediaTypeException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { diskStorage } from 'multer';

export const ALLOWED_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'application/pdf',
  'text/plain',
]);

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const UPLOAD_ROOT = 'uploads';

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]/g, '_').slice(0, 200);
}

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

export const attachmentMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (req, _file, cb) => {
      const ticketId = (req.params as { ticketId?: string }).ticketId;
      const dir = path.join(UPLOAD_ROOT, String(ticketId ?? 'unknown'));
      mkdir(dir, { recursive: true })
        .then(() => cb(null, dir))
        .catch((err) => cb(err as Error, dir));
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}-${sanitizeFilename(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedMime(file.mimetype)) {
      cb(
        new UnsupportedMediaTypeException(
          `MIME type ${file.mimetype} is not allowed. Allowed: ${[...ALLOWED_MIME].join(', ')}`,
        ),
        false,
      );
      return;
    }
    cb(null, true);
  },
};
