import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AttendanceGreeting } from '@vertex-hub/contracts';
import { type Listener, listen, type Transaction } from '@vertex-hub/db';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../../core/config/env.js';
import { ImagesService } from '../files/index.js';

/** The `pg_notify` channel from a punch's transaction to the screens' streams. */
const KIOSK_CHANNEL = 'attendance_kiosk';

/** One open `GET /api/kiosk/stream` connection. */
export interface KioskSubscriber {
  greet: (greeting: AttendanceGreeting) => void;
  close: () => void;
}

/**
 * Rule C20: the greeting reaches the screen the person scanned, whichever API process holds its
 * stream (ADR 0018). One `LISTEN` connection, opened with the first stream; if it fails, every
 * stream closes and the screens reconnect.
 */
@Injectable()
export class KioskStream implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(KioskStream.name);
  private readonly subscribers = new Map<string, Set<KioskSubscriber>>();
  private listener: Promise<Listener> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly images: ImagesService,
  ) {}

  /**
   * Sent when the punch's transaction commits. The photo (F01C rule 15) is too large for a
   * notification's 8000 bytes: the image id goes instead and the stream's process reads it.
   */
  async publish(
    tx: Transaction,
    kioskId: string,
    greeting: AttendanceGreeting,
    imageId: string | null,
  ): Promise<void> {
    const payload = JSON.stringify({ kioskId, greeting: { ...greeting, photo: null }, imageId });
    await tx.execute(sql`select pg_notify(${KIOSK_CHANNEL}, ${payload})`);
  }

  /** Opens the listener if needed; call before answering a stream request. */
  async connect(): Promise<void> {
    if (!this.listener) {
      const attempt = listen(
        this.env.DATABASE_URL,
        KIOSK_CHANNEL,
        (payload) => void this.deliver(payload),
        (error) => {
          this.logger.warn(`Kiosk listener lost: ${error.message}`);
          if (this.listener === attempt) this.listener = null;
          this.closeAll();
        },
      );
      this.listener = attempt;
      attempt.catch(() => {
        if (this.listener === attempt) this.listener = null;
      });
    }
    await this.listener;
  }

  subscribe(kioskId: string, subscriber: KioskSubscriber): () => void {
    const set = this.subscribers.get(kioskId) ?? new Set<KioskSubscriber>();
    set.add(subscriber);
    this.subscribers.set(kioskId, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0 && this.subscribers.get(kioskId) === set) this.subscribers.delete(kioskId);
    };
  }

  beforeApplicationShutdown(): void {
    this.closeAll();
  }

  async onApplicationShutdown(): Promise<void> {
    const listener = this.listener;
    this.listener = null;
    await listener?.then((connected) => connected.close()).catch(() => {});
  }

  private async deliver(payload: string): Promise<void> {
    try {
      const { kioskId, greeting, imageId } = JSON.parse(payload) as {
        kioskId: string;
        greeting: AttendanceGreeting;
        imageId: string | null;
      };
      if (!this.subscribers.has(kioskId)) return;
      const photo = await this.images.photoDataUrl(imageId);
      for (const subscriber of this.subscribers.get(kioskId) ?? []) {
        subscriber.greet({ ...greeting, photo });
      }
    } catch (error) {
      this.logger.error(error, 'Kiosk greeting failed');
    }
  }

  private closeAll(): void {
    const all = [...this.subscribers.values()].flatMap((set) => [...set]);
    this.subscribers.clear();
    for (const subscriber of all) subscriber.close();
  }
}
