import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateTemplate,
  createTemplateSchema,
  type TemplateDetail,
  type TemplateListQuery,
  type TemplatePage,
  templateDetailSchema,
  templateListQuerySchema,
  templatePageSchema,
  type UpdateTemplate,
  updateTemplateSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TemplatesService } from './templates.service.js';

@ApiTags('templates')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions('templates.read')
  @SerializeOptions({ schema: templatePageSchema })
  @ApiOkResponse({
    description: 'Work templates; archived ones with `templates.manage` only',
    standardSchema: templatePageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: templateListQuerySchema }) query: TemplateListQuery,
  ): Promise<TemplatePage> {
    return this.templates.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('templates.read')
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiOkResponse({
    description: 'A template with its stages, steps and default assignees',
    standardSchema: templateDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateDetail> {
    return this.templates.detail(actor, id);
  }

  @Post()
  @RequirePermissions('templates.manage')
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiCreatedResponse({ description: 'The new template', standardSchema: templateDetailSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createTemplateSchema }) input: CreateTemplate,
  ): Promise<TemplateDetail> {
    return this.templates.create(actor, input);
  }

  @Put(':id')
  @RequirePermissions('templates.manage')
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiOkResponse({
    description: 'The template after replacing its document; a `key` equal to an id keeps that row',
    standardSchema: templateDetailSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateTemplateSchema }) input: UpdateTemplate,
  ): Promise<TemplateDetail> {
    return this.templates.update(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('templates.manage')
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiOkResponse({ description: 'The archived template', standardSchema: templateDetailSchema })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateDetail> {
    return this.templates.setArchived(actor, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('templates.manage')
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiOkResponse({ description: 'The restored template', standardSchema: templateDetailSchema })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateDetail> {
    return this.templates.setArchived(actor, id, false);
  }
}
