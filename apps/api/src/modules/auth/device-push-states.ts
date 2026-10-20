import { Injectable } from '@nestjs/common';
import type { DevicePush } from '@vertex-hub/contracts';

/** The push state of each given session, by session id; sessions left out have push off. */
export type DevicePushLookup = (sessionIds: string[]) => Promise<Map<string, DevicePush>>;

const OFF: DevicePush = { state: 'off', lastDeliveredAt: null };

/**
 * Lets `notifications`, which owns the push subscriptions, show each signed-in device's push state
 * (F16 rule A12) without `auth` importing it.
 */
@Injectable()
export class DevicePushStates {
  private lookup: DevicePushLookup | undefined;

  register(lookup: DevicePushLookup): void {
    this.lookup = lookup;
  }

  async of(sessionIds: string[]): Promise<(sessionId: string) => DevicePush> {
    const states = this.lookup && sessionIds.length ? await this.lookup(sessionIds) : new Map();
    return (sessionId) => states.get(sessionId) ?? OFF;
  }
}
