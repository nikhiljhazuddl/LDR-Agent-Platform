import type {
  CompanyInput,
  CompanyResult,
  PageAnalysis,
  RegistrationSignals,
  ScoredCandidate,
  TechDetectionResult,
} from '../types.js';

function summarizeTechSource(tech: TechDetectionResult | null): string {
  if (!tech || tech.evidence.length === 0) {
    return tech?.suspectedVendor ? `Unknown; suspected vendor: ${tech.suspectedVendor}` : 'No strong platform evidence found';
  }
  return tech.evidence
    .slice(0, 3)
    .map(e => `${e.method}: ${e.source}`)
    .join(' | ');
}

function summarizeSelectionSource(
  candidate: ScoredCandidate | null,
  registration: RegistrationSignals | null,
  analysis: PageAnalysis | null
): string {
  if (!candidate) return 'No event candidate selected';
  const rules = candidate.scoreBreakdown.appliedRules
    .slice(0, 5)
    .map(rule => `${rule.name} (${rule.points > 0 ? '+' : ''}${rule.points})`)
    .join(', ');
  const registrationSummary = registration
    ? `registration=${registration.found}; buttons=${registration.registrationButtons.slice(0, 3).join(', ') || 'none'}; forms=${registration.registrationForms}; date=${registration.futureDate || 'none'}`
    : 'registration=not crawled';
  const finalUrl = analysis?.finalUrl ?? candidate.url;
  return `Selected URL: ${finalUrl}; URL score=${candidate.score}; rules=${rules || 'none'}; ${registrationSummary}`;
}

function classifyEventType(text: string): CompanyResult['eventType'] {
  const lower = text.toLowerCase();
  if (lower.includes('summit')) return 'summit';
  if (lower.includes('user conference') || lower.includes('user-conference')) return 'user_conference';
  if (/\bforum\b/.test(lower)) return 'forum';
  if (lower.includes('conference')) return 'conference';
  return 'unknown';
}

export function buildResult(
  company: CompanyInput,
  bestEvent: ScoredCandidate | null,
  bestEventAnalysis: PageAnalysis | null,
  bestEventRegistration: RegistrationSignals | null,
  bestEventTech: TechDetectionResult | null,
  bestWebinar: ScoredCandidate | null,
  bestWebinarAnalysis: PageAnalysis | null,
  bestWebinarTech: TechDetectionResult | null,
  confidence: { score: number; class: 'high' | 'medium' | 'review' },
  aiUsed: boolean,
  processingTimeMs: number
): CompanyResult {
  const now = new Date().toISOString();
  const companyDomain = company.domain ?? bestEvent?.domain ?? bestWebinar?.domain ?? '';

  const eventName = bestEventAnalysis?.title || bestEvent?.title || null;
  const eventUrl = bestEventAnalysis?.finalUrl || bestEvent?.url || null;
  const eventType = classifyEventType(`${eventName ?? ''} ${eventUrl ?? ''}`);

  const eventTechnology = bestEventTech?.isKnownPlatform ? bestEventTech.platform : null;
  const eventTechnologySource = summarizeTechSource(bestEventTech);
  const eventTechEvidence = JSON.stringify(bestEventTech?.evidence ?? []);
  const eventTechConfidence = bestEventTech?.confidence ?? 0;
  const eventSelectionSource = summarizeSelectionSource(bestEvent, bestEventRegistration, bestEventAnalysis);

  const registrationUrl =
    bestEventAnalysis?.registrationTargets?.[0]?.url ||
    (bestEventAnalysis?.formActions?.[0] && bestEventAnalysis.formActions[0]) ||
    eventUrl;

  const errorNotes = [bestEventAnalysis?.error, bestWebinarAnalysis?.error].filter(Boolean).join(' | ');

  const result: CompanyResult = {
    companyName: company.name,
    companyDomain,

    eventName,
    eventUrl,
    registrationUrl: eventUrl ? registrationUrl : null,
    eventDate: bestEventRegistration?.futureDate ?? null,
    eventType,

    eventTechnology,
    eventTechnologySource,
    eventTechEvidence,
    eventTechConfidence,
    eventSelectionSource,

    registrationFound: bestEventRegistration?.found ?? false,
    agendaFound: bestEventRegistration?.agendaFound ?? false,
    speakerPageFound: bestEventRegistration?.speakersFound ?? false,
    sponsorPageFound: bestEventRegistration?.sponsorsFound ?? false,

    webinarName: bestWebinarAnalysis?.title || bestWebinar?.title || null,
    webinarUrl: bestWebinarAnalysis?.finalUrl || bestWebinar?.url || null,
    webinarTechnology: bestWebinarTech?.isKnownPlatform ? bestWebinarTech.platform : null,
    webinarTechnologySource: summarizeTechSource(bestWebinarTech),
    webinarTechEvidence: JSON.stringify(bestWebinarTech?.evidence ?? []),

    confidenceScore: confidence.score,
    confidenceClass: confidence.class,

    lastUpdated: now,
    researchStatus: confidence.class === 'review' ? 'needs_review' : 'complete',
    processingTimeMs,
    aiUsed,
    errorNotes,
  };

  if (!bestEvent) {
    result.researchStatus = 'complete';
    result.confidenceScore = 0;
    result.confidenceClass = 'review';
  }

  return result;
}
