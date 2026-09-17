import { describe, expect, it } from 'vitest';

import {
  assertReportMatchesManifest,
  buildIngestPlan,
  week2ManifestSchema,
} from '@sourcing/ontology';

import { ingestObjectId } from './object-id.js';

import { buildWeek2Fixtures } from './week2-fixture-build.js';
import { loadWeek2CsvBundle, loadWeek2Manifest, planWeek2Ingest } from './run-week2-ingest.js';

describe('Week 2 fixture generator', () => {
  it('manifest reject counts match the ingest plan over generated CSVs', () => {
    const fixtures = buildWeek2Fixtures();
    week2ManifestSchema.parse(fixtures.manifest);

    const bundle = {
      vendors: {
        file: 'vendor_master.csv',
        rows: fixtures.vendor_master.map((raw, index) => ({ line: index + 2, raw })),
      },
      materials: {
        file: 'material_master.csv',
        rows: fixtures.material_master.map((raw, index) => ({ line: index + 2, raw })),
      },
      devices: {
        file: 'device_master.csv',
        rows: fixtures.device_master.map((raw, index) => ({ line: index + 2, raw })),
      },
      supply: {
        file: 'supply_relationship.csv',
        rows: fixtures.supply_relationship.map((raw, index) => ({ line: index + 2, raw })),
      },
      bom: {
        file: 'device_bom.csv',
        rows: fixtures.device_bom.map((raw, index) => ({ line: index + 2, raw })),
      },
    };

    const { report } = buildIngestPlan(
      bundle,
      'manifest-preview',
      '2026-09-17T04:00:00.000Z',
      ingestObjectId,
    );
    assertReportMatchesManifest(report, fixtures.manifest.expectedDataQuality);
  });

  it('pins merge clusters by source key for each band', () => {
    const { manifest } = buildWeek2Fixtures();
    const auto = manifest.expectedMergeClusters.filter((c) => c.band === 'AUTO_CONFIRM');
    const human = manifest.expectedMergeClusters.filter((c) => c.band === 'REQUIRE_HUMAN');
    expect(auto.length).toBeGreaterThanOrEqual(3);
    expect(human.length).toBeGreaterThanOrEqual(2);
    expect(manifest.expectedNonMergePairs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('committed Week 2 CSV fixtures', () => {
  it('match manifest row counts and DQ expectations', async () => {
    const manifest = await loadWeek2Manifest();
    const bundle = await loadWeek2CsvBundle();

    expect(bundle.vendors.rows.length).toBe(manifest.rowCounts.vendor_master);
    expect(bundle.materials.rows.length).toBe(manifest.rowCounts.material_master);
    expect(bundle.devices.rows.length).toBe(manifest.rowCounts.device_master);
    expect(bundle.supply.rows.length).toBe(manifest.rowCounts.supply_relationship);
    expect(bundle.bom.rows.length).toBe(manifest.rowCounts.device_bom);

    const { report } = planWeek2Ingest(bundle, 'test-run', '2026-09-17T04:00:00.000Z');
    assertReportMatchesManifest(report, manifest.expectedDataQuality);
  });
});
