import type { PageAnalysis, TechEvidence } from '../types.js';
import { deduplicateEvidence } from './evidence-utils.js';
import { PLATFORM_FINGERPRINTS } from './fingerprints.js';

export function detectByScripts(analysis: PageAnalysis): TechEvidence[] {
  const evidence: TechEvidence[] = [];

  for (const fp of PLATFORM_FINGERPRINTS) {
    for (const pattern of fp.scriptPatterns) {
      const normalizedPattern = pattern.toLowerCase();
      for (const script of analysis.scripts) {
        if (script.src && script.src.toLowerCase().includes(normalizedPattern)) {
          evidence.push({
            method: 'script',
            signal: fp.name,
            source: `Script src: ${script.src.substring(0, 200)}`,
            weight: 25,
          });
        }
        if (script.inline && script.content?.toLowerCase().includes(normalizedPattern)) {
          evidence.push({
            method: 'script',
            signal: fp.name,
            source: `Inline script contains: "${pattern}"`,
            weight: 15,
          });
        }
      }

      for (const css of analysis.stylesheets) {
        if (css.toLowerCase().includes(normalizedPattern)) {
          evidence.push({
            method: 'script',
            signal: fp.name,
            source: `Stylesheet: ${css.substring(0, 200)}`,
            weight: 20,
          });
        }
      }
    }
  }

  return deduplicateEvidence(evidence);
}

