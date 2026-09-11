/**
 * Enforces PLAN.md §6.3: @sourcing/ontology-store-postgres is the only holder of
 * database credentials.
 *
 * EAV gives up database-level type constraints, so Zod validation inside the store's
 * repository layer is the only guarantee that stored data matches the schema. A
 * guarantee with a bypass is not a guarantee, and a documented invariant with no
 * enforcement is a convention that survives until the first deadline. Hence this check.
 *
 * Fails if anything outside the store package imports a Postgres driver or reads
 * DATABASE_URL.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The one package permitted to hold database credentials. */
const STORE_PACKAGE = join('packages', 'ontology-store-postgres');

/** This file names the forbidden symbols in order to search for them. */
const SELF = join('scripts', 'check-db-boundary.mjs');

const SCAN_ROOTS = ['packages', 'apps', 'services', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);
const CODE_FILE = /\.(?:[cm]?[jt]s|tsx)$/;

/** `pg`, plus its subpaths and siblings — `pg-pool` is the same bypass with a hyphen. */
const DRIVER_IMPORT =
  /\b(?:from|import|require)\b\s*\(?\s*['"](pg(?:[-/][^'"]*)?|postgres(?:[-/][^'"]*)?)['"]/g;
const CREDENTIAL = /\bDATABASE_URL\b/g;

/**
 * Blanks comments while preserving length and newlines, so reported line numbers still
 * point at the original source. Comments are masked rather than stripped because this
 * file and several others legitimately *name* the forbidden symbols in prose, and a
 * check that cries wolf is a check someone deletes. String literals are deliberately
 * left intact: `config('DATABASE_URL')` is a real read.
 */
function maskComments(source) {
  const out = [...source];
  let state = 'code'; // code | line | block | single | double | template
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    switch (state) {
      case 'code':
        if (c === '/' && next === '/') state = 'line';
        else if (c === '/' && next === '*') state = 'block';
        else if (c === "'") state = 'single';
        else if (c === '"') state = 'double';
        else if (c === '`') state = 'template';
        if (state === 'line' || state === 'block') out[i] = ' ';
        break;
      case 'line':
        if (c === '\n') state = 'code';
        else out[i] = ' ';
        break;
      case 'block':
        if (c !== '\n') out[i] = ' ';
        if (c === '*' && next === '/') {
          out[i + 1] = ' ';
          i++;
          state = 'code';
        }
        break;
      case 'single':
      case 'double':
      case 'template':
        if (c === '\\') i++;
        else if (
          (state === 'single' && c === "'") ||
          (state === 'double' && c === '"') ||
          (state === 'template' && c === '`')
        ) {
          state = 'code';
        }
        break;
    }
  }
  return out.join('');
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // A scan root that does not exist yet, e.g. services/ before Python lands.
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (CODE_FILE.test(entry.name)) {
      yield full;
    }
  }
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

const violations = [];

for (const root of SCAN_ROOTS) {
  for await (const file of walk(join(ROOT, root))) {
    const rel = relative(ROOT, file);
    if (rel.startsWith(STORE_PACKAGE + sep) || rel === SELF) continue;

    const source = maskComments(readFileSync(file, 'utf8'));
    for (const [pattern, what] of [
      [DRIVER_IMPORT, 'imports a Postgres driver'],
      [CREDENTIAL, 'reads DATABASE_URL'],
    ]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        violations.push({ rel, line: lineOf(source, match.index), what });
      }
    }
  }
}

// A declared dependency on the driver is a violation before any code imports it.
for (const pkgDir of ['packages', 'apps', 'services']) {
  let entries;
  try {
    entries = await readdir(join(ROOT, pkgDir), { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rel = join(pkgDir, entry.name);
    if (rel === STORE_PACKAGE) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(ROOT, rel, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (/^(?:pg|postgres)(?:[-/]|$)/.test(name)) {
          violations.push({
            rel: join(rel, 'package.json'),
            line: 0,
            what: `declares a dependency on "${name}"`,
          });
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Database credential boundary violated (PLAN.md §6.3).\n');
  for (const { rel, line, what } of violations) {
    console.error(`  ${rel}${line > 0 ? `:${String(line)}` : ''} — ${what}`);
  }
  console.error(
    `\nOnly ${STORE_PACKAGE.split(sep).join('/')} may touch Postgres directly.` +
      '\nGo through the repository layer so writes stay validated and audited.\n',
  );
  process.exit(1);
}

console.log(
  `db-boundary: ok — no Postgres driver imports or DATABASE_URL reads outside ${STORE_PACKAGE.split(sep).join('/')}`,
);
