import type { Link } from './link-types.js';
import type { ObjectTypeName } from './object-types.js';
import { assertValidTraversalProfile, type PathStepSpec, type TraversalProfile } from './profiles.js';
import { makePath, type Path, type PathNode, type PathStep, type StepDirection } from './traversal.js';

type Edge = {
  link: Link;
  direction: StepDirection;
  otherId: string;
};

export type PatternWalkGraph = {
  objectTypeOf(id: string): ObjectTypeName | undefined;
  edgesFrom(nodeId: string): readonly Edge[];
};

function matchingEdges(edges: readonly Edge[], step: PathStepSpec): Edge[] {
  return edges.filter((edge) => edge.link.linkType === step.linkType && edge.direction === step.direction);
}

/**
 * Enumerates every path that completes `profile.pattern` from `source`, without continuing
 * past the terminal step.
 */
export function enumeratePatternPaths(
  source: PathNode,
  profile: TraversalProfile,
  graph: PatternWalkGraph,
): Path[] {
  assertValidTraversalProfile(source.objectType, profile);

  const found: Path[] = [];
  const steps: PathStep[] = [];

  const nodeOf = (id: string): PathNode => {
    const objectType = graph.objectTypeOf(id);
    if (objectType === undefined) {
      throw new Error(`graph has a link to unknown object ${id}`);
    }
    return { id, objectType };
  };

  const walk = (nodeId: string, stepIndex: number): void => {
    if (stepIndex === profile.pattern.length) {
      const node = nodeOf(nodeId);
      if (node.objectType === profile.to && node.id !== source.id) {
        found.push(makePath(source, [...steps]));
      }
      return;
    }

    const stepSpec = profile.pattern[stepIndex];
    if (stepSpec === undefined) return;

    for (const edge of matchingEdges(graph.edgesFrom(nodeId), stepSpec)) {
      const to = nodeOf(edge.otherId);
      steps.push({
        linkId: edge.link.id,
        linkType: edge.link.linkType,
        direction: edge.direction,
        confidence: edge.link.confidence,
        to,
      });
      walk(to.id, stepIndex + 1);
      steps.pop();
    }
  };

  walk(source.id, 0);
  return found;
}
