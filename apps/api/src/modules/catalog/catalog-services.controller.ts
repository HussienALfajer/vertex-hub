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
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CatalogService,
  type CatalogServiceListQuery,
  type CatalogServicePage,
  type CreateCatalogService,
  catalogServiceListQuerySchema,
  catalogServicePageSchema,
  catalogServiceSchema,
  createCatalogServiceSchema,
  type UpdateCatalogService,
  updateCatalogServiceSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { CatalogServicesService } from './catalog-services.service.js';

@ApiTags('catalog')
@Controller('catalog/services')
export class CatalogServicesController {
  constructor(private readonly services: CatalogServicesService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @SerializeOptions({ schema: catalogServicePageSchema })
  @ApiOkResponse({
    description: 'Catalog services; archived ones with `catalog.manage` only',
    standardSchema: catalogServicePageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: catalogServiceListQuerySchema }) query: CatalogServiceListQuery,
  ): Promise<CatalogServicePage> {
    return this.services.list(actor, query);
  }

  @Post()
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: catalogServiceSchema })
  @ApiCreatedResponse({ description: 'The new service', standardSchema: catalogServiceSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createCatalogServiceSchema }) input: CreateCatalogService,
  ): Promise<CatalogService> {
    return this.services.create(actor, input);
  }

  @Patch(':id')
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: catalogServiceSchema })
  @ApiOkResponse({
    description: 'The service after the change',
    standardSchema: catalogServiceSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateCatalogServiceSchema }) input: UpdateCatalogService,
  ): Promise<CatalogService> {
    return this.services.update(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: catalogServiceSchema })
  @ApiOkResponse({ description: 'The archived service', standardSchema: catalogServiceSchema })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CatalogService> {
    return this.services.setArchived(actor, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: catalogServiceSchema })
  @ApiOkResponse({ description: 'The restored service', standardSchema: catalogServiceSchema })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CatalogService> {
    return this.services.setArchived(actor, id, false);
  }
}
