import type { LinkTypeName } from './link-types.js';
import type { ObjectTypeName } from './object-types.js';
import type { TraversalProfile } from './profiles.js';

/**
 * The confidence of a path with no steps, and the identity element for `min`.
 *
 * Not an arbitrary convention. Path confidence has to compose — concatenating two paths
 * must give `min` of their confidences — and only 1.0 satisfies that for the empty path.
 * Any lower value would mean prepending a zero-step path weakened the path it was
 * prepended to.
 */
export const CERTAIN = 1;

/**
 * A node as traversal sees it: identity and type, no properties.
 *
 * Deliberate. A six-deep fan-out would otherwise drag every property of every
 * intermediate node into the result, while callers only render the endpoints. The API
 * assembles full objects for the handful of nodes it actually displays.
 */
export type PathNode = {
  id: string;
  objectType: ObjectTypeName;
};

/**
 * Relative to the link type's declared direction. `ONTOLOGY.md` §4's critical path is
 * `Supplier --SUPPLIES--> Part <--COMPOSED_OF-- Device`, so reaching a device from a
 * part means walking `COMPOSED_OF` AGAINST its declared direction.
 */
export type StepDirection = 'ALONG' | 'AGAINST';

export type PathStep = {
  linkId: string;
  linkType: LinkTypeName;
  direction: StepDirection;
  confidence: number;
  to: PathNode;
};

/**
 * Steps rather than parallel node and edge arrays, so the "N steps, N+1 nodes"
 * relationship cannot be violated by a malformed result.
 *
 * Build these with `makePath`, never by hand: it is what guarantees `confidence` and
 * `weakestStepIndex` agree with `steps`.
 */
export type Path = {
  from: PathNode;
  steps: readonly PathStep[];
  /** The minimum over `steps`, or `CERTAIN` when there are none. */
  confidence: number;
  /** Index into `steps`. `null` only for a zero-step path, which has no weakest link. */
  weakestStepIndex: number | null;
};

export type AffectedTarget = {
  target: PathNode;
  /** The maximum over all paths to this target of the minimum along each. */
  confidence: number;
  bestPath: Path;
  /**
   * How many distinct paths reach this target. A single-source signal rather than a
   * statistic: one route to a device is a materially different risk from fourteen.
   */
  pathCount: number;
};

export type TraversalQuery = {
  from: { objectType: ObjectTypeName; id: string };
  profile: TraversalProfile;
};

export type TraversalResult = {
  /** Sorted by confidence descending. Never includes the source object itself. */
  targets: readonly AffectedTarget[];
  /** Copy of the profile that was executed, so responses are self-describing. */
  profile: TraversalProfile;
};

/** The minimum along the path. Never the product — see ONTOLOGY.md §4. */
export function pathConfidence(steps: readonly PathStep[]): number {
  return steps.reduce((lowest, step) => Math.min(lowest, step.confidence), CERTAIN);
}

/**
 * Index of the weakest step, or `null` when there are no steps. Ties resolve to the
 * first occurrence, stated here rather than left to depend on sort stability.
 */
export function weakestStepIndex(steps: readonly PathStep[]): number | null {
  let weakest: { index: number; confidence: number } | null = null;

  for (const [index, step] of steps.entries()) {
    // Strictly less than, so an equal confidence later in the path does not displace
    // the earlier one.
    if (weakest === null || step.confidence < weakest.confidence) {
      weakest = { index, confidence: step.confidence };
    }
  }

  return weakest?.index ?? null;
}

/**
 * The only way a `Path` should be constructed. Deriving `confidence` and
 * `weakestStepIndex` here rather than letting callers supply them is what makes
 * `steps[weakestStepIndex].confidence === confidence` an invariant instead of a hope.
 */
export function makePath(from: PathNode, steps: readonly PathStep[]): Path {
  return {
    from,
    steps,
    confidence: pathConfidence(steps),
    weakestStepIndex: weakestStepIndex(steps),
  };
}

/**
 * The step a human should go and verify first — the reason we report the minimum rather
 * than a product. `null` for a zero-step path.
 */
export function weakestLink(path: Path): PathStep | null {
  if (path.weakestStepIndex === null) return null;
  return path.steps[path.weakestStepIndex] ?? null;
}

