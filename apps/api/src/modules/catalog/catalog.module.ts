import { Module } from '@nestjs/common';
import { TemplatesModule } from '../templates/index.js';
import { CatalogDirectory } from './catalog-directory.js';
import { CatalogPackagesController } from './catalog-packages.controller.js';
import { CatalogPackagesService } from './catalog-packages.service.js';
import { CatalogServicesController } from './catalog-services.controller.js';
import { CatalogServicesService } from './catalog-services.service.js';
import { CatalogUsage } from './catalog-usage.js';

/**
 * Service catalog (F04, ADR 0023): services and packages with their prices. Reads template names
 * and kinds through the `TemplateDirectory` of `templates`; quotes copy items through
 * `CatalogDirectory` and report their use through `CatalogUsage`.
 */
@Module({
  imports: [TemplatesModule],
  controllers: [CatalogServicesController, CatalogPackagesController],
  providers: [CatalogServicesService, CatalogPackagesService, CatalogDirectory, CatalogUsage],
  exports: [CatalogDirectory, CatalogUsage],
})
export class CatalogModule {}
