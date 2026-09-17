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

function poolPart(index: number): string {
  return `MAT-${String(2000 + index).padStart(4, '0')}`;
}

/** Shared BOM parts — each appears on several devices so anchor suppliers fan out. */
const SHARED_BOM_PARTS = [
  'MAT-MS-01',
  'MAT-MS-02',
  'MAT-MS-03',
  'MAT-MS-04',
  'MAT-MS-05',
  'MAT-MS-06',
  'MAT-MS-07',
  'MAT-MS-08',
] as const;

const SHARED_BOM_DEVICES = [
  'DEV-IP200',
  'DEV-3000',
  'DEV-3001',
  'DEV-3002',
  'DEV-3003',
  'DEV-3004',
] as const;

function buildSupplyRows(
  anchorLifnr: string,
  partIds: readonly string[],
  confidenceFor: (matnr: string, index: number) => number,
): SupplyRow[] {
  return partIds.map((matnr, index) => ({
    LIFNR: anchorLifnr,
    MATNR: matnr,
    CONFIDENCE: confidenceFor(matnr, index).toFixed(2),
  }));
}

export function buildWeek2Fixtures(): Week2FixtureFiles {
  const vendor_master: VendorRow[] = [
    // --- DQ rejects (kept in file; counts vary by code) ---
    { LIFNR: '', NAME1: 'Ghost Vendor', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100001', NAME1: '   ', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100005', NAME1: '', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100006', NAME1: '  \t  ', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100002', NAME1: 'Bad Tier AG', LAND1: 'DE', TIER: 'TIER_9', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100007', NAME1: 'Also Bad Tier', LAND1: 'DE', TIER: 'TIER_X', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100008', NAME1: 'Tier Typo GmbH', LAND1: 'DE', TIER: 'TIER1', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100009', NAME1: 'Empty Tier', LAND1: 'DE', TIER: '', DUNS: '', QUALITY_RATING: '70', CERTIFICATIONS: '' },
    { LIFNR: '100003', NAME1: 'Bad Rating GmbH', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: 'excellent', CERTIFICATIONS: '' },
    { LIFNR: '100010', NAME1: 'NaN Rating', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: 'N/A', CERTIFICATIONS: '' },
    { LIFNR: '100011', NAME1: 'Text Rating', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: 'high', CERTIFICATIONS: '' },
    { LIFNR: '100012', NAME1: 'Blank Rating', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '', CERTIFICATIONS: '' },
    { LIFNR: '100004', NAME1: 'First LIFNR Row', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '72', CERTIFICATIONS: '' },
    { LIFNR: '100004', NAME1: 'Duplicate LIFNR Row', LAND1: 'DE', TIER: 'TIER_2', DUNS: '', QUALITY_RATING: '72', CERTIFICATIONS: '' },

    // --- Merge clusters (unchanged keys) ---
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

    // Anchor-tier fan-out suppliers (8–15 parts each in supply_relationship)
    {
      LIFNR: '101001',
      NAME1: 'Continental Precision Machining AG',
      LAND1: 'DE',
      TIER: 'TIER_1',
      DUNS: '',
      QUALITY_RATING: '86',
      CERTIFICATIONS: 'ISO 13485',
    },
    {
      LIFNR: '101002',
      NAME1: 'Pacific Biomaterials Inc.',
      LAND1: 'US',
      TIER: 'TIER_1',
      DUNS: '',
      QUALITY_RATING: '84',
      CERTIFICATIONS: 'ISO 13485',
    },
    {
      LIFNR: '101003',
      NAME1: 'Danube Electromechanical GmbH',
      LAND1: 'AT',
      TIER: 'TIER_1',
      DUNS: '',
      QUALITY_RATING: '83',
      CERTIFICATIONS: 'ISO 13485|ISO 9001',
    },

    // Middle tier (3–5 parts)
    ...Array.from({ length: 8 }, (_, index) => ({
      LIFNR: String(101010 + index),
      NAME1: `Regional Supplier ${String(index + 1)} Ltd`,
      LAND1: index % 2 === 0 ? 'IE' : 'PL',
      TIER: 'TIER_2',
      DUNS: '',
      QUALITY_RATING: String(72 + (index % 6)),
      CERTIFICATIONS: index % 3 === 0 ? 'ISO 9001' : '',
    })),

    // Long tail (1–2 parts)
    ...Array.from({ length: 14 }, (_, index) => ({
      LIFNR: String(101020 + index),
      NAME1: `Boutique Vendor ${String(index + 1)}`,
      LAND1: 'MX',
      TIER: 'TIER_3',
      DUNS: '',
      QUALITY_RATING: String(60 + (index % 8)),
      CERTIFICATIONS: '',
    })),
  ];

  const material_master: MaterialRow[] = [
    { MATNR: '', MAKTX: 'Missing number', CLASS: 'COMPONENT', CRITICALITY: 'MAJOR', UNIT_COST: '1.00' },
    { MATNR: 'MAT-BAD-COST-1', MAKTX: 'Bad cost negative', CLASS: 'COMPONENT', CRITICALITY: 'MAJOR', UNIT_COST: '-3' },
    { MATNR: 'MAT-BAD-COST-2', MAKTX: 'Bad cost text', CLASS: 'COMPONENT', CRITICALITY: 'MAJOR', UNIT_COST: 'free' },
    { MATNR: 'MAT-BAD-COST-3', MAKTX: 'Bad cost empty', CLASS: 'COMPONENT', CRITICALITY: 'MAJOR', UNIT_COST: '' },
    { MATNR: 'MAT-BAD-CLASS-1', MAKTX: 'Bad class', CLASS: 'WIDGET', CRITICALITY: 'MAJOR', UNIT_COST: '2' },
    { MATNR: 'MAT-BAD-CLASS-2', MAKTX: 'Bad class typo', CLASS: 'COMP', CRITICALITY: 'MAJOR', UNIT_COST: '2' },
    { MATNR: 'MAT-HELIX-01', MAKTX: 'Helix weak pump head', CLASS: 'COMPONENT', CRITICALITY: 'MAJOR', UNIT_COST: '14.50' },
    ...SHARED_BOM_PARTS.map((matnr, index) => ({
      MATNR: matnr,
      MAKTX: `Shared subassembly ${String(index + 1)}`,
      CLASS: 'SUBASSEMBLY' as const,
      CRITICALITY: index === 0 ? ('CRITICAL' as const) : ('MAJOR' as const),
      UNIT_COST: String(8 + index * 2.5),
    })),
    ...Array.from({ length: 80 }, (_, index) => ({
      MATNR: poolPart(index),
      MAKTX: `Pool component ${String(index)}`,
      CLASS: index % 5 === 0 ? 'DIRECT_MATERIAL' : 'COMPONENT',
      CRITICALITY: index % 11 === 0 ? 'CRITICAL' : 'MAJOR',
      UNIT_COST: String((index + 1) * 1.15),
    })),
  ];

  const device_master: DeviceRow[] = [
    { DEVICE_ID: '', DEVICE_NAME: 'Missing id', PRODUCT_FAMILY: 'Infusion', REG_CLASS: 'CLASS_II', LIFECYCLE: 'ACTIVE' },
    { DEVICE_ID: 'DEV-IP200', DEVICE_NAME: 'Infusion Pump 200', PRODUCT_FAMILY: 'Infusion', REG_CLASS: 'CLASS_II', LIFECYCLE: 'ACTIVE' },
    { DEVICE_ID: 'DEV-BAD-REG-1', DEVICE_NAME: 'Bad reg', PRODUCT_FAMILY: 'Infusion', REG_CLASS: 'CLASS_IV', LIFECYCLE: 'ACTIVE' },
    { DEVICE_ID: 'DEV-BAD-REG-2', DEVICE_NAME: 'Bad reg two', PRODUCT_FAMILY: 'Infusion', REG_CLASS: 'CLASS_IV', LIFECYCLE: 'ACTIVE' },
    { DEVICE_ID: 'DEV-BAD-LIFE', DEVICE_NAME: 'Bad life', PRODUCT_FAMILY: 'Infusion', REG_CLASS: 'CLASS_II', LIFECYCLE: 'RETIRED' },
    ...Array.from({ length: 10 }, (_, index) => ({
      DEVICE_ID: `DEV-${String(3000 + index)}`,
      DEVICE_NAME: `Device family ${String(index)}`,
      PRODUCT_FAMILY: index % 2 === 0 ? 'Infusion' : 'Monitoring',
      REG_CLASS: 'CLASS_II',
      LIFECYCLE: 'ACTIVE',
    })),
  ];

  const medSourceParts = [
    ...SHARED_BOM_PARTS,
    poolPart(0),
    poolPart(1),
    poolPart(2),
    poolPart(3),
    poolPart(4),
  ];

  const supply_relationship: SupplyRow[] = [
    { LIFNR: '999998', MATNR: poolPart(0), CONFIDENCE: '0.9' },
    { LIFNR: '999997', MATNR: poolPart(1), CONFIDENCE: '0.9' },
    { LIFNR: '999999', MATNR: poolPart(2), CONFIDENCE: '0.9' },
    { LIFNR: '100301', MATNR: 'MAT-ORPHAN', CONFIDENCE: '0.9' },
    { LIFNR: '100301', MATNR: poolPart(5), CONFIDENCE: '0.9' },
    { LIFNR: '100701', MATNR: 'MAT-HELIX-01', CONFIDENCE: '0.48' },
    ...buildSupplyRows('100301', medSourceParts, (matnr, index) => {
      if (matnr === 'MAT-MS-08') return 0.51;
      return 0.72 + (index % 5) * 0.05;
    }),
    ...buildSupplyRows('101001', [poolPart(10), poolPart(11), poolPart(12), poolPart(13), poolPart(14), poolPart(15), poolPart(16), poolPart(17), poolPart(18), poolPart(19)], (_, index) => 0.65 + (index % 4) * 0.08),
    ...buildSupplyRows('101002', [poolPart(20), poolPart(21), poolPart(22), poolPart(23), poolPart(24), poolPart(25), poolPart(26), poolPart(27)], (_, index) => 0.7 + (index % 3) * 0.07),
    ...buildSupplyRows(
      '101003',
      Array.from({ length: 15 }, (_, index) => poolPart(28 + index)),
      (_, index) => 0.68 + (index % 6) * 0.04,
    ),
    ...Array.from({ length: 8 }, (_, vendorIndex) => {
      const lifnr = String(101010 + vendorIndex);
      const partCount = 3 + (vendorIndex % 3);
      return Array.from({ length: partCount }, (_, line) => ({
        LIFNR: lifnr,
        MATNR: poolPart((43 + vendorIndex * 4 + line) % 80),
        CONFIDENCE: (0.58 + ((vendorIndex + line) % 5) * 0.07).toFixed(2),
      }));
    }).flat(),
    ...Array.from({ length: 14 }, (_, vendorIndex) => {
      const lifnr = String(101020 + vendorIndex);
      const partCount = 1 + (vendorIndex % 2);
      return Array.from({ length: partCount }, (_, line) => ({
        LIFNR: lifnr,
        MATNR: poolPart(10 + ((vendorIndex * 2 + line) % 80)),
        CONFIDENCE: (0.55 + (vendorIndex % 4) * 0.1).toFixed(2),
      }));
    }).flat(),
  ];

  const device_bom: BomRow[] = [
    { DEVICE_ID: 'DEV-MISSING-1', MATNR: poolPart(0), CONFIDENCE: '0.8' },
    { DEVICE_ID: 'DEV-MISSING-2', MATNR: poolPart(1), CONFIDENCE: '0.8' },
    { DEVICE_ID: 'DEV-IP200', MATNR: 'MAT-NOPE', CONFIDENCE: '0.8' },
    { DEVICE_ID: 'DEV-IP200', MATNR: 'MAT-ALSO-NOPE', CONFIDENCE: '0.8' },
    { DEVICE_ID: 'DEV-IP200', MATNR: 'MAT-HELIX-01', CONFIDENCE: '0.82' },
    ...SHARED_BOM_DEVICES.flatMap((deviceId, deviceIndex) =>
      SHARED_BOM_PARTS.map((matnr, partIndex) => ({
        DEVICE_ID: deviceId,
        MATNR: matnr,
        CONFIDENCE: (0.62 + ((deviceIndex + partIndex) % 7) * 0.05).toFixed(2),
      })),
    ),
    ...device_master
      .filter((row) => row.DEVICE_ID.startsWith('DEV-3'))
      .flatMap((row, deviceIndex) =>
        Array.from({ length: 5 + (deviceIndex % 3) }, (_, line) => ({
          DEVICE_ID: row.DEVICE_ID,
          MATNR: poolPart((50 + deviceIndex * 3 + line) % 80),
          CONFIDENCE: (0.58 + (line % 6) * 0.07).toFixed(2),
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
    fixtureId: 'week2-sap-v2',
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
