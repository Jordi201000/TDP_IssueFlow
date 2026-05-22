import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost(url = '/test', method = 'GET') {
  const jsonMock = jest.fn();
  const statusMock = jest.fn(() => ({ json: jsonMock }));
  const response = { status: statusMock };
  const request = { url, method };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, statusMock, jsonMock };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('maps a standard HttpException to the uniform shape', () => {
    const { host, statusMock, jsonMock } = makeHost('/foo');
    filter.catch(new HttpException('something broke', 418), host);

    expect(statusMock).toHaveBeenCalledWith(418);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 418,
        error: 'HttpException',
        message: 'something broke',
        path: '/foo',
      }),
    );
    expect(jsonMock.mock.calls[0][0].timestamp).toEqual(expect.any(String));
  });

  it('extracts a validation array into the details field', () => {
    const { host, jsonMock } = makeHost();
    const exception = new BadRequestException({
      statusCode: 400,
      message: ['email must be an email', 'username should not be empty'],
      error: 'Bad Request',
    });
    filter.catch(exception, host);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'BadRequestException',
        message: 'Validation failed',
        details: ['email must be an email', 'username should not be empty'],
      }),
    );
  });

  it('returns 500 with InternalServerError for unknown errors', () => {
    const { host, statusMock, jsonMock } = makeHost('/boom');
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    filter.catch(new Error('kaboom'), host);
    process.env.NODE_ENV = prevEnv;

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        error: 'InternalServerError',
        message: 'kaboom',
        path: '/boom',
      }),
    );
  });

  it('redacts internal error messages in production', () => {
    const { host, jsonMock } = makeHost();
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    filter.catch(new Error('sensitive detail'), host);
    process.env.NODE_ENV = prevEnv;

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
  });
});
