// The one check command for agents and people (docs/testing.md). Each check runs once, its whole
// output goes to a log file in .verify/, and the console gets a short summary of what failed.
//
//   pnpm verify                 lint, then typecheck, test and build of every package (Turborepo
//                               replays what did not change), the E2E specs the branch changed, and
//                               migration and OpenAPI drift when their sources changed
//   pnpm verify <files...>      only these test files: Vitest in their package, Playwright for
//                               apps/web/e2e specs (with --grep <pattern> to pick tests)
//   --e2e-all                   the whole E2E suite instead of the changed specs (CI runs it on
//                               four shards; here it takes minutes)
//   --base <ref>                compare with <ref> instead of the merge base with origin/main
//   --allow-dev                 run although `pnpm dev` is up (the api build breaks its watcher)
//
// Exit code: 0 when everything passed, 1 when a check failed, 3 when it refused to start.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, '.verify');
const lockFile = join(tmpdir(), 'vertex-hub-verify.lock');
// Longer than any real run (`--e2e-all` included): past it, the lock is a leftover.
const LOCK_MAX_AGE_MS = 30 * 60_000;
const WEB = 'apps/web';
const E2E_DIR = 'apps/web/e2e/';
// What the summary keeps from a log: Biome diagnostics; failed tests, assertions, type errors.
const LINT_LINES = /^\S+:\d+:\d+ |^Found \d+ (error|warning)/;
const TASK_LINES =
  /(^| )(FAIL|×) |AssertionError|Error:|error TS\d+|❯ \S+:\d+:\d+|Test Files .*failed|expected .+ to /;
const RERUN_FILE = /\b(?:apps|packages)\/[\w-]+\/[\w./-]+\.(?:test|spec)\.tsx?\b/g;

const options = parseArgs(process.argv.slice(2));
const started = Date.now();
const report = [];
let failed = false;

takeLock();
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const base = options.base ?? defaultBase();
const changed = changedFiles(base);
const packages = workspacePackages();

if (options.files.length > 0) {
  await verifyFiles(options.files);
} else {
  await verifyBranch();
}
finish();

