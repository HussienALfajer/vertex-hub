import { Injectable } from '@nestjs/common';
import type { PunchableShoot } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';

type Executor = Database | Transaction;

/** A shoot as a punch shows it: the GM sees the point beside the shoot's place (rule C13). */
export interface ShootPlace {
  id: string;
  title: string;
  location: string;
  mapUrl: string | null;
}

/** What the `calendar` module tells attendance about shoots. */
export interface AttendanceShootSource {
  /** Rule C13: the scheduled shoots the user is team crew of, open for a punch at `at`. */
  punchable(executor: Executor, userId: string, at: Date): Promise<PunchableShoot[]>;
  /** The shoots of punches, by id. */
  places(executor: Executor, ids: readonly string[]): Promise<Map<string, ShootPlace>>;
}

/**
 * Rule C13: shoot check-ins read F11 shoots, which the `calendar` module owns. It registers its
 * source here, so `hr` never imports it.
 */
@Injectable()
export class AttendanceShoots {
  private source: AttendanceShootSource | null = null;

  register(source: AttendanceShootSource): void {
    this.source = source;
  }

  punchable(executor: Executor, userId: string, at: Date): Promise<PunchableShoot[]> {
    return this.source?.punchable(executor, userId, at) ?? Promise.resolve([]);
  }

  places(executor: Executor, ids: readonly string[]): Promise<Map<string, ShootPlace>> {
    if (ids.length === 0 || !this.source) return Promise.resolve(new Map());
    return this.source.places(executor, ids);
  }
}
