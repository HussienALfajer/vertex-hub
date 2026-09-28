import { z } from 'zod';

/**
 * Codes the API puts on errors the UI must tell apart (ADR 0013). The web app shows the
 * translation of `errors.<code>`; the server message is English and never shown.
 */
export const ERROR_CODES = [
  'TWO_FACTOR_REQUIRED',
  'EMAIL_TAKEN',
  'GENERAL_MANAGER_ONLY',
  'LAST_GENERAL_MANAGER',
  'CANNOT_ARCHIVE_SELF',
  'USER_HAS_RESPONSIBILITIES',
  'USER_ARCHIVED',
  'USER_NOT_ARCHIVED',
  'PRIMARY_DEPARTMENT_REQUIRED',
  'UNKNOWN_DEPARTMENT',
  'MANAGER_NOT_MEMBER',
  'MANAGER_MEMBERSHIP_REQUIRED',
  'DEPARTMENT_NAME_TAKEN',
  'LINK_INVALID',
] as const;

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
    /** Extra data for some codes, e.g. `responsibilitySchema[]` for `USER_HAS_RESPONSIBILITIES`. */
    details: z.unknown().optional(),
  })
  .meta({ id: 'ErrorResponse', description: 'An error; `code` tells errors apart' });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Something a user is responsible for, which blocks archiving them (F01 rule 9). */
export const responsibilitySchema = z
  .object({
    type: z.enum(['manages_department']),
    id: z.uuid(),
    name: z.string(),
  })
  .meta({ id: 'Responsibility' });

export type Responsibility = z.infer<typeof responsibilitySchema>;
