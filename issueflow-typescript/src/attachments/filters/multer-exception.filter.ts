import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { MulterError } from 'multer';

@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    if (exception.code === 'LIMIT_FILE_SIZE') {
      throw new PayloadTooLargeException('File exceeds 10 MB limit');
    }
    throw new BadRequestException(`Upload error: ${exception.message}`);
  }
}
