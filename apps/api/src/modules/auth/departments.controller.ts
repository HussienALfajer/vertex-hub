import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type DepartmentDetailResponse,
  type DepartmentListResponse,
  departmentDetailResponseSchema,
  departmentListResponseSchema,
  type UpdateDepartment,
  updateDepartmentSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from './current-user.decorator.js';
import { DepartmentsService } from './departments.service.js';

@ApiTags('departments')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions('users.read')
  @SerializeOptions({ schema: departmentListResponseSchema })
  @ApiOkResponse({
    description: 'The ten departments',
    standardSchema: departmentListResponseSchema,
  })
  list(): Promise<DepartmentListResponse> {
    return this.departments.list();
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @SerializeOptions({ schema: departmentDetailResponseSchema })
  @ApiOkResponse({
    description: 'A department with its members',
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
}
