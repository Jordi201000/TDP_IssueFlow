import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from './roles.guard';

function makeCtx(user: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class Cls {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(required: Role[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows when no @Roles set', () => {
    expect(
      makeGuard(undefined).canActivate(makeCtx({ role: Role.DEVELOPER })),
    ).toBe(true);
  });

  it('allows when @Roles array is empty', () => {
    expect(makeGuard([]).canActivate(makeCtx({ role: Role.DEVELOPER }))).toBe(true);
  });

  it('allows when user role is in the required list', () => {
    expect(
      makeGuard([Role.ADMIN]).canActivate(makeCtx({ role: Role.ADMIN })),
    ).toBe(true);
  });

  it('throws ForbiddenException when user role is not in the required list', () => {
    expect(() =>
      makeGuard([Role.ADMIN]).canActivate(makeCtx({ role: Role.DEVELOPER })),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when no user is present on the request', () => {
    expect(() =>
      makeGuard([Role.ADMIN]).canActivate(makeCtx(undefined)),
    ).toThrow(ForbiddenException);
  });
});
