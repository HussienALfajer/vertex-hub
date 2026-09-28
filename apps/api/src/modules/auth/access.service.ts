import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { type ResolvedAccess, resolveAccess } from './resolve-access.js';

@Injectable()
export class AccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Effective roles, departments, permissions and 2FA state; `null` for archived users. */
  resolve(userId: string): Promise<ResolvedAccess | null> {
    return resolveAccess(this.db, userId);
  }
}
