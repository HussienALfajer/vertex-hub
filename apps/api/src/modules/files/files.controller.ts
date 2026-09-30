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
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type ClientDocumentsQuery,
  type CreateFileItem,
  type CreateFileVersion,
  clientDocumentsQuerySchema,
  createFileItemSchema,
  createFileVersionSchema,
  type FileItem,
  type FileItemList,
  type FileItemListQuery,
  type FileItemPage,
  type FileLibraryPage,
  type FileLibraryQuery,
  type FileUsage,
  type FileUsageQuery,
  fileItemListQuerySchema,
  fileItemListSchema,
  fileItemPageSchema,
  fileItemSchema,
  fileLibraryPageSchema,
  fileLibraryQuerySchema,
  fileUsageQuerySchema,
  fileUsageSchema,
  type SetFinal,
  setFinalSchema,
  type UpdateFileItem,
  updateFileItemSchema,
} from '@vertex-hub/contracts';
import { RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { FileLibraryService } from './file-library.service.js';
import { FilesService } from './files.service.js';

/**
 * Files and versions (spec F10). Every route needs a session; the service checks the owner's
 * rights through its policy and answers 404 for anything the caller cannot read.
 */
@ApiTags('files')
@RequireSession()
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly library: FileLibraryService,
  ) {}

  @Get('items')
  @SerializeOptions({ schema: fileItemListSchema })
  @ApiOkResponse({
    description: 'The owner’s items, newest first',
    standardSchema: fileItemListSchema,
  })
  @ApiNotFoundResponse({ description: 'No such owner, or not readable' })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: fileItemListQuerySchema }) query: FileItemListQuery,
  ): Promise<FileItemList> {
    return this.files.list(actor, query);
  }

  @Post('items')
  @SerializeOptions({ schema: fileItemSchema })
  @ApiCreatedResponse({ description: 'The new item with v1', standardSchema: fileItemSchema })
  @ApiBadRequestResponse({ description: '`UPLOAD_NOT_FOUND`, `LINK_NOT_ALLOWED`' })
  @ApiForbiddenResponse({ description: 'No right on the owner; `NOT_CONFIDENTIAL_READER`' })
  @ApiNotFoundResponse({ description: 'No such owner, or not readable' })
  @ApiConflictResponse({
    description:
      '`FILE_NAME_TAKEN`, `LIMIT_REACHED`, `TASK_CLOSED`, `TASK_ARCHIVED`, `CLIENT_ARCHIVED`, `PROJECT_ARCHIVED`, `RETAINER_ARCHIVED`',
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createFileItemSchema }) input: CreateFileItem,
  ): Promise<FileItem> {
    return this.files.create(actor, input);
  }

  @Patch('items/:id')
  @SerializeOptions({ schema: fileItemSchema })
  @ApiOkResponse({ description: 'The item after the change', standardSchema: fileItemSchema })
  @ApiForbiddenResponse({ description: 'No right on the item; `NOT_CONFIDENTIAL_READER`' })
  @ApiNotFoundResponse({ description: 'No such item, or not readable' })
  @ApiConflictResponse({ description: '`FILE_NAME_TAKEN`, `TASK_CLOSED`, owner archived codes' })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateFileItemSchema }) input: UpdateFileItem,
  ): Promise<FileItem> {
    return this.files.update(actor, id, input);
  }

  @Post('items/:id/versions')
  @HttpCode(200)
  @SerializeOptions({ schema: fileItemSchema })
  @ApiOkResponse({ description: 'The item with its new version', standardSchema: fileItemSchema })
  @ApiBadRequestResponse({ description: '`UPLOAD_NOT_FOUND`' })
  @ApiForbiddenResponse({ description: 'No right on the item' })
  @ApiNotFoundResponse({ description: 'No such item, or not readable' })
  @ApiConflictResponse({
    description: '`NOT_VERSIONED`, `LIMIT_REACHED`, `TASK_CLOSED`, owner archived codes',
  })
  addVersion(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: createFileVersionSchema }) input: CreateFileVersion,
  ): Promise<FileItem> {
    return this.files.addVersion(actor, id, input);
  }

  @Post('items/:id/archive')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Removed (archived)' })
  @ApiForbiddenResponse({ description: 'No right on the item' })
  @ApiNotFoundResponse({ description: 'No such item, or not readable' })
  @ApiConflictResponse({ description: '`TASK_CLOSED`, owner archived codes' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.files.archiveItem(actor, id);
  }

  @Post('items/:id/restore')
  @HttpCode(200)
  @SerializeOptions({ schema: fileItemSchema })
  @ApiOkResponse({ description: 'The restored item', standardSchema: fileItemSchema })
  @ApiForbiddenResponse({ description: 'Not scope all of the owner' })
  @ApiNotFoundResponse({ description: 'No such item, or not readable' })
  @ApiConflictResponse({ description: '`FILE_NAME_TAKEN`, `LIMIT_REACHED`, `TASK_CLOSED`' })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FileItem> {
    return this.files.restoreItem(actor, id);
  }

  @Post('versions/:id/archive')
  @HttpCode(200)
  @SerializeOptions({ schema: fileItemSchema })
  @ApiOkResponse({ description: 'The item after the change', standardSchema: fileItemSchema })
  @ApiForbiddenResponse({ description: 'No right on the version' })
  @ApiNotFoundResponse({ description: 'No such version, or not readable' })
  @ApiConflictResponse({ description: '`VERSION_FINAL`, `LAST_VERSION`, `TASK_CLOSED`' })
  archiveVersion(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FileItem> {
    return this.files.archiveVersion(actor, id);
  }

  @Post('versions/:id/restore')
  @HttpCode(200)
  @SerializeOptions({ schema: fileItemSchema })
  @ApiOkResponse({ description: 'The item after the change', standardSchema: fileItemSchema })
  @ApiForbiddenResponse({ description: 'Not scope all of the owner' })
  @ApiNotFoundResponse({ description: 'No such version, or not readable' })
  @ApiConflictResponse({ description: '`LIMIT_REACHED`, `TASK_CLOSED`' })
  restoreVersion(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FileItem> {
    return this.files.restoreVersion(actor, id);
  }

  @Post('versions/:id/final')
  @HttpCode(200)
  @SerializeOptions({ schema: fileItemSchema })
  @ApiOkResponse({ description: 'The item after the change', standardSchema: fileItemSchema })
  @ApiBadRequestResponse({ description: '`NOT_DELIVERABLE`' })
  @ApiForbiddenResponse({ description: 'Not the task’s manage scope' })
  @ApiNotFoundResponse({ description: 'No such version, or not readable' })
  @ApiConflictResponse({ description: '`TASK_NOT_APPROVED`, `TASK_CLOSED`, `TASK_ARCHIVED`' })
  setFinal(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: setFinalSchema }) input: SetFinal,
  ): Promise<FileItem> {
    return this.files.setFinal(actor, id, input);
  }

  @Get('library')
  @SerializeOptions({ schema: fileLibraryPageSchema })
  @ApiOkResponse({
    description: 'Final versions of the client’s deliverables',
    standardSchema: fileLibraryPageSchema,
  })
  @ApiNotFoundResponse({ description: 'No such client, or not readable' })
  libraryPage(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: fileLibraryQuerySchema }) query: FileLibraryQuery,
  ): Promise<FileLibraryPage> {
    return this.library.library(actor, query);
  }

  @Get('documents')
  @SerializeOptions({ schema: fileItemPageSchema })
  @ApiOkResponse({
    description: 'Documents of the client, its projects and retainers',
    standardSchema: fileItemPageSchema,
  })
  @ApiNotFoundResponse({ description: 'No such client, or not readable' })
  documents(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: clientDocumentsQuerySchema }) query: ClientDocumentsQuery,
  ): Promise<FileItemPage> {
    return this.library.documents(actor, query);
  }

  @Get('usage')
  @SerializeOptions({ schema: fileUsageSchema })
  @ApiOkResponse({ description: 'Bytes used and free', standardSchema: fileUsageSchema })
  @ApiForbiddenResponse({ description: 'Not `clients.manage` scope all' })
  usage(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: fileUsageQuerySchema }) query: FileUsageQuery,
  ): Promise<FileUsage> {
    return this.library.usage(actor, query);
  }
}
