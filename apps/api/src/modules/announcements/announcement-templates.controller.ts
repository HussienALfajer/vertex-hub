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
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type AnnouncementTemplate,
  type AnnouncementTemplateList,
  announcementTemplateListSchema,
  announcementTemplateSchema,
  type CreateAnnouncementTemplate,
  createAnnouncementTemplateSchema,
  type UpdateAnnouncementTemplate,
  updateAnnouncementTemplateSchema,
} from '@vertex-hub/contracts';
import { RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { AnnouncementTemplatesService } from './announcement-templates.service.js';

/**
 * F16 rule D12: everyone keeps personal templates and reads the shared ones; the service checks
 * `announcements.manage` `all` for shared ones and answers 404 for someone else's personal one.
 */
@ApiTags('announcements')
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller('announcement-templates')
export class AnnouncementTemplatesController {
  constructor(private readonly templates: AnnouncementTemplatesService) {}

  @Get()
  @RequireSession()
  @SerializeOptions({ schema: announcementTemplateListSchema })
  @ApiOkResponse({
    description: "The caller's personal templates, then the shared ones",
    standardSchema: announcementTemplateListSchema,
  })
  list(@CurrentUser() actor: CurrentUserInfo): Promise<AnnouncementTemplateList> {
    return this.templates.list(actor);
  }

  @Post()
  @RequireSession()
  @SerializeOptions({ schema: announcementTemplateSchema })
  @ApiCreatedResponse({ description: 'The template', standardSchema: announcementTemplateSchema })
  @ApiBadRequestResponse({ description: 'Invalid input' })
  @ApiForbiddenResponse({ description: 'Shared without `announcements.manage` scope all' })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createAnnouncementTemplateSchema }) input: CreateAnnouncementTemplate,
  ): Promise<AnnouncementTemplate> {
    return this.templates.create(actor, input);
  }

  @Patch(':id')
  @RequireSession()
  @SerializeOptions({ schema: announcementTemplateSchema })
  @ApiOkResponse({ description: 'The template', standardSchema: announcementTemplateSchema })
  @ApiForbiddenResponse({ description: 'Shared without `announcements.manage` scope all' })
  @ApiNotFoundResponse({ description: 'No such template, or not for the caller' })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateAnnouncementTemplateSchema }) input: UpdateAnnouncementTemplate,
  ): Promise<AnnouncementTemplate> {
    return this.templates.update(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: announcementTemplateSchema })
  @ApiOkResponse({
    description: 'The template, archived',
    standardSchema: announcementTemplateSchema,
  })
  @ApiForbiddenResponse({ description: 'Shared without `announcements.manage` scope all' })
  @ApiNotFoundResponse({ description: 'No such template, or not for the caller' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AnnouncementTemplate> {
    return this.templates.archive(actor, id);
  }
}
