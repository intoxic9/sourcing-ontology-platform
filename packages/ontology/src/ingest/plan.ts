import type { LinkInput } from '../link-types.js';
import type { ObjectOf } from '../context.js';
import type { Provenance } from '../tracked.js';
import {
  tallyRejects,
  tallySkippedLinks,
  type DataQualityReport,
  type IngestReject,
  type IngestSkippedLink,
} from './dq.js';
import type { emptyRejectCounts, emptySkippedLinkCounts } from './dq.js';
import type { IngestCsvBundle } from './dto.js';
import { collapseWhitespace, normalizeSourceKey } from './normalize.js';
import {
  SAP_DEVICE_BOM,
  SAP_DEVICE_MASTER,
  SAP_MATERIAL_MASTER,
  SAP_SUPPLY_REL,
  SAP_VENDOR_MASTER,
} from './sources.js';

export type IngestObjectIdResolver = (sourceSystem: string, sourceKey: string) => string;

export type PlannedSupplier = {
  id: string;
  sourceKey: string;
  data: ObjectOf<'SUPPLIER'>;
};

export type PlannedPart = {
  id: string;
  sourceKey: string;
  data: ObjectOf<'PART'>;
};

export type PlannedDevice = {
  id: string;
  sourceKey: string;
  data: ObjectOf<'DEVICE'>;
};

export type PlannedLink = LinkInput & {
  fromSourceKey: string;
  toSourceKey: string;
};

export type IngestPlan = {
  suppliers: readonly PlannedSupplier[];
  parts: readonly PlannedPart[];
  devices: readonly PlannedDevice[];
  links: readonly PlannedLink[];
};

const TIER_VALUES = ['TIER_1', 'TIER_2', 'TIER_3'] as const;
const CLASS_VALUES = ['DIRECT_MATERIAL', 'COMPONENT', 'SUBASSEMBLY'] as const;
const CRIT_VALUES = ['CRITICAL', 'MAJOR', 'MINOR'] as const;
const REG_VALUES = ['CLASS_I', 'CLASS_II', 'CLASS_III'] as const;
const LIFE_VALUES = ['DEVELOPMENT', 'ACTIVE', 'END_OF_LIFE', 'DISCONTINUED'] as const;

function directProvenance(
  sourceSystem: string,
  sourceRecordId: string,
  pipelineRunId: string,
  extractedAt: string,
): Provenance {
  return {
    method: 'DIRECT',
    sourceSystem,
    sourceRecordId,
    pipelineRunId,
    extractedAt,
  };
}

function tracked<const T>(
  value: T,
  provenance: Provenance,
  confidence = 1,
): { value: T; confidence: number; provenance: Provenance } {
  return { value, confidence, provenance };
}

