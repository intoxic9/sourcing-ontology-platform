import type { InMemoryGraph, InMemoryObject } from '@sourcing/ontology';
import type { Link, LinkTypeName, ObjectOf, Tracked } from '@sourcing/ontology';

const AT = '2026-03-12T07:30:00.000Z';

const direct = {
  method: 'DIRECT' as const,
  sourceSystem: 'SAP',
  sourceRecordId: 'sap-seed',
  pipelineRunId: 'seed-2026-03-12',
  extractedAt: AT,
};

const fuzzy = {
  method: 'FUZZY_MATCH' as const,
  sourceSystem: 'DUNS_MATCH',
  sourceRecordId: 'duns-seed',
  pipelineRunId: 'seed-2026-03-12',
  extractedAt: AT,
};

const llm = {
  method: 'LLM_EXTRACTION' as const,
  sourceSystem: 'COA_PDF',
  sourceRecordId: 'coa-seed',
  pipelineRunId: 'seed-2026-03-12',
  extractedAt: AT,
};

const t = <const T>(
  value: T,
  confidence = 1,
  provenance: typeof direct | typeof fuzzy | typeof llm = direct,
): Tracked<T> => ({ value, confidence, provenance });

const SITES: InMemoryObject[] = [
  {
    objectType: 'SITE',
    data: {
      id: 'SITE-TUT',
      siteName: t('Tuttlingen Machining'),
      country: t('DE'),
      siteType: t('MANUFACTURING'),
    },
  },
  {
    objectType: 'SITE',
    data: {
      id: 'SITE-GLW',
      siteName: t('Galway Assembly'),
      country: t('IE'),
      siteType: t('ASSEMBLY'),
    },
  },
  {
    objectType: 'SITE',
    data: {
      id: 'SITE-PEN',
      siteName: t('Penang Sterilization'),
      country: t('MY', 0.64, fuzzy),
      siteType: t('STERILIZATION'),
    },
  },
];

type Status = ObjectOf<'SUPPLIER'>['status']['value'];

const SUPPLIER_ROWS: {
  id: string;
  name: string;
  country: string;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  status: Status;
  certs: readonly string[];
  rating: number;
  nameConf?: number;
}[] = [
  {
    id: 'SUP-MEDSOURCE',
    name: 'MedSource GmbH',
    country: 'DE',
    tier: 'TIER_1',
    status: 'PROVISIONAL',
    certs: ['ISO 13485', 'ISO 9001'],
    rating: 86,
  },
  {
    id: 'SUP-HELIX',
    name: 'Helix Polymers AG',
    country: 'CH',
    tier: 'TIER_1',
    status: 'APPROVED',
    certs: ['ISO 13485'],
    rating: 81,
    nameConf: 0.66,
  },
  {
    id: 'SUP-STERILE',
    name: 'SterilePack Ireland Ltd',
    country: 'IE',
    tier: 'TIER_2',
    status: 'SUSPENDED',
    certs: ['ISO 13485'],
    rating: 54,
  },
  {
    id: 'SUP-NIPPON',
    name: 'Nippon Precision Catheters',
    country: 'JP',
    tier: 'TIER_1',
    status: 'APPROVED',
    certs: ['ISO 13485', 'ISO 14971'],
    rating: 91,
  },
  {
    id: 'SUP-VALLEY',
    name: 'Valley Mold Inc',
    country: 'US',
    tier: 'TIER_2',
    status: 'APPROVED',
    certs: ['ISO 9001'],
    rating: 73,
    nameConf: 0.58,
  },
];

const MORE_SUPPLIERS = [
  ['SUP-AURORA', 'Aurora Extrusions', 'US'],
  ['SUP-BOSCH', 'Bosch Sensortec Medical', 'DE'],
  ['SUP-CORK', 'Cork Wire Forms', 'IE'],
  ['SUP-DAITO', 'Daito Spring KK', 'JP'],
  ['SUP-ELITE', 'Elite Cleanroom Consumables', 'MY'],
  ['SUP-FRESEN', 'Fresenius Component Works', 'DE'],
  ['SUP-GROVE', 'Grove Filters Ltd', 'IE'],
  ['SUP-HANNO', 'Hannover Laser Cut', 'DE'],
  ['SUP-INTEGRA', 'Integra Silicone House', 'US'],
  ['SUP-JENA', 'Jena Optics Medical', 'DE'],
  ['SUP-KUALA', 'Kuala Molding Sdn Bhd', 'MY'],
  ['SUP-LAKE', 'Lake Country PCBs', 'US'],
  ['SUP-MUNICH', 'Munich Adhesive Systems', 'DE'],
  ['SUP-OSAKA', 'Osaka Needle Works', 'JP'],
  ['SUP-PHOENIX', 'Phoenix Heat Treat', 'US'],
] as const;