/** Where the path ends. Falls back to `from`, which is correct for a zero-step path. */
export function pathTarget(path: Path): PathNode {
  return path.steps.at(-1)?.to ?? path.from;
}

/**
 * Higher confidence wins. On a tie the shorter path wins, because fewer inferential
 * hops is less for a human to check. Total, and stable: an exact tie returns `a`.
 */
export function betterPath(a: Path, b: Path): Path {
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  return a.steps.length <= b.steps.length ? a : b;
}

/**
 * Identifies a path by the edges it crossed, without using `linkId`.
 *
 * The in-memory fixture authors link ids; Postgres generates UUIDs. A signature that
 * included `linkId` would make the two implementations disagree on `bestPath` whenever
 * two routes tied, which is exactly the disagreement the conformance check exists to
 * catch — and it would be a false one. `(linkType, direction, to)` uniquely identifies
 * an edge from a given node: `links` is unique on `(link_type, from_id, to_id)`.
 */
function pathSignature(path: Path): string {
  return path.steps
    .map((step) => `${step.linkType}:${step.direction}:${step.to.id}`)
    .join('>');
}

/**
 * A total order over paths, best first.
 *
 * The signature tiebreak exists for cross-implementation agreement rather than for
 * looks. Two paths can tie on both confidence and length, and then "the best path"
 * would otherwise be whichever the caller happened to supply first — a depth-first walk
 * and a SQL result set do not enumerate in the same order, so the two would disagree on
 * `bestPath` while agreeing on everything else.
 */
function comparePaths(a: Path, b: Path): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.steps.length !== b.steps.length) return a.steps.length - b.steps.length;

  const left = pathSignature(a);
  const right = pathSignature(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTargets(a: AffectedTarget, b: AffectedTarget): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.bestPath.steps.length !== b.bestPath.steps.length) {
    return a.bestPath.steps.length - b.bestPath.steps.length;
  }
  // Falls back to id so the ordering is total. An unstable order would make the demo
  // and the tests flap for no reason.
  return a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0;
}

/**
 * Groups paths by where they end, keeping the best one for each.
 *
 * A target reachable by several routes takes the **maximum** over those routes of the
 * minimum along each. Our confidence that a device is affected is the best chain of
 * evidence, not the worst and not a combination: a product would deflate it and a
 * noisy-OR would inflate it past any single chain. The maximum never claims more than
 * the strongest end-to-end route actually found.
 *
 * One path per target bounds the output at the number of reachable nodes.
 *
 * Independent of the order paths arrive in, so the in-memory walk and the pattern SQL
 * produce identical results from identical data.
 */
export function collapseToTargets(paths: readonly Path[]): AffectedTarget[] {
  const grouped = new Map<string, { target: PathNode; bestPath: Path; pathCount: number }>();

  for (const path of [...paths].sort(comparePaths)) {
    const target = pathTarget(path);
    const existing = grouped.get(target.id);

    if (existing === undefined) {
      grouped.set(target.id, { target, bestPath: path, pathCount: 1 });
    } else {
      existing.bestPath = betterPath(existing.bestPath, path);
      existing.pathCount += 1;
    }
  }

  return [...grouped.values()]
    .map(({ target, bestPath, pathCount }) => ({
      target,
      confidence: bestPath.confidence,
      bestPath,
      pathCount,
    }))
    .sort(compareTargets);
}

/**
 * The comparison shape for a `TraversalResult`.
 *
 * `linkId` is stripped because it is assigned by storage, not by the walk. Everything
 * else that a risk answer depends on is here: profile, targets, confidences, `pathCount`,
 * the steps of the best path, and `weakestStepIndex`.
 */
export function canonicalTraversalResult(result: TraversalResult): unknown {
  return {
    profile: result.profile,
    targets: result.targets.map((entry) => ({
      target: entry.target,
      confidence: entry.confidence,
      pathCount: entry.pathCount,
      bestPath: {
        from: entry.bestPath.from,
        confidence: entry.bestPath.confidence,
        weakestStepIndex: entry.bestPath.weakestStepIndex,
        steps: entry.bestPath.steps.map((step) => ({
          linkType: step.linkType,
          direction: step.direction,
          confidence: step.confidence,
          to: step.to,
        })),
      },
    })),
  };
}
