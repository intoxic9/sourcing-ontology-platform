import type { InMemoryGraph, InMemoryObject } from './in-memory-context.js';
import type { Link, LinkTypeName } from './link-types.js';
import type { Tracked } from './tracked.js';
import type { TraversalQuery } from './traversal.js';

/**
 * A small supply-chain graph shared by the in-memory unit tests and the Postgres
 * conformance check.
 *
 * It has one owner on purpose. The conformance check's entire value is that both
 * implementations see identical input, and a fixture copied into two places would drift
 * into two different graphs that both "pass".
 */

/**
 * Milliseconds are explicit so the storage round trip is byte-exact. `timestamptz`
 * records an instant and has no memory of how the string was written, so a fixture
 * using `...:00Z` would come back as `...:00.000Z` and look like a mismatch.
 */
const AT = '2026-01-15T09:30:00.000Z';

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
    certifications: [t('ISO 13485'), t('ISO 9001', 0.7)],
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
    // closedAt is deliberately omitted: an open event, and an optional property with no
    // row at all, so the storage round trip has to reproduce absence rather than null.
  },
});

const link = (
  linkType: LinkTypeName,
  fromId: string,
  toId: string,
  confidence: number,
): Link => ({
  id: `${linkType}:${fromId}->${toId}`,
  linkType,
  fromId,
  toId,
  confidence,
  provenance,
});

/**
 * ```
 * sup-1 --SUPPLIES(0.9)--> part-1 <--COMPOSED_OF(0.8)--- dev-1
 * sup-1 --SUPPLIES(0.5)--> part-2 <--COMPOSED_OF(0.95)-- dev-1
 * sup-2 --SUPPLIES(0.6)--> part-1
 *                          part-3 <--COMPOSED_OF(1.0)--- dev-2
 * ev-1 --AFFECTS_SUPPLIER(1.0)--> sup-1
 * ev-1 --AFFECTS_PART(1.0)-----> part-3
 * ```
 *
 * Two routes to dev-1 with different weakest links, so max-of-min is observable.
 * dev-2 hangs off a part nobody supplies and is reachable only by detouring through the
 * quality event — the wrong answer `via` exists to prevent.
 */
export const supplyChainFixture: InMemoryGraph = {
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
};

export const SUPPLY_CHAIN: readonly LinkTypeName[] = ['SUPPLIES', 'COMPOSED_OF'];

const from = { objectType: 'SUPPLIER', id: 'sup-1' } as const;

/**
 * The queries the conformance check runs through both implementations. Chosen to cover
 * the places the two are most likely to disagree rather than the places they obviously
 * agree: every depth around the cap, an exhausted search, a wandering `via`, and a
 * target type that would include the source if the source were not excluded.
 */
export const supplyChainQueries: readonly TraversalQuery[] = [
  { from, to: 'DEVICE', via: SUPPLY_CHAIN },
  { from, to: 'DEVICE', via: SUPPLY_CHAIN, maxDepth: 0 },
  { from, to: 'DEVICE', via: SUPPLY_CHAIN, maxDepth: 1 },
  { from, to: 'DEVICE', via: SUPPLY_CHAIN, maxDepth: 2 },
  { from, to: 'DEVICE', via: SUPPLY_CHAIN, maxDepth: 3 },
  { from, to: 'DEVICE', via: SUPPLY_CHAIN, maxDepth: 6 },
  { from, to: 'PART', via: SUPPLY_CHAIN },
  { from, to: 'SUPPLIER', via: SUPPLY_CHAIN },
  { from, to: 'DEVICE', via: ['SUPPLIES', 'COMPOSED_OF', 'AFFECTS_SUPPLIER', 'AFFECTS_PART'] },
  { from, to: 'QUALITY_EVENT', via: ['AFFECTS_SUPPLIER'] },
  { from: { objectType: 'DEVICE', id: 'dev-1' }, to: 'SUPPLIER', via: SUPPLY_CHAIN },
  { from: { objectType: 'QUALITY_EVENT', id: 'ev-1' }, to: 'DEVICE', via: ['AFFECTS_PART', 'COMPOSED_OF'] },
];
