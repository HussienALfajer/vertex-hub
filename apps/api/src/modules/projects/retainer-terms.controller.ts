import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CancelRetainerTerm,
  type CreateRetainerTerm,
  cancelRetainerTermSchema,
  createRetainerTermSchema,
  type RetainerTerm,
  type RetainerTermList,
  retainerTermListSchema,
  retainerTermSchema,
  type UpdateRetainerTerm,
  updateRetainerTermSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { RetainerTermsService } from './retainer-terms.service.js';

/** Fixed terms of a retainer (spec F05B T1–T12); changes need money access. */
@ApiTags('retainers')
@Controller('retainers/:retainerId/terms')
export class RetainerTermsController {
  constructor(private readonly terms: RetainerTermsService) {}

  @Get()
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: retainerTermListSchema })
  @ApiOkResponse({
    description: 'The retainer’s terms, newest first; amounts only with money access',
    standardSchema: retainerTermListSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
  ): Promise<RetainerTermList> {
    return this.terms.list(actor, retainerId);
  }

  @Post()
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerTermSchema })
  @ApiCreatedResponse({
    description:
      'The new term with its schedule (client scope and money access). A term starting this ' +
      'month is active at once and drafts the month’s invoice',
    standardSchema: retainerTermSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Body({ schema: createRetainerTermSchema }) input: CreateRetainerTerm,
  ): Promise<RetainerTerm> {
    return this.terms.create(actor, retainerId, input);
  }

  @Patch(':termId')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerTermSchema })
  @ApiOkResponse({
    description: 'A scheduled term changes every field; an active term its end action only',
    standardSchema: retainerTermSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body({ schema: updateRetainerTermSchema }) input: UpdateRetainerTerm,
  ): Promise<RetainerTerm> {
    return this.terms.update(actor, retainerId, termId, input);
  }

  @Post(':termId/cancel')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerTermSchema })
  @ApiOkResponse({
    description: 'The cancelled term (scheduled terms only) with its charges cancelled',
    standardSchema: retainerTermSchema,
  })
  cancel(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body({ schema: cancelRetainerTermSchema }) input: CancelRetainerTerm,
  ): Promise<RetainerTerm> {
    return this.terms.cancel(actor, retainerId, termId, input);
  }
}
