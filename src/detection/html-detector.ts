import type { PageAnalysis, TechEvidence } from '../types.js';
import { deduplicateEvidence } from './evidence-utils.js';
import { PLATFORM_FINGERPRINTS } from './fingerprints.js';

export function detectByHtml(analysis: PageAnalysis): TechEvidence[] {
  const evidence: TechEvidence[] = [];
  const html = (analysis.htmlContent || '').toLowerCase();
  const title = (analysis.title || '').toLowerCase();
  const meta = (analysis.metaDescription || '').toLowerCase();

  for (const fp of PLATFORM_FINGERPRINTS) {
    for (const pattern of fp.htmlPatterns) {
      if (!pattern) continue;
      const p = pattern.toLowerCase();
      if (html.includes(p)) {
        evidence.push({
          method: 'html_class',
          signal: fp.name,
          source: `HTML contains: "${pattern}"`,
          weight: 10,
        });
      }
    }

    for (const pattern of fp.metaPatterns) {
      if (!pattern) continue;
      const p = pattern.toLowerCase();
      if (title.includes(p) || meta.includes(p) || html.includes(`<meta`.toLowerCase()) && html.includes(p)) {
        evidence.push({
          method: 'meta_tag',
          signal: fp.name,
          source: `Meta/title contains: "${pattern}"`,
          weight: 10,
        });
      }
    }
  }

  return deduplicateEvidence(evidence);
}