/** Lint, the whole task graph, drift, and the changed E2E specs. */
async function verifyBranch() {
  if (!options.allowDev) {
    const busy = [];
    for (const port of [3000, 5173]) if (await listening(port)) busy.push(port);
    if (busy.length > 0) {
      refuse(
        `pnpm dev is running (port ${busy.join(', ')}). Stop it first: the api build replaces the ` +
          'dist folder its watcher runs from. Or pass --allow-dev.',
      );
    }
  }
  report.push(
    `base ${base.slice(0, 7)}, ${changed.length} changed file${changed.length === 1 ? '' : 's'}`,
  );

  const lint = await run('lint', process.execPath, [
    bin(root, '@biomejs/biome', 'biome'),
    'check',
    '--error-on-warnings',
    '--colors=off',
    '.',
  ]);
  section('lint', lint, lint.code === 0 ? [] : pick(read(lint.log), LINT_LINES, 20));

  const graph = await run('turbo', process.execPath, [
    bin(root, 'turbo'),
    'run',
    'typecheck',
    'test',
    'build',
    '--continue',
    '--output-logs=errors-only',
    '--summarize',
  ]);
  const tasks = turboTasks(read(graph.log));
  const ran = tasks.filter((task) => task.status === 'MISS');
  const broken = tasks.filter((task) => task.exitCode !== 0);
  const details = [
    `${tasks.length} tasks: ${tasks.length - ran.length} replayed from the cache, ${ran.length} ran` +
      (ran.length > 0
        ? ` (${ran.map((task) => `${task.id} ${seconds(task.ms)}`).join(', ')})`
        : ''),
  ];
  for (const task of broken) {
    details.push(`FAIL ${task.id}: ${task.logFile}`);
    details.push(...pick(task.log, TASK_LINES, 14).map((line) => `  ${line}`));
  }
  section('typecheck, test, build', graph, details);
  const webBuilt = !broken.some((task) => task.id === '@vertex-hub/web#build');
  const apiBuilt = !broken.some((task) => task.id === '@vertex-hub/api#build');

  // The schema takes its enums from the contracts, so a contracts change can need a migration too.
  if (
    changed.some((file) =>
      /^(packages\/db\/(src\/schema|migrations)|packages\/contracts\/src)\//.test(file),
    )
  ) {
    await migrationDrift();
  }
  if (
    apiBuilt &&
    changed.some((file) => /^(apps\/api\/src|packages\/contracts\/src)\//.test(file))
  ) {
    await openApiDrift();
  }

  const specs = changed.filter(
    (file) => file.startsWith(E2E_DIR) && file.endsWith('.spec.ts') && existsSync(join(root, file)),
  );
  if (!options.e2eAll && specs.length === 0) {
    report.push('e2e: no changed spec (CI runs the whole suite)');
  } else if (!webBuilt) {
    report.push('e2e: skipped, the web build failed');
  } else if (options.e2eAll) {
    await e2e([]);
  } else {
    await e2e(specs, { changedOnly: true });
  }
}

/** Only the given test files (paths from the repository root), after building their dependencies. */
async function verifyFiles(files) {
  const byPackage = new Map();
  const specs = [];
  for (const file of files) {
    const path = relative(root, resolve(root, file)).replaceAll('\\', '/');
    if (path.startsWith('..') || !existsSync(join(root, path))) refuse(`No such file: ${file}`);
    if (path.startsWith(E2E_DIR)) {
      specs.push(path);
      continue;
    }
    const owner = packages.find((pkg) => path.startsWith(`${pkg.dir}/`));
    if (!owner) refuse(`${file} is not inside a workspace package.`);
    if (!byPackage.has(owner)) byPackage.set(owner, []);
    byPackage.get(owner).push(path.slice(owner.dir.length + 1));
  }
  for (const [pkg, tests] of byPackage) {
    const short = pkg.name.replace('@vertex-hub/', '');
    const deps = await run(`build-${short}`, process.execPath, [
      bin(root, 'turbo'),
      'run',
      'build',
      `--filter=${pkg.name}^...`,
      '--output-logs=errors-only',
    ]);
    if (deps.code !== 0) {
      section(`${short}: build of its dependencies`, deps, pick(read(deps.log), TASK_LINES, 14));
      continue;
    }
    const json = join(out, `vitest-${short}.json`);
    const result = await run(
      `vitest-${short}`,
      process.execPath,
      [
        bin(join(root, pkg.dir), 'vitest'),
        'run',
        ...tests,
        '--reporter=dot',
        '--reporter=json',
        `--outputFile.json=${json}`,
      ],
      { cwd: join(root, pkg.dir) },
    );
    section(`${short}: ${tests.join(' ')}`, result, vitestFailures(json, pkg.dir, result));
  }
  if (specs.length > 0) {
    const build = await run('build-web', process.execPath, [
      bin(root, 'turbo'),
      'run',
      'build',
      '--filter=@vertex-hub/web',
      '--output-logs=errors-only',
    ]);
    if (build.code === 0) await e2e(specs, { grep: options.grep });
    else section('e2e: web build', build, pick(read(build.log), TASK_LINES, 14));
  }
}

/**
 * Playwright on `specs` (all of them when empty). With `changedOnly`, screens.spec.ts, which holds
 * half the suite, runs only the tests the branch added or changed, picked by their titles.
 */
async function e2e(specs, { grep, changedOnly = false } = {}) {
  const runs = [];
  const screens = `${E2E_DIR}screens.spec.ts`;
  const whole = changedOnly ? specs.filter((spec) => spec !== screens) : specs;
  if (specs.length === 0 || whole.length > 0) runs.push({ specs: whole, grep });
  if (changedOnly && specs.includes(screens)) {
    const titles = changedTestTitles(screens);
    if (titles.length > 0) {
      runs.push({ specs: [screens], grep: titles.map(escapeRegExp).join('|') });
    } else {
      report.push('e2e: screens.spec.ts changed outside its tests; CI runs it');
    }
  }
  for (const [index, { specs: files, grep: pattern }] of runs.entries()) {
    const name = `e2e-${index + 1}`;
    const json = join(out, `${name}.json`);
    const result = await run(
      name,
      process.execPath,
      [
        bin(join(root, WEB), '@playwright/test', 'playwright'),
        'test',
        ...files.map((file) => file.slice(`${WEB}/`.length)),
        ...(pattern ? ['--grep', pattern] : []),
        '--reporter=line,json',
      ],
      { cwd: join(root, WEB), env: { PLAYWRIGHT_JSON_OUTPUT_NAME: json } },
    );
    const label =
      files.length === 0
        ? 'e2e: the whole suite'
        : `e2e: ${files.map((file) => file.slice(E2E_DIR.length)).join(', ')}${pattern ? ` (only "${pattern}")` : ''}`;
    section(label, result, playwrightFailures(json));
  }
}

/** `pnpm db:generate` must find nothing to write (CI checks the same). */
async function migrationDrift() {
  const before = git('status', '--porcelain', '--', 'packages/db/migrations');
  const result = await run(
    'migrations',
    process.execPath,
    [bin(join(root, 'packages/db'), 'drizzle-kit'), 'generate'],
    { cwd: join(root, 'packages/db') },
  );
  const after = git('status', '--porcelain', '--', 'packages/db/migrations');
  const drift = result.code === 0 && before !== after;
  if (drift) failed = true;
  report.push(
    result.code !== 0
      ? `migrations: FAIL, db:generate failed (${result.log})`
      : drift
        ? 'migrations: FAIL, db:generate wrote a migration: commit it with the schema change'
        : 'migrations: in step with the schema',
  );
  if (result.code !== 0) failed = true;
}

/** The web app's OpenAPI document and client types must match the API (CI checks the same). */
async function openApiDrift() {
  const files = ['openapi.json', 'schema.gen.ts'].map((name) =>
    join(root, WEB, 'src/lib/api', name),
  );
  const before = files.map(hashOf);
  const exported = await run('openapi-export', process.execPath, ['dist/cli/openapi.js'], {
    cwd: join(root, 'apps/api'),
  });
  const generated =
    exported.code === 0
      ? await run(
          'openapi-generate',
          process.execPath,
          [
            bin(join(root, WEB), 'openapi-typescript'),
            'src/lib/api/openapi.json',
            '-o',
            'src/lib/api/schema.gen.ts',
          ],
          { cwd: join(root, WEB) },
        )
      : exported;
  if (generated.code !== 0) {
    failed = true;
    report.push(`openapi: FAIL, the export or the client generation failed (${generated.log})`);
    return;
  }
  const changedNow = files.filter((file, index) => hashOf(file) !== before[index]);
  if (changedNow.length > 0) failed = true;
  report.push(
    changedNow.length > 0
      ? `openapi: FAIL, they were stale and are regenerated now: ${changedNow.map((file) => relative(root, file).replaceAll('\\', '/')).join(', ')}. Commit them with the change`
      : 'openapi: in step with the API',
  );
}

function finish() {
  const status = failed ? 'FAIL' : 'pass';
  const lines = [
    `pnpm verify: ${status} in ${seconds(Date.now() - started)}`,
    ...report,
    `Logs: .verify/ (${readdirSync(out).length} files)`,
  ];
  const rerun = [...new Set(report.flatMap((line) => line.match(RERUN_FILE) ?? []))];
  if (failed && rerun.length > 0) {
    lines.push(`Rerun only what failed: pnpm verify ${rerun.join(' ')}`);
  }
  const text = `${lines.join('\n')}\n`;
  writeFileSync(join(out, 'summary.md'), text);
  process.stdout.write(text);
  process.exitCode = failed ? 1 : 0;
}

// ---- Steps and their output ------------------------------------------------------------------

/** Runs a command with its whole output in .verify/<name>.log. */
function run(name, command, args, { cwd = root, env = {} } = {}) {
  const log = join(out, `${name}.log`);
  const file = createWriteStream(log);
  file.write(`$ ${[command, ...args].join(' ')}\n(in ${cwd})\n\n`);
  const begun = Date.now();
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.pipe(file, { end: false });
  child.stderr.pipe(file, { end: false });
  return new Promise((done) => {
    child.on('error', (error) => file.write(`\n${String(error)}\n`));
    child.on('close', (code) => {
      file.end(() =>
        done({
          code: code ?? 1,
          ms: Date.now() - begun,
          log: relative(root, log).replaceAll('\\', '/'),
        }),
      );
    });
  });
}

function section(label, result, details) {
  if (result.code !== 0) failed = true;
  report.push(`${label}: ${result.code === 0 ? 'pass' : 'FAIL'} (${seconds(result.ms)})`);
  for (const line of details) report.push(`  ${line}`);
}

/** Turborepo's run summary: each task's cache status, exit code, time and log. */
function turboTasks(log) {
  const found = log.match(/^\s*Summary:\s+(.+\.json)\s*$/m)?.[1];
  const path = found && resolve(root, found);
  if (!path || !existsSync(path)) return [];
  const summary = JSON.parse(readFileSync(path, 'utf8'));
  rmSync(path, { force: true });
  return summary.tasks.map((task) => {
    const logFile = join(root, task.logFile ?? '');
    return {
      id: task.taskId,
      status: task.cache?.status,
      exitCode: task.execution?.exitCode ?? 0,
      ms: (task.execution?.endTime ?? 0) - (task.execution?.startTime ?? 0),
      logFile: relative(root, logFile).replaceAll('\\', '/'),
      get log() {
        return existsSync(logFile) ? stripAnsi(readFileSync(logFile, 'utf8')) : '';
      },
    };
  });
}

function vitestFailures(json, pkgDir, result) {
  if (!existsSync(json)) return result.code === 0 ? [] : pick(read(result.log), TASK_LINES, 14);
  const lines = [];
  const {
    testResults = [],
    numTotalTests = 0,
    numFailedTests = 0,
  } = JSON.parse(readFileSync(json, 'utf8'));
  lines.push(`${numTotalTests - numFailedTests}/${numTotalTests} tests passed`);
  for (const file of testResults) {
    const path = `${pkgDir}/${relative(join(root, pkgDir), file.name).replaceAll('\\', '/')}`;
    const failing = file.assertionResults.filter((test) => test.status === 'failed');
    if (failing.length === 0 && file.status !== 'failed') continue;
    lines.push(`FAIL ${path}`);
    if (failing.length === 0) lines.push(`  ${firstLine(stripAnsi(file.message ?? ''))}`);
    for (const test of failing.slice(0, 5)) {
      lines.push(`  ${test.fullName}: ${firstLine(stripAnsi(test.failureMessages?.[0] ?? ''))}`);
    }
    if (failing.length > 5) lines.push(`  …and ${failing.length - 5} more in this file`);
  }
  return lines;
}

function playwrightFailures(json) {
  if (!existsSync(json)) return [];
  const report = JSON.parse(readFileSync(json, 'utf8'));
  const lines = [];
  const stats = report.stats ?? {};
  lines.push(
    `${stats.expected ?? 0} passed, ${stats.unexpected ?? 0} failed, ${stats.flaky ?? 0} flaky`,
  );
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        if (!last || last.status === 'passed' || last.status === 'skipped') continue;
        lines.push(
          `FAIL ${E2E_DIR}${spec.file ?? file}:${spec.line}: ${spec.title} (${last.status}): ${firstLine(stripAnsi(last.error?.message ?? ''))}`,
        );
      }
    }
    for (const child of suite.suites ?? []) walk(child, suite.file ?? file);
  };
  for (const suite of report.suites ?? []) walk(suite, suite.file);
  return lines.slice(0, 16);
}