function parseConfidence(raw: string, fallback = 0.85): number {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

function parseCertifications(raw: string): readonly string[] {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  return trimmed
    .split('|')
    .map((part) => collapseWhitespace(part))
    .filter((part) => part.length > 0);
}

export function buildIngestPlan(
  bundle: IngestCsvBundle,
  pipelineRunId: string,
  extractedAt: string,
  resolveObjectId: IngestObjectIdResolver,
): { plan: IngestPlan; report: DataQualityReport } {
  const rejects: IngestReject[] = [];
  const skippedLinks: IngestSkippedLink[] = [];

  const suppliers: PlannedSupplier[] = [];
  const parts: PlannedPart[] = [];
  const devices: PlannedDevice[] = [];
  const links: PlannedLink[] = [];

  const vendorByKey = new Map<string, string>();
  const materialByKey = new Map<string, string>();
  const deviceByKey = new Map<string, string>();

  const seenLifnr = new Map<string, { line: number; name: string }>();

  for (const { line, raw } of bundle.vendors.rows) {
    const sourceRecordId = `${bundle.vendors.file}:${String(line)}`;
    const lifnr = normalizeSourceKey(raw.LIFNR);
    const name = raw.NAME1;

    if (lifnr === '') {
      rejects.push({
        code: 'VENDOR_MISSING_LIFNR',
        file: bundle.vendors.file,
        line,
        message: 'LIFNR is blank',
      });
      continue;
    }

    if (collapseWhitespace(name) === '') {
      rejects.push({
        code: 'VENDOR_MISSING_NAME',
        file: bundle.vendors.file,
        line,
        message: `vendor ${lifnr} has blank NAME1`,
      });
      continue;
    }

    const tierRaw = collapseWhitespace(raw.TIER).toUpperCase();
    if (!(TIER_VALUES as readonly string[]).includes(tierRaw)) {
      rejects.push({
        code: 'VENDOR_INVALID_TIER',
        file: bundle.vendors.file,
        line,
        message: `vendor ${lifnr} has invalid TIER ${raw.TIER}`,
      });
      continue;
    }

    const ratingRaw = raw.QUALITY_RATING.trim();
    const rating = Number(ratingRaw);
    if (ratingRaw === '' || !Number.isFinite(rating)) {
      rejects.push({
        code: 'VENDOR_INVALID_QUALITY_RATING',
        file: bundle.vendors.file,
        line,
        message: `vendor ${lifnr} has non-numeric QUALITY_RATING`,
      });
      continue;
    }

    const prior = seenLifnr.get(lifnr);
    if (prior !== undefined) {
      rejects.push({
        code: 'VENDOR_DUPLICATE_LIFNR',
        file: bundle.vendors.file,
        line,
        message: `duplicate LIFNR ${lifnr} (first at line ${String(prior.line)})`,
      });
      continue;
    }
    seenLifnr.set(lifnr, { line, name: collapseWhitespace(name) });

    const prov = directProvenance(SAP_VENDOR_MASTER, sourceRecordId, pipelineRunId, extractedAt);
    const dunsTrimmed = collapseWhitespace(raw.DUNS);
    const id = resolveObjectId(SAP_VENDOR_MASTER, lifnr);
    vendorByKey.set(lifnr, id);

    const data: ObjectOf<'SUPPLIER'> = {
      id,
      legalName: tracked(collapseWhitespace(name), prov),
      country: tracked(collapseWhitespace(raw.LAND1), prov),
      tier: tracked(tierRaw as (typeof TIER_VALUES)[number], prov),
      status: tracked('PROVISIONAL', prov),
      qualityRating: tracked(rating, prov),
      certifications: parseCertifications(raw.CERTIFICATIONS).map((cert) => tracked(cert, prov)),
      aliases: [],
      mergedFrom: [],
      ...(dunsTrimmed === '' ? {} : { duns: tracked(dunsTrimmed, prov) }),
    };

    suppliers.push({ id, sourceKey: lifnr, data });
  }

  for (const { line, raw } of bundle.materials.rows) {
    const sourceRecordId = `${bundle.materials.file}:${String(line)}`;
    const matnr = normalizeSourceKey(raw.MATNR);

    if (matnr === '') {
      rejects.push({
        code: 'MATERIAL_MISSING_MATNR',
        file: bundle.materials.file,
        line,
        message: 'MATNR is blank',
      });
      continue;
    }

    const costRaw = raw.UNIT_COST.trim();
    const cost = Number(costRaw);
    if (costRaw === '' || !Number.isFinite(cost) || cost < 0) {
      rejects.push({
        code: 'MATERIAL_INVALID_UNIT_COST',
        file: bundle.materials.file,
        line,
        message: `material ${matnr} has invalid UNIT_COST`,
      });
      continue;
    }

    const classRaw = collapseWhitespace(raw.CLASS).toUpperCase();
    if (!(CLASS_VALUES as readonly string[]).includes(classRaw)) {
      rejects.push({
        code: 'MATERIAL_INVALID_CLASSIFICATION',
        file: bundle.materials.file,
        line,
        message: `material ${matnr} has invalid CLASS`,
      });
      continue;
    }

    const critRaw = collapseWhitespace(raw.CRITICALITY).toUpperCase();
    if (!(CRIT_VALUES as readonly string[]).includes(critRaw)) {
      rejects.push({
        code: 'MATERIAL_INVALID_CRITICALITY',
        file: bundle.materials.file,
        line,
        message: `material ${matnr} has invalid CRITICALITY`,
      });
      continue;
    }

    const prov = directProvenance(SAP_MATERIAL_MASTER, sourceRecordId, pipelineRunId, extractedAt);
    const id = resolveObjectId(SAP_MATERIAL_MASTER, matnr);
    materialByKey.set(matnr, id);

    parts.push({
      id,
      sourceKey: matnr,
      data: {
        id,
        partNumber: tracked(matnr, prov),
        description: tracked(collapseWhitespace(raw.MAKTX), prov),
        classification: tracked(classRaw as (typeof CLASS_VALUES)[number], prov),
        criticality: tracked(critRaw as (typeof CRIT_VALUES)[number], prov),
        requiresRequalification: tracked(false, prov),
        unitCost: tracked(cost, prov),
      },
    });
  }

  for (const { line, raw } of bundle.devices.rows) {
    const sourceRecordId = `${bundle.devices.file}:${String(line)}`;
    const deviceId = normalizeSourceKey(raw.DEVICE_ID);

    if (deviceId === '') {
      rejects.push({
        code: 'DEVICE_MISSING_ID',
        file: bundle.devices.file,
        line,
        message: 'DEVICE_ID is blank',
      });
      continue;
    }

    if (collapseWhitespace(raw.DEVICE_NAME) === '') {
      rejects.push({
        code: 'DEVICE_MISSING_NAME',
        file: bundle.devices.file,
        line,
        message: `device ${deviceId} has blank DEVICE_NAME`,
      });
      continue;
    }

    const regRaw = collapseWhitespace(raw.REG_CLASS).toUpperCase();
    if (!(REG_VALUES as readonly string[]).includes(regRaw)) {
      rejects.push({
        code: 'DEVICE_INVALID_REG_CLASS',
        file: bundle.devices.file,
        line,
        message: `device ${deviceId} has invalid REG_CLASS`,
      });
      continue;
    }

    const lifeRaw = collapseWhitespace(raw.LIFECYCLE).toUpperCase();
    if (!(LIFE_VALUES as readonly string[]).includes(lifeRaw)) {
      rejects.push({
        code: 'DEVICE_INVALID_LIFECYCLE',
        file: bundle.devices.file,
        line,
        message: `device ${deviceId} has invalid LIFECYCLE`,
      });
      continue;
    }

    const prov = directProvenance(SAP_DEVICE_MASTER, sourceRecordId, pipelineRunId, extractedAt);
    const id = resolveObjectId(SAP_DEVICE_MASTER, deviceId);
    deviceByKey.set(deviceId, id);

    devices.push({
      id,
      sourceKey: deviceId,
      data: {
        id,
        deviceName: tracked(collapseWhitespace(raw.DEVICE_NAME), prov),
        productFamily: tracked(collapseWhitespace(raw.PRODUCT_FAMILY), prov),
        regulatoryClass: tracked(regRaw as (typeof REG_VALUES)[number], prov),
        lifecycleStage: tracked(lifeRaw as (typeof LIFE_VALUES)[number], prov),
      },
    });
  }

  for (const { line, raw } of bundle.supply.rows) {
    const sourceRecordId = `${bundle.supply.file}:${String(line)}`;
    const lifnr = normalizeSourceKey(raw.LIFNR);
    const matnr = normalizeSourceKey(raw.MATNR);
    const fromId = vendorByKey.get(lifnr);
    if (fromId === undefined) {
      skippedLinks.push({
        code: 'SUPPLY_ORPHAN_VENDOR',
        file: bundle.supply.file,
        line,
        message: `unknown LIFNR ${lifnr}`,
      });
      continue;
    }
    const toId = materialByKey.get(matnr);
    if (toId === undefined) {
      skippedLinks.push({
        code: 'SUPPLY_ORPHAN_MATERIAL',
        file: bundle.supply.file,
        line,
        message: `unknown MATNR ${matnr}`,
      });
      continue;
    }

    const prov = directProvenance(SAP_SUPPLY_REL, sourceRecordId, pipelineRunId, extractedAt);
    links.push({
      linkType: 'SUPPLIES',
      fromId,
      toId,
      confidence: parseConfidence(raw.CONFIDENCE, 0.9),
      provenance: prov,
      fromSourceKey: lifnr,
      toSourceKey: matnr,
    });
  }

  for (const { line, raw } of bundle.bom.rows) {
    const sourceRecordId = `${bundle.bom.file}:${String(line)}`;
    const deviceId = normalizeSourceKey(raw.DEVICE_ID);
    const matnr = normalizeSourceKey(raw.MATNR);
    const fromId = deviceByKey.get(deviceId);
    if (fromId === undefined) {
      skippedLinks.push({
        code: 'BOM_ORPHAN_DEVICE',
        file: bundle.bom.file,
        line,
        message: `unknown DEVICE_ID ${deviceId}`,
      });
      continue;
    }
    const toId = materialByKey.get(matnr);
    if (toId === undefined) {
      skippedLinks.push({
        code: 'BOM_ORPHAN_PART',
        file: bundle.bom.file,
        line,
        message: `unknown MATNR ${matnr}`,
      });
      continue;
    }

    const prov = directProvenance(SAP_DEVICE_BOM, sourceRecordId, pipelineRunId, extractedAt);
    links.push({
      linkType: 'COMPOSED_OF',
      fromId,
      toId,
      confidence: parseConfidence(raw.CONFIDENCE, 0.85),
      provenance: prov,
      fromSourceKey: deviceId,
      toSourceKey: matnr,
    });
  }

  const rejectsByCode = tallyRejects(rejects);
  const skippedLinksByCode = tallySkippedLinks(skippedLinks);

  return {
    plan: { suppliers, parts, devices, links },
    report: {
      pipelineRunId,
      accepted: {
        vendors: suppliers.length,
        materials: parts.length,
        devices: devices.length,
        supplyLinks: links.filter((link) => link.linkType === 'SUPPLIES').length,
        bomLinks: links.filter((link) => link.linkType === 'COMPOSED_OF').length,
      },
      rejects,
      skippedLinks,
      rejectsByCode,
      skippedLinksByCode,
    },
  };
}

/** Assert report counts match manifest expectations (used in tests). */
export function assertReportMatchesManifest(
  report: DataQualityReport,
  expected: {
    rejectsByCode: Readonly<Partial<Record<keyof ReturnType<typeof emptyRejectCounts>, number>>>;
    skippedLinksByCode: Readonly<
      Partial<Record<keyof ReturnType<typeof emptySkippedLinkCounts>, number>>
    >;
  },
): void {
  for (const [code, count] of Object.entries(expected.rejectsByCode)) {
    const key = code as keyof typeof report.rejectsByCode;
    if (report.rejectsByCode[key] !== count) {
      throw new Error(
        `reject count ${code}: expected ${String(count)}, got ${String(report.rejectsByCode[key])}`,
      );
    }
  }
  for (const [code, count] of Object.entries(expected.skippedLinksByCode)) {
    const key = code as keyof typeof report.skippedLinksByCode;
    if (report.skippedLinksByCode[key] !== count) {
      throw new Error(
        `skipped link count ${code}: expected ${String(count)}, got ${String(report.skippedLinksByCode[key])}`,
      );
    }
  }
}
