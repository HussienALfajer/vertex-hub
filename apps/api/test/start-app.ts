import type { INestApplication, Type } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

interface StartAppOptions {
  override?: (builder: TestingModuleBuilder) => void;
  /** Extra controllers mounted next to the application's own (test probes). */
  controllers?: Type[];
}

/** Starts the real application on a random local port, configured like `main.ts`. */
export async function startApp(
  options: StartAppOptions = {},
): Promise<{ app: INestApplication; url: string }> {
  const builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  });
  options.override?.(builder);
  const app = (await builder.compile()).createNestApplication({
    bufferLogs: true,
    bodyParser: false,
  });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, url: await app.getUrl() };
}
