import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type BrandKit,
  brandKitSchema,
  type ClientDetailResponse,
  type ClientListQuery,
  type ClientPage,
  type CreateClient,
  clientDetailResponseSchema,
  clientListQuerySchema,
  clientPageSchema,
  createClientSchema,
  type SectorListResponse,
  sectorListResponseSchema,
  type UpdateBrandKit,
  type UpdateClient,
  updateBrandKitSchema,
  updateClientSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ClientsService } from './clients.service.js';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermissions('clients.read')
  @SerializeOptions({ schema: clientPageSchema })
  @ApiOkResponse({ description: 'Clients', standardSchema: clientPageSchema })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: clientListQuerySchema }) query: ClientListQuery,
  ): Promise<ClientPage> {
    return this.clients.list(actor, query);
  }

  @Get('sectors')
  @RequirePermissions('clients.read')
  @SerializeOptions({ schema: sectorListResponseSchema })
  @ApiOkResponse({ description: 'Sectors in use', standardSchema: sectorListResponseSchema })
  sectors(@CurrentUser() actor: CurrentUserInfo): Promise<SectorListResponse> {
    return this.clients.sectors(actor);
  }

  @Get(':id')
  @RequirePermissions('clients.read')
  @SerializeOptions({ schema: clientDetailResponseSchema })
  @ApiOkResponse({ description: 'A client profile', standardSchema: clientDetailResponseSchema })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientDetailResponse> {
    return this.clients.detail(actor, id);
  }

  @Post()
  @RequirePermissions('clients.manage')
  @SerializeOptions({ schema: clientDetailResponseSchema })
  @ApiCreatedResponse({
    description: 'The new client (scope all only)',
    standardSchema: clientDetailResponseSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createClientSchema }) input: CreateClient,
  ): Promise<ClientDetailResponse> {
    return this.clients.create(actor, input);
  }

  @Patch(':id')
  @RequirePermissions('clients.manage')
  @SerializeOptions({ schema: clientDetailResponseSchema })
  @ApiOkResponse({
    description: 'The updated client; account manager and healthcare need scope all',
    standardSchema: clientDetailResponseSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateClientSchema }) input: UpdateClient,
  ): Promise<ClientDetailResponse> {
    return this.clients.update(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('clients.manage')
  @SerializeOptions({ schema: clientDetailResponseSchema })
  @ApiOkResponse({
    description: 'The archived client (scope all only)',
    standardSchema: clientDetailResponseSchema,
  })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientDetailResponse> {
    return this.clients.archive(actor, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('clients.manage')
  @SerializeOptions({ schema: clientDetailResponseSchema })
  @ApiOkResponse({
    description: 'The restored client (scope all only)',
    standardSchema: clientDetailResponseSchema,
  })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientDetailResponse> {
    return this.clients.restore(actor, id);
  }

  @Put(':id/brand-kit')
  @RequirePermissions('clients.manage')
  @SerializeOptions({ schema: brandKitSchema })
  @ApiOkResponse({ description: 'The new brand kit', standardSchema: brandKitSchema })
  replaceBrandKit(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateBrandKitSchema }) kit: UpdateBrandKit,
  ): Promise<BrandKit> {
    return this.clients.replaceBrandKit(actor, id, kit);
  }
}
