import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ObservedErrorService } from './observed-error.service';

type HttpReply = {
  status: (code: number) => { json: (body: unknown) => void };
};

type HttpRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  user?: { userId?: string };
};

@Catch()
export class ObservedExceptionFilter implements ExceptionFilter {
  constructor(private readonly observed: ObservedErrorService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpReply>();
    const request = ctx.getRequest<HttpRequest>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const message = exception instanceof Error ? exception.message : 'خطای داخلی سرور';
    const stack = exception instanceof Error ? exception.stack ?? exception.message : String(exception);
    const path = `${request.method ?? ''} ${request.originalUrl ?? request.url ?? ''}`.trim();

    if (status >= 500) {
      void this.observed.record({
        purpose: 'backend',
        statusCode: status,
        userId: request.user?.userId ?? null,
        message,
        detail: `${path}\n${stack}`.slice(0, 20000),
      });
    }

    const payload =
      body && typeof body === 'object'
        ? body
        : {
            statusCode: status,
            message: typeof body === 'string' ? body : status >= 500 ? 'خطای داخلی سرور' : message,
          };
    response.status(status).json(payload);
  }
}
