import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { ContentModule } from '../content/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TasksModule } from '../tasks/index.js';
import { AudienceResolver } from './audience-resolver.js';
import { AudiencesController } from './audiences.controller.js';
import { AudiencesService } from './audiences.service.js';

/**
 * Audiences (F16 part D, ADR 0038): owns no table. Resolves an audience through `auth`'s
 * `UserDirectory`, `projects`' `EngagementDirectory`, `tasks`' `TaskLinks`, `content`'s
 * `PostTeams` and `clients`' `ClientDirectory`, none of which imports it. Exports
 * `AudienceResolver` for `announcements` (and later the board, chat and portal).
 */
@Module({
  imports: [AuthModule, ClientsModule, ContentModule, ProjectsModule, TasksModule],
  controllers: [AudiencesController],
  providers: [AudienceResolver, AudiencesService],
  exports: [AudienceResolver],
})
export class AudiencesModule {}
