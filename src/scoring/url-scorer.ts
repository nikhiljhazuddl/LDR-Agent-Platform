import type { ScoredCandidate, ScoreBreakdown, SearchResult } from '../types.js';

interface ScoringRule {
  name: string;
  points: number;
  group: keyof Omit<ScoreBreakdown, 'total' | 'appliedRules'>;
  condition: (result: SearchResult, companyName: string, companyDomain?: string) => boolean;
}

const EVENT_SCORING_RULES: ScoringRule[] = [
  {
    name: 'official_domain',
    points: +50,
    group: 'domainMatch',
    condition: (r, company, domain) => {
      if (domain && r.domain.includes(domain.replace('www.', ''))) return true;
      const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '');
      return r.domain.includes(slug);
    },
  },
  {
    name: 'event_subdomain',
    points: +60,
    group: 'subdomainBonus',
    condition: (r) => {
      const eventSubdomains = ['event', 'events', 'summit', 'conference', 'connect', 'register', 'attend'];
      const subdomain = r.domain.split('.')[0]?.toLowerCase() ?? '';
      return eventSubdomains.includes(subdomain);
    },
  },
  {
    name: 'known_event_platform_domain',
    points: +40,
    group: 'domainMatch',
    condition: (r) => {
      const platforms = [
        'cvent.com',
        'web.cvent.com',
        'rainfocus.com',
        'bizzabo.com',
        'swoogo.com',
        'eventmobi.com',
        'hubilo.com',
        'on24.com',
        'airmeet.com',
        'hopin.com',
        'bevy.com',
        'goldcast.io',
        'splashthat.com',
        'whova.com',
        'socio.events',
        'aventri.com',
        'certain.com',
        'grip.events',
        'spotme.com',
        'brella.io',
        'vfairs.com',
        'accelevents.com',
        'run.events',
        'sched.com',
        'arrangeevents.com',
      ];
      return platforms.some(p => r.domain.includes(p));
    },
  },

  { name: 'contains_summit', points: +20, group: 'keywordSignals', condition: (r) => /summit/i.test(r.url + r.title) },
  { name: 'contains_conference', points: +15, group: 'keywordSignals', condition: (r) => /conference/i.test(r.url + r.title) },
  { name: 'contains_forum', points: +15, group: 'keywordSignals', condition: (r) => /\bforum\b/i.test(r.url + r.title) },
  { name: 'contains_user_conference', points: +15, group: 'keywordSignals', condition: (r) => /user.?conference/i.test(r.url + r.title) },
  {
    name: 'contains_registration',
    points: +25,
    group: 'keywordSignals',
    condition: (r) => /regist(er|ration)/i.test(r.url + r.title + r.snippet),
  },
  { name: 'contains_agenda', points: +15, group: 'keywordSignals', condition: (r) => /agenda/i.test(r.url + r.title + r.snippet) },
  { name: 'contains_speakers', points: +10, group: 'keywordSignals', condition: (r) => /speakers?/i.test(r.url + r.title + r.snippet) },

  {
    name: 'future_year_in_url',
    points: +20,
    group: 'dateSignals',
    condition: (r) => {
      const currentYear = new Date().getFullYear();
      const nextYear = currentYear + 1;
      return r.url.includes(String(currentYear)) || r.url.includes(String(nextYear));
    },
  },
  {
    name: 'future_date_in_snippet',
    points: +15,
    group: 'dateSignals',
    condition: (r) => {
      const currentYear = new Date().getFullYear();
      const yearPattern = new RegExp(`(${currentYear}|${currentYear + 1})`);
      return yearPattern.test(r.snippet);
    },
  },

  {
    name: 'news_article',
    points: -30,
    group: 'negativeSignals',
    condition: (r) => {
      const newsDomains = [
        'techcrunch.com',
        'reuters.com',
        'bloomberg.com',
        'cnbc.com',
        'forbes.com',
        'businessinsider.com',
        'zdnet.com',
        'venturebeat.com',
        'theverge.com',
        'wired.com',
        'cnn.com',
        'bbc.com',
        'nytimes.com',
        'wsj.com',
        'ft.com',
        'marketwatch.com',
        'yahoo.com',
      ];
      return newsDomains.some(d => r.domain.includes(d));
    },
  },
  {
    name: 'third_party_listing',
    points: -20,
    group: 'negativeSignals',
    condition: (r) => {
      const listingSites = [
        '10times.com',
        'eventbrite.com',
        'meetup.com',
        'eventzilla.net',
        'allconferences.com',
        'conferenceindex.org',
        'papercall.io',
        'sessionize.com',
        'linkedin.com/events',
      ];
      return listingSites.some(d => r.domain.includes(d));
    },
  },
  {
    name: 'blog_url',
    points: -80,
    group: 'negativeSignals',
    condition: (r) => /\/(blog|blogs|news|press|resources|articles?|insights?)\//i.test(r.url),
  },
  { name: 'blog_or_recap', points: -25, group: 'negativeSignals', condition: (r) => /\b(recap|review|highlights|takeaways|summary)\b/i.test(r.title + r.snippet) },
  {
    name: 'official_event_path',
    points: +20,
    group: 'keywordSignals',
    condition: (r) => /\/(events?|conference|summit|forum|webinars?|register|registration)\b/i.test(r.url),
  },
  {
    name: 'past_event',
    points: -15,
    group: 'negativeSignals',
    condition: (r) => {
      const currentYear = new Date().getFullYear();
      const pastYears = [currentYear - 1, currentYear - 2, currentYear - 3];
      const hasPastYear = pastYears.some(y => r.url.includes(String(y)));
      const hasFutureYear = [currentYear, currentYear + 1].some(y => r.url.includes(String(y)));
      return hasPastYear && !hasFutureYear;
    },
  },

  { name: 'top_3_position', points: +10, group: 'positionBonus', condition: (r) => r.position <= 3 },
];

