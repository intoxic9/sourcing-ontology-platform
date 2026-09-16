import { z } from 'zod';

import type { ActionDefinition, ObjectMutation, ValidationResult } from './action.js';
import type { OntologyContext } from './context.js';
import type { Supplier } from './object-types.js';
import type { Tracked } from './tracked.js';

export const supplierStatusSchema = z.enum([
  'APPROVED',
  'PROVISIONAL',
  'SUSPENDED',
  'DISQUALIFIED',
]);
export type SupplierStatus = z.infer<typeof supplierStatusSchema>;

export const approveSupplierChangeInputSchema = z.strictObject({
  supplierId: z.string().min(1),
  toStatus: supplierStatusSchema,
  justification: z.string().min(1),
});
export type ApproveSupplierChangeInput = z.infer<typeof approveSupplierChangeInputSchema>;

/**
 * Quality-system transitions. DISQUALIFIED is terminal: rehabilitation is a different
 * action we do not have yet, and pretending SUSPENDED ↔ DISQUALIFIED is reversible
 * would hide a real process behind a status flip.
 */
const ALLOWED: Record<SupplierStatus, readonly SupplierStatus[]> = {
  PROVISIONAL: ['APPROVED', 'SUSPENDED', 'DISQUALIFIED'],
  APPROVED: ['SUSPENDED', 'DISQUALIFIED'],
  SUSPENDED: ['APPROVED', 'DISQUALIFIED'],
  DISQUALIFIED: [],
};

const AT = (): string => new Date().toISOString();

function statusValue(toStatus: SupplierStatus): Tracked<SupplierStatus> {
  return {
    value: toStatus,
    confidence: 1,
    provenance: {
      method: 'HUMAN_ENTRY',
      sourceSystem: 'ACTION',
      sourceRecordId: 'approveSupplierChange',
      extractedAt: AT(),
    },
  };
}

async function openCriticalEvents(
  ctx: OntologyContext,
  supplierId: string,
): Promise<readonly string[]> {
  const links = await ctx.getLinks({ objectId: supplierId, linkType: 'AFFECTS_SUPPLIER' });
  const open: string[] = [];

  for (const link of links) {
    const event = await ctx.getObject('QUALITY_EVENT', link.fromId);
    if (event === undefined) continue;
    if (event.severity.value === 'CRITICAL' && event.closedAt === undefined) {
      open.push(event.id);
    }
  }

  return open;
}

function holdsIso13485(supplier: Supplier): boolean {
  return supplier.certifications.some((cert) => cert.value.includes('ISO 13485'));
}

export const approveSupplierChange: ActionDefinition<ApproveSupplierChangeInput> = {
  name: 'approveSupplierChange',
  inputSchema: approveSupplierChangeInputSchema,

  async preconditions(input, ctx): Promise<ValidationResult> {
    const supplier = await ctx.getObject('SUPPLIER', input.supplierId);
    if (supplier === undefined) {
      return { ok: false, errors: [`no SUPPLIER with id ${input.supplierId}`] };
    }

    const from = supplier.status.value;
    const allowed = ALLOWED[from];
    if (!allowed.includes(input.toStatus)) {
      return {
        ok: false,
        errors: [`${from} → ${input.toStatus} is not a legal status transition`],
      };
    }

    if (input.toStatus === 'APPROVED') {
      const errors: string[] = [];
      if (!holdsIso13485(supplier)) {
        errors.push('APPROVED requires a valid ISO 13485 certification');
      }
      const open = await openCriticalEvents(ctx, supplier.id);
      if (open.length > 0) {
        errors.push(
          `APPROVED is blocked by open CRITICAL quality event${open.length === 1 ? '' : 's'} ${open.join(', ')}`,
        );
      }
      if (errors.length > 0) return { ok: false, errors };
    }

    return { ok: true };
  },

  // Always human. A supplier status change is the kind of thing a regulator asks who
  // signed; AUTO would be a surprising reading of "requires approval".
  approvalPolicy: () => 'REQUIRE_HUMAN',

  async execute(input, ctx): Promise<readonly ObjectMutation[]> {
    const supplier = await ctx.getObject('SUPPLIER', input.supplierId);
    if (supplier === undefined) {
      throw new Error(`execute: supplier ${input.supplierId} disappeared`);
    }

    return [
      {
        objectType: 'SUPPLIER',
        id: supplier.id,
        properties: { status: statusValue(input.toStatus) },
      },
    ];
  },
};
