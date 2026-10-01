import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Body,
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  type NestInterceptor,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  SerializeOptions,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import {
  errorResponseSchema,
  type PublicApproval,
  type PublicApprovalItem,
  type PublicResponse,
  publicApprovalItemSchema,
  publicApprovalSchema,
  publicResponseSchema,
} from '@vertex-hub/contracts';
import { PublicApprovalsService } from './public-approvals.service.js';

/**
 * Rule 23: nothing of the client page is cached, sent as a referrer or indexed. Set before the
 * handler runs, so the error answers carry the headers too.
 */
@Injectable()
export class PublicHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const response = context.switchToHttp().getResponse<ServerResponse>();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Robots-Tag', 'noindex');
    return next.handle();
  }
}

/** nginx passes the client address in `X-Forwarded-For` (deploy/nginx). */
function addressOf(request: IncomingMessage): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || request.socket.remoteAddress || null;
}

/**
 * The client page of an approval link (spec F09, "Public"): no session and no cookie, the token
 * is the access. nginx rate-limits `/api/public/` per address.
 */
@ApiTags('approvals')
@AllowAnonymous()
@UseInterceptors(PublicHeadersInterceptor)
@ApiNotFoundResponse({
  description: '`APPROVAL_LINK_INVALID`: unknown or revoked link, or its client or contact changed',
  standardSchema: errorResponseSchema,
})
@ApiGoneResponse({ description: '`APPROVAL_LINK_EXPIRED`', standardSchema: errorResponseSchema })
@Controller('public/approvals/:token')
export class PublicApprovalsController {
  constructor(private readonly approvals: PublicApprovalsService) {}

  @Get()
  @SerializeOptions({ schema: publicApprovalSchema })
  @ApiOkResponse({
    description: 'What the holder of the link sees',
    standardSchema: publicApprovalSchema,
  })
  page(@Param('token') token: string): Promise<PublicApproval> {
    return this.approvals.page(token);
  }

  @Post('items/:itemId/response')
  @HttpCode(200)
  @SerializeOptions({ schema: publicApprovalItemSchema })
  @ApiOkResponse({
    description: 'The item with the decision, which is final',
    standardSchema: publicApprovalItemSchema,
  })
  @ApiConflictResponse({ description: '`ITEM_ALREADY_DECIDED`, `ITEM_WITHDRAWN`' })
  respond(
    @Param('token') token: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body({ schema: publicResponseSchema }) input: PublicResponse,
    @Req() request: IncomingMessage,
  ): Promise<PublicApprovalItem> {
    return this.approvals.respond(token, itemId, input, {
      ip: addressOf(request),
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Get('versions/:versionId/content')
  @ApiOkResponse({
    description: 'The bytes of a snapshot version; a download only for other types',
  })
  async content(
    @Param('token') token: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.approvals.serve(token, versionId, 'content', request, response);
  }

  @Get('versions/:versionId/preview')
  @ApiOkResponse({ description: 'A 1600 px WebP preview of a snapshot image' })
  async preview(
    @Param('token') token: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.approvals.serve(token, versionId, 'preview', request, response);
  }

  @Get('versions/:versionId/thumbnail')
  @ApiOkResponse({ description: 'A 400 px WebP thumbnail of a snapshot image' })
  async thumbnail(
    @Param('token') token: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.approvals.serve(token, versionId, 'thumbnail', request, response);
  }
}