function supplierObject(
  id: string,
  name: string,
  country: string,
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3',
  status: Status,
  certs: readonly string[],
  rating: number,
  nameConf = 1,
): InMemoryObject {
  return {
    objectType: 'SUPPLIER',
    data: {
      id,
      legalName: t(name, nameConf, nameConf < 0.7 ? fuzzy : direct),
      country: t(country),
      tier: t(tier),
      status: t(status),
      qualityRating: t(rating),
      certifications: certs.map((cert, index) =>
        t(cert, index === 1 && cert !== 'ISO 13485' ? 0.57 : 1, index === 1 ? llm : direct),
      ),
      aliases: [],
      mergedFrom: [],
    },
  };
}

const suppliers: InMemoryObject[] = [
  ...SUPPLIER_ROWS.map((row) =>
    supplierObject(
      row.id,
      row.name,
      row.country,
      row.tier,
      row.status,
      row.certs,
      row.rating,
      row.nameConf ?? 1,
    ),
  ),
  ...MORE_SUPPLIERS.map(([id, name, country], index) =>
    supplierObject(
      id,
      name,
      country,
      index % 3 === 0 ? 'TIER_1' : 'TIER_2',
      'APPROVED',
      ['ISO 13485'],
      70 + (index % 20),
      index === 4 ? 0.61 : 1,
    ),
  ),
];

const DEVICE_ROWS: {
  id: string;
  name: string;
  family: string;
  klass: 'CLASS_I' | 'CLASS_II' | 'CLASS_III';
  site: string;
}[] = [
  { id: 'DEV-IP200', name: 'Infusor IP-200', family: 'Infusion', klass: 'CLASS_II', site: 'SITE-GLW' },
  { id: 'DEV-IP350', name: 'Infusor IP-350', family: 'Infusion', klass: 'CLASS_II', site: 'SITE-GLW' },
  { id: 'DEV-MON8', name: 'VitalMon 8', family: 'Monitoring', klass: 'CLASS_II', site: 'SITE-TUT' },
  { id: 'DEV-MON12', name: 'VitalMon 12', family: 'Monitoring', klass: 'CLASS_II', site: 'SITE-TUT' },
  { id: 'DEV-DIA1', name: 'RenalFlow Cartridge', family: 'Dialysis', klass: 'CLASS_III', site: 'SITE-PEN' },
  { id: 'DEV-DIA2', name: 'RenalFlow Plus', family: 'Dialysis', klass: 'CLASS_III', site: 'SITE-PEN' },
  { id: 'DEV-CATH', name: 'Helix Central Catheter', family: 'Access', klass: 'CLASS_II', site: 'SITE-TUT' },
  { id: 'DEV-PUMP', name: 'SyringePump SP-4', family: 'Infusion', klass: 'CLASS_II', site: 'SITE-GLW' },
  { id: 'DEV-MASK', name: 'AnesthMask Adult', family: 'Airway', klass: 'CLASS_I', site: 'SITE-PEN' },
  { id: 'DEV-ECG', name: 'CardioLead ECG Cable', family: 'Monitoring', klass: 'CLASS_I', site: 'SITE-TUT' },
];

const devices: InMemoryObject[] = DEVICE_ROWS.map((row) => ({
  objectType: 'DEVICE',
  data: {
    id: row.id,
    deviceName: t(row.name),
    productFamily: t(row.family),
    regulatoryClass: t(row.klass),
    lifecycleStage: t('ACTIVE'),
  },
}));

