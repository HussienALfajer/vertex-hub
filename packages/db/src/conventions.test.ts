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
};

/** Tables keyed by a natural value instead of a UUIDv7 `id`. Every entry needs a reason. */
const NATURAL_KEYS: Record<string, string> = {
  worker_heartbeats: 'One row per worker name, upserted',
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
