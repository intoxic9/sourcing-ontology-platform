/**
 * Writes contracts/ontology.schema.json from the Zod schemas in @sourcing/ontology.
 *
 * With --check it writes nothing and fails when the committed file is stale. That check
 * is the point of the artifact: a generated file nobody verifies drifts from its source
 * and then quietly lies to whoever reads it. Python generates its Pydantic models from
 * this, so a stale file is a wrong model rather than a cosmetic diff.
 *
 * The document is built inside the package, where it is ordinary testable computation.
 * This script only does filesystem work, which is also why it reads dist/ rather than
 * src/: the contract describes what consumers of the built package actually get.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = new URL('../packages/ontology/dist/index.js', import.meta.url);
const TARGET = new URL('../contracts/ontology.schema.json', import.meta.url);

const checkOnly = process.argv.includes('--check');
const displayPath = relative(process.cwd(), fileURLToPath(TARGET)).replaceAll('\\', '/');

let serializeContract;
try {
  ({ serializeContract } = await import(ENTRY.href));
} catch (cause) {
  throw new Error('emit-contract: @sourcing/ontology is not built. Run `pnpm build`.', {
    cause,
  });
}

const expected = serializeContract();

if (!checkOnly) {
  await writeFile(TARGET, expected, 'utf8');
  console.log(`emit-contract: wrote ${displayPath}`);
  process.exit(0);
}

let actual;
try {
  actual = await readFile(TARGET, 'utf8');
} catch {
  console.error(`emit-contract: ${displayPath} is missing. Run \`pnpm emit:contract\`.`);
  process.exit(1);
}

if (actual !== expected) {
  console.error(
    `emit-contract: ${displayPath} is out of date with the Zod schemas.\n` +
      'Run `pnpm emit:contract` and commit the result.',
  );
  process.exit(1);
}

console.log(`emit-contract: ok — ${displayPath} matches the schemas`);