/** Lines that say what went wrong, without repeats. */
function pick(text, pattern, limit) {
  const seen = new Set();
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\w@/-]+:[\w:-]+: /, '').trim();
    if (!pattern.test(line) || seen.has(line)) continue;
    seen.add(line);
    lines.push(line.length > 220 ? `${line.slice(0, 217)}…` : line);
    if (lines.length === limit) break;
  }
  return lines;
}

// ---- Git, packages, tools --------------------------------------------------------------------

function parseArgs(args) {
  const result = { files: [], e2eAll: false, allowDev: false, base: undefined, grep: undefined };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--e2e-all') result.e2eAll = true;
    else if (arg === '--allow-dev') result.allowDev = true;
    else if (arg === '--base') result.base = args[++index];
    else if (arg === '--grep' || arg === '-g') result.grep = args[++index];
    else if (arg.startsWith('-')) refuse(`Unknown option ${arg} (see scripts/verify.mjs).`);
    else result.files.push(arg);
  }
  return result;
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) refuse(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function defaultBase() {
  const remote = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main'], {
    cwd: root,
    windowsHide: true,
  });
  return git('merge-base', 'HEAD', remote.status === 0 ? 'origin/main' : 'main');
}

/** Files that differ from `base` in the working tree, committed or not, and new untracked ones. */
function changedFiles(from) {
  const listed = [
    ...git('diff', '--name-only', from).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ];
  return [...new Set(listed.filter(Boolean))];
}

