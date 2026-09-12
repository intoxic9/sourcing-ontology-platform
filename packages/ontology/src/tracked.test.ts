import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { provenanceSchema, tracked, type Tracked } from './tracked.js';

const AT = '2026-01-15T09:30:00Z';

/**
 * Compile-time assertion that `Tracked<T>` and the `tracked()` factory agree. `Equals`
 * is the standard invariant-position trick: two conditional types are mutually
 * assignable only when their branches are identical, which makes this an exact
 * comparison rather than a bidirectional-assignability one. If the schema and the type
 * drift, `agree` becomes `false` and assigning `true` stops compiling.
 */
// no-unnecessary-type-parameters fires here and is wrong to: G appearing exactly once
// in each signature is the mechanism, not an oversight. It puts A and B in an invariant
// position, which is what makes this an equality check rather than a mutual
// assignability check that optional properties would slip through.
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */

describe('Tracked', () => {
  it('has a type that matches what tracked() produces', () => {
    const agree: Equals<
      Tracked<string>,
      z.infer<ReturnType<typeof tracked<z.ZodString>>>
    > = true;
    expect(agree).toBe(true);
  });
});

const trackedString = tracked(z.string());

const direct = {
  method: 'DIRECT',
  sourceSystem: 'SAP',
  sourceRecordId: 'VENDOR-4471',
  pipelineRunId: 'run-2026-01-15',
  extractedAt: AT,
} as const;

describe('provenance', () => {
  it('accepts HUMAN_ENTRY without a pipeline run', () => {
    const result = provenanceSchema.safeParse({
      method: 'HUMAN_ENTRY',
      sourceSystem: 'QUALITY_PORTAL',
      sourceRecordId: 'ticket-88',
      extractedAt: AT,
    });
    expect(result.success).toBe(true);
  });

  // The reason for strictObject. A permissive schema would strip pipelineRunId and
  // report success, so the write would succeed having silently lost the field.
  it('rejects HUMAN_ENTRY carrying a pipeline run rather than dropping it', () => {
    const result = provenanceSchema.safeParse({
      method: 'HUMAN_ENTRY',
      sourceSystem: 'QUALITY_PORTAL',
      sourceRecordId: 'ticket-88',
      pipelineRunId: 'run-2026-01-15',
      extractedAt: AT,
    });
    expect(result.success).toBe(false);
  });

  it('accepts INFERRED without a source record', () => {
    const result = provenanceSchema.safeParse({
      method: 'INFERRED',
      sourceSystem: 'RISK_ENGINE',
      pipelineRunId: 'run-2026-01-15',
      extractedAt: AT,
    });
    expect(result.success).toBe(true);
  });

  it('rejects INFERRED pointing at a source record', () => {
    const result = provenanceSchema.safeParse({
      method: 'INFERRED',
      sourceSystem: 'RISK_ENGINE',
      sourceRecordId: 'VENDOR-4471',
      pipelineRunId: 'run-2026-01-15',
      extractedAt: AT,
    });
    expect(result.success).toBe(false);
  });

  it.each(['DIRECT', 'FUZZY_MATCH', 'LLM_EXTRACTION'])('requires both ids for %s', (method) => {
    expect(provenanceSchema.safeParse({ ...direct, method }).success).toBe(true);

    const withoutSource = {
      method,
      sourceSystem: direct.sourceSystem,
      pipelineRunId: direct.pipelineRunId,
      extractedAt: direct.extractedAt,
    };
    expect(provenanceSchema.safeParse(withoutSource).success).toBe(false);

    const withoutRun = {
      method,
      sourceSystem: direct.sourceSystem,
      sourceRecordId: direct.sourceRecordId,
      extractedAt: direct.extractedAt,
    };
    expect(provenanceSchema.safeParse(withoutRun).success).toBe(false);
  });

  it('rejects a non-ISO extractedAt', () => {
    expect(provenanceSchema.safeParse({ ...direct, extractedAt: '15/01/2026' }).success).toBe(
      false,
    );
  });
});

describe('tracked()', () => {
  it('accepts an unverified value at partial confidence', () => {
    const result = trackedString.safeParse({
      value: 'Acme Medical GmbH',
      confidence: 0.82,
      provenance: direct,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a verified value at confidence 1', () => {
    const result = trackedString.safeParse({
      value: 'Acme Medical GmbH',
      confidence: 1,
      provenance: direct,
      verification: { by: 'k.novak', at: AT },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a verified value below confidence 1', () => {
    const result = trackedString.safeParse({
      value: 'Acme Medical GmbH',
      confidence: 0.9,
      provenance: direct,
      verification: { by: 'k.novak', at: AT },
    });
    expect(result.success).toBe(false);
  });

  it.each([-0.1, 1.1])('rejects confidence outside 0..1 (%s)', (confidence) => {
    expect(trackedString.safeParse({ value: 'x', confidence, provenance: direct }).success).toBe(
      false,
    );
  });

  it('rejects a half-set verification', () => {
    const result = trackedString.safeParse({
      value: 'x',
      confidence: 1,
      provenance: direct,
      verification: { by: 'k.novak' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown key', () => {
    const result = trackedString.safeParse({
      value: 'x',
      confidence: 1,
      provenance: direct,
      confidance: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('requires provenance', () => {
    expect(trackedString.safeParse({ value: 'x', confidence: 1 }).success).toBe(false);
  });
});
