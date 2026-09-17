import type { ActionDefinition } from './action.js';
import { approveSupplierChange } from './approve-supplier-change.js';
import { confirmSupplierMerge } from './confirm-supplier-merge.js';
import { flagPartForRequalification } from './flag-part.js';

export const actions = {
  approveSupplierChange,
  confirmSupplierMerge,
  flagPartForRequalification,
} as const;

export type ActionName = keyof typeof actions;

export function actionByName(name: string): ActionDefinition<unknown> {
  if (name === 'approveSupplierChange') {
    return approveSupplierChange as ActionDefinition<unknown>;
  }
  if (name === 'confirmSupplierMerge') {
    return confirmSupplierMerge as ActionDefinition<unknown>;
  }
  if (name === 'flagPartForRequalification') {
    return flagPartForRequalification as ActionDefinition<unknown>;
  }
  throw new Error(`unknown action ${name}`);
}
