import { Module } from '@nestjs/common';
import { TemplatesModule } from '../templates/index.js';
import { CatalogPackagesController } from './catalog-packages.controller.js';
import { CatalogPackagesService } from './catalog-packages.service.js';
import { CatalogServicesController } from './catalog-services.controller.js';
import { CatalogServicesService } from './catalog-services.service.js';

/**
 * Service catalog (F04, ADR 0023): services and packages with their prices. Reads template names
 * and kinds through the `TemplateDirectory` of `templates`.
 */
@Module({
  imports: [TemplatesModule],
  controllers: [CatalogServicesController, CatalogPackagesController],
  providers: [CatalogServicesService, CatalogPackagesService],
})
export class CatalogModule {}
