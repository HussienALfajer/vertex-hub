import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { REQUIRE_SESSION, REQUIRED_PERMISSIONS } from '../src/modules/auth/index.js';

/*
 * Guards for the conventions in ADR 0013 that the type checker cannot see. A failure here means
 * the code breaks a project rule, not that the test is wrong: fix the code, or change the ADR.
 */

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const srcDir = join(apiRoot, 'src');
const modulesDir = join(srcDir, 'modules');
const schemaDir = fileURLToPath(new URL('../../../packages/db/src/schema/', import.meta.url));

/** Metadata key Better Auth's `@AllowAnonymous()` sets. */
const ALLOW_ANONYMOUS = 'PUBLIC';

describe('every route declares who may call it', () => {
  let controllers: Type[] = [];
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    controllers = [...moduleRef.get(ModulesContainer).values()].flatMap((module) =>
      [...module.controllers.values()].map((wrapper) => wrapper.metatype as Type),
    );
    close = () => moduleRef.close();
  });
  afterAll(() => close?.());

  it('finds the controllers it checks', () => {
    expect(controllers.length).toBeGreaterThan(1);
  });

  it('marks each route with @RequirePermissions, @RequireSession or @AllowAnonymous', () => {
    const undeclared = controllers.flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter((name) => name !== 'constructor')
        .filter((name) => {
          const handler = controller.prototype[name];
          return typeof handler === 'function' && Reflect.hasMetadata(METHOD_METADATA, handler);
        })
        .filter((name) => {
          const targets = [controller.prototype[name], controller];
          return ![REQUIRED_PERMISSIONS, REQUIRE_SESSION, ALLOW_ANONYMOUS].some((key) =>
            targets.some((target) => Reflect.getMetadata(key, target) !== undefined),
          );
        })
        .map(
          (name) =>
            `${controller.name}.${name} (${Reflect.getMetadata(PATH_METADATA, controller)})`,
        ),
    );
    expect(undeclared).toEqual([]);
  });
});

interface SourceImport {
  file: string;
  specifier: string;
  names: string[];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Static imports of a file, with the named bindings they bring in. */
function importsOf(file: string): SourceImport[] {
  const source = readFileSync(file, 'utf8');
  const pattern = /import\s+(?:type\s+)?(?:\{([^}]*)\}|[\w*\s,]+)\s+from\s+'([^']+)'/g;
  return [...source.matchAll(pattern)].map((match) => ({
    file,
    specifier: match[2] as string,
    names: (match[1] ?? '')
      .split(',')
      .map(
        (name) =>
          name
            .replace(/^\s*type\s+/, '')
            .split(/\s+as\s+/)[0]
            ?.trim() ?? '',
      )
      .filter(Boolean),
  }));
}

const display = (file: string) => relative(apiRoot, file).split(sep).join('/');

/** The module folder a source file belongs to, or null outside `src/modules`. */
function moduleOf(file: string): string | null {
  const path = relative(modulesDir, file);
  return path.startsWith('..') ? null : (path.split(sep)[0] ?? null);
}

const moduleNames = readdirSync(modulesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const imports = sourceFiles(srcDir).flatMap(importsOf);

describe('module boundaries', () => {
  it('finds the modules it checks', () => {
    expect(moduleNames).toEqual(expect.arrayContaining(['auth', 'health']));
  });

  it('gives every module a public index.ts', () => {
    const missing = moduleNames.filter(
      (name) => !sourceFiles(join(modulesDir, name)).includes(join(modulesDir, name, 'index.ts')),
    );
    expect(missing).toEqual([]);
  });

  it('reaches another module only through its index.ts', () => {
    const offenders = imports
      .filter(({ specifier }) => specifier.startsWith('.'))
      .filter(({ file, specifier }) => {
        const target = resolve(dirname(file), specifier);
        const targetModule = moduleOf(target);
        if (!targetModule || targetModule === moduleOf(file)) return false;
        return target !== join(modulesDir, targetModule, 'index.js');
      })
      .map(({ file, specifier }) => `${display(file)} -> ${specifier}`);
    expect(offenders).toEqual([]);
  });

  /**
   * Which API module owns the tables of each schema file in packages/db (null: no API module
   * does). A new schema file must be added here, which forces the ownership decision.
   */
  const TABLE_OWNERS: Record<string, string | null> = {
    auth: 'auth',
    system: null,
  };

  const tablesBySchemaFile = new Map(
    readdirSync(schemaDir)
      .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
      .map((name) => {
        const source = readFileSync(join(schemaDir, name), 'utf8');
        const tables = [...source.matchAll(/export const (\w+) = pg(?:Table|Enum)\(/g)].map(
          (match) => match[1] as string,
        );
        return [basename(name, '.ts'), tables] as const;
      })
      // Files without tables (index.ts, columns.ts) hold no data to own.
      .filter(([, tables]) => tables.length > 0),
  );

  it('knows the owner of every schema file', () => {
    expect([...tablesBySchemaFile.keys()].sort()).toEqual(Object.keys(TABLE_OWNERS).sort());
  });

  it('queries only the tables its own module owns', () => {
    const ownerOfTable = new Map(
      [...tablesBySchemaFile].flatMap(([file, tables]) =>
        tables.map((table) => [table, TABLE_OWNERS[file] ?? null] as const),
      ),
    );
    const offenders = imports
      .filter(({ specifier }) => specifier === '@vertex-hub/db')
      .flatMap(({ file, names }) =>
        names
          .filter((name) => ownerOfTable.has(name) && ownerOfTable.get(name) !== moduleOf(file))
          .map((name) => `${display(file)} uses ${name} (owned by ${ownerOfTable.get(name)})`),
      );
    expect(offenders).toEqual([]);
  });
});
