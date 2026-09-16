import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_TRAVERSAL_DEPTH } from './constants.js';
import type { LinkTypeName } from './link-types.js';
import type { ObjectTypeName } from './object-types.js';
import {
  betterPath,
  CERTAIN,
  collapseToTargets,
  makePath,
  pathConfidence,
  pathTarget,
  resolveMaxDepth,
  weakestLink,
  weakestStepIndex,
  type PathNode,
  type PathStep,
} from './traversal.js';

const node = (id: string, objectType: ObjectTypeName = 'PART'): PathNode => ({ id, objectType });

const step = (
  to: PathNode,
  confidence: number,
  linkType: LinkTypeName = 'SUPPLIES',
): PathStep => ({ linkId: `link-to-${to.id}`, linkType, direction: 'ALONG', confidence, to });

const source = node('sup-1', 'SUPPLIER');

describe('pathConfidence', () => {
  // The degenerate case, and it is forced rather than chosen: path confidence has to
  // compose, so conf(p1 ++ p2) = min(conf(p1), conf(p2)). Any value below 1 would mean
  // prepending an empty path weakened the path it was prepended to.
  it('is CERTAIN for a path with no steps', () => {
    expect(pathConfidence([])).toBe(CERTAIN);
    expect(CERTAIN).toBe(1);
  });

  it('is the minimum, never the product', () => {
    const steps = [step(node('a'), 0.9), step(node('b'), 0.8), step(node('c'), 0.95)];
    expect(pathConfidence(steps)).toBe(0.8);

    // 0.9 * 0.8 * 0.95 = 0.684, which is what we are deliberately not doing.
    expect(pathConfidence(steps)).not.toBeCloseTo(0.684);
  });

  it('composes: the minimum of two halves is the minimum of the whole', () => {
    const first = [step(node('a'), 0.9), step(node('b'), 0.4)];
    const second = [step(node('c'), 0.7)];

    expect(pathConfidence([...first, ...second])).toBe(
      Math.min(pathConfidence(first), pathConfidence(second)),
    );
    expect(pathConfidence([...[], ...first])).toBe(pathConfidence(first));
  });
});

describe('weakestStepIndex', () => {
  it('is null when there are no steps', () => {
    expect(weakestStepIndex([])).toBeNull();
  });

  it('resolves ties to the first occurrence', () => {
    const steps = [step(node('a'), 0.5), step(node('b'), 0.9), step(node('c'), 0.5)];
    expect(weakestStepIndex(steps)).toBe(0);
  });

  // The loop must not start from CERTAIN, or an all-certain path would report no
  // weakest step despite having steps.
  it('picks a step even when every step is certain', () => {
    expect(weakestStepIndex([step(node('a'), 1), step(node('b'), 1)])).toBe(0);
  });
});

describe('makePath', () => {
  it('keeps confidence and weakestStepIndex in agreement with steps', () => {
    const steps = [step(node('a'), 0.9), step(node('b'), 0.62), step(node('c'), 0.8)];
    const path = makePath(source, steps);

    expect(path.confidence).toBe(0.62);
    expect(path.weakestStepIndex).toBe(1);
    expect(weakestLink(path)?.confidence).toBe(path.confidence);
  });

  it('describes a zero-step path as certain with no weakest link', () => {
    const path = makePath(source, []);

    expect(path.confidence).toBe(CERTAIN);
    expect(path.weakestStepIndex).toBeNull();
    expect(weakestLink(path)).toBeNull();
    // A zero-step path ends where it started.
    expect(pathTarget(path)).toStrictEqual(source);
  });
});

describe('betterPath', () => {
  it('prefers higher confidence', () => {
    const weak = makePath(source, [step(node('a'), 0.4)]);
    const strong = makePath(source, [step(node('a'), 0.9)]);

    expect(betterPath(weak, strong)).toBe(strong);
    expect(betterPath(strong, weak)).toBe(strong);
  });

  it('prefers the shorter path on a tie, as fewer hops to audit', () => {
    const short = makePath(source, [step(node('a'), 0.8)]);
    const long = makePath(source, [step(node('a'), 0.8), step(node('b'), 0.9)]);

    expect(betterPath(long, short)).toBe(short);
    expect(betterPath(short, long)).toBe(short);
  });

  it('is stable on an exact tie', () => {
    const a = makePath(source, [step(node('a'), 0.8)]);
    const b = makePath(source, [step(node('b'), 0.8)]);
    expect(betterPath(a, b)).toBe(a);
  });
});

describe('collapseToTargets', () => {
  const device = node('dev-1', 'DEVICE');

  // Two routes to one device: our confidence is the best chain, not the worst and not a
  // combination of the two.
  const viaStrongPart = makePath(source, [step(node('part-1'), 0.9), step(device, 0.8)]);
  const viaWeakPart = makePath(source, [step(node('part-2'), 0.5), step(device, 0.95)]);

  it('takes the maximum across paths of the minimum along each', () => {
    const [target] = collapseToTargets([viaWeakPart, viaStrongPart]);

    expect(target?.confidence).toBe(0.8);
    expect(target?.bestPath).toBe(viaStrongPart);
  });

  it('counts every route, because one route is a different risk from several', () => {
    const [target] = collapseToTargets([viaWeakPart, viaStrongPart]);
    expect(target?.pathCount).toBe(2);
  });

  it('never exceeds the strongest single chain', () => {
    const [target] = collapseToTargets([viaWeakPart, viaStrongPart]);
    const strongest = Math.max(viaWeakPart.confidence, viaStrongPart.confidence);
    expect(target?.confidence).toBe(strongest);
  });

  it('sorts by confidence descending and is total', () => {
    const other = makePath(source, [step(node('dev-2', 'DEVICE'), 0.95)]);
    const targets = collapseToTargets([viaStrongPart, other, viaWeakPart]);

    expect(targets.map((entry) => entry.target.id)).toStrictEqual(['dev-2', 'dev-1']);
    expect(targets.map((entry) => entry.confidence)).toStrictEqual([0.95, 0.8]);
  });

  it('returns nothing for no paths, rather than a zero-confidence target', () => {
    expect(collapseToTargets([])).toStrictEqual([]);
  });
});

describe('resolveMaxDepth', () => {
  it('defaults to the documented cap', () => {
    expect(resolveMaxDepth(undefined)).toBe(DEFAULT_MAX_TRAVERSAL_DEPTH);
    expect(DEFAULT_MAX_TRAVERSAL_DEPTH).toBe(6);
  });

  it('accepts an explicit zero', () => {
    expect(resolveMaxDepth(0)).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])('rejects %s', (depth) => {
    expect(() => resolveMaxDepth(depth)).toThrow(RangeError);
  });
});
