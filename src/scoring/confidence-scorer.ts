import type { PageAnalysis, RegistrationSignals, TechDetectionResult } from '../types.js';

interface ConfidenceInput {
  urlScore: number;
  registration: RegistrationSignals;
  techDetection: TechDetectionResult;
  pageAnalysis: PageAnalysis;
}

export function calculateConfidence(input: ConfidenceInput): {
  score: number;
  class: 'high' | 'medium' | 'review';
} {
  let score = 0;

  if (input.urlScore >= 80) score += 25;
  else if (input.urlScore >= 60) score += 15;
  else if (input.urlScore >= 40) score += 10;

  if (input.registration.found) {
    score += 15;
    if (input.registration.registrationButtons.length > 0) score += 5;
    if (input.registration.registrationForms > 0) score += 5;
    if (input.registration.futureDate) score += 5;
  }

  if (input.techDetection.isKnownPlatform) {
    score += 10;
    const uniqueMethods = new Set(input.techDetection.evidence.map(e => e.method)).size;
    score += Math.min(15, uniqueMethods * 5);
  }

  const completenessSignals = [
    input.registration.agendaFound,
    input.registration.speakersFound,
    input.registration.sponsorsFound,
    input.registration.pricingFound,
    input.registration.venueFound,
  ];
  const completenessCount = completenessSignals.filter(Boolean).length;
  score += Math.min(20, completenessCount * 5);

  if (input.pageAnalysis.statusCode >= 400) score -= 20;
  if (input.pageAnalysis.statusCode === 0) score -= 10;
  if (input.pageAnalysis.loadTimeMs > 20_000) score -= 5;

  score = Math.max(0, Math.min(100, score));

  let classification: 'high' | 'medium' | 'review';
  if (score >= 80) classification = 'high';
  else if (score >= 60) classification = 'medium';
  else classification = 'review';

  return { score, class: classification };
}

