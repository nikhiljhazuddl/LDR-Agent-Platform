import axios from 'axios';
import { z } from 'zod';
import { getConfig } from '../config.js';
import type { SearchResult } from '../types.js';
import { getLogger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { withRetry } from '../utils/retry.js';
import { safeHostname } from '../utils/url-utils.js';

const SerperResponseSchema = z.object({
  organic: z
    .array(
      z.object({
        title: z.string().default(''),
        link: z.string(),
        snippet: z.string().default(''),
        position: z.number().int().default(0),
        domain: z.string().optional(),
      })
    )
    .default([]),
  searchParameters: z
    .object({
      q: z.string(),
    })
    .optional(),
});

export class SerperClient {
  private limiter = new RateLimiter({ requestsPerSecond: 1 });

  constructor(private readonly apiKey?: string) {}

  async search(params: {
    query: string;
    maxResults: number;
    queryType: 'event' | 'webinar' | 'field_event';
    signal?: AbortSignal;
  }): Promise<SearchResult[]> {
    const config = getConfig();
    const apiKey = this.apiKey ?? config.serperApiKey;
    if (!apiKey) throw new Error('Serper API key not configured');
    const logger = getLogger();

    const doRequest = async () => {
      if (params.signal?.aborted) throw new Error('Run stopped by user');
      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: params.query, num: params.maxResults },
        {
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
          },
          signal: params.signal,
          timeout: 30_000,
          validateStatus: () => true,
        }
      );

      if (response.status === 401) throw new Error('Serper: invalid API key (401)');
      if (response.status === 402) throw new Error('Serper: quota exceeded (402)');
      if (response.status === 429) throw new Error('Serper: rate limited (429)');
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Serper: HTTP ${response.status}`);
      }

      const parsed = SerperResponseSchema.safeParse(response.data);
      if (!parsed.success) throw new Error(`Serper: invalid response: ${parsed.error.message}`);

      return parsed.data;
    };

    const data = await this.limiter.schedule(() =>
      withRetry(doRequest, {
        maxRetries: 3,
        baseDelay: 800,
        maxDelay: 8_000,
        retryableErrors: ['429', 'timeout', 'ECONNRESET', 'ETIMEDOUT'],
      })
    );

    const results: SearchResult[] = data.organic.map(item => {
      const url = item.link;
      const domain = (item.domain || safeHostname(url)).toLowerCase();
      return {
        title: item.title,
        url,
        snippet: item.snippet || '',
        domain,
        position: item.position,
        query: params.query,
        queryType: params.queryType,
      };
    });

    logger.debug('serper.search.complete', {
      query: params.query,
      queryType: params.queryType,
      count: results.length,
    });

    return results;
  }
}
