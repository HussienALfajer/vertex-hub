import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { ENV, type Env } from './config/env.js';

export const API_PREFIX = 'api';

/** Configuration shared by the real server and the integration tests. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  // Don't advertise the framework in every response.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder().setTitle('Vertex Hub API').setVersion('0.0.0').build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
  }
}
