import type { CalendarDate, CalendarIssue, CalendarOccasion } from '@vertex-hub/contracts';

/*
 * What the content calendar marks on its days (spec F08B, screen 2): occasions on their days,
 * gap days and posts too close together, read from the calendar's `occasions` and `issues`.
 */

/** The occasions running on a day, in the order the API gave them. */
export const occasionsOn = (
  occasions: readonly CalendarOccasion[],
  day: CalendarDate,
): CalendarOccasion[] =>
  occasions.filter((occasion) => occasion.startDate <= day && day <= occasion.endDate);

/**
 * Rule C6 on a client's calendar: the occasion applies, no post carries it and "No post this
 * year" was not chosen. Null `covered` (the calendar of every client) never warns.
 */
export const occasionUncovered = (occasion: CalendarOccasion): boolean =>
  occasion.covered === false && occasion.skipped !== true;

/** Rule C7: the clients with a gap running through a day. */
export function gapClientsOn(issues: readonly CalendarIssue[], day: CalendarDate): string[] {
  return issues
    .filter(
      (issue) => issue.kind === 'gap' && issue.date <= day && day <= (issue.endDate ?? issue.date),
    )
    .map((issue) => issue.clientId);
}

/** Rule C8: the posts that sit too close to another on a shared platform. */
export function tooClosePostIds(issues: readonly CalendarIssue[]): Set<string> {
  return new Set(
    issues.filter((issue) => issue.kind === 'too_close').flatMap((issue) => issue.postIds),
  );
}
