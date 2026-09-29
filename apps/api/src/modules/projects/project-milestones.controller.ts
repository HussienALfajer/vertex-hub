import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CompleteMilestone,
  type CreateMilestone,
  completeMilestoneSchema,
  createMilestoneSchema,
  type Milestone,
  type MilestoneListResponse,
  type MilestoneOrder,
  milestoneListResponseSchema,
  milestoneOrderSchema,
  milestoneSchema,
  type UpdateMilestone,
  updateMilestoneSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ProjectMilestonesService } from './project-milestones.service.js';

@ApiTags('projects')
@Controller('projects/:id/milestones')
export class ProjectMilestonesController {
  constructor(private readonly milestones: ProjectMilestonesService) {}

  @Post()
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: milestoneSchema })
  @ApiCreatedResponse({
    description: 'The new milestone, last in the order; the installment needs money access',
    standardSchema: milestoneSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Body({ schema: createMilestoneSchema }) input: CreateMilestone,
  ): Promise<Milestone> {
    return this.milestones.create(actor, projectId, input);
  }

  @Put('order')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: milestoneListResponseSchema })
  @ApiOkResponse({
    description: 'The milestones in their new order',
    standardSchema: milestoneListResponseSchema,
  })
  reorder(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Body({ schema: milestoneOrderSchema }) order: MilestoneOrder,
  ): Promise<MilestoneListResponse> {
    return this.milestones.reorder(actor, projectId, order);
  }

  @Patch(':milestoneId')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: milestoneSchema })
  @ApiOkResponse({
    description: 'The updated milestone; the installment needs money access',
    standardSchema: milestoneSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body({ schema: updateMilestoneSchema }) input: UpdateMilestone,
  ): Promise<Milestone> {
    return this.milestones.update(actor, projectId, milestoneId, input);
  }

  @Post(':milestoneId/complete')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: milestoneSchema })
  @ApiOkResponse({
    description: 'The completed milestone; open tasks need `confirmOpenTasks`',
    standardSchema: milestoneSchema,
  })
  complete(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body({ schema: completeMilestoneSchema }) input: CompleteMilestone,
  ): Promise<Milestone> {
    return this.milestones.complete(actor, projectId, milestoneId, input);
  }

  @Post(':milestoneId/reopen')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: milestoneSchema })
  @ApiOkResponse({ description: 'The reopened milestone', standardSchema: milestoneSchema })
  reopen(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
  ): Promise<Milestone> {
    return this.milestones.reopen(actor, projectId, milestoneId);
  }

  @Post(':milestoneId/archive')
  @HttpCode(204)
  @RequirePermissions('projects.manage')
  @ApiNoContentResponse({ description: 'The pending milestone is removed from the project' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
  ): Promise<void> {
    return this.milestones.archive(actor, projectId, milestoneId);
  }
}
