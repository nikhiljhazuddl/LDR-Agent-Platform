import { describe, expect, it } from 'vitest';
import { detectRegistration } from '../../src/detection/registration-detector.js';
import type { PageAnalysis } from '../../src/types.js';

describe('registration-detector', () => {
  it('detects registration buttons and agenda', async () => {
    const analysis: PageAnalysis = {
      url: 'https://example.com',
      finalUrl: 'https://example.com',
      statusCode: 200,
      title: 'Example Summit',
      metaDescription: '',
      htmlContent: `
        <html>
          <body>
            <nav><a href="/agenda">Agenda</a></nav>
            <a href="/register">Register Now</a>
            <form action="/submit"><input type="email" name="email" /></form>
          </body>
        </html>
      `,
      scripts: [],
      stylesheets: [],
      networkRequests: [],
      cookies: [],
      formActions: ['/submit'],
      iframeUrls: [],
      registrationTargets: [{ text: 'Register Now', url: 'https://events.zuddl.com/example', source: 'link' }],
      globalVariables: [],
      loadTimeMs: 1,
      redirectChain: [],
    };

    const signals = await detectRegistration(analysis);
    expect(signals.found).toBe(true);
    expect(signals.registrationForms).toBe(1);
    expect(signals.agendaFound).toBe(true);
  });
});
