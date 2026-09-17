/**
 * Week 2 demo: supplier-risk traversal on an anchor supplier, then governance on another.
 * Requires `pnpm db:seed` (Week 2 CSV ingest).
 */
import {
  AgentExecutionBlockedError,
  SAP_VENDOR_MASTER,
  SUPPLIER_DEVICE_RISK,
  longestCommonStepPrefixLength,
  weakestLink,
  type AffectedTarget,
  type ObjectTypeName,
  type OntologyContext,
  type PathStep,
} from '@sourcing/ontology';
import { Pool } from 'pg';

import { createPostgresContext } from './context.js';
import { requireDatabaseUrl } from './env.js';
import { approveAction, executeProposedAs, objectAuditHistory, proposeAction } from './governance.js';
import { ingestObjectId } from './ingest/object-id.js';
import { loadWeek2Manifest } from './ingest/run-week2-ingest.js';

async function objectDisplayName(
  ctx: OntologyContext,
  objectType: ObjectTypeName,
  id: string,
): Promise<string> {
  switch (objectType) {
    case 'SUPPLIER': {
      const obj = await ctx.getObject('SUPPLIER', id);
      return obj?.legalName.value ?? id;
    }
    case 'PART': {
      const obj = await ctx.getObject('PART', id);
      if (obj === undefined) return id;
      return obj.description.value;
    }
    case 'DEVICE': {
      const obj = await ctx.getObject('DEVICE', id);
      return obj?.deviceName.value ?? id;
    }
    default:
      return id;
  }
}

async function formatHopLine(ctx: OntologyContext, step: PathStep): Promise<string> {
  const label = await objectDisplayName(ctx, step.to.objectType, step.to.id);
  return `--[${step.linkType} ${step.confidence.toFixed(2)}]--> ${label}`;
}

function formatSuffixSummary(steps: readonly PathStep[]): string {
  if (steps.length === 0) return '(direct)';
  if (steps.length === 1) {
    const step = steps[0]!;
    return `via ${step.linkType} ${step.confidence.toFixed(2)}`;
  }
  return steps.map((step) => `${step.linkType} ${step.confidence.toFixed(2)}`).join(' → ');
}

function sharedPrefixLabel(count: number, prefixLength: number): string {
  const routeWord = count === 1 ? 'route' : 'routes';
  if (prefixLength === 1) {
    return `All ${String(count)} ${routeWord} run through one fact:`;
  }
  return `All ${String(count)} ${routeWord} share ${String(prefixLength)} hops:`;
}

async function printRiskTargetsCollapsed(
  ctx: OntologyContext,
  originName: string,
  targets: readonly AffectedTarget[],
): Promise<boolean> {
  const paths = targets.map((entry) => entry.bestPath);
  const prefixLength = longestCommonStepPrefixLength(paths);

  if (prefixLength === 0) {
    let sawWeakSupply = false;
    for (const target of targets) {
      const deviceName = await objectDisplayName(ctx, 'DEVICE', target.target.id);
      const weakest = weakestLink(target.bestPath);
      const hops = (await Promise.all(target.bestPath.steps.map((step) => formatHopLine(ctx, step)))).join(
        ' ',
      );
      console.log(
        `\n  ${deviceName}  confidence ${target.confidence.toFixed(2)}  routes ${String(target.pathCount)}`,
      );
      console.log(`    ${originName} ${hops}`);
      if (weakest !== null) {
        const weakAt = await objectDisplayName(ctx, weakest.to.objectType, weakest.to.id);
        console.log(
          `    weakest: ${weakest.linkType} @ ${weakest.confidence.toFixed(2)} on ${weakAt}  (the fact to go verify)`,
        );
        if (weakest.linkType === 'SUPPLIES' && weakest.confidence <= 0.55) {
          sawWeakSupply = true;
        }
      }
    }
    return sawWeakSupply;
  }

  const prefixSteps = paths[0]!.steps.slice(0, prefixLength);
  const prefixHops = (await Promise.all(prefixSteps.map((step) => formatHopLine(ctx, step)))).join(' ');
  console.log(`\n  ${sharedPrefixLabel(targets.length, prefixLength)}`);
  console.log(`    ${originName} ${prefixHops}`);

  const referenceWeakest = weakestLink(paths[0]!);
  const weakestInSharedPrefix =
    referenceWeakest !== null &&
    paths.every((path) => {
      const weakest = weakestLink(path);
      return (
        weakest !== null &&
        weakest.linkType === referenceWeakest.linkType &&
        weakest.confidence === referenceWeakest.confidence &&
        weakest.to.id === referenceWeakest.to.id &&
        path.weakestStepIndex !== null &&
        path.weakestStepIndex < prefixLength
      );
    });

  if (weakestInSharedPrefix && referenceWeakest !== null) {
    console.log('    ^ weakest link — this is the fact to go verify');
  }

  console.log('\n  Affected devices:');
  let sawWeakSupply = false;
  for (const target of targets) {
    const deviceName = await objectDisplayName(ctx, 'DEVICE', target.target.id);
    const suffix = target.bestPath.steps.slice(prefixLength);
    console.log(
      `    ${deviceName.padEnd(28)} ${formatSuffixSummary(suffix).padEnd(22)} confidence ${target.confidence.toFixed(2)}`,
    );
    const weakest = weakestLink(target.bestPath);
    if (weakest?.linkType === 'SUPPLIES' && weakest.confidence <= 0.55) {
      sawWeakSupply = true;
    }
  }

  return sawWeakSupply;
}

