import {
  Body,
  Controller,
  Delete,
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
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CreateProject,
  createProjectSchema,
  type Image,
  imageSchema,
  type ProjectDetail,
  type ProjectListQuery,
  type ProjectPage,
  type ProjectStatusChange,
  projectDetailSchema,
  projectListQuerySchema,
  projectPageSchema,
  projectStatusChangeSchema,
  type SetImage,
  setImageSchema,
  type UpdateProject,
  updateProjectSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: projectPageSchema })
  @ApiOkResponse({ description: 'Projects', standardSchema: projectPageSchema })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: projectListQuerySchema }) query: ProjectListQuery,
  ): Promise<ProjectPage> {
    return this.projects.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: projectDetailSchema })
  @ApiOkResponse({
    description: 'A project with its milestones; money only with money access',
    standardSchema: projectDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectDetail> {
    return this.projects.detail(actor, id);
  }

  @Post()
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: projectDetailSchema })
  @ApiCreatedResponse({
    description: 'The new project (client scope; currency and installments need money access)',
    standardSchema: projectDetailSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createProjectSchema }) input: CreateProject,
  ): Promise<ProjectDetail> {
    return this.projects.create(actor, input);
  }

  @Patch(':id')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: projectDetailSchema })
  @ApiOkResponse({
    description:
      'The updated project; the project manager needs client scope, the currency money access',
    standardSchema: projectDetailSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateProjectSchema }) input: UpdateProject,
  ): Promise<ProjectDetail> {
    return this.projects.update(actor, id, input);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: projectDetailSchema })
  @ApiOkResponse({
    description: 'The project after the change; cancel needs client scope, reopen scope all',
    standardSchema: projectDetailSchema,
  })
  changeStatus(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: projectStatusChangeSchema }) change: ProjectStatusChange,
  ): Promise<ProjectDetail> {
    return this.projects.changeStatus(actor, id, change);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: projectDetailSchema })
  @ApiOkResponse({
    description: 'The archived project (scope all only)',
    standardSchema: projectDetailSchema,
  })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectDetail> {
    return this.projects.archive(actor, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: projectDetailSchema })
  @ApiOkResponse({
    description: 'The restored project (scope all only)',
    standardSchema: projectDetailSchema,
  })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectDetail> {
    return this.projects.restore(actor, id);
  }

  @Put(':id/image')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: imageSchema })
  @ApiOkResponse({
    description: 'The new project image, pending until rendered',
    standardSchema: imageSchema,
  })
  @ApiBadRequestResponse({
    description:
      '`UPLOAD_NOT_FOUND`, `IMAGE_TYPE_NOT_ALLOWED`, `IMAGE_TOO_SMALL`, `BRAND_FILE_NOT_FOUND` (only client logos come from brand files)',
  })
  @ApiPayloadTooLargeResponse({ description: '`IMAGE_TOO_LARGE`: above 10 MB' })
  @ApiForbiddenResponse({ description: 'A project outside the `projects.manage` scope' })
  @ApiNotFoundResponse({ description: 'No such readable project' })
  @ApiConflictResponse({ description: '`PROJECT_ARCHIVED`, `CLIENT_ARCHIVED`' })
  setImage(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: setImageSchema }) input: SetImage,
  ): Promise<Image> {
    return this.projects.setImage(actor, id, input);
  }

  @Delete(':id/image')
  @HttpCode(204)
  @RequirePermissions('projects.manage')
  @ApiNoContentResponse({
    description: "The project's own image is removed: it shows its client's logo again",
  })
  @ApiForbiddenResponse({ description: 'A project outside the `projects.manage` scope' })
  @ApiNotFoundResponse({ description: 'No such readable project' })
  @ApiConflictResponse({ description: '`PROJECT_ARCHIVED`, `CLIENT_ARCHIVED`' })
  removeImage(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.projects.removeImage(actor, id);
  }
}
