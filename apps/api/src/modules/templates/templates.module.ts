import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

/**
 * Work templates (F07, ADR 0017). Reads users and department membership through `auth`'s
 * `UserDirectory`, clients through `clients`' `ClientDirectory` and retainers through `projects`'
 * `EngagementDirectory`.
 */
@Module({
  imports: [AuthModule, ClientsModule, ProjectsModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
