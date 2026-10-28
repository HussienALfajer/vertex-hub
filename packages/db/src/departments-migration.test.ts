import { SYSTEM_DEPARTMENT_CODES } from '@vertex-hub/contracts';
import { asc, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import { departments } from './schema/index.js';

const connection = createDatabase(process.env.DATABASE_URL as string);

afterAll(() => connection.close());

/** F23, ADR 0043: departments as records with a text code. */
describe('departments migration', () => {
  it('seeds the identity and the order of the ten departments', async () => {
    const rows = await connection.db
      .select({
        code: departments.code,
        color: departments.color,
        icon: departments.icon,
        position: departments.position,
      })
      .from(departments)
      .where(sql`${departments.code} in ${SYSTEM_DEPARTMENT_CODES}`)
      .orderBy(asc(departments.id));
    expect(rows.map((row) => row.code)).toEqual([...SYSTEM_DEPARTMENT_CODES]);
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows.map((row) => row.color)).toEqual([
      ...['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'],
      ...['c1', 'c2'],
    ]);
    expect(rows.find((row) => row.code === 'medical_consultation')?.icon).toBe('stethoscope');
  });

  it('stores department columns as text and drops the enum', async () => {
    const columns = await connection.db.execute<{ table_name: string; data_type: string }>(sql`
      select table_name, data_type from information_schema.columns
      where table_schema = 'public' and column_name in ('department', 'departments', 'addressed_department')
        and table_name in ('tasks', 'task_comments', 'work_template_steps', 'work_template_assignees',
          'catalog_services', 'quote_lines', 'quote_line_items', 'projects', 'retainers')`);
    expect(columns.rows).toHaveLength(9);
    for (const column of columns.rows) {
      expect(['text', 'ARRAY'], column.table_name).toContain(column.data_type);
    }
    const enums = await connection.db.execute(
      sql`select 1 from pg_type where typname = 'department_code'`,
    );
    expect(enums.rows).toEqual([]);
  });

  it('references departments by code from every single-department column', async () => {
    const keys = await connection.db.execute<{ table_name: string }>(sql`
      select c.conrelid::regclass::text as table_name from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'departments'::regclass
        and c.confkey = array[(select attnum from pg_attribute
          where attrelid = 'departments'::regclass and attname = 'code')]::smallint[]
      order by 1`);
    expect(keys.rows.map((row) => row.table_name)).toEqual([
      'catalog_services',
      'quote_line_items',
      'quote_lines',
      'task_comments',
      'tasks',
      'work_template_assignees',
      'work_template_steps',
    ]);
  });
});
