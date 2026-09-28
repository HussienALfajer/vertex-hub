import { HttpException } from '@nestjs/common';
import type { ErrorCode, ErrorResponse } from '@vertex-hub/contracts';

/**
 * An error the UI tells apart by its code (ADR 0013). The body is `ErrorResponse`; the web app
 * shows the translation of `errors.<code>`, never `message`.
 */
export class CodedException extends HttpException {
  constructor(status: 400 | 403 | 404 | 409, code: ErrorCode, message: string, details?: unknown) {
    const body: ErrorResponse = { statusCode: status, code, message, details };
    super(body, status);
  }
}
