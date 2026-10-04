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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  type BillableItems,
  type BillableItemsQuery,
  billableItemsQuerySchema,
  billableItemsSchema,
  type ChangeInvoiceDueDate,
  type CreateInvoice,
  changeInvoiceDueDateSchema,
  createInvoiceSchema,
  type InvoiceDetail,
  type InvoiceDraft,
  type InvoiceListQuery,
  type InvoicePage,
  type IssueInvoice,
  invoiceDetailSchema,
  invoiceDraftSchema,
  invoiceListQuerySchema,
  invoicePageSchema,
  issueInvoiceSchema,
  type QuotePdfRender,
  quotePdfRenderSchema,
  type UpdateInvoiceServices,
  updateInvoiceServicesSchema,
  type VoidInvoice,
  voidInvoiceSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { InvoiceWorkflowService } from './invoice-workflow.service.js';
import { InvoicesService } from './invoices.service.js';

@ApiTags('invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly workflow: InvoiceWorkflowService,
    private readonly pdf: InvoicePdfService,
  ) {}

  @Get()
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: invoicePageSchema })
  @ApiOkResponse({
    description: 'Invoices of the clients in scope; drafts and open invoices by default',
    standardSchema: invoicePageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: invoiceListQuerySchema }) query: InvoiceListQuery,
  ): Promise<InvoicePage> {
    return this.invoices.list(actor, query);
  }

  @Get('billable')
  @RequirePermissions('invoices.manage')
  @SerializeOptions({ schema: billableItemsSchema })
  @ApiOkResponse({
    description: "The client's work in the currency that no live invoice holds",
    standardSchema: billableItemsSchema,
  })
  billable(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: billableItemsQuerySchema }) query: BillableItemsQuery,
  ): Promise<BillableItems> {
    return this.invoices.billable(actor, query);
  }

  @Get(':id')
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: invoiceDetailSchema })
  @ApiOkResponse({ description: 'An invoice', standardSchema: invoiceDetailSchema })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceDetail> {
    return this.invoices.detail(actor, id);
  }

  @Post()
  @RequirePermissions('invoices.manage')
  @SerializeOptions({ schema: invoiceDetailSchema })
  @ApiCreatedResponse({ description: 'The new draft', standardSchema: invoiceDetailSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createInvoiceSchema }) input: CreateInvoice,
  ): Promise<InvoiceDetail> {
    return this.invoices.create(actor, input);
  }

  @Put(':id')
  @RequirePermissions('invoices.manage')
  @SerializeOptions({ schema: invoiceDetailSchema })
  @ApiOkResponse({ description: 'The saved draft', standardSchema: invoiceDetailSchema })
  saveDraft(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: invoiceDraftSchema }) input: InvoiceDraft,
  ): Promise<InvoiceDetail> {
    return this.invoices.saveDraft(actor, id, input);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequirePermissions('invoices.manage')
  @SerializeOptions({ schema: invoiceDetailSchema })
  @ApiOkResponse({
    description: 'The issued invoice with its number, rate and due date',
    standardSchema: invoiceDetailSchema,
  })
  issue(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: issueInvoiceSchema }) input: IssueInvoice,
  ): Promise<InvoiceDetail> {
    return this.workflow.issue(actor, id, input);
  }

  @Post(':id/due-date')
  @HttpCode(200)
  @RequirePermissions('invoices.manage')
  @SerializeOptions({ schema: invoiceDetailSchema })
  @ApiOkResponse({
    description: 'The invoice with its new due date and status',
    standardSchema: invoiceDetailSchema,
  })
  changeDueDate(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: changeInvoiceDueDateSchema }) input: ChangeInvoiceDueDate,
  ): Promise<InvoiceDetail> {
    return this.workflow.changeDueDate(actor, id, input);
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermissions('invoices.manage')
  @SerializeOptions({ schema: invoiceDetailSchema })
  @ApiOkResponse({ description: 'The voided invoice', standardSchema: invoiceDetailSchema })
  void(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: voidInvoiceSchema }) input: VoidInvoice,
  ): Promise<InvoiceDetail> {
    return this.workflow.void(actor, id, input);
  }

  @Put(':id/services')
  @RequirePermissions('invoices.manage')
  @SerializeOptions({ schema: invoiceDetailSchema })
  @ApiOkResponse({
    description: 'The invoice with the services of its lines (F15 rule 22)',
    standardSchema: invoiceDetailSchema,
  })
  @ApiNotFoundResponse({ description: 'No such invoice in your scope' })
  updateServices(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateInvoiceServicesSchema }) input: UpdateInvoiceServices,
  ): Promise<InvoiceDetail> {
    return this.workflow.updateServices(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermissions('invoices.manage')
  @ApiNoContentResponse({ description: 'The draft was discarded' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.invoices.archive(actor, id);
  }

  @Post(':id/pdf')
  @HttpCode(200)
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: quotePdfRenderSchema })
  @ApiOkResponse({
    description:
      'Queues the draft preview (managers) or renders an issued invoice again when its PDF is not ready',
    standardSchema: quotePdfRenderSchema,
  })
  renderPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuotePdfRender> {
    return this.pdf.render(actor, id);
  }

  @Get(':id/pdf')
  @RequirePermissions('invoices.read')
  @ApiQuery({ name: 'draft', required: false, enum: ['true'] })
  @ApiOkResponse({ description: 'The PDF of the invoice, or the draft preview with draft=true' })
  @ApiNotFoundResponse({ description: 'No such invoice, or its PDF is not ready' })
  async downloadPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('draft') draft: string | undefined,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.pdf.serve(actor, id, draft === 'true', request, response);
  }
}
