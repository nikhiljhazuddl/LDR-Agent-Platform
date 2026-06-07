import type { PageAnalysis, TechEvidence } from '../types.js';
import { deduplicateEvidence } from './evidence-utils.js';
import { PLATFORM_FINGERPRINTS } from './fingerprints.js';

export function detectByCookies(analysis: PageAnalysis): TechEvidence[] {
  const evidence: TechEvidence[] = [];

  for (const fp of PLATFORM_FINGERPRINTS) {
    for (const pattern of fp.cookiePatterns) {
      const normalized = pattern.toLowerCase();
      for (const cookie of analysis.cookies) {
        if (cookie.name.toLowerCase().includes(normalized)) {
          evidence.push({
            method: 'cookie',
            signal: fp.name,
            source: `Cookie: ${cookie.name} (domain: ${cookie.domain})`,
            weight: 20,
          });
        }
      }
    }
  }

  return deduplicateEvidence(evidence);
}

