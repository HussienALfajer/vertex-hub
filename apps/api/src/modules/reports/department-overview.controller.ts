import { Controller, Get, Param, ParseUUIDPipe, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type DepartmentOverview, departmentOverviewSchema } from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { DepartmentOverviewService } from './department-overview.service.js';

/** The overview tab of a department's page (F23); the department itself is `auth`'s. */
@ApiTags('departments')
@Controller('departments')
export class DepartmentOverviewController {
  constructor(private readonly overviews: DepartmentOverviewService) {}

  @Get(':id/overview')
  @RequirePermissions('users.read')
  @SerializeOptions({ schema: departmentOverviewSchema })
  @ApiOkResponse({
    description: 'Counts for everyone; the workload and leave for its report readers',
    standardSchema: departmentOverviewSchema,
  })
  overview(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartmentOverview> {
    return this.overviews.overview(actor, id);
  }
}
