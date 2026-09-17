import {
  buildIngestPlan,
  emptyRejectCounts,
  emptySkippedLinkCounts,
  type IngestCsvBundle,
  type Week2Manifest,
} from '@sourcing/ontology';

import { ingestObjectId } from './object-id.js';

type VendorRow = {
  LIFNR: string;
  NAME1: string;
  LAND1: string;
  TIER: string;
  DUNS: string;
  QUALITY_RATING: string;
  CERTIFICATIONS: string;
};

type MaterialRow = {
  MATNR: string;
  MAKTX: string;
  CLASS: string;
  CRITICALITY: string;
  UNIT_COST: string;
};

type DeviceRow = {
  DEVICE_ID: string;
  DEVICE_NAME: string;
  PRODUCT_FAMILY: string;
  REG_CLASS: string;
  LIFECYCLE: string;
};

type SupplyRow = { LIFNR: string; MATNR: string; CONFIDENCE: string };
type BomRow = { DEVICE_ID: string; MATNR: string; CONFIDENCE: string };

export type Week2FixtureFiles = {
  vendor_master: VendorRow[];
  material_master: MaterialRow[];
  device_master: DeviceRow[];
  supply_relationship: SupplyRow[];
  device_bom: BomRow[];
  manifest: Week2Manifest;
};

