import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeCtx(): ExecutionContext {
  const handler = () => undefined;
  class Cls {}
  return {
    getHandler: () => handler,
    getClass: () => Cls,
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('bypasses authentication when @Public() metadata is present', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key) => (key === IS_PUBLIC_KEY ? true : undefined)),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(makeCtx())).toBe(true);
  });

  it('checks both handler and class for the metadata', () => {
    const getAllAndOverride = jest.fn().mockReturnValue(true);
    const reflector = { getAllAndOverride } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const ctx = makeCtx();

    guard.canActivate(ctx);

    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });

  it('delegates to AuthGuard.super when not public', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    // Stub the super.canActivate via prototype chain so we don't need a real JWT.
    const superProto = Object.getPrototypeOf(Object.getPrototypeOf(guard));
    const spy = jest
      .spyOn(superProto, 'canActivate')
      .mockReturnValueOnce('delegated' as unknown as boolean);

    const result = guard.canActivate(makeCtx());

    expect(result).toBe('delegated');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
