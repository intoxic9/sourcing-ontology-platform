import { beforeEach, describe, expect, it } from 'vitest';

import { UnknownObjectError, type OntologyContext } from './context.js';
import { createInMemoryContext, type InMemoryObject } from './in-memory-context.js';
import type { Link, LinkTypeName } from './link-types.js';
import type { Tracked } from './tracked.js';
import { weakestLink } from './traversal.js';

const AT = '2026-01-15T09:30:00Z';

const provenance = {
  method: 'DIRECT',
  sourceSystem: 'SAP',
  sourceRecordId: 'rec-1',
  pipelineRunId: 'run-1',
  extractedAt: AT,
} as const;

/** `const` type parameter so enum literals stay literal instead of widening to string. */
const t = <const T>(value: T, confidence = 1): Tracked<T> => ({ value, confidence, provenance });

const supplier = (id: string): InMemoryObject => ({
  objectType: 'SUPPLIER',
  data: {
    id,
    legalName: t(`Supplier ${id}`),
    country: t('DE'),
    tier: t('TIER_1'),
    status: t('APPROVED'),
    qualityRating: t(80),
    certifications: [],
  },
});

const part = (id: string): InMemoryObject => ({
  objectType: 'PART',
  data: {
    id,
    partNumber: t(id.toUpperCase()),
    description: t('a part'),
    classification: t('COMPONENT'),
    criticality: t('MAJOR'),
    requiresRequalification: t(false),
    unitCost: t(12.5),
  },
});

const device = (id: string): InMemoryObject => ({
  objectType: 'DEVICE',
  data: {
    id,
    deviceName: t(`Device ${id}`),
    productFamily: t('Infusion'),
    regulatoryClass: t('CLASS_II'),
    lifecycleStage: t('ACTIVE'),
  },
});

const qualityEvent = (id: string): InMemoryObject => ({
  objectType: 'QUALITY_EVENT',
  data: {
    id,
    eventType: t('AUDIT_FINDING'),
    severity: t('CRITICAL'),
    openedAt: t(AT),
    description: t('finding'),
  },
});

const link = (
  linkType: LinkTypeName,
  fromId: string,
  toId: string,
  confidence: number,
): Link => ({ id: `${linkType}:${fromId}->${toId}`, linkType, fromId, toId, confidence, provenance });

/**
 * sup-1 --SUPPLIES(0.9)--> part-1 <--COMPOSED_OF(0.8)-- dev-1
 * sup-1 --SUPPLIES(0.5)--> part-2 <--COMPOSED_OF(0.95)- dev-1
 *
 * Two routes to dev-1 with different weakest links, so the max-of-min rule is visible.
 * dev-2 hangs off part-3, which nobody supplies, and is only reachable by detouring
 * through the quality event — the exact wrong answer `via` exists to prevent.
 */
const SUPPLY_CHAIN: readonly LinkTypeName[] = ['SUPPLIES', 'COMPOSED_OF'];

let context: OntologyContext;

beforeEach(() => {
  context = createInMemoryContext({
    objects: [
      supplier('sup-1'),
      supplier('sup-2'),
      part('part-1'),
      part('part-2'),
      part('part-3'),
      device('dev-1'),
      device('dev-2'),
      qualityEvent('ev-1'),
    ],
    links: [
      link('SUPPLIES', 'sup-1', 'part-1', 0.9),
      link('SUPPLIES', 'sup-1', 'part-2', 0.5),
      link('SUPPLIES', 'sup-2', 'part-1', 0.6),
      link('COMPOSED_OF', 'dev-1', 'part-1', 0.8),
      link('COMPOSED_OF', 'dev-1', 'part-2', 0.95),
      link('COMPOSED_OF', 'dev-2', 'part-3', 1),
      link('AFFECTS_SUPPLIER', 'ev-1', 'sup-1', 1),
      link('AFFECTS_PART', 'ev-1', 'part-3', 1),
    ],
  });
});

const affectedDevices = (maxDepth?: number) =>
  context.traverse({
    from: { objectType: 'SUPPLIER', id: 'sup-1' },
    to: 'DEVICE',
    via: SUPPLY_CHAIN,
    ...(maxDepth === undefined ? {} : { maxDepth }),
  });

describe('getObject', () => {
  it('returns the object typed as the caller asked for it', async () => {
    const found = await context.getObject('SUPPLIER', 'sup-1');
    expect(found?.legalName.value).toBe('Supplier sup-1');
  });

  it('returns undefined for an id that is not there', async () => {
    expect(await context.getObject('SUPPLIER', 'nope')).toBeUndefined();
  });

  // Finding a PART under an id asked for as a SUPPLIER is a caller bug, not a miss.
  it('throws when the id exists but is another type', async () => {
    await expect(context.getObject('SUPPLIER', 'part-1')).rejects.toThrow(UnknownObjectError);
  });
});

