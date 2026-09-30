import type { Logger } from '@nestjs/common';

/** Thrown after a job run in which some items failed; the others were still done. */
export class JobItemsFailedError extends Error {
  constructor(readonly failed: string[]) {
    super(`Job items failed: ${failed.join(', ')}`);
    this.name = 'JobItemsFailedError';
  }
}

/**
 * Runs `work` for each item in order. A failing item is logged and skipped, so one broken record
 * does not hold back the rest; the run then throws `JobItemsFailedError`, and pg-boss records the
 * job as failed and retries it (every scheduled job is idempotent).
 */
export async function runEach<T>(
  items: Iterable<T>,
  logger: Logger,
  label: (item: T) => string,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const failed: string[] = [];
  for (const item of items) {
    try {
      await work(item);
    } catch (error) {
      failed.push(label(item));
      logger.error(`${label(item)} failed`, error instanceof Error ? error.stack : String(error));
    }
  }
  if (failed.length > 0) throw new JobItemsFailedError(failed);
}
