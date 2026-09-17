import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIngestPlan,
  deviceBomRowSchema,
  deviceMasterRowSchema,
  materialMasterRowSchema,
  supplyRelationshipRowSchema,
  type DataQualityReport,
  type IngestCsvBundle,
  type IngestPlan,
  vendorMasterRowSchema,
  week2ManifestSchema,
  type Week2Manifest,
} from '@sourcing/ontology';

import { ingestObjectId } from './object-id.js';

import { csvRowsToObjects, parseCsv } from './parse-csv.js';
import { applyIngestPlan } from './persist-ingest.js';
import type { Queryable } from '../repository.js';

const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/week2/', import.meta.url));

export function week2FixtureDir(): string {
  return FIXTURE_DIR;
}

async function loadCsvFile<T>(
  dir: string,
  name: string,
  schema: { parse: (value: unknown) => T },
): Promise<{ file: string; rows: { line: number; raw: T }[] }> {
  const file = join(dir, name);
  const text = await readFile(file, 'utf8');
  const { headers, rows } = parseCsv(text);
  return csvRowsToObjects<T>(name, headers, rows, (record) => schema.parse(record));
}

export async function loadWeek2CsvBundle(dir = FIXTURE_DIR): Promise<IngestCsvBundle> {
  const [vendors, materials, devices, supply, bom] = await Promise.all([
    loadCsvFile(dir, 'vendor_master.csv', vendorMasterRowSchema),
    loadCsvFile(dir, 'material_master.csv', materialMasterRowSchema),
    loadCsvFile(dir, 'device_master.csv', deviceMasterRowSchema),
    loadCsvFile(dir, 'supply_relationship.csv', supplyRelationshipRowSchema),
    loadCsvFile(dir, 'device_bom.csv', deviceBomRowSchema),
  ]);
  return { vendors, materials, devices, supply, bom };
}

export async function loadWeek2Manifest(dir = FIXTURE_DIR): Promise<Week2Manifest> {
  const raw: unknown = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  return week2ManifestSchema.parse(raw);
}

export function planWeek2Ingest(
  bundle: IngestCsvBundle,
  pipelineRunId: string,
  extractedAt: string,
): { plan: IngestPlan; report: DataQualityReport } {
  return buildIngestPlan(bundle, pipelineRunId, extractedAt, ingestObjectId);
}

export async function runWeek2Ingest(
  db: Queryable,
  options?: { dir?: string; pipelineRunId?: string; extractedAt?: string },
): Promise<{ plan: IngestPlan; report: DataQualityReport; manifest: Week2Manifest }> {
  const dir = options?.dir ?? FIXTURE_DIR;
  const pipelineRunId = options?.pipelineRunId ?? `ingest-${randomUUID()}`;
  const extractedAt = options?.extractedAt ?? new Date().toISOString();
  const manifest = await loadWeek2Manifest(dir);
  const bundle = await loadWeek2CsvBundle(dir);
  const { plan, report } = planWeek2Ingest(bundle, pipelineRunId, extractedAt);

  await applyIngestPlan(db, plan, pipelineRunId, report);

  return { plan, report, manifest };
}
