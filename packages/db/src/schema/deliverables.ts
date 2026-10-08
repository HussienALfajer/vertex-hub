import { DELIVERABLE_KINDS } from '@vertex-hub/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Kinds of counted deliverables (F05), in a file of its own: `quotes` and `retainers` import each
 * other (an accepted quote's terms and amendments), and `quotes` needs the enum while it loads.
 */
export const deliverableKindEnum = pgEnum('deliverable_kind', DELIVERABLE_KINDS);
