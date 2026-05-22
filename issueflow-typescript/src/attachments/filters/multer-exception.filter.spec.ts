import {
  ArgumentsHost,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { MulterError } from 'multer';
import { MulterExceptionFilter } from './multer-exception.filter';

describe('MulterExceptionFilter', () => {
  const filter = new MulterExceptionFilter();
  const host = {} as ArgumentsHost;

  it('translates LIMIT_FILE_SIZE → PayloadTooLargeException', () => {
    const err = new MulterError('LIMIT_FILE_SIZE');
    expect(() => filter.catch(err, host)).toThrow(PayloadTooLargeException);
  });

  it('translates other MulterError → BadRequestException', () => {
    const err = new MulterError('LIMIT_UNEXPECTED_FILE', 'extra');
    expect(() => filter.catch(err, host)).toThrow(BadRequestException);
  });
});
