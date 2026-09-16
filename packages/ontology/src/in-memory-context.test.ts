import { beforeEach, describe, expect, it } from 'vitest';

import { UnknownObjectError, type OntologyContext } from './context.js';
import {
  patternConformanceCases,
  sharedPartBridgeFixture,
  supplyChainFixture,
} from './fixture.js';
import { createInMemoryContext } from './in-memory-context.js';
import { SUPPLIER_DEVICE_RISK } from './profiles.js';
import { weakestLink } from './traversal.js';

let context: OntologyContext;

beforeEach(() => {
  context = createInMemoryContext(supplyChainFixture);
});

const helixBridgeContext = () => createInMemoryContext(sharedPartBridgeFixture);

describe('getObject', () => {
  it('returns the object typed as the caller asked for it', async () => {
    const found = await context.getObject('SUPPLIER', 'sup-1');
    expect(found?.legalName.value).toBe('Supplier sup-1');
    expect(found?.certifications).toHaveLength(2);
  });

  it('returns undefined for an id that is not there', async () => {
    expect(await context.getObject('SUPPLIER', 'nope')).toBeUndefined();
  });

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

describe('SUPPLIER_DEVICE_RISK on supplyChainFixture', () => {
  const query = {
    from: { objectType: 'SUPPLIER', id: 'sup-1' } as const,
    profile: SUPPLIER_DEVICE_RISK,
  };

  it('reports the strongest route and counts the rest', async () => {
    const { targets } = await context.traverse(query);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.target.id).toBe('dev-1');
    expect(targets[0]?.confidence).toBe(0.8);
    expect(targets[0]?.pathCount).toBe(2);
  });

  it('names the step a human should go and verify', async () => {
    const { targets } = await context.traverse(query);
    const best = targets[0]?.bestPath;
    const weakest = best === undefined ? null : weakestLink(best);

    expect(weakest?.linkType).toBe('COMPOSED_OF');
    expect(weakest?.confidence).toBe(0.8);
    expect(weakest?.to.id).toBe('dev-1');
  });

  it('records the direction each link was crossed', async () => {
    const { targets } = await context.traverse(query);

    expect(targets[0]?.bestPath.steps.map((s) => [s.linkType, s.direction])).toStrictEqual([
      ['SUPPLIES', 'ALONG'],
      ['COMPOSED_OF', 'AGAINST'],
    ]);
  });

  it('omits dev-2 — no supply edge to its part', async () => {
    const { targets } = await context.traverse(query);
    expect(targets.map((entry) => entry.target.id)).toStrictEqual(['dev-1']);
  });
});

describe('shared part bridge fixture', () => {
  it('helix reaches dev-infusor but not dev-bridge-only (no helix part on that BOM)', async () => {
    const ctx = helixBridgeContext();
    const { targets } = await ctx.traverse({
      from: { objectType: 'SUPPLIER', id: 'sup-helix' },
      profile: SUPPLIER_DEVICE_RISK,
    });

    expect(targets.map((entry) => entry.target.id)).toStrictEqual(['dev-infusor']);
    expect(targets[0]?.confidence).toBe(0.55);
    expect(targets[0]?.pathCount).toBe(1);
  });

  it('other supplier reaches both devices with expected confidences', async () => {
    const ctx = helixBridgeContext();
    const { targets } = await ctx.traverse({
      from: { objectType: 'SUPPLIER', id: 'sup-other' },
      profile: SUPPLIER_DEVICE_RISK,
    });

    expect(targets.map((entry) => entry.target.id)).toStrictEqual(['dev-bridge-only', 'dev-infusor']);
    expect(targets[0]?.confidence).toBe(0.93);
    expect(targets[1]?.confidence).toBeCloseTo(0.92, 5);
  });
});

describe('pattern conformance expectations', () => {
  it.each(patternConformanceCases)('$name', async (conformanceCase) => {
    const ctx = createInMemoryContext(conformanceCase.fixture);
    const { targets } = await ctx.traverse(conformanceCase.query);

    expect(targets.map((entry) => entry.target.id)).toStrictEqual(conformanceCase.expected.targetIds);

    for (const [id, expected] of Object.entries(conformanceCase.expected.byTarget)) {
      const target = targets.find((entry) => entry.target.id === id);
      expect(target?.confidence).toBe(expected.confidence);
      expect(target?.pathCount).toBe(expected.pathCount);
      expect(
        target?.bestPath.steps.map((step) => [step.linkType, step.direction] as const),
      ).toStrictEqual(expected.stepDirections);
    }
  });
});

describe('validation', () => {
  it('refuses an empty profile pattern', async () => {
    await expect(
      context.traverse({
        from: { objectType: 'SUPPLIER', id: 'sup-1' },
        profile: { pattern: [], to: 'DEVICE' },
      }),
    ).rejects.toThrow(RangeError);
  });

  it('refuses a profile whose terminal type disagrees with the pattern', async () => {
    await expect(
      context.traverse({
        from: { objectType: 'SUPPLIER', id: 'sup-1' },
        profile: { pattern: SUPPLIER_DEVICE_RISK.pattern, to: 'PART' },
      }),
    ).rejects.toThrow(RangeError);
  });

  it('throws on an unknown source rather than returning nothing', async () => {
    await expect(
      context.traverse({
        from: { objectType: 'SUPPLIER', id: 'ghost' },
        profile: SUPPLIER_DEVICE_RISK,
      }),
    ).rejects.toThrow(UnknownObjectError);
  });

  it('throws when the source id is a different type than claimed', async () => {
    await expect(
      context.traverse({
        from: { objectType: 'SUPPLIER', id: 'part-1' },
        profile: SUPPLIER_DEVICE_RISK,
      }),
    ).rejects.toThrow(UnknownObjectError);
  });
});
