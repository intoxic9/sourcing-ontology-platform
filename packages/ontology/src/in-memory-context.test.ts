import { beforeEach, describe, expect, it } from 'vitest';

import { UnknownObjectError, type OntologyContext } from './context.js';
import { SUPPLY_CHAIN, supplyChainFixture } from './fixture.js';
import { createInMemoryContext } from './in-memory-context.js';
import { weakestLink } from './traversal.js';

let context: OntologyContext;

beforeEach(() => {
  context = createInMemoryContext(supplyChainFixture);
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
    expect(found?.certifications).toHaveLength(2);
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

  it('is truncated at the exact depth of the match, because the cap still has uncrossed edges', async () => {
    // At depth 2 we have found dev-1, but from the device the other COMPOSED_OF edge
    // still leads to the other part. That is the lower-bound case the type documents.
    const { targets, truncated } = await affectedDevices(2);
    expect(targets.map((entry) => entry.target.id)).toStrictEqual(['dev-1']);
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
