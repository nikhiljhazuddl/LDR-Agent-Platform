import type { PageAnalysis, TechEvidence } from '../types.js';
import { deduplicateEvidence } from './evidence-utils.js';
import { PLATFORM_FINGERPRINTS } from './fingerprints.js';

export function detectByForms(analysis: PageAnalysis): TechEvidence[] {
  const evidence: TechEvidence[] = [];

  for (const fp of PLATFORM_FINGERPRINTS) {
    for (const pattern of fp.formActionPatterns) {
      const normalized = pattern.toLowerCase();
      for (const action of analysis.formActions) {
        if (action.toLowerCase().includes(normalized)) {
          evidence.push({
            method: 'form_action',
            signal: fp.name,
            source: `Form action: ${action.substring(0, 200)}`,
            weight: 30,
          });
        }
      }
    }
  }

  for (const fp of PLATFORM_FINGERPRINTS) {
    for (const pattern of fp.domains) {
      for (const iframeSrc of analysis.iframeUrls) {
        if (pattern && iframeSrc.toLowerCase().includes(pattern.toLowerCase())) {
          evidence.push({
            method: 'form_action',
            signal: fp.name,
            source: `Embedded iframe: ${iframeSrc.substring(0, 200)}`,
            weight: 30,
          });
        }
      }
    }
  }

  return deduplicateEvidence(evidence);
}

