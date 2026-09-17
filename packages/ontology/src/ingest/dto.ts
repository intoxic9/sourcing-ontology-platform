import { z } from 'zod';

/** Raw vendor_master.csv row after string parsing (before business validation). */
export const vendorMasterRowSchema = z.strictObject({
  LIFNR: z.string(),
  NAME1: z.string(),
  LAND1: z.string(),
  TIER: z.string(),
  DUNS: z.string(),
  QUALITY_RATING: z.string(),
  CERTIFICATIONS: z.string(),
});
export type VendorMasterRow = z.infer<typeof vendorMasterRowSchema>;

export const materialMasterRowSchema = z.strictObject({
  MATNR: z.string(),
  MAKTX: z.string(),
  CLASS: z.string(),
  CRITICALITY: z.string(),
  UNIT_COST: z.string(),
});
export type MaterialMasterRow = z.infer<typeof materialMasterRowSchema>;

export const deviceMasterRowSchema = z.strictObject({
  DEVICE_ID: z.string(),
  DEVICE_NAME: z.string(),
  PRODUCT_FAMILY: z.string(),
  REG_CLASS: z.string(),
  LIFECYCLE: z.string(),
});
export type DeviceMasterRow = z.infer<typeof deviceMasterRowSchema>;

export const supplyRelationshipRowSchema = z.strictObject({
  LIFNR: z.string(),
  MATNR: z.string(),
  CONFIDENCE: z.string(),
});
export type SupplyRelationshipRow = z.infer<typeof supplyRelationshipRowSchema>;

export const deviceBomRowSchema = z.strictObject({
  DEVICE_ID: z.string(),
  MATNR: z.string(),
  CONFIDENCE: z.string(),
});
export type DeviceBomRow = z.infer<typeof deviceBomRowSchema>;

export type ParsedCsvFile<T> = {
  file: string;
  rows: readonly { line: number; raw: T }[];
};

export type IngestCsvBundle = {
  vendors: ParsedCsvFile<VendorMasterRow>;
  materials: ParsedCsvFile<MaterialMasterRow>;
  devices: ParsedCsvFile<DeviceMasterRow>;
  supply: ParsedCsvFile<SupplyRelationshipRow>;
  bom: ParsedCsvFile<DeviceBomRow>;
};
