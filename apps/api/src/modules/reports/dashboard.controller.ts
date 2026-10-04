import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CompanyDashboard,
  companyDashboardSchema,
  type DepartmentDashboard,
  type DepartmentDashboardQuery,
  departmentDashboardQuerySchema,
  departmentDashboardSchema,
  type FinanceDashboard,
  financeDashboardSchema,
  type MyClientsDashboard,
  myClientsDashboardSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('company')
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: companyDashboardSchema })
  @ApiOkResponse({
    description: 'The Company section of the home page (F15 rule 1)',
    standardSchema: companyDashboardSchema,
  })
  @ApiForbiddenResponse({ description: 'Needs `reports.read` under `all`' })
  company(@CurrentUser() actor: CurrentUserInfo): Promise<CompanyDashboard> {
    return this.dashboard.company(actor);
  }

  @Get('finance')
  @RequirePermissions('reports.finance')
  @SerializeOptions({ schema: financeDashboardSchema })
  @ApiOkResponse({
    description: 'The Finance section of the home page (F15 rule 2)',
    standardSchema: financeDashboardSchema,
  })
  finance(): Promise<FinanceDashboard> {
    return this.dashboard.finance();
  }

  @Get('departments')
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: departmentDashboardSchema })
  @ApiOkResponse({
    description: 'The Departments section of the home page for one department (F15 rule 3)',
    standardSchema: departmentDashboardSchema,
  })
  @ApiForbiddenResponse({ description: 'The department is not in your `reports.read` scope' })
  departments(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: departmentDashboardQuerySchema }) query: DepartmentDashboardQuery,
  ): Promise<DepartmentDashboard> {
    return this.dashboard.department(actor, query.department);
  }

  @Get('clients')
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: myClientsDashboardSchema })
  @ApiOkResponse({
    description: 'The My clients section of the home page (F15 rule 4)',
    standardSchema: myClientsDashboardSchema,
  })
  @ApiForbiddenResponse({ description: 'Needs `reports.read` under `own_clients`' })
  clients(@CurrentUser() actor: CurrentUserInfo): Promise<MyClientsDashboard> {
    return this.dashboard.myClients(actor);
  }
}
