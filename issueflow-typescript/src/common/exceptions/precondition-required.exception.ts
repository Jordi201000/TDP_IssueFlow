import { HttpException } from '@nestjs/common';

export class PreconditionRequiredException extends HttpException {
  constructor(message = 'Precondition Required') {
    super(message, 428);
  }
}
