import type { SearchResult } from '../types.js';
import { normalizeUrl } from '../utils/url-utils.js';

export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  for (const r of results) {
    let normalized: string;
    try {
      normalized = normalizeUrl(r.url);
    } catch {
      continue;
    }
    if (!seen.has(normalized)) {
      seen.set(normalized, r);
    }
  }
  return Array.from(seen.values());
}

export function splitByType(results: SearchResult[]): { events: SearchResult[]; webinars: SearchResult[] } {
  const events: SearchResult[] = [];
  const webinars: SearchResult[] = [];
  for (const r of results) {
    if (r.queryType === 'event') events.push(r);
    else webinars.push(r);
  }
  return { events, webinars };
}

