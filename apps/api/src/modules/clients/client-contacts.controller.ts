import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type Contact,
  type CreateContact,
  contactSchema,
  createContactSchema,
  type UpdateContact,
  updateContactSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ClientContactsService } from './client-contacts.service.js';

@ApiTags('clients')
@Controller('clients/:id/contacts')
export class ClientContactsController {
  constructor(private readonly contacts: ClientContactsService) {}

  @Post()
  @RequirePermissions('clients.manage')
  @SerializeOptions({ schema: contactSchema })
  @ApiCreatedResponse({ description: 'The new contact', standardSchema: contactSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body({ schema: createContactSchema }) input: CreateContact,
  ): Promise<Contact> {
    return this.contacts.create(actor, clientId, input);
  }

  @Patch(':contactId')
  @RequirePermissions('clients.manage')
  @SerializeOptions({ schema: contactSchema })
  @ApiOkResponse({ description: 'The updated contact', standardSchema: contactSchema })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body({ schema: updateContactSchema }) input: UpdateContact,
  ): Promise<Contact> {
    return this.contacts.update(actor, clientId, contactId, input);
  }

  @Post(':contactId/archive')
  @HttpCode(204)
  @RequirePermissions('clients.manage')
  @ApiNoContentResponse({ description: 'The contact is removed from the client' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ): Promise<void> {
    return this.contacts.archive(actor, clientId, contactId);
  }
}
