import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientContactsController } from './client-contacts.controller.js';
import { ClientContactsService } from './client-contacts.service.js';
import { ClientNotesController } from './client-notes.controller.js';
import { ClientNotesService } from './client-notes.service.js';
import { ClientPlatformAccountsController } from './client-platform-accounts.controller.js';
import { ClientPlatformAccountsService } from './client-platform-accounts.service.js';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';

/**
 * Clients (F02): basics, contacts, brand kit, platform accounts and the communication log.
 * Reads users through the `auth` module's `UserDirectory` and registers the account-manager
 * responsibility (rule 8) in its `ResponsibilityRegistry`.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    ClientsController,
    ClientContactsController,
    ClientPlatformAccountsController,
    ClientNotesController,
  ],
  providers: [
    ClientsService,
    ClientContactsService,
    ClientPlatformAccountsService,
    ClientNotesService,
  ],
})
export class ClientsModule {}
