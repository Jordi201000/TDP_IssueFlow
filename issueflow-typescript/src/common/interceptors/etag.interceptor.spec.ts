import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { EtagInterceptor } from './etag.interceptor';

function makeCtx(): { ctx: ExecutionContext; setHeader: jest.Mock } {
  const setHeader = jest.fn();
  const response = { setHeader };
  const ctx = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { ctx, setHeader };
}

function makeHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('EtagInterceptor', () => {
  const interceptor = new EtagInterceptor();

  it('sets ETag when response has a numeric version', async () => {
    const { ctx, setHeader } = makeCtx();
    const data = { id: 1, title: 'x', version: 3 };
    const result = await lastValueFrom(
      interceptor.intercept(ctx, makeHandler(data)),
    );
    expect(setHeader).toHaveBeenCalledWith('ETag', '"3"');
    expect(result).toBe(data);
  });

  it('does not set ETag when response lacks a numeric version', async () => {
    const { ctx, setHeader } = makeCtx();
    await lastValueFrom(
      interceptor.intercept(ctx, makeHandler({ id: 1, title: 'x' })),
    );
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('does not set ETag on null/undefined responses', async () => {
    const { ctx, setHeader } = makeCtx();
    await lastValueFrom(interceptor.intercept(ctx, makeHandler(null)));
    await lastValueFrom(interceptor.intercept(ctx, makeHandler(undefined)));
    expect(setHeader).not.toHaveBeenCalled();
  });
});
