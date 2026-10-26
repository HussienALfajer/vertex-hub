import { readFileSync } from 'node:fs';
import { richTextFromPlain } from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';

const connection = createDatabase(process.env.DATABASE_URL as string);

afterAll(() => connection.close());

/** The backfill's function, from its migration, as a temporary function of one session. */
const createFunction = readFileSync(
  new URL('../migrations/0088_f06b_text_docs.sql', import.meta.url),
  'utf8',
)
  .split('--> statement-breakpoint')[0]
  ?.replace('CREATE FUNCTION f06b_text_doc', 'CREATE FUNCTION pg_temp.f06b_text_doc') as string;

const user = '01a0e97d-0028-7d46-8479-c4c5c1a41c11';

describe('the rich-text backfill of comments and briefs (F06B edge case 22)', () => {
  it('builds the documents richTextFromPlain builds', async () => {
    const samples: [string, boolean][] = [
      ['one line', false],
      ['first\n\nthird', false],
      [`Hi @{${user.toUpperCase()}}, see @{${user}}.\nThanks`, true],
      [`@{${user}}`, true],
      [`kept as text @{${user}}`, false],
      ['@{not-a-uuid} {x}', true],
    ];
    const docs = await connection.db.transaction(async (tx) => {
      await tx.execute(sql.raw(createFunction));
      const out: unknown[] = [];
      for (const [text, mentions] of samples) {
        const result = await tx.execute<{ doc: unknown }>(
          sql`select pg_temp.f06b_text_doc(${text}, ${mentions}) as doc`,
        );
        out.push(result.rows[0]?.doc);
      }
      return out;
    });
    expect(docs).toEqual(samples.map(([text, mentions]) => richTextFromPlain(text, { mentions })));
  });
});
