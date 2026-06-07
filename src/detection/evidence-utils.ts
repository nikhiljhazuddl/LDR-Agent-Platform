import type { TechEvidence } from '../types.js';

export function deduplicateEvidence(evidence: TechEvidence[]): TechEvidence[] {
  const seen = new Set<string>();
  const out: TechEvidence[] = [];
  for (const ev of evidence) {
    const key = `${ev.method}|${ev.signal}|${ev.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

