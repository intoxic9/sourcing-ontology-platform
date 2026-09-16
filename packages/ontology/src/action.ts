import { z } from 'zod';

import type { OntologyContext } from './context.js';
import type { ObjectTypeName } from './object-types.js';
import type { Tracked } from './tracked.js';

export const actorTypeSchema = z.enum(['HUMAN', 'AGENT']);
export type ActorType = z.infer<typeof actorTypeSchema>;

export type Actor = {
  id: string;
  type: ActorType;
};

export const approvalDecisionSchema = z.enum(['AUTO', 'REQUIRE_HUMAN']);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: readonly string[] };

/**
 * A property-level change `execute` wants applied. The runner stamps provenance with
 * the audit record id; `execute` itself is a pure read of the current ontology.
 */
export type ObjectMutation = {
  objectType: ObjectTypeName;
  id: string;
  properties: Record<string, Tracked<unknown>>;
};

/**
 * Governs a write. `approvalPolicy` is documented on the field rather than in a
 * comment on a CHECK constraint two packages away, because PLAN.md §6.5: nobody
 * reading a policy that returns `AUTO` should be able to conclude it applies to agents.
 */
export type ActionDefinition<TInput> = {
  name: string;
  inputSchema: z.ZodType<TInput>;
  preconditions: (input: TInput, ctx: OntologyContext) => Promise<ValidationResult>;
  /**
   * Human-initiated actions only. For `actorType: 'AGENT'` the runner ignores this and
   * always routes to PROPOSE. An AUTO result never authorises an agent to execute.
   */
  approvalPolicy: (input: TInput, ctx: OntologyContext) => Promise<ApprovalDecision> | ApprovalDecision;
  execute: (input: TInput, ctx: OntologyContext) => Promise<readonly ObjectMutation[]>;
};

export class PreconditionsFailedError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`preconditions failed: ${errors.join('; ')}`);
    this.name = 'PreconditionsFailedError';
  }
}

export class AgentExecutionBlockedError extends Error {
  constructor() {
    super('agents may propose Actions; they may never execute them');
    this.name = 'AgentExecutionBlockedError';
  }
}

/**
 * The only place routing is decided. Agents always propose, whatever the policy
 * returned. Humans follow the policy.
 */
export function routingDecision(
  policy: ApprovalDecision,
  actorType: ActorType,
): 'PROPOSE' | 'EXECUTE' {
  if (actorType === 'AGENT') return 'PROPOSE';
  return policy === 'AUTO' ? 'EXECUTE' : 'PROPOSE';
}

export async function checkPreconditions<TInput>(
  action: ActionDefinition<TInput>,
  input: TInput,
  ctx: OntologyContext,
): Promise<void> {
  const result = await action.preconditions(input, ctx);
  if (!result.ok) throw new PreconditionsFailedError(result.errors);
}

export const auditStatusSchema = z.enum(['PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED']);
export type AuditStatus = z.infer<typeof auditStatusSchema>;

export type AuditRecord = {
  id: string;
  actionName: string;
  actor: string;
  actorType: ActorType;
  proposedAt: string;
  approvedBy?: string | undefined;
  approvedAt?: string | undefined;
  approverType?: ActorType | undefined;
  status: AuditStatus;
  justification: string;
  inputPayload: unknown;
  beforeState: unknown;
  afterState: unknown;
  schemaVersion: string;
};
