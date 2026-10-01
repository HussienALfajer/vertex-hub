import {
  CLIENT_DECISIONS,
  RESPONSE_CHANNELS,
  REVIEW_OUTCOMES,
  REVIEW_STAGES,
} from '@vertex-hub/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

/*
 * The enums of review snapshots and client responses (F09, ADR 0020), shared by tasks and posts
 * (F08, ADR 0021). Kept apart from `tasks.ts` and `content.ts`, which refer to each other's
 * tables.
 */

export const reviewStageEnum = pgEnum('review_stage', REVIEW_STAGES);

export const reviewOutcomeEnum = pgEnum('review_outcome', REVIEW_OUTCOMES);

export const clientDecisionEnum = pgEnum('client_decision', CLIENT_DECISIONS);

export const responseChannelEnum = pgEnum('response_channel', RESPONSE_CHANNELS);
