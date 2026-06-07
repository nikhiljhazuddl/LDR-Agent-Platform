import type { PageAnalysis } from '../types.js';

export function detectUnknownPlatform(analysis: PageAnalysis): { suspectedVendor: string | null } {
  const exclude = [
    'google',
    'facebook',
    'twitter',
    'linkedin',
    'doubleclick',
    'cloudflare',
    'cloudfront',
    'amazonaws',
    'akamai',
    'fastly',
    'segment',
    'mixpanel',
    'hotjar',
    'hubspot',
    'marketo',
    'salesforce',
    'pardot',
    'intercom',
    'drift',
    'zendesk',
    'stripe',
    'fonts.googleapis',
    'jquery',
    'unpkg',
    'cdnjs',
    'datadoghq',
    'newrelic',
    'sentry',
  ];

  const thirdPartyDomains = analysis.networkRequests
    .filter(r => ['xhr', 'fetch'].includes(r.resourceType))
    .map(r => r.domain)
    .filter(d => !exclude.some(e => d.includes(e)));

  const apiDomains = thirdPartyDomains.filter(d => d.startsWith('api.'));

  const pageDomain = new URL(analysis.finalUrl).hostname;
  const externalForms = analysis.formActions.filter(action => {
    try {
      return new URL(action).hostname !== pageDomain;
    } catch {
      return false;
    }
  });

  const unknownIframes = analysis.iframeUrls.filter(src => {
    try {
      return new URL(src).hostname !== pageDomain;
    } catch {
      return false;
    }
  });

  const suspected = apiDomains[0] || externalForms[0] || unknownIframes[0] || null;
  if (!suspected) return { suspectedVendor: null };

  try {
    return { suspectedVendor: new URL(suspected).hostname };
  } catch {
    return { suspectedVendor: null };
  }
}