const PART_NAMES = [
  'silicone infusion tubing',
  'PCB controller board',
  'ABS pump housing',
  'peristaltic cassette',
  'pressure transducer',
  'Li-ion battery pack',
  'OLED status display',
  'motor gearbox',
  'sterile fluid path',
  'luer lock adapter',
  'NIBP cuff bladder',
  'SpO2 optical module',
  'ECG lead set',
  'alarm speaker',
  'power supply 24V',
  'dialysis membrane',
  'blood-side connector',
  'dialysate coupling',
  'heparin line',
  'catheter extrusion',
  'guidewire core',
  'hydrophilic coating',
  'suture wing',
  'needleless port',
  'mask cushion silicone',
  'exhalation valve',
  'headgear strap',
  'CO2 sampling line',
  'syringe barrel 50ml',
  'plunger stopper',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const parts: InMemoryObject[] = Array.from({ length: 60 }, (_, index) => {
  const n = index + 1;
  const criticality = n % 11 === 0 ? 'CRITICAL' : n % 5 === 0 ? 'MAJOR' : 'MINOR';
  const classification =
    n % 3 === 0 ? 'SUBASSEMBLY' : n % 3 === 1 ? 'COMPONENT' : 'DIRECT_MATERIAL';
  const conf = n === 7 || n === 19 || n === 41 ? 0.52 : 1;
  return {
    objectType: 'PART' as const,
    data: {
      id: `PART-${pad(n)}`,
      partNumber: t(`PN-${String(1000 + n)}`, conf, conf < 0.7 ? llm : direct),
      description: t(PART_NAMES[index % PART_NAMES.length] ?? 'component'),
      classification: t(classification),
      criticality: t(criticality),
      requiresRequalification: t(false),
      unitCost: t(5 + (n % 40) * 1.25),
    },
  };
});

const events: InMemoryObject[] = [
  {
    objectType: 'QUALITY_EVENT',
    data: {
      id: 'QE-CAPA-441',
      eventType: t('AUDIT_FINDING'),
      severity: t('CRITICAL'),
      openedAt: t('2026-02-01T10:00:00.000Z'),
      description: t('Ethylene oxide residuals above spec on sterile barrier'),
    },
  },
  {
    objectType: 'QUALITY_EVENT',
    data: {
      id: 'QE-NCR-118',
      eventType: t('NONCONFORMANCE'),
      severity: t('MAJOR'),
      openedAt: t('2026-01-20T09:00:00.000Z'),
      closedAt: t('2026-02-18T16:00:00.000Z'),
      description: t('Dimensional drift on pump housing cavity 3'),
    },
  },
  {
    objectType: 'QUALITY_EVENT',
    data: {
      id: 'QE-CMP-009',
      eventType: t('COMPLAINT'),
      severity: t('MINOR'),
      openedAt: t('2026-03-01T12:00:00.000Z'),
      description: t('Cosmetic flash on luer, no patient harm'),
    },
  },
];

function L(
  linkType: LinkTypeName,
  fromId: string,
  toId: string,
  confidence: number,
): Link {
  const provenance = confidence < 0.7 ? fuzzy : direct;
  return {
    id: `${linkType}:${fromId}->${toId}`,
    linkType,
    fromId,
    toId,
    confidence,
    provenance,
  };
}

const supplierIds = suppliers.map((s) => s.data.id);
const partIds = parts.map((p) => p.data.id);
const suppliersExceptHelix = supplierIds.filter((id) => id !== 'SUP-HELIX');

const supplyLinks: Link[] = partIds.map((partId, index) => {
  const supplierId = suppliersExceptHelix[index % suppliersExceptHelix.length] ?? 'SUP-MEDSOURCE';
  const confidence = index % 13 === 0 ? 0.48 : index % 9 === 0 ? 0.63 : 0.97;
  return L('SUPPLIES', supplierId, partId, confidence);
});

// Helix's only supply edge is the weak tubing match. That is the demo's weakest link:
// every device Helix reaches is only as strong as this hop.
const helixTubing = L('SUPPLIES', 'SUP-HELIX', 'PART-01', 0.55);

const composed: Link[] = DEVICE_ROWS.flatMap((device, deviceIndex) => {
  const start = deviceIndex * 5;
  return [0, 1, 2, 3, 4].map((offset) => {
    const partId = `PART-${pad(start + offset + 1)}`;
    const confidence = device.id === 'DEV-IP200' && offset === 0 ? 0.92 : 0.96;
    return L('COMPOSED_OF', device.id, partId, confidence);
  });
});

const manufactured: Link[] = DEVICE_ROWS.map((device) =>
  L('MANUFACTURED_AT', device.id, device.site, device.site === 'SITE-PEN' ? 0.67 : 0.99),
);

const qualityLinks: Link[] = [
  L('AFFECTS_SUPPLIER', 'QE-CAPA-441', 'SUP-STERILE', 0.91),
  L('AFFECTS_PART', 'QE-CAPA-441', 'PART-16', 0.88),
  L('AFFECTS_SUPPLIER', 'QE-NCR-118', 'SUP-VALLEY', 0.73),
  L('AFFECTS_PART', 'QE-NCR-118', 'PART-03', 0.7),
  L('AFFECTS_PART', 'QE-CMP-009', 'PART-24', 0.44),
];

const links: Link[] = [...supplyLinks, helixTubing, ...composed, ...manufactured, ...qualityLinks];

// Unique on (link_type, from_id, to_id) — drop a duplicate Helix/PART-01 if modulo already assigned it.
const seen = new Set<string>();
const uniqueLinks = links.filter((link) => {
  const key = `${link.linkType}|${link.fromId}|${link.toId}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

export const seedGraph: InMemoryGraph = {
  objects: [...SITES, ...suppliers, ...devices, ...parts, ...events],
  links: uniqueLinks,
};

export const DEMO_SUPPLIER_RISK = 'SUP-HELIX';
export const DEMO_SUPPLIER_ACTION = 'SUP-MEDSOURCE';
export const DEMO_HELIX_DEVICE = 'DEV-IP200';
