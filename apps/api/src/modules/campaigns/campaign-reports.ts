import { Inject, Injectable } from '@nestjs/common';
import type { ReportClients } from '@vertex-hub/contracts';
import { adWallets, type Database } from '@vertex-hub/db';
import { and, inArray, isNotNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { ClientDirectory } from '../clients/index.js';
import { AdWalletBalances } from './ad-wallet-balances.js';

/**
 * Read-only ad figures for dashboards and reports (F15, ADR 0027): wallets of non-archived
 * clients, in USD. Callers check the scope.
 */
@Injectable()
export class CampaignReports {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly balances: AdWalletBalances,
  ) {}

  /** Rules 1 and 4: wallets in low state (`low_since` set), with their balance. */
  async lowWallets(
    clients: ReportClients,
  ): Promise<{ clientId: string; balanceUsdMinor: number }[]> {
    if (clients !== 'all' && clients.length === 0) return [];
    const rows = await this.db
      .select({ clientId: adWallets.clientId })
      .from(adWallets)
      .where(
        and(
          isNotNull(adWallets.lowSince),
          this.clients.isLive(adWallets.clientId),
          clients === 'all' ? undefined : inArray(adWallets.clientId, [...clients]),
        ),
      );
    const ids = rows.map((row) => row.clientId);
    const totals = await this.balances.totals(this.db, ids);
    return ids.map((clientId) => ({
      clientId,
      balanceUsdMinor: totals.get(clientId)?.balanceMinor ?? 0,
    }));
  }
}
