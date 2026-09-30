import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { ErrorCode } from '@vertex-hub/contracts';
import { CodedException } from './index.js';

/** The unique indexes behind a "name taken" check, and the code the check itself answers. */
const UNIQUE_CODES: Record<string, ErrorCode> = {
  users_email_unique: 'EMAIL_TAKEN',
  departments_name_unique: 'DEPARTMENT_NAME_TAKEN',
  clients_trade_name_idx: 'CLIENT_NAME_TAKEN',
  projects_client_name_idx: 'PROJECT_NAME_TAKEN',
  retainers_client_name_idx: 'RETAINER_NAME_TAKEN',
  retainer_deliverables_kind_label_idx: 'DUPLICATE_DELIVERABLE',
  retainer_cycle_lines_kind_label_idx: 'DUPLICATE_DELIVERABLE',
  work_templates_name_idx: 'TEMPLATE_NAME_TAKEN',
  template_runs_one_full_run_idx: 'ALREADY_GENERATED',
  file_items_name_unique: 'FILE_NAME_TAKEN',
};

/** PostgreSQL codes of a write that lost a race: unique violation, deadlock, serialization. */
const UNIQUE_VIOLATION = '23505';
const RACE_CODES = new Set(['40P01', '40001']);

interface PgError {
  code: string;
  constraint?: string;
}

/** The PostgreSQL error behind `error`, which Drizzle wraps as its `cause`. */
function pgErrorOf(error: unknown): PgError | null {
  for (let current = error, depth = 0; current && depth < 3; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      };
    }
    current = candidate.cause;
  }
  return null;
}

/**
 * The coded error for a database error that two concurrent requests can cause (ADR 0013): the
 * code the service's own check gives when it wins the race, else `CONCURRENT_CHANGE`, which asks
 * the user to try again. Null for any other error.
 */
export function codedDatabaseError(error: unknown): CodedException | null {
  const pg = pgErrorOf(error);
  if (!pg) return null;
  if (pg.code === UNIQUE_VIOLATION) {
    const code = (pg.constraint && UNIQUE_CODES[pg.constraint]) || 'CONCURRENT_CHANGE';
    return new CodedException(409, code, 'The record changed at the same time');
  }
  if (RACE_CODES.has(pg.code)) {
    return new CodedException(409, 'CONCURRENT_CHANGE', 'The record changed at the same time');
  }
  return null;
}

/** Answers database race errors with their coded 409; everything else as Nest does. */
@Catch()
export class DatabaseErrorFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const coded = exception instanceof HttpException ? null : codedDatabaseError(exception);
    super.catch(coded ?? exception, host);
  }
}
