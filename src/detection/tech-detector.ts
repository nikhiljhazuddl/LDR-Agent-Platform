import type { PageAnalysis, TechDetectionResult, TechEvidence } from '../types.js';
import { detectByDomain } from './domain-detector.js';
import { detectByScripts } from './script-detector.js';
import { detectByNetwork } from './network-detector.js';
import { detectByCookies } from './cookie-detector.js';
import { detectByGlobals } from './globals-detector.js';
import { detectByForms } from './form-detector.js';
import { detectByHtml } from './html-detector.js';
import { detectByDns } from './dns-detector.js';
import { detectUnknownPlatform } from './unknown-platform.js';
import { PLATFORM_FINGERPRINTS } from './fingerprints.js';

const STRONG_METHODS = new Set(['domain', 'script', 'network', 'cookie', 'form_action', 'dns_cname']);
const WEAK_METHODS = new Set(['html_class', 'meta_tag', 'global_variable']);

export async function detectTechnology(analysis: PageAnalysis): Promise<TechDetectionResult> {
  const allEvidence: TechEvidence[] = [];

  const domainEvidence = detectByDomain(analysis);
  const scriptEvidence = detectByScripts(analysis);
  const networkEvidence = detectByNetwork(analysis);
  const cookieEvidence = detectByCookies(analysis);
  const globalEvidence = detectByGlobals(analysis);
  const formEvidence = detectByForms(analysis);
  const htmlEvidence = detectByHtml(analysis);
  const dnsEvidence = await detectByDns(analysis);

  allEvidence.push(
    ...domainEvidence,
    ...scriptEvidence,
    ...networkEvidence,
    ...cookieEvidence,
    ...globalEvidence,
    ...formEvidence,
    ...htmlEvidence,
    ...dnsEvidence
  );

  if (allEvidence.length === 0) {
    const unknownSignals = detectUnknownPlatform(analysis);
    return {
      platform: 'Unknown',
      confidence: 0,
      evidence: [],
      isKnownPlatform: false,
      suspectedVendor: unknownSignals.suspectedVendor ?? undefined,
    };
  }

  const secondary = new Set(PLATFORM_FINGERPRINTS.filter(fp => fp.secondary).map(fp => fp.name));

  const platformScores = new Map<string, { evidence: TechEvidence[]; totalWeight: number }>();
  for (const ev of allEvidence) {
    const current = platformScores.get(ev.signal) ?? { evidence: [], totalWeight: 0 };
    current.evidence.push(ev);
    current.totalWeight += ev.weight;
    platformScores.set(ev.signal, current);
  }

  const ranked = Array.from(platformScores.entries())
    .map(([platform, data]) => ({ platform, ...data }))
    .sort((a, b) => b.totalWeight - a.totalWeight);

  const bestNonSecondary = ranked.find(r => !secondary.has(r.platform)) ?? ranked[0];
  const winner = bestNonSecondary;

  const hasStrongEvidence = winner.evidence.some(e => STRONG_METHODS.has(e.method));
  const uniqueMethods = new Set(winner.evidence.map(e => e.method)).size;
  const weakOnly = winner.evidence.every(e => WEAK_METHODS.has(e.method));

  if (secondary.has(winner.platform) || weakOnly || (!hasStrongEvidence && uniqueMethods < 2)) {
    const unknownSignals = detectUnknownPlatform(analysis);
    return {
      platform: 'Unknown',
      confidence: 0,
      evidence: winner.evidence,
      isKnownPlatform: false,
      suspectedVendor: unknownSignals.suspectedVendor ?? winner.platform,
    };
  }

  const techConfidence = Math.min(95, 30 + uniqueMethods * 15);

  return {
    platform: winner.platform,
    confidence: techConfidence,
    evidence: winner.evidence,
    isKnownPlatform: true,
  };
}
