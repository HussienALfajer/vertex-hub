import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { type FileUpload, fileUploadSchema } from '@vertex-hub/contracts';
import { RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { FileContentService } from './file-content.service.js';
import { FileUploadsService } from './file-uploads.service.js';

/** The bytes of files: step 1 of an upload, content and rendered previews (spec F10). */
@ApiTags('files')
@RequireSession()
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller('files')
export class FileContentController {
  constructor(
    private readonly uploads: FileUploadsService,
    private readonly content: FileContentService,
  ) {}

  @Post('uploads')
  @SerializeOptions({ schema: fileUploadSchema })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({
    description: 'Stored, waiting to be attached for 24 hours',
    standardSchema: fileUploadSchema,
  })
  @ApiBadRequestResponse({ description: '`FILE_EMPTY`, `FILE_TYPE_BLOCKED`' })
  @ApiPayloadTooLargeResponse({ description: '`FILE_TOO_LARGE`: above 250 MB' })
  @ApiResponse({ status: 507, description: '`STORAGE_FULL`' })
  upload(
    @CurrentUser() actor: CurrentUserInfo,
    @Req() request: IncomingMessage,
  ): Promise<FileUpload> {
    return this.uploads.upload(actor, request);
  }

  @Get('versions/:id/content')
  @ApiOkResponse({ description: 'The bytes; inline only for safe preview types' })
  @ApiNotFoundResponse({ description: 'No such upload version, or not readable' })
  async fileContent(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download: string | undefined,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.content.content(actor, id, download === '1', request, response);
  }

  @Get('versions/:id/thumbnail')
  @ApiOkResponse({ description: 'A 400 px WebP thumbnail' })
  @ApiNotFoundResponse({ description: 'No ready preview, or not readable' })
  async thumbnail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.content.preview(actor, id, 'thumbnail', request, response);
  }

  @Get('versions/:id/preview')
  @ApiOkResponse({ description: 'A 1600 px WebP preview' })
  @ApiNotFoundResponse({ description: 'No ready preview, or not readable' })
  async preview(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.content.preview(actor, id, 'preview', request, response);
  }
}
