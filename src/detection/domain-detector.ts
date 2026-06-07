import type { PageAnalysis, TechEvidence } from '../types.js';
import { PLATFORM_FINGERPRINTS } from './fingerprints.js';

export function detectByDomain(analysis: PageAnalysis): TechEvidence[] {
  const evidence: TechEvidence[] = [];
  const urlDomain = new URL(analysis.finalUrl).hostname;

  for (const fp of PLATFORM_FINGERPRINTS) {
    for (const pattern of fp.domains) {
      if (pattern && urlDomain.includes(pattern)) {
        evidence.push({
          method: 'domain',
          signal: fp.name,
          source: `Page URL domain: ${urlDomain}`,
          weight: 30,
        });
      }
    }
  }
  return evidence;
}

