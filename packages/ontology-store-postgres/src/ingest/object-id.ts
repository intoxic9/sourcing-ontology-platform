import { createHash } from 'node:crypto';

/**
 * Opaque, deterministic object id for an ingested business key. Same inputs always yield
 * the same UUID-shaped id so manifests can pin merge clusters by source key.
 */
export function ingestObjectId(sourceSystem: string, sourceKey: string): string {
  const digest = createHash('sha256')
    .update(`sourcing-ontology/ingest/v1\0${sourceSystem}\0${sourceKey}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  const byte6 = bytes[6] ?? 0;
  const byte8 = bytes[8] ?? 0;
  bytes[6] = (byte6 & 0x0f) | 0x40;
  bytes[8] = (byte8 & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
