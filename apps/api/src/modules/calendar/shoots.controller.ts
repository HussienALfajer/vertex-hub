import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CancelShoot,
  type CloseShoot,
  type CreateShoot,
  cancelShootSchema,
  closeShootSchema,
  createShootSchema,
  type ReopenShoot,
  reopenShootSchema,
  type ShootDetail,
  type ShootListQuery,
  type ShootPage,
  type Shot,
  type ShotDoneInput,
  type ShotListInput,
  shootDetailSchema,
  shootListQuerySchema,
  shootPageSchema,
  shotDoneInputSchema,
  shotListInputSchema,
  shotSchema,
  type UpdateShoot,
  updateShootSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ShootWorkflowService } from './shoot-workflow.service.js';
import { ShootsService } from './shoots.service.js';

@ApiTags('calendar')
@Controller('shoots')
export class ShootsController {
  constructor(
    private readonly shoots: ShootsService,
    private readonly workflow: ShootWorkflowService,
  ) {}

  @Get()
  @RequirePermissions('calendar.read')
  @SerializeOptions({ schema: shootPageSchema })
  @ApiOkResponse({
    description: 'Shoots, latest start first; `archived` needs `shoots.manage` over all shoots',
    standardSchema: shootPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: shootListQuerySchema }) query: ShootListQuery,
  ): Promise<ShootPage> {
    return this.shoots.list(actor, query);
  }

  @Post()
  @RequirePermissions('shoots.manage')
  @SerializeOptions({ schema: shootDetailSchema })
  @ApiCreatedResponse({
    description: 'The booked shoot (shoot scope on the client; no client needs scope all)',
    standardSchema: shootDetailSchema,
  })
  @ApiConflictResponse({
    description:
      '`TASK_NOT_BOOKABLE`, `SCHEDULE_CONFLICT` (details: the conflicts), `CLIENT_ARCHIVED`, F06 link errors',
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createShootSchema }) input: CreateShoot,
  ): Promise<ShootDetail> {
    return this.shoots.create(actor, input);
  }

  @Get(':id')
  @RequirePermissions('calendar.read')
  @SerializeOptions({ schema: shootDetailSchema })
  @ApiOkResponse({
    description: 'A shoot with its crew, shot list, tasks and what the caller may do',
    standardSchema: shootDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShootDetail> {
    return this.shoots.detail(actor, id);
  }

  @Patch(':id')
  @RequirePermissions('shoots.manage')
  @SerializeOptions({ schema: shootDetailSchema })
  @ApiOkResponse({ description: 'The edited shoot', standardSchema: shootDetailSchema })
  @ApiConflictResponse({
    description: '`SHOOT_NOT_SCHEDULED`, `SHOOT_ARCHIVED`, `SCHEDULE_CONFLICT`',
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateShootSchema }) input: UpdateShoot,
  ): Promise<ShootDetail> {
    return this.shoots.update(actor, id, input);
  }

  @Put(':id/shots')
  @RequirePermissions('shoots.manage')
  @SerializeOptions({ schema: shootDetailSchema })
  @ApiOkResponse({
    description: 'The shoot with its new shot list; kept items keep their ticks',
    standardSchema: shootDetailSchema,
  })
  @ApiConflictResponse({ description: '`SHOOT_NOT_SCHEDULED`, `SHOOT_ARCHIVED`' })
  saveShots(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: shotListInputSchema }) input: ShotListInput,
  ): Promise<ShootDetail> {
    return this.shoots.saveShots(actor, id, input);
  }

  @Post(':id/shots/:shotId/done')
  @HttpCode(200)
  @RequirePermissions('calendar.read')
  @SerializeOptions({ schema: shotSchema })
  @ApiOkResponse({
    description: 'The shot, ticked or unticked (team crew or shoot scope)',
    standardSchema: shotSchema,
  })
  @ApiConflictResponse({ description: '`SHOOT_NOT_SCHEDULED`, `SHOOT_ARCHIVED`' })
  tick(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shotId', ParseUUIDPipe) shotId: string,
    @Body({ schema: shotDoneInputSchema }) input: ShotDoneInput,
  ): Promise<Shot> {
    return this.shoots.tick(actor, id, shotId, input.done);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions('calendar.read')
  @SerializeOptions({ schema: shootDetailSchema })
  @ApiOkResponse({
    description:
      'The completed shoot (shoot scope or its lead); its task is delivered and the editing task created',
    standardSchema: shootDetailSchema,
  })
  @ApiConflictResponse({ description: '`SHOOT_NOT_SCHEDULED`, `SHOOT_NOT_STARTED`' })
  close(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: closeShootSchema }) input: CloseShoot,
  ): Promise<ShootDetail> {
    return this.workflow.close(actor, id, input);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('shoots.manage')
  @SerializeOptions({ schema: shootDetailSchema })
  @ApiOkResponse({ description: 'The cancelled shoot', standardSchema: shootDetailSchema })
  @ApiConflictResponse({ description: '`SHOOT_NOT_SCHEDULED`, `SHOOT_ARCHIVED`' })
  cancel(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: cancelShootSchema }) input: CancelShoot,
  ): Promise<ShootDetail> {
    return this.workflow.cancel(actor, id, input);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions('shoots.manage')
  @SerializeOptions({ schema: shootDetailSchema })
  @ApiOkResponse({ description: 'The shoot, scheduled again', standardSchema: shootDetailSchema })
  @ApiConflictResponse({
    description: '`SHOOT_NOT_CANCELLED`, `TASK_NOT_BOOKABLE`, `SCHEDULE_CONFLICT`',
  })
  reopen(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: reopenShootSchema }) input: ReopenShoot,
  ): Promise<ShootDetail> {
    return this.workflow.reopen(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('shoots.manage')
  @SerializeOptions({ schema: shootDetailSchema })
  @ApiOkResponse({
    description: 'The archived shoot (`shoots.manage` over all shoots)',
    standardSchema: shootDetailSchema,
  })
  @ApiConflictResponse({ description: '`SHOOT_ARCHIVED`' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShootDetail> {
    return this.shoots.archive(actor, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('shoots.manage')
  @SerializeOptions({ schema: shootDetailSchema })
  @ApiOkResponse({
    description: 'The restored shoot (`shoots.manage` over all shoots)',
    standardSchema: shootDetailSchema,
  })
  @ApiConflictResponse({ description: '`SHOOT_NOT_ARCHIVED`, `TASK_NOT_BOOKABLE`' })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShootDetail> {
    return this.shoots.restore(actor, id);
  }
}
