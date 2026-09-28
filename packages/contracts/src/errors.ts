import { z } from 'zod';

/**
 * Codes the API puts on errors the UI must tell apart (ADR 0013). The web app shows the
 * translation of `errors.<code>`; the server message is English and never shown.
 */
export const ERROR_CODES = ['TWO_FACTOR_REQUIRED'] as const;

export const errorCodeSchema = z.enum(ERROR_CODES).meta({ id: 'ErrorCode' });

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * The body of every error response (ADR 0013). The API's own errors carry `statusCode`;
 * Better Auth's (under /api/auth) carry `code` and `message` only.
 */
export const errorResponseSchema = z
  .object({
    statusCode: z.number().int().optional(),
    code: z.string().optional(),
    message: z.string(),
  })
  .meta({ id: 'ErrorResponse', description: 'An error; `code` tells errors apart' });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
