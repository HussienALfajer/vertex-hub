import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateCycleAdjustment,
  type CreateCycleLine,
  type CycleDetail,
  type CycleLine,
  type CycleListQuery,
  type CyclePage,
  createCycleAdjustmentSchema,
  createCycleLineSchema,
  cycleDetailSchema,
  cycleLineSchema,
  cycleListQuerySchema,
  cyclePageSchema,
  type UpdateCycleLine,
  updateCycleLineSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { RetainerCyclesService } from './retainer-cycles.service.js';

@ApiTags('retainers')
@Controller('retainers/:id/cycles')
export class RetainerCyclesController {
  constructor(private readonly cycles: RetainerCyclesService) {}

  @Get()
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: cyclePageSchema })
  @ApiOkResponse({ description: 'The retainer’s cycles', standardSchema: cyclePageSchema })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) retainerId: string,
    @Query({ schema: cycleListQuerySchema }) query: CycleListQuery,
  ): Promise<CyclePage> {
    return this.cycles.list(actor, retainerId, query);
  }

  @Get(':cycleId')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: cycleDetailSchema })
  @ApiOkResponse({
    description: 'A cycle with each line’s adjustments',
    standardSchema: cycleDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) retainerId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
  ): Promise<CycleDetail> {
    return this.cycles.detail(actor, retainerId, cycleId);
  }

  @Patch(':cycleId/lines/:lineId')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: cycleLineSchema })
  @ApiOkResponse({
    description: 'The line with its new committed quantity (open cycles, client scope)',
    standardSchema: cycleLineSchema,
  })
  updateLine(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) retainerId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body({ schema: updateCycleLineSchema }) input: UpdateCycleLine,
  ): Promise<CycleLine> {
    return this.cycles.updateLine(actor, retainerId, cycleId, lineId, input);
  }

  @Post(':cycleId/lines')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: cycleLineSchema })
  @ApiCreatedResponse({
    description: 'A line for this cycle only (open cycles, client scope)',
    standardSchema: cycleLineSchema,
  })
  addLine(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) retainerId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Body({ schema: createCycleLineSchema }) input: CreateCycleLine,
  ): Promise<CycleLine> {
    return this.cycles.addLine(actor, retainerId, cycleId, input);
  }

  @Post(':cycleId/lines/:lineId/adjustments')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: cycleLineSchema })
  @ApiCreatedResponse({
    description: 'The line after a reasoned change of its delivered count',
    standardSchema: cycleLineSchema,
  })
  adjust(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) retainerId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body({ schema: createCycleAdjustmentSchema }) input: CreateCycleAdjustment,
  ): Promise<CycleLine> {
    return this.cycles.adjust(actor, retainerId, cycleId, lineId, input);
  }
}
