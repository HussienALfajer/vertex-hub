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
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type ArchiveSalaryChange,
  archiveSalaryChangeSchema,
  type CreateSalaryChange,
  createSalaryChangeSchema,
  type EmployeeFile,
  type EmployeeListQuery,
  type EmployeePage,
  type EndService,
  employeeFileSchema,
  employeeListQuerySchema,
  employeePageSchema,
  endServiceSchema,
  type Payout,
  payoutSchema,
  type SalaryChange,
  type SalaryChangeList,
  salaryChangeListSchema,
  salaryChangeSchema,
  type UpdateEmployeeFile,
  updateEmployeeFileSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { EmployeesService } from './employees.service.js';
import { SalaryChangesService } from './salary-changes.service.js';

@ApiTags('hr')
@Controller('hr')
export class HrController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly salaries: SalaryChangesService,
  ) {}

  @Get('employees')
  @RequireSession()
  @SerializeOptions({ schema: employeePageSchema })
  @ApiOkResponse({
    description: 'People: `employees.read` or `salaries.read`; pay only with `salaries.read`',
    standardSchema: employeePageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: employeeListQuerySchema }) query: EmployeeListQuery,
  ): Promise<EmployeePage> {
    return this.employees.list(actor, query);
  }

  @Get('employees/:userId')
  @RequireSession()
  @SerializeOptions({ schema: employeeFileSchema })
  @ApiOkResponse({
    description: 'An employee file, its sections by rule A2; 404 for anyone else',
    standardSchema: employeeFileSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<EmployeeFile> {
    return this.employees.detail(actor, userId);
  }

  @Patch('employees/:userId')
  @RequirePermissions('employees.manage')
  @SerializeOptions({ schema: employeeFileSchema })
  @ApiOkResponse({ description: 'The file after the change', standardSchema: employeeFileSchema })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body({ schema: updateEmployeeFileSchema }) input: UpdateEmployeeFile,
  ): Promise<EmployeeFile> {
    return this.employees.update(actor, userId, input);
  }

  @Put('employees/:userId/payout')
  @RequirePermissions('payouts.manage')
  @SerializeOptions({ schema: employeeFileSchema })
  @ApiOkResponse({ description: 'The file after the change', standardSchema: employeeFileSchema })
  setPayout(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body({ schema: payoutSchema }) input: Payout,
  ): Promise<EmployeeFile> {
    return this.employees.setPayout(actor, userId, input);
  }

  @Post('employees/:userId/end')
  @HttpCode(200)
  @RequirePermissions('employees.manage')
  @SerializeOptions({ schema: employeeFileSchema })
  @ApiOkResponse({
    description: 'The file with its end of service (rule A8)',
    standardSchema: employeeFileSchema,
  })
  endService(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body({ schema: endServiceSchema }) input: EndService,
  ): Promise<EmployeeFile> {
    return this.employees.endService(actor, userId, input);
  }

  @Delete('employees/:userId/end')
  @RequirePermissions('employees.manage')
  @SerializeOptions({ schema: employeeFileSchema })
  @ApiOkResponse({
    description: 'The file with its end of service cleared',
    standardSchema: employeeFileSchema,
  })
  clearEnd(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<EmployeeFile> {
    return this.employees.clearEnd(actor, userId);
  }

  @Get('employees/:userId/salaries')
  @RequireSession()
  @SerializeOptions({ schema: salaryChangeListSchema })
  @ApiOkResponse({
    description: 'The salary history: the employee and `salaries.read` holders; 404 otherwise',
    standardSchema: salaryChangeListSchema,
  })
  salaryHistory(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<SalaryChangeList> {
    return this.salaries.list(actor, userId);
  }

  @Post('employees/:userId/salaries')
  @RequirePermissions('salaries.manage')
  @SerializeOptions({ schema: salaryChangeSchema })
  @ApiCreatedResponse({
    description: 'The added salary change',
    standardSchema: salaryChangeSchema,
  })
  addSalary(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body({ schema: createSalaryChangeSchema }) input: CreateSalaryChange,
  ): Promise<SalaryChange> {
    return this.salaries.create(actor, userId, input);
  }

  @Post('salaries/:id/archive')
  @HttpCode(200)
  @RequirePermissions('salaries.manage')
  @SerializeOptions({ schema: salaryChangeSchema })
  @ApiOkResponse({ description: 'The archived salary change', standardSchema: salaryChangeSchema })
  archiveSalary(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: archiveSalaryChangeSchema }) input: ArchiveSalaryChange,
  ): Promise<SalaryChange> {
    return this.salaries.archive(actor, id, input);
  }
}
