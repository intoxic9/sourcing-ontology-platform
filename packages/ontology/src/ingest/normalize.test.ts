import { describe, expect, it } from 'vitest';

import { normalizeLegalNameForMatch, normalizeSourceKey } from './normalize.js';

describe('normalizeLegalNameForMatch', () => {
  it('folds casing, whitespace, and legal suffix variants', () => {
    expect(normalizeLegalNameForMatch('  MedSource G.m.b.H.  ')).toBe(
      normalizeLegalNameForMatch('MEDSOURCE GMBH'),
    );
    expect(normalizeLegalNameForMatch('Nordic Sterile Solutions GmbH')).toBe(
      normalizeLegalNameForMatch('Nordic Sterile Solutions GMBH'),
    );
  });

  it('keeps transposed tokens distinct', () => {
    const a = normalizeLegalNameForMatch('Alpine Polymers GmbH');
    const b = normalizeLegalNameForMatch('Polymers Alpine GmbH');
    expect(a).not.toBe(b);
  });
});

describe('normalizeSourceKey', () => {
  it('trims vendor keys', () => {
    expect(normalizeSourceKey('  100301  ')).toBe('100301');
  });
});
