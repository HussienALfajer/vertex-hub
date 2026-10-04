import type { IncomingMessage, ServerResponse } from 'node:http';
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
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  type ClientMonthlyReport,
  type ClientReportQuery,
  clientMonthlyReportSchema,
  clientReportQuerySchema,
  type QuotePdfRender,
  quotePdfRenderSchema,
  type UpdateClientReportSummary,
  updateClientReportSummarySchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ClientReportService } from './client-report.service.js';
import { clientReportWorkbook } from './excel-workbooks.js';
import { sendWorkbook, XLSX_MIME_TYPE } from './send-workbook.js';

/**
 * The monthly client report (spec F15, rules 17–20): on screen, as Excel and as a PDF, with the
 * account manager's summary. A client outside the caller's `reports.read` scope is a 404.
 */
@ApiTags('reports')
@Controller('clients/:id/monthly-report')
export class ClientReportController {
  constructor(private readonly reports: ClientReportService) {}

  @Get()
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: clientMonthlyReportSchema })
  @ApiOkResponse({
    description: "The client's report for a month (rules 17 and 18)",
    standardSchema: clientMonthlyReportSchema,
  })
  @ApiBadRequestResponse({ description: '`INVALID_MONTH`: a month after the current one' })
  @ApiNotFoundResponse({ description: 'No such client in your `reports.read` scope' })
  report(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: clientReportQuerySchema }) query: ClientReportQuery,
  ): Promise<ClientMonthlyReport> {
    return this.reports.report(actor, id, query.month);
  }

  @Get('export')
  @RequirePermissions('reports.read')
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOkResponse({ description: 'The report as an Excel file (rule 24)' })
  async export(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: clientReportQuerySchema }) query: ClientReportQuery,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const report = await this.reports.report(actor, id, query.month);
    sendWorkbook(
      response,
      `client-report-${report.client.name}-${report.month}.xlsx`,
      await clientReportWorkbook(report),
    );
  }

  @Put('summary')
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: clientMonthlyReportSchema })
  @ApiOkResponse({
    description: "Replaces the month's summary; an empty text clears it (rule 19)",
    standardSchema: clientMonthlyReportSchema,
  })
  @ApiBadRequestResponse({ description: '`INVALID_MONTH`: a month after the current one' })
  @ApiNotFoundResponse({ description: 'No such client in your `reports.read` scope' })
  saveSummary(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateClientReportSummarySchema }) input: UpdateClientReportSummary,
  ): Promise<ClientMonthlyReport> {
    return this.reports.saveSummary(actor, id, input.month, input.summary);
  }

  @Post('pdf')
  @HttpCode(200)
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: quotePdfRenderSchema })
  @ApiOkResponse({
    description: 'Queues the PDF of the report as it is now (rule 20), or finds it ready',
    standardSchema: quotePdfRenderSchema,
  })
  renderPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: clientReportQuerySchema }) query: ClientReportQuery,
  ): Promise<QuotePdfRender> {
    return this.reports.requestPdf(actor, id, query.month);
  }

  @Get('pdf')
  @RequirePermissions('reports.read')
  @ApiOkResponse({ description: 'The report PDF, for 24 hours after it was asked for' })
  @ApiNotFoundResponse({ description: 'No such client, or no ready PDF of this report' })
  async downloadPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: clientReportQuerySchema }) query: ClientReportQuery,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.reports.servePdf(actor, id, query.month, request, response);
  }
}
