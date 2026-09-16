import type { InMemoryGraph, InMemoryObject } from './in-memory-context.js';
import type { Link, LinkTypeName } from './link-types.js';
import type { Tracked } from './tracked.js';
import { SUPPLIER_DEVICE_RISK } from './profiles.js';
import type { TraversalQuery } from './traversal.js';

/**
 * A small supply-chain graph shared by the in-memory unit tests and the Postgres
 * conformance check.
 *
 * It has one owner. The conformance check's entire value is that both
 * implementations see identical input, and a fixture copied into two places would drift
 * into two different graphs that both "pass".
 */

const AT = '2026-01-15T09:30:00.000Z';

const provenance = {
  method: 'DIRECT',
  sourceSystem: 'SAP',
  sourceRecordId: 'rec-1',
  pipelineRunId: 'run-1',
  extractedAt: AT,
} as const;

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

/**
 * Reproduces the old four-hop bridge (Helix → part-shared → other supplier → part-bridge
 * → device) while keeping part-shared off the bridge device's BOM. The two-hop pattern
 * must not reach `dev-bridge-only`; an unbounded `via` walk would.
 */
export const sharedPartBridgeFixture: InMemoryGraph = {
  objects: [
    supplier('sup-helix'),
    supplier('sup-other'),
    part('part-shared'),
    part('part-bridge'),
    device('dev-infusor'),
    device('dev-bridge-only'),
  ],
  links: [
    link('SUPPLIES', 'sup-helix', 'part-shared', 0.55),
    link('SUPPLIES', 'sup-other', 'part-shared', 0.97),
    link('SUPPLIES', 'sup-other', 'part-bridge', 0.96),
    link('COMPOSED_OF', 'dev-infusor', 'part-shared', 0.92),
    link('COMPOSED_OF', 'dev-bridge-only', 'part-bridge', 0.93),
  ],
};

const fromSup1 = { objectType: 'SUPPLIER', id: 'sup-1' } as const;

export type PatternConformanceCase = {
  name: string;
  fixture: InMemoryGraph;
  query: TraversalQuery;
  expected: {
    targetIds: readonly string[];
    /** Per target id, in the same order as targetIds when sorted by id is not used — map by id */
    byTarget: Readonly<
      Record<
        string,
        {
          confidence: number;
          pathCount: number;
          stepDirections: readonly (readonly [LinkTypeName, 'ALONG' | 'AGAINST'])[];
        }
      >
    >;
  };
};

export const patternConformanceCases: readonly PatternConformanceCase[] = [
  {
    name: 'sup-1 supplier device risk — two routes to dev-1',
    fixture: supplyChainFixture,
    query: { from: fromSup1, profile: SUPPLIER_DEVICE_RISK },
    expected: {
      targetIds: ['dev-1'],
      byTarget: {
        'dev-1': {
          confidence: 0.8,
          pathCount: 2,
          stepDirections: [
            ['SUPPLIES', 'ALONG'],
            ['COMPOSED_OF', 'AGAINST'],
          ],
        },
      },
    },
  },
  {
    name: 'shared part bridge — helix reaches infusor only, not bridge-only device',
    fixture: sharedPartBridgeFixture,
    query: { from: { objectType: 'SUPPLIER', id: 'sup-helix' }, profile: SUPPLIER_DEVICE_RISK },
    expected: {
      targetIds: ['dev-infusor'],
      byTarget: {
        'dev-infusor': {
          confidence: 0.55,
          pathCount: 1,
          stepDirections: [['SUPPLIES', 'ALONG'], ['COMPOSED_OF', 'AGAINST']],
        },
      },
    },
  },
  {
    name: 'shared part bridge — other supplier reaches both devices',
    fixture: sharedPartBridgeFixture,
    query: { from: { objectType: 'SUPPLIER', id: 'sup-other' }, profile: SUPPLIER_DEVICE_RISK },
    expected: {
      targetIds: ['dev-bridge-only', 'dev-infusor'],
      byTarget: {
        'dev-infusor': {
          confidence: 0.92,
          pathCount: 1,
          stepDirections: [['SUPPLIES', 'ALONG'], ['COMPOSED_OF', 'AGAINST']],
        },
        'dev-bridge-only': {
          confidence: 0.93,
          pathCount: 1,
          stepDirections: [['SUPPLIES', 'ALONG'], ['COMPOSED_OF', 'AGAINST']],
        },
      },
    },
  },
];
