import { Injectable, type OnModuleInit } from '@nestjs/common';
import { EMAIL_DATA_SCHEMAS } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import { Mailer, type QueuedEmailEvent } from '../email/index.js';
import { NotificationCenter } from './notification-center.js';

/**
 * F16 part C rule 5: the security notice and new-device emails (F14 email rules 14–15) also
 * store `security_notice` and `security_new_device` for their user, in the transaction that
 * queues them, so they reach the phone. The email stays the one that is emailed. Registered
 * with `email`, which imports no module, so `auth` needs none either.
 */
@Injectable()
export class SecurityNotices implements OnModuleInit {
  constructor(
    private readonly mailer: Mailer,
    private readonly center: NotificationCenter,
  ) {}

  onModuleInit(): void {
    this.mailer.onQueued((tx, email) => this.copy(tx, email));
  }

  async copy(tx: Transaction, email: QueuedEmailEvent): Promise<void> {
    const userId = email.to[0]?.userId;
    if (!userId) return;
    const base = { recipients: [userId], actorId: null, subjectId: userId, emailSent: true };
    if (email.kind === 'security_notice') {
      const { change, by } = EMAIL_DATA_SCHEMAS.security_notice.parse(email.data);
      await this.center.notify(tx, { ...base, type: 'security_notice', data: { change, by } });
    }
    if (email.kind === 'new_device') {
      const { device, at } = EMAIL_DATA_SCHEMAS.new_device.parse(email.data);
      await this.center.notify(tx, { ...base, type: 'security_new_device', data: { device, at } });
    }
  }
}
