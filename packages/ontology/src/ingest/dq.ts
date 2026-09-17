import { z } from 'zod';

/** Stable codes for manifest ↔ report assertions (do not rephrase in the pipeline). */
export const ingestRejectCodeSchema = z.enum([
  'VENDOR_MISSING_LIFNR',
  'VENDOR_MISSING_NAME',
  'VENDOR_INVALID_TIER',
  'VENDOR_INVALID_QUALITY_RATING',
  'VENDOR_DUPLICATE_LIFNR',
  'MATERIAL_MISSING_MATNR',
  'MATERIAL_INVALID_UNIT_COST',
  'MATERIAL_INVALID_CLASSIFICATION',
  'MATERIAL_INVALID_CRITICALITY',
  'DEVICE_MISSING_ID',
  'DEVICE_MISSING_NAME',
  'DEVICE_INVALID_REG_CLASS',
  'DEVICE_INVALID_LIFECYCLE',
]);
export type IngestRejectCode = z.infer<typeof ingestRejectCodeSchema>;

export const ingestSkippedLinkCodeSchema = z.enum([
  'SUPPLY_ORPHAN_VENDOR',
  'SUPPLY_ORPHAN_MATERIAL',
  'BOM_ORPHAN_DEVICE',
  'BOM_ORPHAN_PART',
]);
export type IngestSkippedLinkCode = z.infer<typeof ingestSkippedLinkCodeSchema>;

export type IngestRowRef = {
  file: string;
  line: number;
};

export type IngestReject = {
  code: IngestRejectCode;
  file: string;
  line: number;
  message: string;
};

export type IngestSkippedLink = {
  code: IngestSkippedLinkCode;
  file: string;
  line: number;
  message: string;
};

export type DataQualityCounts = {
  rejectsByCode: Readonly<Record<IngestRejectCode, number>>;
  skippedLinksByCode: Readonly<Record<IngestSkippedLinkCode, number>>;
};

export type DataQualityReport = DataQualityCounts & {
  pipelineRunId: string;
  accepted: {
    vendors: number;
    materials: number;
    devices: number;
    supplyLinks: number;
    bomLinks: number;
  };
  rejects: readonly IngestReject[];
  skippedLinks: readonly IngestSkippedLink[];
};

export function emptyRejectCounts(): Record<IngestRejectCode, number> {
  return {
    VENDOR_MISSING_LIFNR: 0,
    VENDOR_MISSING_NAME: 0,
    VENDOR_INVALID_TIER: 0,
    VENDOR_INVALID_QUALITY_RATING: 0,
    VENDOR_DUPLICATE_LIFNR: 0,
    MATERIAL_MISSING_MATNR: 0,
    MATERIAL_INVALID_UNIT_COST: 0,
    MATERIAL_INVALID_CLASSIFICATION: 0,
    MATERIAL_INVALID_CRITICALITY: 0,
    DEVICE_MISSING_ID: 0,
    DEVICE_MISSING_NAME: 0,
    DEVICE_INVALID_REG_CLASS: 0,
    DEVICE_INVALID_LIFECYCLE: 0,
  };
}

export function emptySkippedLinkCounts(): Record<IngestSkippedLinkCode, number> {
  return {
    SUPPLY_ORPHAN_VENDOR: 0,
    SUPPLY_ORPHAN_MATERIAL: 0,
    BOM_ORPHAN_DEVICE: 0,
    BOM_ORPHAN_PART: 0,
  };
}

export function tallyRejects(rejects: readonly IngestReject[]): Record<IngestRejectCode, number> {
  const counts = emptyRejectCounts();
  for (const reject of rejects) {
    counts[reject.code] += 1;
  }
  return counts;
}

export function tallySkippedLinks(
  skipped: readonly IngestSkippedLink[],
): Record<IngestSkippedLinkCode, number> {
  const counts = emptySkippedLinkCounts();
  for (const row of skipped) {
    counts[row.code] += 1;
  }
  return counts;
}
