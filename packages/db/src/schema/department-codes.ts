import { DEPARTMENT_CODES } from '@vertex-hub/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * The department codes (ADR 0014), in a file of their own: `users` points to its photo in
 * `images` (F01C), which points to projects and retainers, and those need the enum while they
 * load.
 */
export const departmentCodeEnum = pgEnum('department_code', DEPARTMENT_CODES);
