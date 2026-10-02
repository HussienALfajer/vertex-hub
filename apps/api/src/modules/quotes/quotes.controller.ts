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
  type CreateQuote,
  createQuoteSchema,
  type ExtendQuote,
  extendQuoteSchema,
  type QuoteApprovalAction,
  type QuoteApprovalDecision,
  type QuoteDetail,
  type QuoteDraft,
  type QuoteListQuery,
  type QuotePage,
  type QuotePdfRender,
  quoteApprovalActionSchema,
  quoteApprovalDecisionSchema,
  quoteDetailSchema,
  quoteDraftSchema,
  quoteListQuerySchema,
  quotePageSchema,
  quotePdfRenderSchema,
  type RejectQuote,
  rejectQuoteSchema,
  type SendQuote,
  sendQuoteSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { QuotePdfService } from './quote-pdf.service.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';
import { QuotesService } from './quotes.service.js';

@ApiTags('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly workflow: QuoteWorkflowService,
    private readonly pdf: QuotePdfService,
  ) {}

  @Get()
  @RequirePermissions('quotes.read')
  @SerializeOptions({ schema: quotePageSchema })
  @ApiOkResponse({
    description: 'Quotes of the clients in scope; the latest open versions by default',
    standardSchema: quotePageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: quoteListQuerySchema }) query: QuoteListQuery,
  ): Promise<QuotePage> {
    return this.quotes.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('quotes.read')
  @SerializeOptions({ schema: quoteDetailSchema })
  @ApiOkResponse({ description: 'A quote version', standardSchema: quoteDetailSchema })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuoteDetail> {
    return this.quotes.detail(actor, id);
  }

  @Post()
  @RequirePermissions('quotes.manage')
  @SerializeOptions({ schema: quoteDetailSchema })
  @ApiCreatedResponse({ description: 'The new draft', standardSchema: quoteDetailSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createQuoteSchema }) input: CreateQuote,
  ): Promise<QuoteDetail> {
    return this.quotes.create(actor, input);
  }

  @Put(':id')
  @RequirePermissions('quotes.manage')
  @SerializeOptions({ schema: quoteDetailSchema })
  @ApiOkResponse({ description: 'The saved draft', standardSchema: quoteDetailSchema })
  saveDraft(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: quoteDraftSchema }) input: QuoteDraft,
  ): Promise<QuoteDetail> {
    return this.quotes.saveDraft(actor, id, input);
  }

  @Post(':id/approval')
  @HttpCode(200)
  @RequirePermissions('quotes.manage')
  @SerializeOptions({ schema: quoteDetailSchema })
  @ApiOkResponse({
    description: 'The draft after requesting or withdrawing discount approval',
    standardSchema: quoteDetailSchema,
  })
  approval(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: quoteApprovalActionSchema }) input: QuoteApprovalAction,
  ): Promise<QuoteDetail> {
    return this.workflow.approval(actor, id, input);
  }

  @Post(':id/approval/decision')
  @HttpCode(200)
  @RequirePermissions('quotes.approve_discount')
  @SerializeOptions({ schema: quoteDetailSchema })
  @ApiOkResponse({
    description: 'The draft after the discount was approved or returned',
    standardSchema: quoteDetailSchema,
  })
  decide(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: quoteApprovalDecisionSchema }) input: QuoteApprovalDecision,
  ): Promise<QuoteDetail> {
    return this.workflow.decide(actor, id, input);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions('quotes.manage')
  @SerializeOptions({ schema: quoteDetailSchema })
  @ApiOkResponse({ description: 'The sent quote', standardSchema: quoteDetailSchema })
  send(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: sendQuoteSchema }) input: SendQuote,
  ): Promise<QuoteDetail> {
    return this.workflow.send(actor, id, input);
  }

  @Post(':id/extend')
  @HttpCode(200)
  @RequirePermissions('quotes.manage')
  @SerializeOptions({ schema: quoteDetailSchema })
  @ApiOkResponse({ description: 'The quote, sent again', standardSchema: quoteDetailSchema })
  extend(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: extendQuoteSchema }) input: ExtendQuote,
  ): Promise<QuoteDetail> {
    return this.workflow.extend(actor, id, input);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('quotes.manage')
  @SerializeOptions({ schema: quoteDetailSchema })
  @ApiOkResponse({ description: 'The rejected quote', standardSchema: quoteDetailSchema })
  reject(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: rejectQuoteSchema }) input: RejectQuote,
  ): Promise<QuoteDetail> {
    return this.workflow.reject(actor, id, input);
  }

  @Post(':id/versions')
  @RequirePermissions('quotes.manage')
  @SerializeOptions({ schema: quoteDetailSchema })
  @ApiCreatedResponse({ description: 'The new draft version', standardSchema: quoteDetailSchema })
  newVersion(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuoteDetail> {
    return this.quotes.newVersion(actor, id);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermissions('quotes.manage')
  @ApiNoContentResponse({ description: 'The draft was discarded' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.quotes.archive(actor, id);
  }

  @Post(':id/pdf')
  @HttpCode(200)
  @RequirePermissions('quotes.read')
  @SerializeOptions({ schema: quotePdfRenderSchema })
  @ApiOkResponse({
    description:
      'Queues the draft preview (client scope) or renders a sent version again when its PDF is not ready',
    standardSchema: quotePdfRenderSchema,
  })
  renderPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuotePdfRender> {
    return this.pdf.render(actor, id);
  }

  @Get(':id/pdf')
  @RequirePermissions('quotes.read')
  @ApiQuery({ name: 'draft', required: false, enum: ['true'] })
  @ApiOkResponse({ description: 'The PDF of the version, or the draft preview with draft=true' })
  @ApiNotFoundResponse({ description: 'No such quote, or its PDF is not ready' })
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
