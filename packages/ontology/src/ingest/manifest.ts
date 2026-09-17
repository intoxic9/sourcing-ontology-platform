import { z } from 'zod';

import { ingestRejectCodeSchema, ingestSkippedLinkCodeSchema } from './dq.js';

const rejectCountFields = Object.fromEntries(
  ingestRejectCodeSchema.options.map((code) => [code, z.number().int().nonnegative()]),
) as Record<z.infer<typeof ingestRejectCodeSchema>, z.ZodNumber>;

const skippedCountFields = Object.fromEntries(
  ingestSkippedLinkCodeSchema.options.map((code) => [code, z.number().int().nonnegative()]),
) as Record<z.infer<typeof ingestSkippedLinkCodeSchema>, z.ZodNumber>;

export const mergeBandSchema = z.enum(['AUTO_CONFIRM', 'REQUIRE_HUMAN', 'DO_NOT_MERGE']);
export type MergeBand = z.infer<typeof mergeBandSchema>;

export const expectedMergeClusterSchema = z.strictObject({
  band: mergeBandSchema,
  survivorSourceKey: z.string().min(1),
  duplicateSourceKeys: z.array(z.string().min(1)),
  note: z.string().optional(),
});
export type ExpectedMergeCluster = z.infer<typeof expectedMergeClusterSchema>;

export const expectedNonMergePairSchema = z.strictObject({
  sourceKeyA: z.string().min(1),
  sourceKeyB: z.string().min(1),
  note: z.string().optional(),
});
export type ExpectedNonMergePair = z.infer<typeof expectedNonMergePairSchema>;

export const week2ManifestSchema = z.strictObject({
  version: z.literal(1),
  fixtureId: z.string().min(1),
  expectedDataQuality: z.strictObject({
    rejectsByCode: z.strictObject(rejectCountFields),
    skippedLinksByCode: z.strictObject(skippedCountFields),
  }),
  expectedMergeClusters: z.array(expectedMergeClusterSchema),
  expectedNonMergePairs: z.array(expectedNonMergePairSchema),
  demoRoles: z.strictObject({
    /** Survivor LIFNR for supplier-risk demo; must fan out to shared BOM devices. */
    riskAnchorSurvivorSourceKey: z.string().min(1),
    /** MATNR whose SUPPLIES edge is the intentional weak link for that anchor. */
    riskWeakSupplyPartSourceKey: z.string().min(1),
    riskExpectedDeviceCountMin: z.number().int().positive(),
    riskExpectedDeviceCountMax: z.number().int().positive(),
    /** Distinct supplier for approveSupplierChange governance vignette. */
    governanceSurvivorSourceKey: z.string().min(1),
  }),
  rowCounts: z.strictObject({
    vendor_master: z.number().int().nonnegative(),
    material_master: z.number().int().nonnegative(),
    device_master: z.number().int().nonnegative(),
    supply_relationship: z.number().int().nonnegative(),
    device_bom: z.number().int().nonnegative(),
  }),
});
export type Week2Manifest = z.infer<typeof week2ManifestSchema>;
