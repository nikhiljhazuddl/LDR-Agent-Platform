import { describe, expect, it } from 'vitest';
import { detectTechnology } from '../../src/detection/tech-detector.js';
import type { PageAnalysis } from '../../src/types.js';

describe('tech-detector', () => {
  it('detects Cvent from network and cookies', async () => {
    const analysis: PageAnalysis = {
      url: 'https://example.com/event',
      finalUrl: 'https://example.com/event',
      statusCode: 200,
      title: 'Example Event',
      metaDescription: '',
      htmlContent: '<html><head></head><body></body></html>',
      scripts: [{ src: 'https://cdn.example.com/app.js', inline: false }],
      stylesheets: [],
      networkRequests: [
        { url: 'https://api.cvent.com/v1/events', method: 'GET', resourceType: 'xhr', domain: 'api.cvent.com' },
      ],
      cookies: [{ name: 'cvent_session', value: 'x', domain: '.example.com' }],
      formActions: [],
      iframeUrls: [],
      registrationTargets: [],
      globalVariables: [],
      loadTimeMs: 123,
      redirectChain: [],
    };

    const detected = await detectTechnology(analysis);
    expect(detected.platform).toBe('Cvent');
    expect(detected.isKnownPlatform).toBe(true);
    expect(detected.evidence.length).toBeGreaterThan(0);
  });

  it('does not report a platform from weak HTML-only evidence', async () => {
    const analysis: PageAnalysis = {
      url: 'https://example.com/event',
      finalUrl: 'https://example.com/event',
      statusCode: 200,
      title: 'Example Event',
      metaDescription: '',
      htmlContent: '<html><body><div class="eventbrite-layout"></div></body></html>',
      scripts: [],
      stylesheets: [],
      networkRequests: [],
      cookies: [],
      formActions: [],
      iframeUrls: [],
      registrationTargets: [],
      globalVariables: [],
      loadTimeMs: 123,
      redirectChain: [],
    };

    const detected = await detectTechnology(analysis);
    expect(detected.platform).toBe('Unknown');
    expect(detected.isKnownPlatform).toBe(false);
  });

  it('detects Zuddl from registration page source and network signals', async () => {
    const analysis: PageAnalysis = {
      url: 'https://events.zuddl.com/findhelp/register',
      finalUrl: 'https://events.zuddl.com/findhelp/register',
      statusCode: 200,
      title: 'Findhelp Conference Registration',
      metaDescription: '',
      htmlContent: '<html><script>window.__zuddl = { eventId: "findhelp" }</script></html>',
      scripts: [{ src: 'https://cdn.zuddl.com/event-app.js', inline: false }],
      stylesheets: [],
      networkRequests: [
        { url: 'https://api.zuddl.com/events/findhelp', method: 'GET', resourceType: 'xhr', domain: 'api.zuddl.com' },
      ],
      cookies: [],
      formActions: ['https://events.zuddl.com/findhelp/register'],
      iframeUrls: [],
      registrationTargets: [],
      globalVariables: ['__zuddl'],
      loadTimeMs: 100,
      redirectChain: [],
    };

    const detected = await detectTechnology(analysis);
    expect(detected.platform).toBe('Zuddl');
    expect(detected.isKnownPlatform).toBe(true);
  });
});
