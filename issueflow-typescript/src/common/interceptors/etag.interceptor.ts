import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * When the handler returns an entity carrying a numeric `version`, set the
 * `ETag: "<version>"` response header. Runs before the global
 * ClassSerializerInterceptor strips `@Exclude()`-marked fields.
 */
@Injectable()
export class EtagInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap((data: unknown) => {
        const version = (data as { version?: unknown } | null)?.version;
        if (typeof version === 'number') {
          res.setHeader('ETag', `"${version}"`);
        }
      }),
    );
  }
}
