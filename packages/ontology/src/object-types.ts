import { z } from 'zod';

import { timestampSchema, tracked } from './tracked.js';

export const objectTypeNameSchema = z.enum([
  'SUPPLIER',
  'PART',
  'DEVICE',
  'SITE',
  'QUALITY_EVENT',
]);
export type ObjectTypeName = z.infer<typeof objectTypeNameSchema>;

/**
 * `ONTOLOGY.md` marks some properties as only mutable via an Action. That implies the
 * rest are ingestion-writable, and it has to: batch ingestion of 20 suppliers and 60
 * parts cannot route 400-odd property writes through Actions with approval routing. So
 * "writes are governed" means two write paths, and this marks which properties belong
 * to the governed one. Attached as Zod metadata so it survives into the emitted JSON
 * Schema and needs no parallel declaration. See PLAN.md §8.
 */
const ACTION_ONLY = { mutability: 'ACTION_ONLY' } as const;

/**
 * `id` is the one unwrapped field on every object type. It is identity, not a claim
 * about the world, so it carries no confidence or provenance and maps to `objects.id`
 * rather than to a property row.
 */
const identity = z.string().min(1);

export const supplierSchema = z.strictObject({
  id: identity,
  legalName: tracked(z.string().min(1)),

  // "Strong identity key when present" — genuinely absent for many suppliers, so
  // optional rather than an empty string standing in for absence.
  duns: tracked(z.string().min(1)).optional(),

  // Left as a free string rather than ISO 3166-1 alpha-2: closing it would force a
  // normalisation decision ("Germany" vs "DE") that ingestion has not faced yet.
  country: tracked(z.string().min(1)),

  tier: tracked(z.enum(['TIER_1', 'TIER_2', 'TIER_3'])),
  status: tracked(
    z.enum(['APPROVED', 'PROVISIONAL', 'SUSPENDED', 'DISQUALIFIED']),
  ).meta(ACTION_ONLY),
  qualityRating: tracked(z.number()),

  // The only multiple-cardinality property in Week 1. Always present, empty when the
  // supplier holds none — never undefined, so nothing reads `certifications?.length`.
  certifications: z.array(tracked(z.string().min(1))),
});
export type Supplier = z.infer<typeof supplierSchema>;

export const partSchema = z.strictObject({
  id: identity,
  partNumber: tracked(z.string().min(1)),
  description: tracked(z.string()),
  classification: tracked(z.enum(['DIRECT_MATERIAL', 'COMPONENT', 'SUBASSEMBLY'])),
  criticality: tracked(z.enum(['CRITICAL', 'MAJOR', 'MINOR'])),
  requiresRequalification: tracked(z.boolean()).meta(ACTION_ONLY),
  unitCost: tracked(z.number().nonnegative()),
});
export type Part = z.infer<typeof partSchema>;

export const deviceSchema = z.strictObject({
  id: identity,
  deviceName: tracked(z.string().min(1)),

  // A naming dimension rather than a closed set, so it stays a free string.
  productFamily: tracked(z.string().min(1)),

  regulatoryClass: tracked(z.enum(['CLASS_I', 'CLASS_II', 'CLASS_III'])),
  lifecycleStage: tracked(
    z.enum(['DEVELOPMENT', 'ACTIVE', 'END_OF_LIFE', 'DISCONTINUED']),
  ),
});
export type Device = z.infer<typeof deviceSchema>;

export const siteSchema = z.strictObject({
  id: identity,
  siteName: tracked(z.string().min(1)),
  country: tracked(z.string().min(1)),
  siteType: tracked(
    z.enum(['MANUFACTURING', 'ASSEMBLY', 'STERILIZATION', 'DISTRIBUTION']),
  ),
});
export type Site = z.infer<typeof siteSchema>;

export const qualityEventSchema = z.strictObject({
  id: identity,
  eventType: tracked(z.enum(['AUDIT_FINDING', 'NONCONFORMANCE', 'COMPLAINT', 'RECALL'])),
  severity: tracked(z.enum(['CRITICAL', 'MAJOR', 'MINOR'])),
  openedAt: tracked(timestampSchema),

  // Optional because an open event has no close date, and `approveSupplierChange`
  // turns on exactly that distinction: an open CRITICAL event blocks approval.
  closedAt: tracked(timestampSchema).optional(),

  description: tracked(z.string()),
});
export type QualityEvent = z.infer<typeof qualityEventSchema>;

/**
 * Keyed by object type name so the store and the definition derivation can look a
 * schema up from a row's `object_type` without a switch that can fall out of date.
 */
export const objectSchemas = {
  SUPPLIER: supplierSchema,
  PART: partSchema,
  DEVICE: deviceSchema,
  SITE: siteSchema,
  QUALITY_EVENT: qualityEventSchema,
} as const satisfies Record<ObjectTypeName, z.ZodType>;
