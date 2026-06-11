import type { Browser } from 'playwright';
import type { CookieInfo, NetworkRequest, PageAnalysis, RegistrationTarget, ScriptInfo, WebinarRegistrationProfile } from '../types.js';
import { getConfig } from '../config.js';
import { getRandomUserAgent } from './user-agents.js';

const DEFAULT_WINDOW_KEYS = new Set([
  'chrome',
  'performance',
  'navigator',
  'location',
  'document',
  'window',
  'self',
  'top',
  'parent',
  'frames',
  'screen',
  'history',
  'localStorage',
  'sessionStorage',
  'console',
  'alert',
  'confirm',
  'prompt',
  'fetch',
  'XMLHttpRequest',
  'Intl',
  'crypto',
  'webkitURL',
  'URL',
  'URLSearchParams',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'MutationObserver',
  'IntersectionObserver',
]);

const CTA_PATTERN = /\b(register|registration|login|log in|sign in|sign up|attend|tickets?|reserve|save my seat)\b/i;

export async function analyzePage(
  browser: Browser,
  url: string,
  options?: {
    screenshotPath?: string;
    screenshotUrl?: string;
    signal?: AbortSignal;
    webinarRegistrationProfile?: WebinarRegistrationProfile;
    onScreenshot?: (detail: { url: string; screenshotUrl: string; capturedAt: string }) => void;
  }
): Promise<PageAnalysis> {
  const config = getConfig();
  if (options?.signal?.aborted) throw new Error('Run stopped by user');

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: getRandomUserAgent(),
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page = await context.newPage();
  const networkRequests: NetworkRequest[] = [];
  const redirectChain: string[] = [];
  const abortHandler = () => {
    context.close().catch(() => undefined);
  };
  options?.signal?.addEventListener('abort', abortHandler, { once: true });

  page.on('request', request => {
    const reqUrl = request.url();
    const resourceType = request.resourceType();
    if (!['xhr', 'fetch', 'websocket', 'script', 'stylesheet'].includes(resourceType)) return;
    try {
      const parsed = new URL(reqUrl);
      networkRequests.push({
        url: reqUrl,
        method: request.method(),
        resourceType,
        domain: parsed.hostname,
      });
    } catch {
      // ignore
    }
  });

  page.on('response', response => {
    const status = response.status();
    if ([301, 302, 303, 307, 308].includes(status)) {
      redirectChain.push(response.url());
    }
  });

  const stopScreenshotStream = startScreenshotStream(page, options);

  const startTime = Date.now();
  let statusCode = 0;
  let errorNote: string | undefined;

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: config.pageLoadTimeout });
    if (options?.signal?.aborted) throw new Error('Run stopped by user');
    statusCode = response?.status() ?? 0;
    await page.waitForTimeout(config.networkIdleWait);
  } catch (error) {
    if (options?.signal?.aborted) {
      options.signal.removeEventListener('abort', abortHandler);
      stopScreenshotStream();
      await context.close().catch(() => undefined);
      throw new Error('Run stopped by user');
    }
    const message = (error as Error).message ?? String(error);
    errorNote = message;
    if (message.toLowerCase().includes('timeout')) {
      statusCode = 0;
    } else {
      stopScreenshotStream();
      await context.close();
      throw error;
    }
  }

  const loadTimeMs = Date.now() - startTime;

  let formSubmitStatus: PageAnalysis['formSubmitStatus'];
  if (options?.webinarRegistrationProfile) {
    formSubmitStatus = await fillAndSubmitWebinarForm(page, options.webinarRegistrationProfile).catch(error => ({
      attempted: true,
      submitted: false,
      message: (error as Error).message ?? String(error),
    }));
    if (formSubmitStatus.submitted) {
      await page.waitForTimeout(config.networkIdleWait).catch(() => undefined);
    }
  }

  const finalUrl = page.url();

  const title = await page.title().catch(() => '');
  const metaDescription = await page
    .$eval('meta[name="description"]', el => el.getAttribute('content') ?? '')
    .catch(() => '');

  const htmlContent = await page.content().catch(() => '');
  const truncatedHtml = htmlContent.substring(0, 500_000);

  const scripts: ScriptInfo[] = await page
    .$$eval('script', scripts =>
      scripts.map(s => ({
        src: (s as HTMLScriptElement).src || '',
        inline: !(s as HTMLScriptElement).src,
        content: !(s as HTMLScriptElement).src ? (s.textContent?.substring(0, 2000) ?? '') : undefined,
      }))
    )
    .catch(() => []);

  const stylesheets: string[] = await page
    .$$eval('link[rel="stylesheet"]', links =>
      links.map(l => (l as HTMLLinkElement).href).filter(Boolean)
    )
    .catch(() => []);

  const rawCookies = await context.cookies().catch(() => []);
  const cookies: CookieInfo[] = rawCookies.map(c => ({
    name: c.name,
    value: c.value.substring(0, 200),
    domain: c.domain,
  }));

  const formActions: string[] = await page
    .$$eval('form', forms => forms.map(f => (f as HTMLFormElement).action).filter(Boolean))
    .catch(() => []);

  const registrationTargets: RegistrationTarget[] = await extractRegistrationTargets(page).catch(() => []);

  const iframeUrls: string[] = await page
    .$$eval('iframe', iframes => iframes.map(f => (f as HTMLIFrameElement).src).filter(Boolean))
    .catch(() => []);

  const globalVariables: string[] = await page
    .evaluate(defaultKeys => {
      const defaults = new Set(defaultKeys as string[]);
      const keys = Object.keys(window as unknown as Record<string, unknown>)
        .filter(k => !defaults.has(k))
        .slice(0, 100);
      return keys;
    }, Array.from(DEFAULT_WINDOW_KEYS))
    .catch(() => []);

  if (options?.screenshotPath) {
    await page.screenshot({ path: options.screenshotPath, fullPage: false }).catch(() => undefined);
  }

  const clickedTarget = await clickRegistrationTarget(page, finalUrl).catch(() => null);
  if (clickedTarget) registrationTargets.unshift(clickedTarget);

  options?.signal?.removeEventListener('abort', abortHandler);
  stopScreenshotStream();
  await context.close();

  return {
    url,
    finalUrl,
    statusCode,
    title,
    metaDescription,
    htmlContent: truncatedHtml,
    scripts,
    stylesheets,
    networkRequests,
    cookies,
    formActions,
    iframeUrls,
    registrationTargets,
    globalVariables,
    loadTimeMs,
    redirectChain,
    ...(formSubmitStatus ? { formSubmitStatus } : {}),
    ...(options?.screenshotUrl ? { screenshotUrl: options.screenshotUrl } : {}),
    ...(errorNote ? { error: errorNote } : {}),
  };
}

