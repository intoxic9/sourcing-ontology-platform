import { linkTypeDefinitions, type LinkTypeName } from './link-types.js';
import type { ObjectTypeName } from './object-types.js';
import type { StepDirection } from './traversal.js';

export type PathStepSpec = {
  linkType: LinkTypeName;
  direction: StepDirection;
};

/** Ordered steps the traversal engine executes; the real query shape. */
export type PathPattern = readonly PathStepSpec[];

/**
 * A named traversal profile: the pattern and the object type at its terminal node are one
 * value, so callers cannot ask for devices with a pattern that ends on a site.
 */
export type TraversalProfile = {
  pattern: PathPattern;
  to: ObjectTypeName;
};

/** Supplier failure propagation to devices: one SUPPLIES out, one COMPOSED_OF back. */
export const SUPPLIER_DEVICE_RISK: TraversalProfile = {
  pattern: [
    { linkType: 'SUPPLIES', direction: 'ALONG' },
    { linkType: 'COMPOSED_OF', direction: 'AGAINST' },
  ],
  to: 'DEVICE',
};

function linkDefinition(linkType: LinkTypeName) {
  const found = linkTypeDefinitions.find((entry) => entry.name === linkType);
  if (found === undefined) throw new Error(`unknown link type ${linkType}`);
  return found;
}

/** Object type after crossing one pattern step from `currentType`. */
export function objectTypeAfterStep(
  currentType: ObjectTypeName,
  step: PathStepSpec,
): ObjectTypeName {
  const def = linkDefinition(step.linkType);
  if (step.direction === 'ALONG') {
    if (currentType !== def.from) {
      throw new RangeError(
        `pattern step ${step.linkType} ALONG requires ${def.from}, at ${currentType}`,
      );
    }
    return def.to;
  }

  if (currentType !== def.to) {
    throw new RangeError(
      `pattern step ${step.linkType} AGAINST requires ${def.to}, at ${currentType}`,
    );
  }
  return def.from;
}

/** Terminal object type implied by walking `pattern` from `startType`. */
export function terminalObjectType(
  startType: ObjectTypeName,
  pattern: PathPattern,
): ObjectTypeName {
  return pattern.reduce((current, step) => objectTypeAfterStep(current, step), startType);
}

/** Ensures `profile.to` matches the pattern and `fromType` can start the walk. */
export function assertValidTraversalProfile(
  fromType: ObjectTypeName,
  profile: TraversalProfile,
): void {
  if (profile.pattern.length === 0) {
    throw new RangeError('traverse requires a non-empty profile pattern');
  }

  const end = terminalObjectType(fromType, profile.pattern);
  if (end !== profile.to) {
    throw new RangeError(
      `profile.to is ${profile.to} but pattern from ${fromType} ends at ${end}`,
    );
  }
}