/**
 * Titles of the tests the branch added or changed in a spec file: for each changed line, the
 * nearest `test(` call at or above it. A template title keeps its literal start, so
 * `images (${size})` matches every size.
 */
function changedTestTitles(file) {
  const content = readFileSync(join(root, file), 'utf8').split('\n');
  const lines = new Set();
  if (!git('ls-files', '--', file)) {
    for (let index = 0; index < content.length; index++) lines.add(index);
  } else {
    const diff = git('diff', '-U0', base, '--', file);
    for (const [, start, count] of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
      const first = Number(start) - 1;
      for (let index = first; index < first + Math.max(Number(count ?? 1), 1); index++) {
        lines.add(index);
      }
    }
  }
  const titles = new Set();
  for (const line of lines) {
    for (let index = Math.min(line, content.length - 1); index >= 0; index--) {
      const match = content[index].match(/\btest(?:\.only)?\(\s*(['"`])((?:(?!\1).)+)\1/);
      if (!match) continue;
      const title = match[1] === '`' ? match[2].split('${')[0].trim() : match[2];
      if (title) titles.add(title);
      break;
    }
  }
  return [...titles];
}

function workspacePackages() {
  return ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(root, group, entry.name, 'package.json')),
      )
      .map((entry) => ({
        dir: `${group}/${entry.name}`,
        name: JSON.parse(readFileSync(join(root, group, entry.name, 'package.json'), 'utf8')).name,
      })),
  );
}

/** The JavaScript entry of a dependency's command, run with Node (no shell, no quoting). */
function bin(fromDir, pkg, name = pkg.split('/').at(-1)) {
  for (const dir of [fromDir, root]) {
    const manifest = join(dir, 'node_modules', ...pkg.split('/'), 'package.json');
    if (!existsSync(manifest)) continue;
    const { bin: bins } = JSON.parse(readFileSync(manifest, 'utf8'));
    const entry = typeof bins === 'string' ? bins : bins?.[name];
    if (entry) return join(dirname(manifest), entry);
  }
  refuse(`${pkg} is not installed in ${relative(root, fromDir) || '.'}: run pnpm install.`);
}

function listening(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

/** One verify at a time on this machine: two runs would share the test databases and the CPU. */
function takeLock() {
  const mine = JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cwd: root });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockFile, mine, { flag: 'wx' });
      process.on('exit', () => {
        try {
          if (readFileSync(lockFile, 'utf8') === mine) rmSync(lockFile, { force: true });
        } catch {
          // Already gone.
        }
      });
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const held = lockHolder();
      if (held) {
        refuse(
          `pnpm verify is already running (pid ${held.pid} since ${held.since}, in ${held.cwd}). ` +
            'Wait for its summary instead of starting another run. A lock left by a killed run ' +
            `expires after 30 minutes; ${lockFile} is the file.`,
        );
      }
      rmSync(lockFile, { force: true });
    }
  }
}

/**
 * Who holds the lock: nobody once its process is gone or after LOCK_MAX_AGE_MS, since a killed
 * run leaves the file behind and Windows soon gives its pid to another process.
 */
function lockHolder() {
  try {
    const held = JSON.parse(readFileSync(lockFile, 'utf8'));
    return alive(held.pid) && Date.now() - Date.parse(held.since) < LOCK_MAX_AGE_MS ? held : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function refuse(message) {
  console.error(message);
  process.exit(3);
}

function read(log) {
  return stripAnsi(readFileSync(join(root, log), 'utf8'));
}

function hashOf(file) {
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : '';
}

function stripAnsi(text) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function firstLine(text) {
  const line = text.split('\n').find((part) => part.trim()) ?? '';
  return line.trim().slice(0, 200);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function seconds(ms) {
  const total = Math.round(ms / 1000);
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
}
