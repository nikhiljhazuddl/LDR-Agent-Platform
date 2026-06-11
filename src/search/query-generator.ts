import type { SearchQuery } from '../types.js';

export function generateEventQueries(company: string, domain?: string): SearchQuery[] {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;

  const queries: SearchQuery[] = [
    { query: `"${company}" annual conference ${nextYear}`, type: 'event', priority: 1 },
    { query: `"${company}" summit ${nextYear}`, type: 'event', priority: 1 },
    { query: `"${company}" annual conference ${currentYear}`, type: 'event', priority: 1 },

    { query: `"${company}" user conference`, type: 'event', priority: 2 },
    { query: `"${company}" flagship event`, type: 'event', priority: 2 },
    { query: `"${company}" annual event ${nextYear}`, type: 'event', priority: 2 },

    { query: `"${company}" event registration ${nextYear}`, type: 'event', priority: 3 },
    { query: `"${company}" conference registration`, type: 'event', priority: 3 },

    ...(domain
      ? [
          { query: `site:${domain} conference`, type: 'event' as const, priority: 4 },
          { query: `site:${domain} summit`, type: 'event' as const, priority: 4 },
          { query: `site:${domain} event registration`, type: 'event' as const, priority: 4 },
        ]
      : []),
  ];

  return queries;
}

export function generateWebinarQueries(company: string, domain?: string): SearchQuery[] {
  return [
    { query: `"${company}" webinar register`, type: 'webinar', priority: 1 },
    { query: `"${company}" upcoming webinar`, type: 'webinar', priority: 1 },
    { query: `"${company}" live webinar`, type: 'webinar', priority: 2 },
    { query: `"${company}" webinar ${new Date().getFullYear()}`, type: 'webinar', priority: 2 },
    ...(domain
      ? [
          { query: `site:${domain} webinar`, type: 'webinar' as const, priority: 3 },
          { query: `site:${domain} webinar register`, type: 'webinar' as const, priority: 3 },
        ]
      : []),
  ];
}

export function generateFieldEventQueries(company: string, domain?: string): SearchQuery[] {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const years = [nextYear, currentYear, currentYear - 1];
  const baseTerms = [
    'roadshow',
    'workshop',
    'meetup',
    'user group',
    'training',
    'community event',
    'local event',
    'regional tour',
    'customer event',
    'field event',
  ];

  const queries: SearchQuery[] = [];
  for (const [index, year] of years.entries()) {
    for (const term of baseTerms.slice(0, index === 0 ? 7 : 5)) {
      queries.push({ query: `"${company}" "${term}" ${year}`, type: 'field_event', priority: index + 1 });
    }
  }

  if (domain) {
    const paths = ['events', 'roadshow', 'workshop', 'meetup', 'training', 'usergroup', 'community/events', 'customers/events'];
    for (const path of paths) {
      queries.push({ query: `site:${domain}/${path} ${currentYear} OR ${nextYear}`, type: 'field_event', priority: 1 });
    }
    queries.push({ query: `site:${domain} RSVP workshop roadshow meetup`, type: 'field_event', priority: 2 });
  }

  queries.push(
    { query: `"${company}" "join us in" RSVP`, type: 'field_event', priority: 2 },
    { query: `"${company}" "customer roadshow"`, type: 'field_event', priority: 2 },
    { query: `"${company}" "local workshop"`, type: 'field_event', priority: 2 }
  );

  return queries;
}
