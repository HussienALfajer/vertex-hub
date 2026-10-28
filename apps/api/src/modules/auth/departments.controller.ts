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
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AddDepartmentMembers,
  type ArchiveDepartment,
  addDepartmentMembersSchema,
  archiveDepartmentSchema,
  type CreateDepartment,
  createDepartmentSchema,
  type DepartmentArchivePreview,
  type DepartmentDetailResponse,
  type DepartmentListResponse,
  type DepartmentOrder,
  departmentArchivePreviewSchema,
  departmentDetailResponseSchema,
  departmentListResponseSchema,
  departmentOrderSchema,
  type MoveDepartmentMember,
  moveDepartmentMemberSchema,
  type UpdateDepartment,
  updateDepartmentSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from './current-user.decorator.js';
import { DepartmentArchiveService } from './department-archive.service.js';
import { DepartmentMembersService } from './department-members.service.js';
import { DepartmentsService } from './departments.service.js';

@ApiTags('departments')
@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly departments: DepartmentsService,
    private readonly members: DepartmentMembersService,
    private readonly archives: DepartmentArchiveService,
  ) {}

  @Get()
  @RequirePermissions('users.read')
  @SerializeOptions({ schema: departmentListResponseSchema })
  @ApiOkResponse({
    description: 'Every department: active ones in their order, then archived ones',
    standardSchema: departmentListResponseSchema,
  })
  list(): Promise<DepartmentListResponse> {
    return this.departments.list();
  }

  @Post()
  @RequirePermissions('departments.manage')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiCreatedResponse({
    description: 'The new department, last in the order',
    standardSchema: departmentDetailResponseSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createDepartmentSchema }) input: CreateDepartment,
  ): Promise<DepartmentDetailResponse> {
    return this.departments.create(actor, input);
  }

  @Put('order')
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: departmentListResponseSchema })
  @ApiOkResponse({
    description: 'The departments in their new order',
    standardSchema: departmentListResponseSchema,
  })
  order(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: departmentOrderSchema }) input: DepartmentOrder,
  ): Promise<DepartmentListResponse> {
    return this.departments.order(actor, input);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiOkResponse({
    description: 'A department with its members and what it grants',
    standardSchema: departmentDetailResponseSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartmentDetailResponse> {
    return this.departments.detail(actor, id);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiOkResponse({
    description: 'The department after the change',
    standardSchema: departmentDetailResponseSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateDepartmentSchema }) input: UpdateDepartment,
  ): Promise<DepartmentDetailResponse> {
    return this.departments.update(actor, id, input);
  }

  @Get(':id/archive-preview')
  @RequirePermissions('departments.manage')
  @SerializeOptions({ schema: departmentArchivePreviewSchema })
  @ApiOkResponse({
    description: 'What archiving the department would move, by category',
    standardSchema: departmentArchivePreviewSchema,
  })
  archivePreview(@Param('id', ParseUUIDPipe) id: string): Promise<DepartmentArchivePreview> {
    return this.archives.preview(id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('departments.manage')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiOkResponse({
    description: 'The archived department, after its work moved',
    standardSchema: departmentDetailResponseSchema,
  })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: archiveDepartmentSchema }) input: ArchiveDepartment,
  ): Promise<DepartmentDetailResponse> {
    return this.archives.archive(actor, id, input);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('departments.manage')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiOkResponse({
    description: 'The restored department, empty and last in the order',
    standardSchema: departmentDetailResponseSchema,
  })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartmentDetailResponse> {
    return this.departments.restore(actor, id);
  }

  @Post(':id/members')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiOkResponse({
    description: 'The department with its new secondary members',
    standardSchema: departmentDetailResponseSchema,
  })
  addMembers(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: addDepartmentMembersSchema }) input: AddDepartmentMembers,
  ): Promise<DepartmentDetailResponse> {
    return this.members.add(actor, id, input);
  }

  @Post(':id/members/:userId/primary')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiOkResponse({
    description: 'The department, now the member’s primary one',
    standardSchema: departmentDetailResponseSchema,
  })
  makePrimary(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<DepartmentDetailResponse> {
    return this.members.makePrimary(actor, id, userId);
  }

  @Post(':id/members/:userId/move')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiOkResponse({
    description: 'This department, after the member moved to another one',
    standardSchema: departmentDetailResponseSchema,
  })
  moveMember(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body({ schema: moveDepartmentMemberSchema }) input: MoveDepartmentMember,
  ): Promise<DepartmentDetailResponse> {
    return this.members.move(actor, id, userId, input);
  }

  @Delete(':id/members/:userId')
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiOkResponse({
    description: 'The department without the secondary member',
    standardSchema: departmentDetailResponseSchema,
  })
  removeMember(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<DepartmentDetailResponse> {
    return this.members.remove(actor, id, userId);
  }
}
