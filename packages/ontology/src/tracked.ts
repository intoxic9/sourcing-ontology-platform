import { z } from 'zod';

/**
 * ISO-8601 instant. Every timestamp is a string at the boundary and a `timestamptz` in
 * the database; its `value_type` is `TIMESTAMP`.
 */
export const timestampSchema = z.iso.datetime();

/**
 * Confidence conventions live in ONTOLOGY.md §2: `DIRECT` and `HUMAN_ENTRY` are 1.0,
 * `FUZZY_MATCH` 0.5–0.95, `LLM_EXTRACTION` 0.4–0.95, `INFERRED` 0.3–0.8. Those are
 * conventions rather than constraints, and deliberately not pinned per method here —
 * calibration is an eval target, so a model claiming 0.9 gets checked against the
 * golden set instead of being trusted by the type system.
 */
export const provenanceMethodSchema = z.enum([
  'DIRECT',
  'FUZZY_MATCH',
  'LLM_EXTRACTION',
  'HUMAN_ENTRY',
  'INFERRED',
]);
export type ProvenanceMethod = z.infer<typeof provenanceMethodSchema>;

const provenanceCommon = {
  sourceSystem: z.string().min(1),
  extractedAt: timestampSchema,
};

/**
 * A discriminated union rather than one object with optional fields, so the two
 * conditional provenance rules are structural instead of conventional. Mirrors the
 * biconditional CHECKs in migration 004.
 *
 * `strictObject` throughout, and that choice is load-bearing: Zod's default object
 * *strips* unknown keys, so a `pipelineRunId` sent alongside `HUMAN_ENTRY` would be
 * silently discarded rather than rejected. Silently dropping provenance is precisely
 * the failure mode provenance exists to prevent. It also keeps runtime behaviour in
 * step with the emitted JSON Schema, which carries `additionalProperties: false`.
 */
export const provenanceSchema = z.discriminatedUnion('method', [
  // A person typing a value has no ingestion run to attribute it to.
  z.strictObject({
    ...provenanceCommon,
    method: z.literal('HUMAN_ENTRY'),
    sourceRecordId: z.string().min(1),
  }),

  // A value derived from other tracked values has no raw source row to point at.
  z.strictObject({
    ...provenanceCommon,
    method: z.literal('INFERRED'),
    pipelineRunId: z.string().min(1),
  }),

  z.strictObject({
    ...provenanceCommon,
    method: z.enum(['DIRECT', 'FUZZY_MATCH', 'LLM_EXTRACTION']),
    sourceRecordId: z.string().min(1),
    pipelineRunId: z.string().min(1),
  }),
]);
export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * Nested rather than two sibling optional fields, so "verified by someone at some time"
 * cannot be half-set. The type-level mirror of
 * `CHECK ((verified_by IS NULL) = (verified_at IS NULL))`.
 */
export const verificationSchema = z.strictObject({
  by: z.string().min(1),
  at: timestampSchema,
});
export type Verification = z.infer<typeof verificationSchema>;

export const confidenceSchema = z.number().min(0).max(1);

/**
 * Human verification means certainty. Declared once and applied to both tracked
 * properties and links, so the rule has a single owner on this side of the boundary as
 * `CHECK (verified_by IS NULL OR confidence = 1.0)` does on the other.
 */
export const verifiedImpliesCertain = (candidate: {
  readonly confidence: number;
  readonly verification?: Verification | undefined;
}): boolean => candidate.verification === undefined || candidate.confidence === 1;

export const VERIFIED_IMPLIES_CERTAIN_MESSAGE =
  'a verified value must have confidence 1.0; verification means certainty';

/**
 * The evidence carried by anything tracked — a property value or a link. Exported as a
 * shape rather than a finished schema so callers can spread it into their own
 * `strictObject`. An intersection would not work: a strict object rejects the keys
 * contributed by the other half.
 */
export const evidenceShape = {
  confidence: confidenceSchema,
  provenance: provenanceSchema,
  verification: verificationSchema.optional(),
};

/**
 * Every scalar property on every object type is wrapped in this. Nothing enters the
 * ontology without knowing where it came from and how much we trust it.
 *
 * A flat object rather than a verified/unverified union: a union would make
 * `confidence: 1` type-level, but it renders `Tracked` as a `oneOf` in JSON Schema and
 * forces the definition interpreter to dig through branches for every property on every
 * type. See PLAN.md §7.
 */
export type Tracked<T> = {
  value: T;
  confidence: number;
  provenance: Provenance;
  // `| undefined` matches what Zod infers for `.optional()`. Under
  // exactOptionalPropertyTypes, absent and explicitly-undefined are distinct types, so
  // omitting it would make this type quietly disagree with the schema below.
  verification?: Verification | undefined;
};

/**
 * Has no explicit return type, and that is a limitation rather than an oversight: the
 * honest annotation `z.ZodType<Tracked<z.output<TValue>>>` does not compile, because
 * TypeScript cannot verify the assignment while `TValue` is unresolved. Writing a
 * weaker annotation would state something less true than what is inferred.
 *
 * So the tie between this factory and `Tracked<T>` above is asserted at a concrete
 * instantiation in tracked.test.ts instead, which is where a drift would surface
 * anyway. If the two stop agreeing, that test stops compiling.
 */
export function tracked<TValue extends z.ZodType>(value: TValue) {
  return z
    .strictObject({ value, ...evidenceShape })
    .refine(verifiedImpliesCertain, { error: VERIFIED_IMPLIES_CERTAIN_MESSAGE });
}
