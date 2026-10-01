import { is } from 'drizzle-orm';
import { getTableConfig, PgTable, PgTimestamp } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema/index.js';

/*
 * Guards for the data conventions in docs/architecture.md and ADR 0013, applied to every table.
 * A failure here means a schema breaks a project rule: fix the schema, or change the ADR.
 */

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableConfig(table));

/**
 * Tables that are not business records, so they skip the business columns (archived_at and
 * timestamps). Every entry needs a reason.
 */
const NOT_BUSINESS_RECORDS: Record<string, string> = {
  sessions: 'Better Auth table',
  accounts: 'Better Auth table',
  verifications: 'Better Auth table',
  two_factors: 'Better Auth table',
  user_roles: 'Link table; a role is granted or revoked, never archived',
  department_members: 'Link table; a membership is added or removed, never archived',
  audit_entries: 'Append-only log; rows are never updated or archived',
  worker_heartbeats: 'System data written by the worker',
  retainer_cycles: 'A month of a retainer; never archived on its own, it goes with its retainer',
  retainer_cycle_lines: 'Part of its cycle; a line is never removed from a month (F05 R10)',
  retainer_cycle_adjustments: 'Append-only; corrected by a new adjustment (F05 R7)',
  task_dependencies: 'Link table; a dependency is added or removed, never archived (F06)',
  task_revisions: 'Append-only; never archived, an over-limit decision is set once (F06 rule 10)',
  task_reviews: 'Append-only review history with its snapshots; never edited or archived (F09)',
  task_client_responses: 'Append-only; a client decision is final and never archived (F09)',
  post_reviews: 'Append-only review history with its snapshots; never edited or archived (F08)',
  post_client_responses: 'Append-only; a client decision is final and never archived (F08)',
  approval_requests: 'Revoked, never archived (F09, ADR 0020)',
  approval_items: 'Part of its request; decided or withdrawn, never archived (F09)',
  work_template_stages: 'Part of its template document; replaced when the template is saved (F07)',
  work_template_steps: 'Part of its template document; replaced when the template is saved (F07)',
  work_template_step_dependencies: 'Link table inside a template document (F07)',
  work_template_assignees: 'Link table; a default assignee is set or cleared (F07)',
  retainer_templates: 'Link table; linking and unlinking are audited on the retainer (F07)',
  template_runs: 'Append-only; runs are never edited or archived (F07)',
  template_run_tasks: 'Append-only link between a run and the tasks it created (F07)',
  notifications: 'Personal, not a business record: purged after reading, never archived (F14)',
  notification_settings: 'Personal mute settings, one row per user (F14)',
  notification_reminders: 'Idempotency keys of the daily job, insert-only (F14 rule 8)',
  file_uploads: 'Temporary: deleted when attached or purged after 24 hours (F10)',
};

/** Tables keyed by a natural value instead of a UUIDv7 `id`. Every entry needs a reason. */
const NATURAL_KEYS: Record<string, string> = {
  worker_heartbeats: 'One row per worker name, upserted',
  retainer_templates: 'One row per retainer, keyed by the retainer (F07)',
  notification_settings: 'One row per user, keyed by the user (F14)',
};

describe('database conventions', () => {
  it('finds the tables it checks', () => {
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['users', 'worker_heartbeats']),
    );
  });

  it('lists only existing tables as exceptions', () => {
    const names = new Set(tables.map((table) => table.name));
    const stale = [...Object.keys(NOT_BUSINESS_RECORDS), ...Object.keys(NATURAL_KEYS)].filter(
      (name) => !names.has(name),
    );
    expect(stale).toEqual([]);
  });

  it('keys single-column primary keys on a UUID `id`', () => {
    const offenders = tables
      .filter((table) => !(table.name in NATURAL_KEYS) && table.primaryKeys.length === 0)
      .filter((table) => {
        const primary = table.columns.filter((column) => column.primary);
        return (
          primary.length !== 1 || primary[0]?.name !== 'id' || primary[0].columnType !== 'PgUUID'
        );
      })
      .map((table) => table.name);
    expect(offenders).toEqual([]);
  });

  it('gives every business table created_at, updated_at and archived_at', () => {
    const required = ['created_at', 'updated_at', 'archived_at'];
    const offenders = tables
      .filter((table) => !(table.name in NOT_BUSINESS_RECORDS))
      .flatMap((table) =>
        required
          .filter((name) => !table.columns.some((column) => column.name === name))
          .map((name) => `${table.name}.${name}`),
      );
    expect(offenders).toEqual([]);
  });

  it('stores every timestamp with a time zone', () => {
    const offenders = tables.flatMap((table) =>
      table.columns
        .filter((column) => is(column, PgTimestamp) && !column.withTimezone)
        .map((column) => `${table.name}.${column.name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('never uses floating-point columns (money is integer minor units, ADR 0006)', () => {
    const offenders = tables.flatMap((table) =>
      table.columns
        .filter((column) => ['PgReal', 'PgDoublePrecision'].includes(column.columnType))
        .map((column) => `${table.name}.${column.name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('indexes every foreign key (PostgreSQL does not do it automatically)', () => {
    const offenders = tables.flatMap((table) => {
      const leading = [
        ...table.indexes.map((index) =>
          index.config.columns.map((column) => ('name' in column ? column.name : '')),
        ),
        ...table.primaryKeys.map((key) => key.columns.map((column) => column.name)),
        ...table.uniqueConstraints.map((constraint) =>
          constraint.columns.map((column) => column.name),
        ),
        ...table.columns
          .filter((column) => column.primary || column.isUnique)
          .map((column) => [column.name]),
      ];
      return table.foreignKeys
        .map((key) => key.reference().columns.map((column) => column.name))
        .filter(
          (columns) => !leading.some((indexed) => columns.every((name, i) => indexed[i] === name)),
        )
        .map((columns) => `${table.name}(${columns.join(', ')})`);
    });
    expect(offenders).toEqual([]);
  });
});
