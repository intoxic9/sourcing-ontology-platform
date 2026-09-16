import { describe, expect, it } from 'vitest';

import { routingDecision } from './action.js';
import { approveSupplierChange } from './approve-supplier-change.js';
import { createInMemoryContext, type InMemoryGraph, type InMemoryObject } from './in-memory-context.js';
import { flagPartForRequalification } from './flag-part.js';
import type { Link, LinkTypeName } from './link-types.js';
import type { Tracked } from './tracked.js';

const AT = '2026-01-15T09:30:00.000Z';

const provenance = {
  method: 'DIRECT',
  sourceSystem: 'SAP',
  sourceRecordId: 'rec-1',
  pipelineRunId: 'run-1',
  extractedAt: AT,
} as const;

const t = <const T>(value: T, confidence = 1): Tracked<T> => ({ value, confidence, provenance });

const supplier = (
  id: string,
  status: 'APPROVED' | 'PROVISIONAL' | 'SUSPENDED' | 'DISQUALIFIED',
  certs: readonly string[] = ['ISO 13485'],
): InMemoryObject => ({
  objectType: 'SUPPLIER',
  data: {
    id,
    legalName: t(`Supplier ${id}`),
    country: t('DE'),
    tier: t('TIER_1'),
    status: t(status),
    qualityRating: t(80),
    certifications: certs.map((value) => t(value)),
  },
});

const part = (
  id: string,
  criticality: 'CRITICAL' | 'MAJOR' | 'MINOR',
): InMemoryObject => ({
  objectType: 'PART',
  data: {
    id,
    partNumber: t(id),
    description: t('a part'),
    classification: t('COMPONENT'),
    criticality: t(criticality),
    requiresRequalification: t(false),
    unitCost: t(1),
  },
});

const event = (id: string, severity: 'CRITICAL' | 'MAJOR' | 'MINOR'): InMemoryObject => ({
  objectType: 'QUALITY_EVENT',
  data: {
    id,
    eventType: t('AUDIT_FINDING'),
    severity: t(severity),
    openedAt: t(AT),
    description: t('finding'),
  },
});

const link = (linkType: LinkTypeName, fromId: string, toId: string): Link => ({
  id: `${linkType}:${fromId}->${toId}`,
  linkType,
  fromId,
  toId,
  confidence: 1,
  provenance,
});

function graph(objects: InMemoryObject[], links: Link[] = []): InMemoryGraph {
  return { objects, links };
}

describe('routingDecision', () => {
  it('never lets an agent execute, even when the policy says AUTO', () => {
    expect(routingDecision('AUTO', 'AGENT')).toBe('PROPOSE');
    expect(routingDecision('REQUIRE_HUMAN', 'AGENT')).toBe('PROPOSE');
  });

  it('lets a human follow AUTO and REQUIRE_HUMAN', () => {
    expect(routingDecision('AUTO', 'HUMAN')).toBe('EXECUTE');
    expect(routingDecision('REQUIRE_HUMAN', 'HUMAN')).toBe('PROPOSE');
  });
});

describe('approveSupplierChange', () => {
  it('allows PROVISIONAL → APPROVED when ISO 13485 is present and no open CRITICAL event', async () => {
    const ctx = createInMemoryContext(graph([supplier('sup-ok', 'PROVISIONAL')]));
    const input = {
      supplierId: 'sup-ok',
      toStatus: 'APPROVED' as const,
      justification: 'certs in date',
    };

    await expect(approveSupplierChange.preconditions(input, ctx)).resolves.toStrictEqual({
      ok: true,
    });
    expect(await approveSupplierChange.approvalPolicy(input, ctx)).toBe('REQUIRE_HUMAN');

    const [mutation] = await approveSupplierChange.execute(input, ctx);
    expect(mutation?.properties['status']?.value).toBe('APPROVED');
  });

  it('refuses APPROVED without ISO 13485', async () => {
    const ctx = createInMemoryContext(
      graph([supplier('sup-bare', 'PROVISIONAL', ['ISO 9001'])]),
    );
    const result = await approveSupplierChange.preconditions(
      { supplierId: 'sup-bare', toStatus: 'APPROVED', justification: 'no' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/ISO 13485/);
  });

  it('refuses APPROVED when a CRITICAL quality event is still open', async () => {
    const ctx = createInMemoryContext(
      graph(
        [supplier('sup-hot', 'PROVISIONAL'), event('ev-1', 'CRITICAL')],
        [link('AFFECTS_SUPPLIER', 'ev-1', 'sup-hot')],
      ),
    );
    const result = await approveSupplierChange.preconditions(
      { supplierId: 'sup-hot', toStatus: 'APPROVED', justification: 'not yet' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/ev-1/);
  });

  it('refuses a terminal DISQUALIFIED leaving that state', async () => {
    const ctx = createInMemoryContext(graph([supplier('sup-dead', 'DISQUALIFIED')]));
    const result = await approveSupplierChange.preconditions(
      { supplierId: 'sup-dead', toStatus: 'APPROVED', justification: 'no' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/not a legal status transition/);
  });
});

describe('flagPartForRequalification', () => {
  it('auto-applies for a human on a MINOR part with a linked event', async () => {
    const ctx = createInMemoryContext(
      graph(
        [part('part-min', 'MINOR'), event('ev-2', 'MAJOR')],
        [link('AFFECTS_PART', 'ev-2', 'part-min')],
      ),
    );
    const input = { partId: 'part-min', justification: 'event' };
    await expect(flagPartForRequalification.preconditions(input, ctx)).resolves.toStrictEqual({
      ok: true,
    });
    expect(await flagPartForRequalification.approvalPolicy(input, ctx)).toBe('AUTO');
  });

  it('requires a human for a CRITICAL part', async () => {
    const ctx = createInMemoryContext(
      graph(
        [part('part-crit', 'CRITICAL'), event('ev-3', 'CRITICAL')],
        [link('AFFECTS_PART', 'ev-3', 'part-crit')],
      ),
    );
    expect(
      await flagPartForRequalification.approvalPolicy(
        { partId: 'part-crit', justification: 'event' },
        ctx,
      ),
    ).toBe('REQUIRE_HUMAN');
  });

  it('is still PROPOSE for an agent on a MINOR part', () => {
    expect(routingDecision('AUTO', 'AGENT')).toBe('PROPOSE');
  });

  it('refuses a part with no event and a healthy supplier', async () => {
    const ctx = createInMemoryContext(
      graph(
        [part('part-ok', 'MINOR'), supplier('sup-ok', 'APPROVED')],
        [link('SUPPLIES', 'sup-ok', 'part-ok')],
      ),
    );
    const result = await flagPartForRequalification.preconditions(
      { partId: 'part-ok', justification: 'no' },
      ctx,
    );
    expect(result.ok).toBe(false);
  });
});