const pool = new Pool({ connectionString: requireDatabaseUrl() });

try {
  const manifest = await loadWeek2Manifest();
  const roles = manifest.demoRoles;
  const riskId = ingestObjectId(SAP_VENDOR_MASTER, roles.riskAnchorSurvivorSourceKey);
  const governanceId = ingestObjectId(SAP_VENDOR_MASTER, roles.governanceSurvivorSourceKey);

  const ctx = createPostgresContext(pool);

  const riskSupplier = await ctx.getObject('SUPPLIER', riskId);
  if (riskSupplier === undefined) {
    throw new Error('demo graph not loaded. Run `pnpm db:seed` (Week 2 ingest) first.');
  }

  console.log(`=== Supplier risk: ${riskSupplier.legalName.value} ===`);
  console.log(`id ${riskSupplier.id}`);

  const result = await ctx.traverse({
    from: { objectType: 'SUPPLIER', id: riskSupplier.id },
    profile: SUPPLIER_DEVICE_RISK,
  });

  const deviceCount = result.targets.length;
  if (
    deviceCount < roles.riskExpectedDeviceCountMin ||
    deviceCount > roles.riskExpectedDeviceCountMax
  ) {
    console.log(
      `ERROR: expected ${String(roles.riskExpectedDeviceCountMin)}–${String(roles.riskExpectedDeviceCountMax)} devices, got ${String(deviceCount)}`,
    );
    process.exitCode = 1;
  }

  console.log(`status ${riskSupplier.status.value}   ${String(deviceCount)} devices affected`);

  const sawWeakSupply = await printRiskTargetsCollapsed(
    ctx,
    riskSupplier.legalName.value,
    result.targets,
  );

  if (!sawWeakSupply && deviceCount > 0) {
    console.log(
      `\nERROR: expected a weakest SUPPLIES link on ${roles.riskWeakSupplyPartSourceKey} at <= 0.55`,
    );
    process.exitCode = 1;
  }

  const governanceSupplier = await ctx.getObject('SUPPLIER', governanceId);
  if (governanceSupplier === undefined) {
    throw new Error(`missing governance supplier ${roles.governanceSurvivorSourceKey}`);
  }
  if (governanceSupplier.id === riskSupplier.id) {
    console.log('ERROR: risk and governance suppliers must differ');
    process.exitCode = 1;
  }

  console.log(
    `\n=== Agent proposes approveSupplierChange on ${governanceSupplier.legalName.value} ===`,
  );
  console.log(`current status: ${governanceSupplier.status.value}`);

  const proposed = await proposeAction(pool, {
    actionName: 'approveSupplierChange',
    input: {
      supplierId: governanceSupplier.id,
      toStatus: 'APPROVED',
      justification: 'ISO 13485 current; no open CRITICAL events',
    },
    actor: { id: 'agent-risk-1', type: 'AGENT' },
    justification: 'ISO 13485 current; no open CRITICAL events',
  });
  console.log(`proposed audit ${proposed.id}  status=${proposed.status}`);

  try {
    await executeProposedAs(pool, proposed.id, { id: 'agent-risk-1', type: 'AGENT' });
    console.log('ERROR: agent execution was not blocked');
    process.exitCode = 1;
  } catch (error) {
    if (error instanceof AgentExecutionBlockedError) {
      console.log(`blocked: ${error.message}`);
    } else {
      throw error;
    }
  }

  const still = await ctx.getObject('SUPPLIER', governanceSupplier.id);
  console.log(`status after blocked execute: ${still?.status.value ?? '?'}`);

  console.log(`\n=== Human approves ===`);
  const executed = await approveAction(pool, {
    auditId: proposed.id,
    approver: { id: 'k.novak', type: 'HUMAN' },
    justification: 'reviewed certs and CAPA board; approve',
  });
  console.log(`audit ${executed.id}  status=${executed.status}  approver=${executed.approvedBy ?? '?'}`);

  const after = await ctx.getObject('SUPPLIER', governanceSupplier.id);
  console.log(`status: ${governanceSupplier.status.value} -> ${after?.status.value ?? '?'}`);

  console.log(`\n=== Audit trail for ${governanceSupplier.legalName.value} (${governanceSupplier.id}) ===`);
  const trail = await objectAuditHistory(pool, governanceSupplier.id);
  for (const record of trail) {
    const approval =
      record.approvedBy === undefined ? '' : `  approved by ${record.approvedBy}`;
    console.log(
      `  ${record.proposedAt}  ${record.actionName}  ${record.actorType}:${record.actor}  ${record.status}${approval}`,
    );
  }
} finally {
  await pool.end();
}
