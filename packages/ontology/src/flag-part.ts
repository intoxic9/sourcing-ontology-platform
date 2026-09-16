import { z } from 'zod';

import type { ActionDefinition, ObjectMutation, ValidationResult } from './action.js';
import type { OntologyContext } from './context.js';
import type { Tracked } from './tracked.js';

export const flagPartForRequalificationInputSchema = z.strictObject({
  partId: z.string().min(1),
  justification: z.string().min(1),
});
export type FlagPartForRequalificationInput = z.infer<
  typeof flagPartForRequalificationInputSchema
>;

const AT = (): string => new Date().toISOString();

function flagValue(): Tracked<boolean> {
  return {
    value: true,
    confidence: 1,
    provenance: {
      method: 'HUMAN_ENTRY',
      sourceSystem: 'ACTION',
      sourceRecordId: 'flagPartForRequalification',
      extractedAt: AT(),
    },
  };
}

async function justified(ctx: OntologyContext, partId: string): Promise<boolean> {
  const eventLinks = await ctx.getLinks({ objectId: partId, linkType: 'AFFECTS_PART' });
  if (eventLinks.length > 0) return true;

  const supplyLinks = await ctx.getLinks({ objectId: partId, linkType: 'SUPPLIES' });
  for (const link of supplyLinks) {
    const supplier = await ctx.getObject('SUPPLIER', link.fromId);
    if (supplier === undefined) continue;
    if (supplier.status.value === 'SUSPENDED' || supplier.status.value === 'DISQUALIFIED') {
      return true;
    }
  }

  return false;
}

export const flagPartForRequalification: ActionDefinition<FlagPartForRequalificationInput> =
  {
    name: 'flagPartForRequalification',
    inputSchema: flagPartForRequalificationInputSchema,

    async preconditions(input, ctx): Promise<ValidationResult> {
      const part = await ctx.getObject('PART', input.partId);
      if (part === undefined) {
        return { ok: false, errors: [`no PART with id ${input.partId}`] };
      }

      if (!(await justified(ctx, part.id))) {
        return {
          ok: false,
          errors: [
            'flagging a part requires a linked QualityEvent or a SUSPENDED/DISQUALIFIED supplier',
          ],
        };
      }

      return { ok: true };
    },

    async approvalPolicy(input, ctx) {
      const part = await ctx.getObject('PART', input.partId);
      // MINOR auto-applies for a human. CRITICAL (and MAJOR, which ONTOLOGY.md is silent
      // on) wait. The runner still ignores this for agents.
      if (part?.criticality.value === 'MINOR') return 'AUTO';
      return 'REQUIRE_HUMAN';
    },

    async execute(input, ctx): Promise<readonly ObjectMutation[]> {
      const part = await ctx.getObject('PART', input.partId);
      if (part === undefined) throw new Error(`execute: part ${input.partId} disappeared`);

      return [
        {
          objectType: 'PART',
          id: part.id,
          properties: { requiresRequalification: flagValue() },
        },
      ];
    },
  };
