import type { PageAnalysis, TechEvidence } from '../types.js';
import { deduplicateEvidence } from './evidence-utils.js';
import { PLATFORM_FINGERPRINTS } from './fingerprints.js';

export function detectByGlobals(analysis: PageAnalysis): TechEvidence[] {
  const evidence: TechEvidence[] = [];

  for (const fp of PLATFORM_FINGERPRINTS) {
    for (const pattern of fp.globalPatterns) {
      const normalized = pattern.toLowerCase();
      for (const globalVar of analysis.globalVariables) {
        if (globalVar.toLowerCase().includes(normalized)) {
          evidence.push({
            method: 'global_variable',
            signal: fp.name,
            source: `window.${globalVar}`,
            weight: 20,
          });
        }
      }
    }
  }

  return deduplicateEvidence(evidence);
}

