import { google, type gmail_v1 } from 'googleapis';
import { getConfig } from '../config.js';
import type { WebinarRegistrationProfile } from '../types.js';

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface WebinarEmailMatch {
  messageId: string;
  subject: string;
  from: string;
  link: string;
}

export class GmailClient {
  private gmail: gmail_v1.Gmail;

  constructor() {
    const config = getConfig();
    if (config.gmailOAuthClientId && config.gmailOAuthClientSecret && config.gmailOAuthRefreshToken) {
      const auth = new google.auth.OAuth2(
        config.gmailOAuthClientId,
        config.gmailOAuthClientSecret,
        config.gmailOAuthRedirectUri
      );
      auth.setCredentials({ refresh_token: config.gmailOAuthRefreshToken });
      this.gmail = google.gmail({ version: 'v1', auth });
      return;
    }

    if (!config.gmailServiceAccountEmail || !config.gmailServiceAccountKey || !config.gmailImpersonateEmail) {
      throw new Error('Gmail OAuth refresh token or domain delegation is not configured');
    }
    const auth = new google.auth.JWT({
      email: config.gmailServiceAccountEmail,
      key: normalizePrivateKey(config.gmailServiceAccountKey),
      scopes: [GMAIL_READONLY_SCOPE],
      subject: config.gmailImpersonateEmail,
    });
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  static isConfigured(): boolean {
    const config = getConfig();
    return Boolean(
      (config.gmailOAuthClientId && config.gmailOAuthClientSecret && config.gmailOAuthRefreshToken) ||
        (config.gmailServiceAccountEmail && config.gmailServiceAccountKey && config.gmailImpersonateEmail)
    );
  }

  static getOAuthAuthorizationUrl(): string {
    const config = getConfig();
    if (!config.gmailOAuthClientId || !config.gmailOAuthClientSecret || !config.gmailOAuthRedirectUri) {
      throw new Error('Missing Gmail OAuth client ID, client secret, or redirect URI');
    }
    const auth = new google.auth.OAuth2(
      config.gmailOAuthClientId,
      config.gmailOAuthClientSecret,
      config.gmailOAuthRedirectUri
    );
    return auth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [GMAIL_READONLY_SCOPE],
      include_granted_scopes: true,
    });
  }

  static async exchangeOAuthCode(code: string): Promise<string> {
    const config = getConfig();
    if (!config.gmailOAuthClientId || !config.gmailOAuthClientSecret || !config.gmailOAuthRedirectUri) {
      throw new Error('Missing Gmail OAuth client ID, client secret, or redirect URI');
    }
    const auth = new google.auth.OAuth2(
      config.gmailOAuthClientId,
      config.gmailOAuthClientSecret,
      config.gmailOAuthRedirectUri
    );
    const { tokens } = await auth.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh token. Revoke prior consent or use prompt=consent and try again.');
    }
    return tokens.refresh_token;
  }

  async waitForWebinarEmail(params: {
    profile: WebinarRegistrationProfile;
    companyName: string;
    webinarUrl: string;
    submittedAfter: Date;
    signal?: AbortSignal;
  }): Promise<WebinarEmailMatch | null> {
    const config = getConfig();
    const deadline = Date.now() + config.gmailPollTimeoutMs;

    while (Date.now() < deadline) {
      if (params.signal?.aborted) throw new Error('Run stopped by user');
      const match = await this.findRecentWebinarEmail(params);
      if (match) return match;
      await wait(config.gmailPollIntervalMs, params.signal);
    }

    return null;
  }

  private async findRecentWebinarEmail(params: {
    profile: WebinarRegistrationProfile;
    companyName: string;
    webinarUrl: string;
    submittedAfter: Date;
  }): Promise<WebinarEmailMatch | null> {
    const afterSeconds = Math.max(0, Math.floor(params.submittedAfter.getTime() / 1000) - 60);
    const domain = safeHostname(params.webinarUrl);
    const profileTerms = [params.profile.email, params.profile.company, params.companyName, domain]
      .filter(Boolean)
      .map(term => `"${String(term).replaceAll('"', '')}"`);
    const query = [`after:${afterSeconds}`, '(webinar OR webcast OR event OR watch OR join OR registration OR confirmation)'];
    if (profileTerms.length > 0) query.push(`(${profileTerms.join(' OR ')})`);

    const list = await this.gmail.users.messages.list({
      userId: 'me',
      q: query.join(' '),
      maxResults: 10,
    });

    const messages = list.data.messages ?? [];
    const candidates: WebinarEmailMatch[] = [];
    for (const message of messages) {
      if (!message.id) continue;
      const full = await this.gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full',
      });
      const parsed = parseMessage(full.data);
      const link = pickBestWebinarLink(parsed.links, params.webinarUrl);
      if (!link) continue;
      candidates.push({
        messageId: message.id,
        subject: parsed.subject,
        from: parsed.from,
        link,
      });
    }

    return candidates[0] ?? null;
  }
}

function parseMessage(message: gmail_v1.Schema$Message): { subject: string; from: string; links: string[] } {
  const headers = message.payload?.headers ?? [];
  const subject = headers.find(header => header.name?.toLowerCase() === 'subject')?.value ?? '';
  const from = headers.find(header => header.name?.toLowerCase() === 'from')?.value ?? '';
  const body = collectBodyText(message.payload);
  return { subject, from, links: extractLinks(body) };
}

function collectBodyText(part?: gmail_v1.Schema$MessagePart): string {
  if (!part) return '';
  const chunks: string[] = [];
  if (part.body?.data) chunks.push(decodeBase64Url(part.body.data));
  for (const child of part.parts ?? []) {
    chunks.push(collectBodyText(child));
  }
  return chunks.join('\n');
}

function extractLinks(text: string): string[] {
  const decoded = decodeHtmlEntities(text);
  const links = new Set<string>();
  const hrefPattern = /href=["']([^"']+)["']/gi;
  const urlPattern = /https?:\/\/[^\s<>"')]+/gi;
  for (const match of decoded.matchAll(hrefPattern)) links.add(cleanLink(match[1]!));
  for (const match of decoded.matchAll(urlPattern)) links.add(cleanLink(match[0]!));
  return Array.from(links).filter(link => link.startsWith('http'));
}

function pickBestWebinarLink(links: string[], webinarUrl: string): string | null {
  const originHost = safeHostname(webinarUrl);
  const scored = links
    .filter(link => !isUtilityLink(link))
    .map(link => ({ link, score: scoreLink(link, originHost) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.link ?? null;
}

function scoreLink(link: string, originHost: string): number {
  const lower = link.toLowerCase();
  let score = 0;
  if (/webinar|webcast|event|join|watch|view|attend|launch|on-demand|ondemand|recording|session/.test(lower)) score += 50;
  if (/register|registration|confirmation|thank/.test(lower)) score += 20;
  if (/zoom|on24|gotowebinar|webex|zuddl|brighttalk|bigmarker|livestorm|demio|goldcast|cvent|bizzabo/.test(lower)) score += 40;
  if (originHost && lower.includes(originHost.replace(/^www\./, ''))) score += 10;
  return score;
}

function isUtilityLink(link: string): boolean {
  return /unsubscribe|preferences|privacy|terms|calendar|ics|mailto:|facebook|linkedin|twitter|x\.com/i.test(link);
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanLink(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/[.,;]+$/, '');
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function normalizePrivateKey(key: string): string {
  return key.replace(/\\n/g, '\n');
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Run stopped by user'));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new Error('Run stopped by user'));
      },
      { once: true }
    );
  });
}
