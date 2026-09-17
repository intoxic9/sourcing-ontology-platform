import { z } from 'zod';

import type { ActionDefinition, ObjectMutation, ValidationResult } from './action.js';
import { MergedObjectError, type OntologyContext } from './context.js';

/** Loaded by the store layer; not part of OntologyContext until ingest/ER wiring lands. */
export type MergeProposal = {
  id: string;
  survivorId: string;
  duplicateId: string;
  score: number;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  pipelineRunId: string;
  features: Readonly<Record<string, unknown>>;
};

export const confirmSupplierMergeInputSchema = z.strictObject({
  proposalId: z.uuid(),
  decision: z.enum(['CONFIRM', 'REJECT']),
  justification: z.string().min(1),
});
export type ConfirmSupplierMergeInput = z.infer<typeof confirmSupplierMergeInputSchema>;

const AUTO_MERGE_THRESHOLD = 0.95;

/**
 * Week 2 Action: apply or reject an entity-resolution merge proposal.
 *
 * Store responsibilities (Phase E): load proposal, tombstone duplicate, repoint links,
 * merge aliases/mergedFrom on survivor, update merge_proposals + audit.
 * `getMergeProposal` is not on OntologyContext yet; preconditions/execute stub until then.
 */
export const confirmSupplierMerge: ActionDefinition<ConfirmSupplierMergeInput> = {
  name: 'confirmSupplierMerge',
  inputSchema: confirmSupplierMergeInputSchema,

  preconditions(): Promise<ValidationResult> {
    return Promise.resolve({
      ok: false,
      errors: ['confirmSupplierMerge: merge proposal store not wired yet'],
    });
  },

  approvalPolicy: () => 'REQUIRE_HUMAN' as const,

  execute(): Promise<readonly ObjectMutation[]> {
    return Promise.reject(new Error('confirmSupplierMerge execute not wired'));
  },
};

/** For store/governance once merge_proposals is readable. */
export async function validateConfirmSupplierMergePreconditions(
  input: ConfirmSupplierMergeInput,
  ctx: OntologyContext,
  proposal: MergeProposal,
): Promise<ValidationResult> {
  if (proposal.status !== 'PENDING') {
    return { ok: false, errors: [`proposal ${proposal.id} is ${proposal.status}, not PENDING`] };
  }

  const survivor = await ctx.getObject('SUPPLIER', proposal.survivorId);
  if (survivor === undefined) {
    return { ok: false, errors: [`no SUPPLIER with id ${proposal.survivorId}`] };
  }

  try {
    await ctx.getObject('SUPPLIER', proposal.duplicateId);
  } catch (error) {
    if (error instanceof MergedObjectError) {
      return { ok: false, errors: [`duplicate ${proposal.duplicateId} is already merged`] };
    }
    throw error;
  }

  const duplicate = await ctx.getObject('SUPPLIER', proposal.duplicateId);
  if (duplicate === undefined) {
    return { ok: false, errors: [`no SUPPLIER with id ${proposal.duplicateId}`] };
  }

  if (input.decision === 'CONFIRM' && proposal.survivorId === proposal.duplicateId) {
    return { ok: false, errors: ['survivor and duplicate must differ'] };
  }

  return { ok: true };
}

export function confirmSupplierMergeApprovalPolicy(
  input: ConfirmSupplierMergeInput,
  proposal: MergeProposal,
): 'AUTO' | 'REQUIRE_HUMAN' {
  if (input.decision === 'REJECT') return 'AUTO';
  if (proposal.score > AUTO_MERGE_THRESHOLD) return 'AUTO';
  return 'REQUIRE_HUMAN';
}
