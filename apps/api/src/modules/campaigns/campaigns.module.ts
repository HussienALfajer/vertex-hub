import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { FilesModule } from '../files/index.js';
import { InvoicesModule } from '../invoices/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { QuotesModule } from '../quotes/index.js';
import { TasksModule } from '../tasks/index.js';
import { AdReceiptsService } from './ad-receipts.service.js';
import { AdWalletBalances } from './ad-wallet-balances.js';
import { AdWalletEntryFileOwner } from './ad-wallet-entry-file-owner.js';
import { AdWalletsController } from './ad-wallets.controller.js';
import { AdWalletsService } from './ad-wallets.service.js';
import { CampaignReports } from './campaign-reports.js';
import { CampaignUpdatesService } from './campaign-updates.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';

/**
 * Ad campaigns (F12, ADR 0025): campaigns of a client with a USD budget and periodic updates of
 * spend and results, and the client's ad-budget wallet of deposits and refunds that wallet-funded
 * spend is deducted from, with the A11 low-balance alert (sent through `NotificationCenter`,
 * repeated as a source of `notifications.daily`). Reads clients through `ClientDirectory`, users
 * through `UserDirectory`, the linked project or retainer through `projects`' `EngagementDirectory`
 * and the linked task through `tasks`' `TaskLinks`; takes deposit receipt numbers and the current
 * rate from `invoices`' `DocumentNumbers`, the company details printed on deposit receipts from
 * `quotes`' `QuoteDirectory`, and keeps entry proofs and receipts as documents of the entry
 * (`files`' `GeneratedFiles`, owner type `ad_wallet_entry`). Receipts are rendered by the worker
 * (`campaigns.pdf`) and attached by `AdReceiptsService` (`campaigns.pdf-ready`). Exports
 * `CampaignReports` for `reports`, its only importer.
 */
@Module({
  imports: [
    AuthModule,
    ClientsModule,
    FilesModule,
    InvoicesModule,
    NotificationsModule,
    ProjectsModule,
    QuotesModule,
    TasksModule,
  ],
  controllers: [CampaignsController, AdWalletsController],
  providers: [
    CampaignsService,
    CampaignUpdatesService,
    AdWalletBalances,
    AdWalletsService,
    AdReceiptsService,
    AdWalletEntryFileOwner,
    CampaignReports,
  ],
  exports: [CampaignReports],
})
export class CampaignsModule {}
