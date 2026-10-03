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
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type ClientBilling,
  type ClientStatement,
  type ClientStatementQuery,
  type CreateProjectExpense,
  clientBillingSchema,
  clientStatementQuerySchema,
  clientStatementSchema,
  createProjectExpenseSchema,
  type ProjectBilling,
  projectBillingSchema,
  type RetainerBilling,
  retainerBillingSchema,
  type UpdateProjectExpense,
  updateProjectExpenseSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { InvoiceBillingService } from './invoice-billing.service.js';
import { ProjectExpensesService } from './project-expenses.service.js';

/**
 * Client balances and statements, project and retainer billing summaries, and project expenses
 * (spec F13, "Statements, expenses, billing summaries"). Reads need money access over the client.
 */
@ApiTags('invoices')
@Controller()
export class InvoiceBillingController {
  constructor(
    private readonly billing: InvoiceBillingService,
    private readonly expenses: ProjectExpensesService,
  ) {}

  @Get('clients/:id/billing')
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: clientBillingSchema })
  @ApiOkResponse({
    description: "The client's balances per currency and its newest invoices",
    standardSchema: clientBillingSchema,
  })
  clientBilling(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientBilling> {
    return this.billing.clientBilling(actor, id);
  }

  @Get('clients/:id/statement')
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: clientStatementSchema })
  @ApiOkResponse({
    description: "The client's statement in one currency (rule 28)",
    standardSchema: clientStatementSchema,
  })
  statement(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: clientStatementQuerySchema }) query: ClientStatementQuery,
  ): Promise<ClientStatement> {
    return this.billing.statement(actor, id, query);
  }

  @Get('projects/:id/billing')
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: projectBillingSchema })
  @ApiOkResponse({
    description: 'Milestones with their invoices, invoices, expenses and margin (money access)',
    standardSchema: projectBillingSchema,
  })
  projectBilling(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectBilling> {
    return this.billing.projectBilling(actor, id);
  }

  @Post('projects/:id/expenses')
  @RequirePermissions('expenses.manage')
  @SerializeOptions({ schema: projectBillingSchema })
  @ApiCreatedResponse({
    description: "The project's billing with the new expense",
    standardSchema: projectBillingSchema,
  })
  createExpense(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: createProjectExpenseSchema }) input: CreateProjectExpense,
  ): Promise<ProjectBilling> {
    return this.expenses.create(actor, id, input);
  }

  @Patch('project-expenses/:id')
  @RequirePermissions('expenses.manage')
  @SerializeOptions({ schema: projectBillingSchema })
  @ApiOkResponse({
    description: "The project's billing with the edited expense",
    standardSchema: projectBillingSchema,
  })
  updateExpense(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateProjectExpenseSchema }) input: UpdateProjectExpense,
  ): Promise<ProjectBilling> {
    return this.expenses.update(actor, id, input);
  }

  @Post('project-expenses/:id/archive')
  @HttpCode(200)
  @RequirePermissions('expenses.manage')
  @SerializeOptions({ schema: projectBillingSchema })
  @ApiOkResponse({
    description: "The project's billing without the archived expense",
    standardSchema: projectBillingSchema,
  })
  archiveExpense(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectBilling> {
    return this.expenses.archive(actor, id);
  }

  @Get('retainers/:id/billing')
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: retainerBillingSchema })
  @ApiOkResponse({
    description: 'Cycles and extra work with their invoices, and invoices (money access)',
    standardSchema: retainerBillingSchema,
  })
  retainerBilling(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RetainerBilling> {
    return this.billing.retainerBilling(actor, id);
  }
}
