import dns from 'dns/promises';
import type { PageAnalysis, TechEvidence } from '../types.js';
import { PLATFORM_FINGERPRINTS } from './fingerprints.js';
import { deduplicateEvidence } from './evidence-utils.js';

export async function detectByDns(analysis: PageAnalysis): Promise<TechEvidence[]> {
  const evidence: TechEvidence[] = [];
  const hostname = new URL(analysis.finalUrl).hostname;

  try {
    const records = await dns.resolveCname(hostname);
    for (const record of records) {
      for (const fp of PLATFORM_FINGERPRINTS) {
        for (const pattern of fp.cnamePatterns) {
          if (pattern && record.toLowerCase().includes(pattern.toLowerCase())) {
            evidence.push({
              method: 'dns_cname',
              signal: fp.name,
              source: `CNAME: ${hostname} → ${record}`,
              weight: 35,
            });
          }
        }
      }
    }
  } catch {
    // expected: many hostnames have no CNAME
  }

  return deduplicateEvidence(evidence);
}

