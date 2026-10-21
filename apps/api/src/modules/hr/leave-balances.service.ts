import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateLeaveAdjustment, LeaveBalance } from '@vertex-hub/contracts';
import type { Database } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { HrRequestsService } from './hr-requests.service.js';
import { HrScope } from './hr-scope.js';
import { LeaveLedger } from './leave-ledger.js';

/** `GET /balances/:userId` and its adjustments (rules B6 and B7). */
@Injectable()
export class LeaveBalancesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly scope: HrScope,
    private readonly ledger: LeaveLedger,
    private readonly requests: HrRequestsService,
  ) {}

  /** The employee's own balances, or those `hr.read` covers; 404 otherwise. */
  async get(actor: CurrentUserInfo, userId: string, year: number): Promise<LeaveBalance> {
    if (userId !== actor.id && !(await this.scope.covers(actor, userId))) {
      throw new NotFoundException();
    }
    const [profile] = await this.users.profiles({ ids: [userId] });
    if (!profile) throw new NotFoundException();
    const pending = await this.requests.pendingDays(this.db, userId, year);
    return this.ledger.view(userId, year, pending);
  }

  async adjust(
    actor: CurrentUserInfo,
    userId: string,
    input: CreateLeaveAdjustment,
  ): Promise<LeaveBalance> {
    await this.ledger.adjust(actor, userId, input);
    const pending = await this.requests.pendingDays(this.db, userId, input.year);
    return this.ledger.view(userId, input.year, pending);
  }
}
