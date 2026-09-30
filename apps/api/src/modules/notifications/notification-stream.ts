import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  NOTIFICATION_STREAM_LIFETIME_MS,
  NOTIFICATION_STREAM_PING_MS,
  type NotificationStreamEvent,
} from '@vertex-hub/contracts';
import { type Listener, listen } from '@vertex-hub/db';
import { ENV, type Env } from '../../core/config/env.js';
import { UserDirectory } from '../auth/index.js';
import { NOTIFICATIONS_CHANNEL, parsePayload } from './notification-channel.js';
import { NotificationsService } from './notifications.service.js';

/** How often an open stream pings (and checks its session), and when it closes (rule 4). */
export interface StreamTiming {
  pingMs: number;
  lifetimeMs: number;
}

/** Injection token for `StreamTiming`: the contract's values, shortened by tests. */
export const STREAM_TIMING = Symbol('STREAM_TIMING');

export const DEFAULT_STREAM_TIMING: StreamTiming = {
  pingMs: NOTIFICATION_STREAM_PING_MS,
  lifetimeMs: NOTIFICATION_STREAM_LIFETIME_MS,
};

/** One open `GET /api/me/notifications/stream` connection. */
export interface StreamSubscriber {
  send: (event: NotificationStreamEvent) => void;
  close: () => void;
}

/**
 * Pushes committed notifications to their recipients' open streams (spec F14 rule 4, ADR 0018).
 * One `LISTEN` connection, opened with the first stream. If it fails, every stream is closed so
 * clients reconnect and refetch; the next stream opens a new connection.
 */
@Injectable()
export class NotificationStream implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationStream.name);
  private readonly subscribers = new Map<string, Set<StreamSubscriber>>();
  private listener: Promise<Listener> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationsService,
    private readonly users: UserDirectory,
  ) {}

  /**
   * Whether a stream's session has ended since it opened (password reset, sign-out of other
   * sessions, archiving). Checked on every ping, so a revoked session stops receiving at once.
   */
  async sessionEnded(sessionId: string): Promise<boolean> {
    return !(await this.users.sessionActive(sessionId));
  }

  /** Opens the listener if needed; call before answering a stream request, so a failure is a 500. */
  async connect(): Promise<void> {
    await this.ensureListener();
  }

  /** Registers a stream once `connect` resolved. Returns the unsubscribe. */
  subscribe(userId: string, subscriber: StreamSubscriber): () => void {
    const set = this.subscribers.get(userId) ?? new Set<StreamSubscriber>();
    set.add(subscriber);
    this.subscribers.set(userId, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0 && this.subscribers.get(userId) === set) this.subscribers.delete(userId);
    };
  }

  /**
   * Ends the open streams before Nest closes the HTTP server, which waits for every open
   * connection: without this a restart would hang until each stream's lifetime ran out.
   */
  beforeApplicationShutdown(): void {
    this.closeAll();
  }

  async onApplicationShutdown(): Promise<void> {
    const listener = this.listener;
    this.listener = null;
    await listener?.then((connected) => connected.close()).catch(() => {});
  }

  private ensureListener(): Promise<Listener> {
    if (!this.listener) {
      const attempt = listen(
        this.env.DATABASE_URL,
        NOTIFICATIONS_CHANNEL,
        (payload) => {
          this.deliver(payload).catch((error: unknown) =>
            this.logger.error(error, 'Notification push failed'),
          );
        },
        (error) => {
          this.logger.warn(`Notification listener lost: ${error.message}`);
          if (this.listener === attempt) this.listener = null;
          this.closeAll();
        },
      );
      this.listener = attempt;
      attempt.catch(() => {
        if (this.listener === attempt) this.listener = null;
      });
    }
    return this.listener;
  }

  private async deliver(payload: string): Promise<void> {
    const byRecipient = new Map<string, string[]>();
    for (const { recipientId, notificationId } of parsePayload(payload)) {
      if (!this.subscribers.has(recipientId)) continue;
      byRecipient.set(recipientId, [...(byRecipient.get(recipientId) ?? []), notificationId]);
    }
    for (const [recipientId, ids] of byRecipient) {
      const [items, unreadCount] = await Promise.all([
        this.notifications.byIds(recipientId, ids),
        this.notifications.unreadCount(recipientId),
      ]);
      for (const subscriber of this.subscribers.get(recipientId) ?? []) {
        for (const notification of items) subscriber.send({ notification, unreadCount });
      }
    }
  }

  private closeAll(): void {
    const all = [...this.subscribers.values()].flatMap((set) => [...set]);
    this.subscribers.clear();
    for (const subscriber of all) subscriber.close();
  }
}