const WEBINAR_SCORING_RULES: ScoringRule[] = [
  {
    name: 'official_domain',
    points: +40,
    group: 'domainMatch',
    condition: (r, company, domain) => {
      if (domain && r.domain.includes(domain.replace('www.', ''))) return true;
      const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '');
      return r.domain.includes(slug);
    },
  },
  {
    name: 'known_webinar_platform_domain',
    points: +40,
    group: 'domainMatch',
    condition: (r) => {
      const platforms = [
        'on24.com',
        'zoom.us',
        'gotowebinar.com',
        'webex.com',
        'teams.microsoft.com',
        'microsoft.com',
        'demio.com',
        'livestorm.co',
        'bigmarker.com',
        'brighttalk.com',
        'vimeo.com',
        'youtube.com',
      ];
      return platforms.some(p => r.domain.includes(p));
    },
  },
  { name: 'contains_webinar', points: +25, group: 'keywordSignals', condition: (r) => /webinar/i.test(r.url + r.title + r.snippet) },
  { name: 'contains_register', points: +20, group: 'keywordSignals', condition: (r) => /regist(er|ration)|save\\s*(my)?\\s*seat/i.test(r.url + r.title + r.snippet) },
  { name: 'contains_upcoming', points: +10, group: 'keywordSignals', condition: (r) => /\b(upcoming|join\\s+us|live)\b/i.test(r.title + r.snippet) },
  { name: 'contains_on_demand', points: +5, group: 'keywordSignals', condition: (r) => /\b(on[- ]demand|watch\\s+now)\b/i.test(r.title + r.snippet) },

  {
    name: 'future_year_in_url',
    points: +10,
    group: 'dateSignals',
    condition: (r) => {
      const currentYear = new Date().getFullYear();
      const nextYear = currentYear + 1;
      return r.url.includes(String(currentYear)) || r.url.includes(String(nextYear));
    },
  },

  { name: 'past_webinar_or_recap', points: -20, group: 'negativeSignals', condition: (r) => /\b(past|recap|recording|replay|slides|highlights)\b/i.test(r.title + r.snippet) },
  { name: 'top_3_position', points: +10, group: 'positionBonus', condition: (r) => r.position <= 3 },
];

function emptyBreakdown(): ScoreBreakdown {
  return {
    domainMatch: 0,
    subdomainBonus: 0,
    keywordSignals: 0,
    dateSignals: 0,
    negativeSignals: 0,
    positionBonus: 0,
    total: 0,
    appliedRules: [],
  };
}

export function scoreResult(
  result: SearchResult,
  companyName: string,
  companyDomain: string | undefined,
  rules: ScoringRule[]
): { score: number; breakdown: ScoreBreakdown } {
  const breakdown = emptyBreakdown();
  let total = 0;

  for (const rule of rules) {
    if (!rule.condition(result, companyName, companyDomain)) continue;
    total += rule.points;
    breakdown[rule.group] += rule.points;
    breakdown.appliedRules.push({ name: rule.name, points: rule.points });
  }

  breakdown.total = total;
  return { score: total, breakdown };
}

export function scoreAndRank(
  results: SearchResult[],
  companyName: string,
  companyDomain?: string
): ScoredCandidate[] {
  return results
    .map(r => {
      const rules = r.queryType === 'event' ? EVENT_SCORING_RULES : WEBINAR_SCORING_RULES;
      const { score, breakdown } = scoreResult(r, companyName, companyDomain, rules);
      return {
        url: r.url,
        domain: r.domain,
        title: r.title,
        snippet: r.snippet,
        score,
        scoreBreakdown: breakdown,
        queryType: r.queryType,
      } satisfies ScoredCandidate;
    })
    .sort((a, b) => b.score - a.score);
}
