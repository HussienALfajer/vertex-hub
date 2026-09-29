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
  'CLIENT_NAME_TAKEN',
  'INVALID_ACCOUNT_MANAGER',
  'CLIENT_ARCHIVED',
  'CLIENT_NOT_ARCHIVED',
  'LIMIT_REACHED',
  'UNKNOWN_CONTACT',
  'NOT_NOTE_AUTHOR',
  'NOTE_ARCHIVED',
  'CLIENT_ENDED',
  'INVALID_PROJECT_MANAGER',
  'INVALID_DATES',
  'PROJECT_NAME_TAKEN',
  'PROJECT_CLOSED',
  'PROJECT_ARCHIVED',
  'PROJECT_NOT_ARCHIVED',
  'CURRENCY_LOCKED',
  'INVALID_TRANSITION',
  'MILESTONES_OPEN',
  'INVALID_ORDER',
  'MILESTONE_DONE',
  'MILESTONE_NOT_DONE',
  'MILESTONE_HAS_OPEN_TASKS',
  'RETAINER_NAME_TAKEN',
  'RETAINER_ENDED',
  'RETAINER_ARCHIVED',
  'RETAINER_NOT_ARCHIVED',
  'RETAINER_STARTED',
  'DUPLICATE_DELIVERABLE',
  'CYCLE_CLOSED',
  'NEGATIVE_DELIVERED',
  'BILLING_NOTE_REQUIRED',
  'ASSIGNEE_REQUIRED',
  'INVALID_ASSIGNEE',
  'TASK_BLOCKED',
  'INVALID_DEPENDENCY',
  'DEPENDENCY_CYCLE',
  'INVALID_LINK',
  'NO_ENGAGEMENT',
  'EXTRA_WORK_BILLED',
  'NOT_OVER_LIMIT',
  'ALREADY_DECIDED',
  'INVALID_MENTION',
  'NOT_COMMENT_AUTHOR',
  'TASK_ARCHIVED',
  'TASK_NOT_ARCHIVED',
  'TASKS_OPEN',
  'TEMPLATE_NAME_TAKEN',
  'TEMPLATE_ARCHIVED',
  'TEMPLATE_NOT_ARCHIVED',
  'TEMPLATE_KIND_MISMATCH',
  'TEMPLATE_NOT_LINKED',
  'NO_TEMPLATE',
  'NO_REPEATED_STEP',
  'NOTHING_MISSING',
  'ALREADY_GENERATED',
  'NOT_MUTABLE',
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

/**
 * Something a user is responsible for, which blocks archiving them (F01 rule 9, F05 rule 4, F06) or
 * removing their Account Manager role (F02 rule 8).
 */
export const responsibilitySchema = z
  .object({
    type: z.enum([
      'manages_department',
      'account_manager_of_client',
      'project_manager_of_project',
      'assignee_of_open_tasks',
    ]),
    id: z.uuid(),
    name: z.string(),
  })
  .meta({ id: 'Responsibility' });

export type Responsibility = z.infer<typeof responsibilitySchema>;
