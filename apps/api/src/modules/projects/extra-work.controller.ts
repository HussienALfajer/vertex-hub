import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateExtraWork,
  createExtraWorkSchema,
  type ExtraWork,
  type ExtraWorkBillingChange,
  type ExtraWorkListQuery,
  type ExtraWorkPage,
  extraWorkBillingChangeSchema,
  extraWorkListQuerySchema,
  extraWorkPageSchema,
  extraWorkSchema,
  type UpdateExtraWork,
  updateExtraWorkSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ExtraWorkService } from './extra-work.service.js';

/*
 * The same five routes under `/api/projects/:id/extra-work` and `/api/retainers/:id/extra-work`
 * (spec F05, "Extra work"). Estimates need money access; billing needs client scope and money.
 */

const LIST = {
  description: 'Extra work, newest request first',
  standardSchema: extraWorkPageSchema,
};
const ONE = { description: 'The extra work item', standardSchema: extraWorkSchema };
const BILLING = {
  description: 'The item with its billing status (client scope and money access)',
  standardSchema: extraWorkSchema,
};
const ARCHIVED = { description: 'The item is removed (entered by mistake)' };

@Controller()
export class ExtraWorkController {
  constructor(private readonly extraWork: ExtraWorkService) {}

  @ApiTags('projects')
  @Get('projects/:id/extra-work')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: extraWorkPageSchema })
  @ApiOkResponse(LIST)
  listOfProject(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: extraWorkListQuerySchema }) query: ExtraWorkListQuery,
  ): Promise<ExtraWorkPage> {
    return this.extraWork.list(actor, 'project', id, query);
  }

  @ApiTags('projects')
  @Post('projects/:id/extra-work')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: extraWorkSchema })
  @ApiCreatedResponse(ONE)
  createOnProject(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: createExtraWorkSchema }) input: CreateExtraWork,
  ): Promise<ExtraWork> {
    return this.extraWork.create(actor, 'project', id, input);
  }

  @ApiTags('projects')
  @Patch('projects/:id/extra-work/:itemId')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: extraWorkSchema })
  @ApiOkResponse(ONE)
  updateOnProject(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body({ schema: updateExtraWorkSchema }) input: UpdateExtraWork,
  ): Promise<ExtraWork> {
    return this.extraWork.update(actor, 'project', id, itemId, input);
  }

  @ApiTags('projects')
  @Post('projects/:id/extra-work/:itemId/billing')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: extraWorkSchema })
  @ApiOkResponse(BILLING)
  billOnProject(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body({ schema: extraWorkBillingChangeSchema }) input: ExtraWorkBillingChange,
  ): Promise<ExtraWork> {
    return this.extraWork.changeBilling(actor, 'project', id, itemId, input);
  }

  @ApiTags('projects')
  @Post('projects/:id/extra-work/:itemId/archive')
  @HttpCode(204)
  @RequirePermissions('projects.manage')
  @ApiNoContentResponse(ARCHIVED)
  archiveOnProject(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    return this.extraWork.archive(actor, 'project', id, itemId);
  }

  @ApiTags('retainers')
  @Get('retainers/:id/extra-work')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: extraWorkPageSchema })
  @ApiOkResponse(LIST)
  listOfRetainer(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: extraWorkListQuerySchema }) query: ExtraWorkListQuery,
  ): Promise<ExtraWorkPage> {
    return this.extraWork.list(actor, 'retainer', id, query);
  }

  @ApiTags('retainers')
  @Post('retainers/:id/extra-work')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: extraWorkSchema })
  @ApiCreatedResponse(ONE)
  createOnRetainer(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: createExtraWorkSchema }) input: CreateExtraWork,
  ): Promise<ExtraWork> {
    return this.extraWork.create(actor, 'retainer', id, input);
  }

  @ApiTags('retainers')
  @Patch('retainers/:id/extra-work/:itemId')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: extraWorkSchema })
  @ApiOkResponse(ONE)
  updateOnRetainer(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body({ schema: updateExtraWorkSchema }) input: UpdateExtraWork,
  ): Promise<ExtraWork> {
    return this.extraWork.update(actor, 'retainer', id, itemId, input);
  }

  @ApiTags('retainers')
  @Post('retainers/:id/extra-work/:itemId/billing')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: extraWorkSchema })
  @ApiOkResponse(BILLING)
  billOnRetainer(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body({ schema: extraWorkBillingChangeSchema }) input: ExtraWorkBillingChange,
  ): Promise<ExtraWork> {
    return this.extraWork.changeBilling(actor, 'retainer', id, itemId, input);
  }

  @ApiTags('retainers')
  @Post('retainers/:id/extra-work/:itemId/archive')
  @HttpCode(204)
  @RequirePermissions('projects.manage')
  @ApiNoContentResponse(ARCHIVED)
  archiveOnRetainer(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    return this.extraWork.archive(actor, 'retainer', id, itemId);
  }
}
