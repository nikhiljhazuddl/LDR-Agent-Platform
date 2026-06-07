import { describe, expect, it } from 'vitest';
import { scoreAndRank } from '../../src/scoring/url-scorer.js';
import type { SearchResult } from '../../src/types.js';

describe('url-scorer', () => {
  it('ranks official domain event pages above news', () => {
    const company = 'Snowflake';
    const domain = 'snowflake.com';
    const results: SearchResult[] = [
      {
        title: 'Snowflake Summit 2026 - Register Now',
        url: 'https://summit.snowflake.com/register',
        snippet: 'Join us June 2026',
        domain: 'summit.snowflake.com',
        position: 1,
        query: 'q',
        queryType: 'event',
      },
      {
        title: 'Snowflake announces Summit',
        url: 'https://techcrunch.com/2026/01/01/snowflake-summit/',
        snippet: 'Recap',
        domain: 'techcrunch.com',
        position: 2,
        query: 'q',
        queryType: 'event',
      },
    ];

    const ranked = scoreAndRank(results, company, domain);
    expect(ranked[0]!.domain).toContain('snowflake.com');
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });
});