function startScreenshotStream(
  page: import('playwright').Page,
  options?: {
    screenshotPath?: string;
    screenshotUrl?: string;
    onScreenshot?: (detail: { url: string; screenshotUrl: string; capturedAt: string }) => void;
  }
): () => void {
  if (!options?.screenshotPath || !options.screenshotUrl || !options.onScreenshot) return () => undefined;
  const screenshotPath = options.screenshotPath;
  const screenshotUrl = options.screenshotUrl;
  const onScreenshot = options.onScreenshot;

  let stopped = false;
  let capturing = false;
  const capture = async () => {
    if (stopped || capturing || page.isClosed()) return;
    capturing = true;
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 2500 });
      onScreenshot({
        url: page.url(),
        screenshotUrl,
        capturedAt: new Date().toISOString(),
      });
    } catch {
      // Best-effort stream only.
    } finally {
      capturing = false;
    }
  };

  void capture();
  const interval = setInterval(() => void capture(), 1000);
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

async function extractRegistrationTargets(page: import('playwright').Page): Promise<RegistrationTarget[]> {
  const targets = await page.$$eval(
    'a, form',
    elements =>
      elements
        .map(el => {
          const tagName = el.tagName.toLowerCase();
          if (tagName === 'a') {
            const anchor = el as HTMLAnchorElement;
            const text = anchor.textContent?.replace(/\s+/g, ' ').trim() || anchor.getAttribute('aria-label') || '';
            return {
              text,
              url: anchor.href,
              source: 'link' as const,
            };
          }
          const form = el as HTMLFormElement;
          const text = form.textContent?.replace(/\s+/g, ' ').trim() || 'form';
          return {
            text,
            url: form.action,
            source: 'form' as const,
          };
        })
        .filter(target => target.url && /\b(register|registration|login|log in|sign in|sign up|attend|tickets?|reserve|save my seat)\b/i.test(`${target.text} ${target.url}`))
        .slice(0, 8)
  );

  return dedupeTargets(targets);
}

