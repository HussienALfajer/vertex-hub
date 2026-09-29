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
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateRetainer,
  createRetainerSchema,
  type DeliverableLineList,
  deliverableLineListSchema,
  type RetainerDeliverables,
  type RetainerDetail,
  type RetainerListQuery,
  type RetainerPage,
  type RetainerStatusChange,
  retainerDeliverablesSchema,
  retainerDetailSchema,
  retainerListQuerySchema,
  retainerPageSchema,
  retainerStatusChangeSchema,
  type UpdateRetainer,
  updateRetainerSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { RetainersService } from './retainers.service.js';

@ApiTags('retainers')
@Controller('retainers')
export class RetainersController {
  constructor(private readonly retainers: RetainersService) {}

  @Get()
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: retainerPageSchema })
  @ApiOkResponse({
    description: 'Retainers with their current cycle',
    standardSchema: retainerPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: retainerListQuerySchema }) query: RetainerListQuery,
  ): Promise<RetainerPage> {
    return this.retainers.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: retainerDetailSchema })
  @ApiOkResponse({
    description: 'A retainer with its lines and current cycle; money only with money access',
    standardSchema: retainerDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RetainerDetail> {
    return this.retainers.detail(actor, id);
  }

  @Post()
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerDetailSchema })
  @ApiCreatedResponse({
    description:
      'The new retainer (client scope; currency and fee need money access). A start date of ' +
      'today or earlier opens this month’s cycle at once',
    standardSchema: retainerDetailSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createRetainerSchema }) input: CreateRetainer,
  ): Promise<RetainerDetail> {
    return this.retainers.create(actor, input);
  }

  @Patch(':id')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerDetailSchema })
  @ApiOkResponse({
    description: 'The updated retainer (client scope; currency and fee need money access)',
    standardSchema: retainerDetailSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateRetainerSchema }) input: UpdateRetainer,
  ): Promise<RetainerDetail> {
    return this.retainers.update(actor, id, input);
  }

  @Put(':id/deliverables')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: deliverableLineListSchema })
  @ApiOkResponse({
    description: 'The standing lines, applied from the next cycle; lines left out are archived',
    standardSchema: deliverableLineListSchema,
  })
  setDeliverables(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: retainerDeliverablesSchema }) input: RetainerDeliverables,
  ): Promise<DeliverableLineList> {
    return this.retainers.setDeliverables(actor, id, input);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerDetailSchema })
  @ApiOkResponse({
    description: 'The retainer after the change; reactivating needs scope all',
    standardSchema: retainerDetailSchema,
  })
  changeStatus(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: retainerStatusChangeSchema }) change: RetainerStatusChange,
  ): Promise<RetainerDetail> {
    return this.retainers.changeStatus(actor, id, change);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerDetailSchema })
  @ApiOkResponse({
    description: 'The archived retainer (scope all only)',
    standardSchema: retainerDetailSchema,
  })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RetainerDetail> {
    return this.retainers.archive(actor, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerDetailSchema })
  @ApiOkResponse({
    description: 'The restored retainer (scope all only)',
    standardSchema: retainerDetailSchema,
  })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RetainerDetail> {
    return this.retainers.restore(actor, id);
  }
}
