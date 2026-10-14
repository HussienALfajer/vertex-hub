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
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type CycleReport,
  cycleReportSchema,
  type QuotePdfRender,
  quotePdfRenderSchema,
  type UpdateCycleReportSummary,
  updateCycleReportSummarySchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { CycleReportService } from './cycle-report.service.js';
import { cycleReportWorkbook } from './excel-workbooks.js';
import { sendWorkbook, XLSX_MIME_TYPE } from './send-workbook.js';

const NOT_FOUND =
  'No such retainer cycle, a backdated one, or its client is outside your `reports.read` scope';

/**
 * The retainer cycle report (spec F05C R1–R3): on screen, as Excel and as a PDF, with the
 * account manager's summary. A cycle whose client is outside the caller's `reports.read` scope is
 * a 404.
 */
@ApiTags('reports')
@Controller('retainers/:id/cycles/:cycleId/report')
export class CycleReportController {
  constructor(private readonly reports: CycleReportService) {}

  @Get()
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: cycleReportSchema })
  @ApiOkResponse({ description: "The cycle's report (R2)", standardSchema: cycleReportSchema })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  report(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
  ): Promise<CycleReport> {
    return this.reports.report(actor, id, cycleId);
  }

  @Get('export')
  @RequirePermissions('reports.read')
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOkResponse({ description: 'The report as an Excel file' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  async export(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const report = await this.reports.report(actor, id, cycleId);
    sendWorkbook(
      response,
      `cycle-report-${report.client.name}-${report.retainer.name}-${report.cycle.number}.xlsx`,
      await cycleReportWorkbook(report),
    );
  }

  @Put('summary')
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: cycleReportSchema })
  @ApiOkResponse({
    description: "Replaces the cycle's summary; an empty text clears it (R3)",
    standardSchema: cycleReportSchema,
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  saveSummary(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Body({ schema: updateCycleReportSummarySchema }) input: UpdateCycleReportSummary,
  ): Promise<CycleReport> {
    return this.reports.saveSummary(actor, id, cycleId, input.summary);
  }

  @Post('pdf')
  @HttpCode(200)
  @RequirePermissions('reports.read')
  @SerializeOptions({ schema: quotePdfRenderSchema })
  @ApiOkResponse({
    description: 'Finds the stored PDF of the report as it is now, or queues a new render (R3)',
    standardSchema: quotePdfRenderSchema,
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  renderPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
  ): Promise<QuotePdfRender> {
    return this.reports.requestPdf(actor, id, cycleId);
  }

  @Get('pdf')
  @RequirePermissions('reports.read')
  @ApiOkResponse({ description: 'The report PDF, while it is the report as it is now' })
  @ApiNotFoundResponse({ description: `${NOT_FOUND}; or no current PDF` })
  async downloadPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.reports.servePdf(actor, id, cycleId, request, response);
  }
}
