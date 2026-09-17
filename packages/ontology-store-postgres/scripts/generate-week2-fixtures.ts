import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWeek2Fixtures, week2FixtureCsvFiles } from '../src/ingest/week2-fixture-build.js';

const OUT = fileURLToPath(new URL('../fixtures/week2/', import.meta.url));

const fixtures = buildWeek2Fixtures();
const files = week2FixtureCsvFiles(fixtures);

await mkdir(OUT, { recursive: true });
for (const [name, body] of Object.entries(files)) {
  await writeFile(join(OUT, name), body, 'utf8');
}
console.log(`wrote Week 2 fixtures to ${OUT}`);
