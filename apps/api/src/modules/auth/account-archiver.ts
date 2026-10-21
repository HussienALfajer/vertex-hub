import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import { UsersService } from './users.service.js';

/**
 * Archives an account by the system (F17 rule A8: the day after the last working day), under the
 * F01 archive rules: sessions closed, links revoked, open work told to the managers. Refused like
 * a manual archive while the user holds responsibilities or is the last General Manager.
 */
@Injectable()
export class AccountArchiver {
  constructor(private readonly users: UsersService) {}

  /** Returns false when the account was already archived. */
  archive(tx: Transaction, userId: string): Promise<boolean> {
    return this.users.archiveBySystem(tx, userId);
  }
}
