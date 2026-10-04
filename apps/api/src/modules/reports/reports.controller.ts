import type { ServerResponse } from 'node:http';
import { Controller, Get, Query, Res, SerializeOptions } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  type OverdueInvoicesQuery,
  type OverdueInvoicesReport,
  overdueInvoicesQuerySchema,
  overdueInvoicesReportSchema,
  type ProductivityQuery,
  type ProductivityReport,
  productivityQuerySchema,
  productivityReportSchema,
  type RevenueQuery,
  type RevenueReport,
  revenueQuerySchema,
  revenueReportSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { overdueWorkbook, productivityWorkbook, revenueWorkbook } from './excel-workbooks.js';
import { ReportsService } from './reports.service.js';
import { sendWorkbook, XLSX_MIME_TYPE } from './send-workbook.js';

/**
 * The department productivity, revenue and overdue invoices reports (spec F15, rules 8–16), on
 * screen and as Excel files (rule 24).
 */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('productivity')
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: productivityReportSchema })
  @ApiOkResponse({
    description: 'Department productivity over a period (rules 8–10)',
    standardSchema: productivityReportSchema,
  })
  @ApiBadRequestResponse({ description: '`INVALID_DATES`: to before from, or over 366 days' })
  @ApiForbiddenResponse({ description: 'A department outside your `reports.read` scope' })
  productivity(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: productivityQuerySchema }) query: ProductivityQuery,
  ): Promise<ProductivityReport> {
    return this.reports.productivity(actor, query);
  }

  @Get('productivity/export')
  @RequirePermissions('reports.read')
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOkResponse({ description: 'The productivity report as an Excel file (rule 24)' })
  async productivityExport(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: productivityQuerySchema }) query: ProductivityQuery,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const report = await this.reports.productivity(actor, query);
    sendWorkbook(
      response,
      `productivity-${report.period.from}-${report.period.to}.xlsx`,
      await productivityWorkbook(report),
    );
  }

  @Get('revenue')
  @RequirePermissions('reports.finance')
  @SerializeOptions({ schema: revenueReportSchema })
  @ApiOkResponse({
    description: 'Revenue by client and by service over a period (rules 11–15)',
    standardSchema: revenueReportSchema,
  })
  @ApiBadRequestResponse({ description: '`INVALID_DATES`: to before from, or over 366 days' })
  revenue(@Query({ schema: revenueQuerySchema }) query: RevenueQuery): Promise<RevenueReport> {
    return this.reports.revenue(query);
  }

  @Get('revenue/export')
  @RequirePermissions('reports.finance')
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOkResponse({ description: 'The revenue report as an Excel file with three sheets (rule 15)' })
  async revenueExport(
    @Query({ schema: revenueQuerySchema }) query: RevenueQuery,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const report = await this.reports.revenue(query);
    sendWorkbook(
      response,
      `revenue-${report.period.from}-${report.period.to}.xlsx`,
      await revenueWorkbook(report),
    );
  }

  @Get('overdue-invoices')
  @RequirePermissions('reports.finance')
  @SerializeOptions({ schema: overdueInvoicesReportSchema })
  @ApiOkResponse({
    description: 'Overdue invoices today with aging buckets and totals (rule 16)',
    standardSchema: overdueInvoicesReportSchema,
  })
  overdueInvoices(
    @Query({ schema: overdueInvoicesQuerySchema }) query: OverdueInvoicesQuery,
  ): Promise<OverdueInvoicesReport> {
    return this.reports.overdueInvoices(query);
  }

  @Get('overdue-invoices/export')
  @RequirePermissions('reports.finance')
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOkResponse({ description: 'The overdue invoices report as an Excel file (rule 24)' })
  async overdueInvoicesExport(
    @Query({ schema: overdueInvoicesQuerySchema }) query: OverdueInvoicesQuery,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const report = await this.reports.overdueInvoices(query);
    sendWorkbook(response, `overdue-invoices-${report.today}.xlsx`, await overdueWorkbook(report));
  }
}
