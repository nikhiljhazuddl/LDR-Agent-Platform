import { describe, expect, it } from 'vitest';
import { generateEventQueries, generateWebinarQueries } from '../../src/search/query-generator.js';

describe('query-generator', () => {
  it('generates event queries with current/next year', () => {
    const year = new Date().getFullYear();
    const queries = generateEventQueries('Acme Corp', 'acme.com').map(q => q.query).join('\n');
    expect(queries).toContain(String(year));
    expect(queries).toContain(String(year + 1));
    expect(queries).toContain('site:acme.com conference');
  });

  it('generates webinar queries', () => {
    const queries = generateWebinarQueries('Acme Corp', 'acme.com').map(q => q.query);
    expect(queries.some(q => q.includes('webinar register'))).toBe(true);
    expect(queries.some(q => q.includes('site:acme.com webinar'))).toBe(true);
  });
});

