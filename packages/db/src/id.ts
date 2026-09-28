import { v7 as uuidv7 } from 'uuid';

/** New primary key: a time-ordered UUIDv7 generated in the application (docs/architecture.md). */
export function newId(): string {
  return uuidv7();
}
