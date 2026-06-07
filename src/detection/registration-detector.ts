import * as cheerio from 'cheerio';
import type { PageAnalysis, RegistrationSignals } from '../types.js';

export async function detectRegistration(page: PageAnalysis): Promise<RegistrationSignals> {
  const html = page.htmlContent || '';
  const lower = html.toLowerCase();
  const $ = cheerio.load(html);

  const result: RegistrationSignals = {
    found: false,
    registrationButtons: [],
    registrationForms: 0,
    agendaFound: false,
    speakersFound: false,
    sponsorsFound: false,
    exhibitorsFound: false,
    venueFound: false,
    pricingFound: false,
  };

  const buttonPatterns: RegExp[] = [
    /register\s*now/i,
    /registration/i,
    /\bsign\s*up\b/i,
    /\breserve\b/i,
    /save\s*(my)?\s*seat/i,
    /\bget\s*tickets?\b/i,
    /\bbuy\s*tickets?\b/i,
    /\battend\b/i,
  ];

  const candidates: Array<{ text: string; href?: string }> = [];

  $('a, button, input[type="submit"], input[type="button"]').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const text =
      tag === 'input'
        ? ($(el).attr('value') || '').trim()
        : $(el).text().replace(/\s+/g, ' ').trim();
    const href = tag === 'a' ? ($(el).attr('href') || '').trim() : undefined;
    if (!text && !href) return;
    candidates.push({ text, href });
  });

  const matched: string[] = [];
  for (const c of candidates) {
    const haystack = `${c.text} ${c.href ?? ''}`.trim();
    if (!haystack) continue;
    if (buttonPatterns.some(p => p.test(haystack))) {
      matched.push(c.text || c.href || '');
    }
  }

  result.registrationButtons = Array.from(new Set(matched)).filter(Boolean).slice(0, 10);

  // Registration forms: count forms with email-like fields
  let formCount = 0;
  $('form').each((_, form) => {
    const hasEmail =
      $(form).find('input[type="email"]').length > 0 ||
      $(form).find('input[name*="email" i]').length > 0 ||
      $(form).find('input[id*="email" i]').length > 0;
    if (hasEmail) formCount += 1;
  });
  result.registrationForms = formCount;

  const sectionPatterns: Record<keyof Pick<
    RegistrationSignals,
    | 'agendaFound'
    | 'speakersFound'
    | 'sponsorsFound'
    | 'exhibitorsFound'
    | 'venueFound'
    | 'pricingFound'
  >, RegExp> = {
    agendaFound: /\b(agenda|schedule|program|sessions?|tracks?)\b/i,
    speakersFound: /\b(speakers?|keynote|presenters?|panelists?)\b/i,
    sponsorsFound: /\b(sponsors?|partners?|sponsorship)\b/i,
    exhibitorsFound: /\b(exhibitors?|exhibition|expo\b)/i,
    venueFound: /\b(venue|location|directions|getting\s*there|hotel)\b/i,
    pricingFound: /\b(pricing|tickets?|passes?|early\s*bird|registration\s*fee)\b/i,
  };

  const navAndHeadings = $('nav a, h1, h2, h3, h4, [id], [class]')
    .toArray()
    .map(el => `${$(el).text()} ${$(el).attr('id') || ''} ${$(el).attr('class') || ''}`)
    .join(' ');

  for (const [key, pattern] of Object.entries(sectionPatterns)) {
    (result as unknown as Record<string, boolean>)[key] =
      pattern.test(navAndHeadings) || pattern.test(lower.substring(0, 50_000));
  }

  const datePatterns = [
    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?,?\s*\d{4}/i,
    /\d{1,2}(?:\s*[-–]\s*\d{1,2})?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s*\d{4}/i,
    /20\d{2}-\d{2}-\d{2}/,
  ];

  for (const pattern of datePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.futureDate = match[0];
      break;
    }
  }

  result.found = result.registrationButtons.length > 0 || result.registrationForms > 0;
  return result;
}
