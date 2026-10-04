import { Inject, Injectable } from '@nestjs/common';
import {
  businessDate,
  type PostPlatform,
  type PublishedLink,
  type ReportPeriod,
} from '@vertex-hub/contracts';
import { contentPosts, type Database } from '@vertex-hub/db';
import { and, asc, between, eq, isNull, ne } from 'drizzle-orm';
import { inBusinessPeriod } from '../../core/database/business-date.js';
import { DATABASE } from '../../core/database/database.module.js';

/** A post published in a month (F15 rule 18.5). */
export interface PublishedPost {
  id: string;
  publishedOn: string;
  platforms: PostPlatform[];
  title: string;
  links: PublishedLink[];
}

/**
 * Read-only figures of the content calendar for reports (F15, ADR 0027): non-archived posts of a
 * client. Callers check the scope.
 */
@Injectable()
export class ContentReports {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Rule 18.5: the client's posts published in the period, by publish time. */
  async published(clientId: string, period: ReportPeriod): Promise<PublishedPost[]> {
    const rows = await this.db
      .select({
        id: contentPosts.id,
        publishedAt: contentPosts.publishedAt,
        platforms: contentPosts.platforms,
        title: contentPosts.title,
        links: contentPosts.publishedLinks,
      })
      .from(contentPosts)
      .where(
        and(
          eq(contentPosts.clientId, clientId),
          eq(contentPosts.status, 'published'),
          isNull(contentPosts.archivedAt),
          inBusinessPeriod(contentPosts.publishedAt, period),
        ),
      )
      .orderBy(asc(contentPosts.publishedAt), asc(contentPosts.id));
    return rows.flatMap(({ publishedAt, ...row }) =>
      publishedAt ? [{ ...row, publishedOn: businessDate(publishedAt) }] : [],
    );
  }

  /** Rule 18.10: the client's posts planned in the period that are not cancelled, by date. */
  async planned(
    clientId: string,
    period: ReportPeriod,
  ): Promise<{ date: string; title: string }[]> {
    return this.db
      .select({ date: contentPosts.publishDate, title: contentPosts.title })
      .from(contentPosts)
      .where(
        and(
          eq(contentPosts.clientId, clientId),
          ne(contentPosts.status, 'cancelled'),
          isNull(contentPosts.archivedAt),
          between(contentPosts.publishDate, period.from, period.to),
        ),
      )
      .orderBy(asc(contentPosts.publishDate), asc(contentPosts.publishTime), asc(contentPosts.id));
  }
}
