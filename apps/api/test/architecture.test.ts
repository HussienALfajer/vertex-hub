import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { REQUIRE_SESSION, REQUIRED_PERMISSIONS } from '../src/core/access/index.js';

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
  /** Everything the target exports: `import * as`, `export *`, a dynamic `import()`. */
  namespace: boolean;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Every import of a file, read by the TypeScript parser: static imports (named, default,
 * namespace, type-only), re-exports and dynamic `import()`, whatever the quotes.
 */
function importsOf(file: string, source = readFileSync(file, 'utf8')): SourceImport[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const found: SourceImport[] = [];
  const named = (elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[]) =>
    elements.map((element) => (element.propertyName ?? element.name).text);
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      let names: string[] = [];
      let namespace = false;
      if (ts.isImportDeclaration(node)) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) namespace = true;
        if (bindings && ts.isNamedImports(bindings)) names = named(bindings.elements);
        if (node.importClause?.name) names.push('default');
      } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        names = named(node.exportClause.elements);
      } else {
        namespace = true;
      }
      found.push({ file, specifier: node.moduleSpecifier.text, names, namespace });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({ file, specifier: node.arguments[0].text, names: [], namespace: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe('import reading', () => {
  it('finds every form of import the boundary rules must see', () => {
    const source = [
      "import Default, { a, type B as C } from '../other/a.js';",
      'import * as db from "@vertex-hub/db";',
      "export { d } from '../other/d.js';",
      "export * from '../other/e.js';",
      "const f = await import('../other/f.js');",
    ].join('\n');
    expect(importsOf('x.ts', source)).toEqual([
      { file: 'x.ts', specifier: '../other/a.js', names: ['a', 'B', 'default'], namespace: false },
      { file: 'x.ts', specifier: '@vertex-hub/db', names: [], namespace: true },
      { file: 'x.ts', specifier: '../other/d.js', names: ['d'], namespace: false },
      { file: 'x.ts', specifier: '../other/e.js', names: [], namespace: true },
      { file: 'x.ts', specifier: '../other/f.js', names: [], namespace: true },
    ]);
  });
});

const display = (file: string) => relative(apiRoot, file).split(sep).join('/');

/** The module folder a source file belongs to, or null outside `src/modules`. */
function moduleOf(file: string): string | null {
  const path = relative(modulesDir, file);
  return path.startsWith('..') ? null : (path.split(sep)[0] ?? null);
}

const moduleNames = readdirSync(modulesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const imports = sourceFiles(srcDir).flatMap((file) => importsOf(file));

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

  it('keeps notifications independent of the modules that emit them (ADR 0018)', () => {
    const emitters = [
      'tasks',
      'clients',
      'projects',
      'templates',
      'content',
      'calendar',
      'invoices',
    ];
    const offenders = imports
      .filter(
        ({ file, specifier }) => moduleOf(file) === 'notifications' && specifier.startsWith('.'),
      )
      .filter(({ file, specifier }) => {
        const target = moduleOf(resolve(dirname(file), specifier));
        return target !== null && emitters.includes(target);
      })
      .map(({ file, specifier }) => `${display(file)} -> ${specifier}`);
    expect(offenders).toEqual([]);
  });

  it('keeps files independent of the modules that own files (ADR 0019)', () => {
    const owners = ['tasks', 'clients', 'projects', 'content', 'quotes', 'invoices'];
    const offenders = imports
      .filter(({ file, specifier }) => moduleOf(file) === 'files' && specifier.startsWith('.'))
      .filter(({ file, specifier }) => {
        const target = moduleOf(resolve(dirname(file), specifier));
        return target !== null && owners.includes(target);
      })
      .map(({ file, specifier }) => `${display(file)} -> ${specifier}`);
    expect(offenders).toEqual([]);
  });

  it('keeps tasks independent of approvals, and clients of tasks (ADR 0020)', () => {
    const forbidden: Record<string, string> = { tasks: 'approvals', clients: 'tasks' };
    const offenders = imports
      .filter(({ specifier }) => specifier.startsWith('.'))
      .filter(({ file, specifier }) => {
        const from = moduleOf(file);
        return !!from && moduleOf(resolve(dirname(file), specifier)) === forbidden[from];
      })
      .map(({ file, specifier }) => `${display(file)} -> ${specifier}`);
    expect(offenders).toEqual([]);
  });

  it('keeps tasks, clients and projects independent of content, and content of approvals (ADR 0021)', () => {
    const forbidden: Record<string, string> = {
      tasks: 'content',
      clients: 'content',
      projects: 'content',
      content: 'approvals',
    };
    const offenders = imports
      .filter(({ specifier }) => specifier.startsWith('.'))
      .filter(({ file, specifier }) => {
        const from = moduleOf(file);
        return !!from && moduleOf(resolve(dirname(file), specifier)) === forbidden[from];
      })
      .map(({ file, specifier }) => `${display(file)} -> ${specifier}`);
    expect(offenders).toEqual([]);
  });

  it('keeps tasks, clients, projects and auth independent of calendar (ADR 0022)', () => {
    const independent = ['tasks', 'clients', 'projects', 'auth'];
    const offenders = imports
      .filter(({ specifier }) => specifier.startsWith('.'))
      .filter(({ file, specifier }) => {
        const from = moduleOf(file);
        return (
          !!from &&
          independent.includes(from) &&
          moduleOf(resolve(dirname(file), specifier)) === 'calendar'
        );
      })
      .map(({ file, specifier }) => `${display(file)} -> ${specifier}`);
    expect(offenders).toEqual([]);
  });

  /**
   * Which API module owns the tables of each schema file in packages/db (null: no API module
   * does). A new schema file must be added here, which forces the ownership decision.
   */
  const TABLE_OWNERS: Record<string, string | null> = {
    approvals: 'approvals',
    audit: 'audit',
    auth: 'auth',
    calendar: 'calendar',
    campaigns: 'campaigns',
    catalog: 'catalog',
    clients: 'clients',
    content: 'content',
    files: 'files',
    invoices: 'invoices',
    leads: 'leads',
    notifications: 'notifications',
    projects: 'projects',
    quotes: 'quotes',
    retainers: 'projects',
    reviews: 'tasks',
    system: null,
    tasks: 'tasks',
    templates: 'templates',
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

  it('never imports all of @vertex-hub/db at once, which would hide the tables used', () => {
    const offenders = imports
      .filter(({ specifier, namespace }) => specifier === '@vertex-hub/db' && namespace)
      .map(({ file }) => display(file));
    expect(offenders).toEqual([]);
  });
});
