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
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateNote,
  createNoteSchema,
  type Note,
  type NoteListQuery,
  type NotePage,
  noteListQuerySchema,
  notePageSchema,
  noteSchema,
  type UpdateNote,
  updateNoteSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ClientNotesService } from './client-notes.service.js';

@ApiTags('clients')
@Controller('clients/:id/notes')
export class ClientNotesController {
  constructor(private readonly notes: ClientNotesService) {}

  @Get()
  @RequirePermissions('clients.read')
  @SerializeOptions({ schema: notePageSchema })
  @ApiOkResponse({ description: 'The communication log', standardSchema: notePageSchema })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Query({ schema: noteListQuerySchema }) query: NoteListQuery,
  ): Promise<NotePage> {
    return this.notes.list(actor, clientId, query);
  }

  @Post()
  @RequirePermissions('clients.log')
  @SerializeOptions({ schema: noteSchema })
  @ApiCreatedResponse({ description: 'The new note', standardSchema: noteSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body({ schema: createNoteSchema }) input: CreateNote,
  ): Promise<Note> {
    return this.notes.create(actor, clientId, input);
  }

  @Patch(':noteId')
  @RequirePermissions('clients.log')
  @SerializeOptions({ schema: noteSchema })
  @ApiOkResponse({ description: 'The updated note (author only)', standardSchema: noteSchema })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body({ schema: updateNoteSchema }) input: UpdateNote,
  ): Promise<Note> {
    return this.notes.update(actor, clientId, noteId, input);
  }

  @Post(':noteId/archive')
  @HttpCode(204)
  @RequirePermissions('clients.log')
  @ApiNoContentResponse({ description: 'The note is withdrawn from the log' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<void> {
    return this.notes.archive(actor, clientId, noteId);
  }
}
