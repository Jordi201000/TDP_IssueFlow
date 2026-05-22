import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  timestamp: string;
  path: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toErrorBody(exception, request);

    if (body.statusCode >= 500) {
      this.logger.error(`${request.method} ${request.url}`, exception as Error);
    }

    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown, request: Request): ErrorBody {
    const timestamp = new Date().toISOString();
    const path = request.url;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const { message, details } = this.extractMessage(raw);
      return {
        statusCode: status,
        error: exception.constructor.name,
        message,
        ...(details !== undefined && { details }),
        timestamp,
        path,
      };
    }

    const isProd = process.env.NODE_ENV === 'production';
    const message =
      !isProd && exception instanceof Error
        ? exception.message
        : 'Internal server error';

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message,
      timestamp,
      path,
    };
  }

  private extractMessage(raw: unknown): { message: string; details?: unknown } {
    if (typeof raw === 'string') return { message: raw };
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const msg = obj.message;
      if (Array.isArray(msg)) {
        return { message: 'Validation failed', details: msg };
      }
      if (typeof msg === 'string') {
        return { message: msg };
      }
    }
    return { message: 'Error' };
  }
}
