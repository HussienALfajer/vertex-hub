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
  type CatalogPackage,
  type CatalogPackageListQuery,
  type CatalogPackagePage,
  type CreateCatalogPackage,
  catalogPackageListQuerySchema,
  catalogPackagePageSchema,
  catalogPackageSchema,
  createCatalogPackageSchema,
  type UpdateCatalogPackage,
  updateCatalogPackageSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { CatalogPackagesService } from './catalog-packages.service.js';

@ApiTags('catalog')
@Controller('catalog/packages')
export class CatalogPackagesController {
  constructor(private readonly packages: CatalogPackagesService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @SerializeOptions({ schema: catalogPackagePageSchema })
  @ApiOkResponse({
    description: 'Catalog packages with their items; archived ones with `catalog.manage` only',
    standardSchema: catalogPackagePageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: catalogPackageListQuerySchema }) query: CatalogPackageListQuery,
  ): Promise<CatalogPackagePage> {
    return this.packages.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('catalog.read')
  @SerializeOptions({ schema: catalogPackageSchema })
  @ApiOkResponse({ description: 'A package with its items', standardSchema: catalogPackageSchema })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CatalogPackage> {
    return this.packages.detail(actor, id);
  }

  @Post()
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: catalogPackageSchema })
  @ApiCreatedResponse({ description: 'The new package', standardSchema: catalogPackageSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createCatalogPackageSchema }) input: CreateCatalogPackage,
  ): Promise<CatalogPackage> {
    return this.packages.create(actor, input);
  }

  @Patch(':id')
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: catalogPackageSchema })
  @ApiOkResponse({
    description: 'The package after the change; `items`, when given, replaces every item',
    standardSchema: catalogPackageSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateCatalogPackageSchema }) input: UpdateCatalogPackage,
  ): Promise<CatalogPackage> {
    return this.packages.update(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: catalogPackageSchema })
  @ApiOkResponse({ description: 'The archived package', standardSchema: catalogPackageSchema })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CatalogPackage> {
    return this.packages.setArchived(actor, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: catalogPackageSchema })
  @ApiOkResponse({ description: 'The restored package', standardSchema: catalogPackageSchema })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CatalogPackage> {
    return this.packages.setArchived(actor, id, false);
  }
}
