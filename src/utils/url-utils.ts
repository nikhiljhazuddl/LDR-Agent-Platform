export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref', 'source'];
  stripParams.forEach(p => parsed.searchParams.delete(p));
  return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function normalizeDomain(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  try {
    const hostname = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.toLowerCase();
  }
}