function toCsv(headers: readonly string[], rows: Record<string, string>[]): string {
  const escape = (value: string): string => {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function buildWeek2Fixtures(): Week2FixtureFiles {
  const vendor_master: VendorRow[] = [
    // --- DQ rejects (must stay in the file) ---
    { LIFNR: '', NAME1: 'Ghost Vendor', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100001', NAME1: '   ', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100002', NAME1: 'Bad Tier AG', LAND1: 'DE', TIER: 'TIER_9', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100003', NAME1: 'Bad Rating GmbH', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: 'excellent', CERTIFICATIONS: '' },
    { LIFNR: '100004', NAME1: 'First LIFNR Row', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '72', CERTIFICATIONS: '' },
    { LIFNR: '100004', NAME1: 'Duplicate LIFNR Row', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '72', CERTIFICATIONS: '' },

    // --- AUTO_CONFIRM clusters ---
    {
      LIFNR: '100301',
      NAME1: 'MedSource GmbH',
      LAND1: 'DE',
      TIER: 'TIER_1',
      DUNS: '314159265',
      QUALITY_RATING: '88',
      CERTIFICATIONS: 'ISO 13485|ISO 9001',
    },
    {
      LIFNR: '100302',
      NAME1: 'MedSource G.m.b.H.',
      LAND1: 'DE',
      TIER: 'TIER_1',
      DUNS: '314159265',
      QUALITY_RATING: '88',
      CERTIFICATIONS: 'ISO 13485',
    },
    {
      LIFNR: '100303',
      NAME1: '  MEDSOURCE   GMBH  ',
      LAND1: 'DE',
      TIER: 'TIER_1',
      DUNS: '314159265',
      QUALITY_RATING: '87',
      CERTIFICATIONS: 'ISO 13485',
    },
    {
      LIFNR: '100401',
      NAME1: 'Nordic Sterile Solutions GmbH',
      LAND1: 'SE',
      TIER: 'TIER_1',
      DUNS: '271828182',
      QUALITY_RATING: '91',
      CERTIFICATIONS: 'ISO 13485',
    },
    {
      LIFNR: '100402',
      NAME1: 'Nordic Sterile Solutions GMBH',
      LAND1: 'SE',
      TIER: 'TIER_1',
      DUNS: '271828182',
      QUALITY_RATING: '90',
      CERTIFICATIONS: 'ISO 13485',
    },
    {
      LIFNR: '100501',
      NAME1: 'Alpine Polymers GmbH',
      LAND1: 'AT',
      TIER: 'TIER_2',
      DUNS: '161803398',
      QUALITY_RATING: '79',
      CERTIFICATIONS: '',
    },
    {
      LIFNR: '100502',
      NAME1: 'Polymers Alpine GmbH',
      LAND1: 'AT',
      TIER: 'TIER_2',
      DUNS: '161803398',
      QUALITY_RATING: '78',
      CERTIFICATIONS: '',
    },

    // --- REQUIRE_HUMAN clusters ---
    {
      LIFNR: '100601',
      NAME1: 'Bavarian Medical Supplies GmbH',
      LAND1: 'DE',
      TIER: 'TIER_2',
      DUNS: '123450001',
      QUALITY_RATING: '76',
      CERTIFICATIONS: 'ISO 9001',
    },
    {
      LIFNR: '100602',
      NAME1: 'Bavarian Med. Supplies G.m.b.H.',
      LAND1: 'DE',
      TIER: 'TIER_2',
      DUNS: '123450001',
      QUALITY_RATING: '75',
      CERTIFICATIONS: 'ISO 9001',
    },
    {
      LIFNR: '100611',
      NAME1: 'Rhine Valley Polymers Ltd',
      LAND1: 'DE',
      TIER: 'TIER_3',
      DUNS: '123450002',
      QUALITY_RATING: '68',
      CERTIFICATIONS: '',
    },
    {
      LIFNR: '100612',
      NAME1: 'Rhine Vly Polymers Ltd.',
      LAND1: 'DE',
      TIER: 'TIER_3',
      DUNS: '123450002',
      QUALITY_RATING: '67',
      CERTIFICATIONS: '',
    },

    // --- DO_NOT_MERGE bait (similar names, different DUNS) ---
    {
      LIFNR: '100801',
      NAME1: 'Alpha Med Devices GmbH',
      LAND1: 'DE',
      TIER: 'TIER_2',
      DUNS: '990001001',
      QUALITY_RATING: '74',
      CERTIFICATIONS: '',
    },
    {
      LIFNR: '100802',
      NAME1: 'Alpha Med Diagnostics GmbH',
      LAND1: 'DE',
      TIER: 'TIER_2',
      DUNS: '990001002',
      QUALITY_RATING: '73',
      CERTIFICATIONS: '',
    },

    // --- Helix narrative (weak link) ---
    {
      LIFNR: '100701',
      NAME1: 'Helix Components International GmbH',
      LAND1: 'CH',
      TIER: 'TIER_2',
      DUNS: '424242424',
      QUALITY_RATING: '62',
      CERTIFICATIONS: 'ISO 13485',
    },
    {
      LIFNR: '100702',
      NAME1: 'Helix Components Intl.  G.m.b.H.',
      LAND1: 'CH',
      TIER: 'TIER_2',
      DUNS: '424242424',
      QUALITY_RATING: '61',
      CERTIFICATIONS: 'ISO 13485',
    },

    // --- Unique suppliers for fan-out (unique LIFNR each) ---
    ...Array.from({ length: 12 }, (_, index) => {
      const id = 101000 + index;
      return {
        LIFNR: String(id),
        NAME1: `Tier One Partner ${String(index + 1)} GmbH`,
        LAND1: index % 3 === 0 ? 'DE' : index % 3 === 1 ? 'US' : 'MX',
        TIER: 'TIER_1',
        DUNS: '',
        QUALITY_RATING: String(80 + (index % 5)),
        CERTIFICATIONS: 'ISO 13485',
      } satisfies VendorRow;
    }),
  ];

  const material_master: MaterialRow[] = [
    { MATNR: '', MAKTX: 'Missing number', CLASS: 'COMPONENT', CRITICALITY: 'MAJOR', UNIT_COST: '1.00' },
    { MATNR: 'MAT-BAD-COST', MAKTX: 'Bad cost', CLASS: 'COMPONENT', CRITICALITY: 'MAJOR', UNIT_COST: '-3' },
    { MATNR: 'MAT-BAD-CLASS', MAKTX: 'Bad class', CLASS: 'WIDGET', CRITICALITY: 'MAJOR', UNIT_COST: '2' },
    { MATNR: 'MAT-BAD-CRIT', MAKTX: 'Bad crit', CLASS: 'COMPONENT', CRITICALITY: 'LOW', UNIT_COST: '2' },
    { MATNR: 'MAT-HELIX-01', MAKTX: 'Helix weak pump head', CLASS: 'COMPONENT', CRITICALITY: 'MAJOR', UNIT_COST: '14.50' },
    ...Array.from({ length: 38 }, (_, index) => ({
      MATNR: `MAT-${String(2000 + index).padStart(4, '0')}`,
      MAKTX: `Generic component ${String(index)}`,
      CLASS: index % 4 === 0 ? 'DIRECT_MATERIAL' : 'COMPONENT',
      CRITICALITY: index % 7 === 0 ? 'CRITICAL' : 'MAJOR',
      UNIT_COST: String((index + 1) * 1.25),
    })),
  ];

  const device_master: DeviceRow[] = [
    { DEVICE_ID: '', DEVICE_NAME: 'Missing id', PRODUCT_FAMILY: 'Infusion', REG_CLASS: 'CLASS_II', LIFECYCLE: 'ACTIVE' },
    { DEVICE_ID: 'DEV-IP200', DEVICE_NAME: 'Infusion Pump 200', PRODUCT_FAMILY: 'Infusion', REG_CLASS: 'CLASS_II', LIFECYCLE: 'ACTIVE' },
    { DEVICE_ID: 'DEV-BAD-REG', DEVICE_NAME: 'Bad reg', PRODUCT_FAMILY: 'Infusion', REG_CLASS: 'CLASS_IV', LIFECYCLE: 'ACTIVE' },
    { DEVICE_ID: 'DEV-BAD-LIFE', DEVICE_NAME: 'Bad life', PRODUCT_FAMILY: 'Infusion', REG_CLASS: 'CLASS_II', LIFECYCLE: 'RETIRED' },
    ...Array.from({ length: 10 }, (_, index) => ({
      DEVICE_ID: `DEV-${String(3000 + index)}`,
      DEVICE_NAME: `Device family ${String(index)}`,
      PRODUCT_FAMILY: index % 2 === 0 ? 'Infusion' : 'Monitoring',
      REG_CLASS: 'CLASS_II',
      LIFECYCLE: 'ACTIVE',
    })),
  ];

  const supply_relationship: SupplyRow[] = [
    { LIFNR: '999999', MATNR: 'MAT-2000', CONFIDENCE: '0.9' },
    { LIFNR: '100301', MATNR: 'MAT-9999', CONFIDENCE: '0.9' },
    { LIFNR: '100701', MATNR: 'MAT-HELIX-01', CONFIDENCE: '0.48' },
    { LIFNR: '100301', MATNR: 'MAT-2000', CONFIDENCE: '0.92' },
    { LIFNR: '100301', MATNR: 'MAT-2001', CONFIDENCE: '0.88' },
    ...vendor_master
      .filter((row) => row.LIFNR.startsWith('101') && row.LIFNR.length === 6)
      .flatMap((row, vendorIndex) =>
        Array.from({ length: 3 }, (_, partOffset) => ({
          LIFNR: row.LIFNR,
          MATNR: `MAT-${String(2000 + ((vendorIndex * 3 + partOffset) % 38)).padStart(4, '0')}`,
          CONFIDENCE: String(0.55 + ((vendorIndex + partOffset) % 4) * 0.1),
        })),
      ),
  ];

  const device_bom: BomRow[] = [
    { DEVICE_ID: 'DEV-MISSING', MATNR: 'MAT-2000', CONFIDENCE: '0.8' },
    { DEVICE_ID: 'DEV-IP200', MATNR: 'MAT-MISSING', CONFIDENCE: '0.8' },
    { DEVICE_ID: 'DEV-IP200', MATNR: 'MAT-HELIX-01', CONFIDENCE: '0.82' },
    { DEVICE_ID: 'DEV-IP200', MATNR: 'MAT-2000', CONFIDENCE: '0.91' },
    ...device_master
      .filter((row) => row.DEVICE_ID.startsWith('DEV-3'))
      .flatMap((row, deviceIndex) =>
        Array.from({ length: 6 }, (_, line) => ({
          DEVICE_ID: row.DEVICE_ID,
          MATNR: `MAT-${String(2000 + ((deviceIndex * 5 + line) % 38)).padStart(4, '0')}`,
          CONFIDENCE: String(0.6 + (line % 5) * 0.08),
        })),
      ),
  ];

  const bundle: IngestCsvBundle = {
    vendors: { file: 'vendor_master.csv', rows: vendor_master.map((raw, index) => ({ line: index + 2, raw })) },
    materials: {
      file: 'material_master.csv',
      rows: material_master.map((raw, index) => ({ line: index + 2, raw })),
    },
    devices: { file: 'device_master.csv', rows: device_master.map((raw, index) => ({ line: index + 2, raw })) },
    supply: {
      file: 'supply_relationship.csv',
      rows: supply_relationship.map((raw, index) => ({ line: index + 2, raw })),
    },
    bom: { file: 'device_bom.csv', rows: device_bom.map((raw, index) => ({ line: index + 2, raw })) },
  };

  const { report } = buildIngestPlan(
    bundle,
    'manifest-preview',
    '2026-09-17T04:00:00.000Z',
    ingestObjectId,
  );

  const manifest: Week2Manifest = {
    version: 1,
    fixtureId: 'week2-sap-v1',
    expectedDataQuality: {
      rejectsByCode: { ...emptyRejectCounts(), ...report.rejectsByCode },
      skippedLinksByCode: { ...emptySkippedLinkCounts(), ...report.skippedLinksByCode },
    },
    expectedMergeClusters: [
      {
        band: 'AUTO_CONFIRM',
        survivorSourceKey: '100301',
        duplicateSourceKeys: ['100302', '100303'],
        note: 'MedSource legal-suffix and casing drift, shared DUNS',
      },
      {
        band: 'AUTO_CONFIRM',
        survivorSourceKey: '100401',
        duplicateSourceKeys: ['100402'],
        note: 'Nordic Sterile suffix variant',
      },
      {
        band: 'AUTO_CONFIRM',
        survivorSourceKey: '100501',
        duplicateSourceKeys: ['100502'],
        note: 'Transposed tokens + shared DUNS',
      },
      {
        band: 'AUTO_CONFIRM',
        survivorSourceKey: '100701',
        duplicateSourceKeys: ['100702'],
        note: 'Helix abbreviation and suffix drift',
      },
      {
        band: 'REQUIRE_HUMAN',
        survivorSourceKey: '100601',
        duplicateSourceKeys: ['100602'],
        note: 'Abbreviated Med. vs Medical',
      },
      {
        band: 'REQUIRE_HUMAN',
        survivorSourceKey: '100611',
        duplicateSourceKeys: ['100612'],
        note: 'Rhine Valley vs Rhine Vly',
      },
    ],
    expectedNonMergePairs: [
      { sourceKeyA: '100801', sourceKeyB: '100802', note: 'Devices vs Diagnostics' },
    ],
    demoRoles: {
      helixSurvivorSourceKey: '100701',
      medSourceSurvivorSourceKey: '100301',
      helixWeakPartSourceKey: 'MAT-HELIX-01',
      helixOnlyDeviceSourceKey: 'DEV-IP200',
    },
    rowCounts: {
      vendor_master: vendor_master.length,
      material_master: material_master.length,
      device_master: device_master.length,
      supply_relationship: supply_relationship.length,
      device_bom: device_bom.length,
    },
  };

  return {
    vendor_master,
    material_master,
    device_master,
    supply_relationship,
    device_bom,
    manifest,
  };
}

export function week2FixtureCsvFiles(
  fixtures: Week2FixtureFiles,
): Record<string, string> {
  return {
    'vendor_master.csv': toCsv(
      ['LIFNR', 'NAME1', 'LAND1', 'TIER', 'DUNS', 'QUALITY_RATING', 'CERTIFICATIONS'],
      fixtures.vendor_master,
    ),
    'material_master.csv': toCsv(
      ['MATNR', 'MAKTX', 'CLASS', 'CRITICALITY', 'UNIT_COST'],
      fixtures.material_master,
    ),
    'device_master.csv': toCsv(
      ['DEVICE_ID', 'DEVICE_NAME', 'PRODUCT_FAMILY', 'REG_CLASS', 'LIFECYCLE'],
      fixtures.device_master,
    ),
    'supply_relationship.csv': toCsv(['LIFNR', 'MATNR', 'CONFIDENCE'], fixtures.supply_relationship),
    'device_bom.csv': toCsv(['DEVICE_ID', 'MATNR', 'CONFIDENCE'], fixtures.device_bom),
    'manifest.json': `${JSON.stringify(fixtures.manifest, null, 2)}\n`,
  };
}
