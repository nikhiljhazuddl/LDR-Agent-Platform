import type { PageAnalysis, TechEvidence } from '../types.js';
import { deduplicateEvidence } from './evidence-utils.js';
import { PLATFORM_FINGERPRINTS } from './fingerprints.js';

export function detectByNetwork(analysis: PageAnalysis): TechEvidence[] {
  const evidence: TechEvidence[] = [];

  for (const fp of PLATFORM_FINGERPRINTS) {
    for (const pattern of fp.networkDomains) {
      for (const request of analysis.networkRequests) {
        if (!pattern) continue;
        if (!request.domain.includes(pattern)) continue;
        const weight = ['xhr', 'fetch', 'websocket'].includes(request.resourceType) ? 35 : 20;
        let path = '';
        try {
          path = new URL(request.url).pathname.substring(0, 100);
        } catch {
          path = '';
        }
        evidence.push({
          method: 'network',
          signal: fp.name,
          source: `${request.resourceType.toUpperCase()} to: ${request.domain}${path}`,
          weight,
        });
      }
    }
  }

  return deduplicateEvidence(evidence);
}

