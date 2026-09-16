import { describe, expect, it } from 'vitest';

import type { LinkTypeName } from './link-types.js';
import type { ObjectTypeName } from './object-types.js';
import {
  betterPath,
  CERTAIN,
  collapseToTargets,
  makePath,
  pathConfidence,
  pathTarget,
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
  it('is CERTAIN for a path with no steps', () => {
    expect(pathConfidence([])).toBe(CERTAIN);
    expect(CERTAIN).toBe(1);
  });

  it('is the minimum, never the product', () => {
    const steps = [step(node('a'), 0.9), step(node('b'), 0.8), step(node('c'), 0.95)];
    expect(pathConfidence(steps)).toBe(0.8);

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

  it('picks the same bestPath regardless of input order', () => {
    const left = makePath(source, [step(node('dev-a', 'DEVICE'), 0.7)]);
    const right = makePath(source, [step(node('dev-b', 'DEVICE'), 0.7)]);

    expect(collapseToTargets([left, right]).map((entry) => entry.target.id)).toStrictEqual(
      collapseToTargets([right, left]).map((entry) => entry.target.id),
    );
  });
});
