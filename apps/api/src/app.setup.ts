import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { ENV, type Env } from './core/config/env.js';
import { sameOriginOnly } from './core/http/same-origin.js';

export const API_PREFIX = 'api';

/** Configuration shared by the real server and the integration tests. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  // Don't advertise the framework in every response.
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  // Refuses cross-origin state changes on every route (CSRF), Better Auth's included.
  app.use(sameOriginOnly(env.APP_URL));

  if (env.NODE_ENV !== 'production') {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, createOpenApiDocument(app));
  }
}

/** The OpenAPI document, generated from the contracts on each route (ADR 0012). */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('Vertex Hub API').setVersion('0.0.0').build();
  return SwaggerModule.createDocument(app, config);
}