describe('getLinks', () => {
  it('matches either endpoint', async () => {
    const links = await context.getLinks({ objectId: 'part-1' });
    expect(links.map((l) => l.id).sort()).toStrictEqual([
      'COMPOSED_OF:dev-1->part-1',
      'SUPPLIES:sup-1->part-1',
      'SUPPLIES:sup-2->part-1',
    ]);
  });

  it('filters by link type', async () => {
    const links = await context.getLinks({ objectId: 'sup-1', linkType: 'AFFECTS_SUPPLIER' });
    expect(links).toHaveLength(1);
  });
});

describe('supplier to affected devices', () => {
  it('reports the strongest route and counts the rest', async () => {
    const { targets } = await affectedDevices();

    expect(targets).toHaveLength(1);
    expect(targets[0]?.target.id).toBe('dev-1');
    // max(min(0.9, 0.8), min(0.5, 0.95)) = max(0.8, 0.5)
    expect(targets[0]?.confidence).toBe(0.8);
    expect(targets[0]?.pathCount).toBe(2);
  });

  it('names the step a human should go and verify', async () => {
    const { targets } = await affectedDevices();
    const best = targets[0]?.bestPath;
    const weakest = best === undefined ? null : weakestLink(best);

    expect(weakest?.linkType).toBe('COMPOSED_OF');
    expect(weakest?.confidence).toBe(0.8);
    expect(weakest?.to.id).toBe('dev-1');
  });

  // Reaching a device from a part means crossing COMPOSED_OF backwards.
  it('records the direction each link was crossed', async () => {
    const { targets } = await affectedDevices();

    expect(targets[0]?.bestPath.steps.map((s) => [s.linkType, s.direction])).toStrictEqual([
      ['SUPPLIES', 'ALONG'],
      ['COMPOSED_OF', 'AGAINST'],
    ]);
  });

  it('omits unreachable devices rather than scoring them zero', async () => {
    const { targets, truncated } = await affectedDevices();

    expect(targets.map((entry) => entry.target.id)).not.toContain('dev-2');
    // Absent with truncated false is "not reachable", not "unknown".
    expect(truncated).toBe(false);
  });
});

describe('via', () => {
  // Without the filter, sup-1 reaches dev-2 through a quality event: a real connection
  // but a different claim, and mixing the two leaves the confidence meaning nothing.
  it('keeps the walk out of unrelated link types', async () => {
    const supplyOnly = await affectedDevices();
    const everything = await context.traverse({
      from: { objectType: 'SUPPLIER', id: 'sup-1' },
      to: 'DEVICE',
      via: ['SUPPLIES', 'COMPOSED_OF', 'AFFECTS_SUPPLIER', 'AFFECTS_PART'],
    });

    expect(supplyOnly.targets.map((e) => e.target.id)).toStrictEqual(['dev-1']);
    expect(everything.targets.map((e) => e.target.id).sort()).toStrictEqual(['dev-1', 'dev-2']);
  });

  it('refuses a query that can cross nothing', async () => {
    await expect(
      context.traverse({ from: { objectType: 'SUPPLIER', id: 'sup-1' }, to: 'DEVICE', via: [] }),
    ).rejects.toThrow(RangeError);
  });
});

describe('depth cap', () => {
  it('reports truncation when it stops with edges left to cross', async () => {
    const { targets, truncated } = await affectedDevices(1);

    // A device is two hops away, so nothing is found — but "nothing found" here means
    // unknown, not safe, which is the whole reason the flag exists.
    expect(targets).toStrictEqual([]);
    expect(truncated).toBe(true);
  });

  it('is not truncated once the search exhausts the graph', async () => {
    expect((await affectedDevices(6)).truncated).toBe(false);
  });

  it('reports the cap it applied', async () => {
    expect((await affectedDevices(3)).maxDepth).toBe(3);
    expect((await affectedDevices()).maxDepth).toBe(6);
  });
});

describe('degenerate queries', () => {
  // "supplier S affects supplier S" is true and useless.
  it('excludes the source from its own results', async () => {
    const { targets } = await context.traverse({
      from: { objectType: 'SUPPLIER', id: 'sup-1' },
      to: 'SUPPLIER',
      via: SUPPLY_CHAIN,
    });

    expect(targets.map((entry) => entry.target.id)).toStrictEqual(['sup-2']);
  });

  // "No such supplier" and "this supplier affects nothing" must not look alike.
  it('throws on an unknown source rather than returning nothing', async () => {
    await expect(
      context.traverse({
        from: { objectType: 'SUPPLIER', id: 'ghost' },
        to: 'DEVICE',
        via: SUPPLY_CHAIN,
      }),
    ).rejects.toThrow(UnknownObjectError);
  });

  it('throws when the source id is a different type than claimed', async () => {
    await expect(
      context.traverse({
        from: { objectType: 'SUPPLIER', id: 'part-1' },
        to: 'DEVICE',
        via: SUPPLY_CHAIN,
      }),
    ).rejects.toThrow(UnknownObjectError);
  });

  it('finds nothing at depth zero but says so', async () => {
    const { targets, truncated } = await affectedDevices(0);
    expect(targets).toStrictEqual([]);
    expect(truncated).toBe(true);
  });
});