async function clickRegistrationTarget(page: import('playwright').Page, originalUrl: string): Promise<RegistrationTarget | null> {
  const candidates = await page.locator('a, button, [role="button"], input[type="button"], input[type="submit"]').evaluateAll(elements =>
    elements
      .map((el, index) => {
        const input = el as HTMLInputElement;
        const text = (input.value || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        return { index, text };
      })
      .filter(candidate => /\b(register|registration|login|log in|sign in|sign up|attend|tickets?|reserve|save my seat)\b/i.test(candidate.text))
      .slice(0, 5)
  );

  for (const candidate of candidates) {
    const element = page.locator('a, button, [role="button"], input[type="button"], input[type="submit"]').nth(candidate.index);
    const beforeUrl = page.url();
    const popupPromise = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
    const navigationPromise = page.waitForURL(url => url.toString() !== beforeUrl, { timeout: 4000 }).catch(() => null);
    await element.click({ timeout: 4000 }).catch(() => undefined);
    const popup = await popupPromise;
    await navigationPromise;
    const clickedUrl = popup?.url() || page.url();
    if (popup) await popup.close().catch(() => undefined);
    if (clickedUrl && clickedUrl !== beforeUrl && clickedUrl !== originalUrl && !clickedUrl.startsWith('about:')) {
      return { text: candidate.text, url: clickedUrl, source: 'click' };
    }
  }

  return null;
}

async function fillAndSubmitWebinarForm(
  page: import('playwright').Page,
  profile: WebinarRegistrationProfile
): Promise<NonNullable<PageAnalysis['formSubmitStatus']>> {
  const fields = await page.locator('input, textarea, select').evaluateAll(elements =>
    elements.map((el, index) => {
      const input = el as HTMLInputElement;
      const id = input.id || '';
      const label = id
        ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.replace(/\s+/g, ' ').trim() || ''
        : '';
      const nearby = input.closest('label, div, p, li')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      return {
        index,
        tag: el.tagName.toLowerCase(),
        type: input.type || '',
        name: input.name || '',
        id,
        placeholder: input.placeholder || '',
        ariaLabel: input.getAttribute('aria-label') || '',
        label,
        nearby,
        required: input.required || input.getAttribute('aria-required') === 'true',
      };
    })
  );

  const filled: string[] = [];
  for (const field of fields) {
    if (['hidden', 'submit', 'button', 'reset', 'file', 'password'].includes(field.type)) continue;
    const value = valueForField(field, profile);
    if (!value) continue;
    const locator = page.locator('input, textarea, select').nth(field.index);
    if (field.tag === 'select') {
      await locator.selectOption({ label: value }).catch(async () => {
        await locator.selectOption(value).catch(() => undefined);
      });
    } else {
      await locator.fill(value, { timeout: 3000 }).catch(() => undefined);
    }
    filled.push(field.name || field.id || field.placeholder || field.label || field.type);
  }

  for (const field of fields.filter(f => f.type === 'checkbox' && f.required)) {
    await page.locator('input, textarea, select').nth(field.index).check({ timeout: 2000 }).catch(() => undefined);
  }

  const submit = await findSubmitCandidate(page);
  if (!submit) {
    return {
      attempted: true,
      submitted: false,
      fieldsFilled: filled,
      message: filled.length > 0 ? 'Filled fields but no submit button was detected' : 'No fillable webinar form was detected',
    };
  }

  const beforeUrl = page.url();
  const navigationPromise = page.waitForURL(url => url.toString() !== beforeUrl, { timeout: 10_000 }).catch(() => null);
  await submit.click({ timeout: 5000 }).catch(() => undefined);
  await navigationPromise;
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

  const postSubmitUrl = page.url();
  const text = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).toLowerCase();
  const emailLikelySent = /\b(email|inbox|gmail|sent|check your|confirmation|link has been sent)\b/i.test(text);
  const watchLikelyOpen = /\b(watch now|join now|play|player|webinar is starting|on demand|recording)\b/i.test(text);

  return {
    attempted: true,
    submitted: true,
    fieldsFilled: filled,
    postSubmitUrl,
    emailLikelySent,
    message: watchLikelyOpen
      ? 'Submitted and webinar/watch page appears to be available'
      : emailLikelySent
        ? 'Submitted and page indicates an email link was sent'
        : 'Submitted webinar form',
  };
}

async function findSubmitCandidate(page: import('playwright').Page): Promise<import('playwright').Locator | null> {
  const candidates = await page
    .locator('button, input[type="submit"], input[type="button"], [role="button"]')
    .evaluateAll(elements =>
      elements
        .map((el, index) => {
          const input = el as HTMLInputElement;
          const text = (input.value || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          return { index, text };
        })
        .filter(candidate => /\b(register|submit|watch|join|continue|send|access|get link|view)\b/i.test(candidate.text))
        .slice(0, 5)
    )
    .catch(() => []);

  if (candidates.length === 0) return null;
  return page.locator('button, input[type="submit"], input[type="button"], [role="button"]').nth(candidates[0]!.index);
}

function valueForField(
  field: {
    type: string;
    name: string;
    id: string;
    placeholder: string;
    ariaLabel: string;
    label: string;
    nearby: string;
  },
  profile: WebinarRegistrationProfile
): string | null {
  const text = `${field.name} ${field.id} ${field.placeholder} ${field.ariaLabel} ${field.label} ${field.nearby}`.toLowerCase();
  const fullName = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  if (field.type === 'email' || /\be-?mail\b/.test(text)) return profile.email ?? null;
  if (/\bfirst\b/.test(text)) return profile.firstName || splitName(fullName).first || null;
  if (/\blast\b/.test(text)) return profile.lastName || splitName(fullName).last || null;
  if (/\b(full\s*)?name\b/.test(text) && !/\bcompany\b/.test(text)) return fullName || null;
  if (/\b(company|organization|organisation|account)\b/.test(text)) return profile.company ?? null;
  if (/\b(job title|title|role|designation|position)\b/.test(text)) return profile.title ?? null;
  if (/\b(phone|mobile|telephone|tel)\b/.test(text)) return profile.phone ?? null;
  if (/\b(country|region)\b/.test(text)) return profile.country ?? null;
  return null;
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] ?? '',
    last: parts.slice(1).join(' '),
  };
}

function dedupeTargets(targets: RegistrationTarget[]): RegistrationTarget[] {
  const seen = new Set<string>();
  const out: RegistrationTarget[] = [];
  for (const target of targets) {
    const key = target.url.replace(/#.*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}
