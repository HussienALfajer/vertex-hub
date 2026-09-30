import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type DatabaseConnection, SERVER_DATABASE_LIMITS } from '@vertex-hub/db';
import { ENV, type Env } from '../config/env.js';

/** Injection token for the Drizzle database. */
export const DATABASE = Symbol('DATABASE');
const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [ENV],
      useFactory: (env: Env) => createDatabase(env.DATABASE_URL, SERVER_DATABASE_LIMITS),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_CONNECTION],
      useFactory: (connection: DatabaseConnection) => connection.db,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
