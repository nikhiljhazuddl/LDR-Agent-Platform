import type { Browser } from 'playwright';
import { getConfig } from './config.js';
import type {
  CompanyInput,
  CompanyResult,
  PageAnalysis,
  ProgressEvent,
  ProgressStage,
  RuntimeCredentials,
  ScoredCandidate,
  SearchQuery,
  SearchResult,
  TechDetectionResult,
} from './types.js';
import { SerperClient } from './search/serper-client.js';
import { generateEventQueries, generateWebinarQueries } from './search/query-generator.js';
import { deduplicateResults } from './search/candidate-collector.js';
import { scoreAndRank } from './scoring/url-scorer.js';
import { BrowserPool } from './crawler/browser-pool.js';
import { analyzePage } from './crawler/page-analyzer.js';
import { detectRegistration } from './detection/registration-detector.js';
import { detectTechnology } from './detection/tech-detector.js';
import { calculateConfidence } from './scoring/confidence-scorer.js';
import { buildResult } from './output/formatter.js';
import { aiResolveAmbiguity } from './ai/fallback.js';
import { getLogger } from './utils/logger.js';
import { ExcelClient } from './output/excel-client.js';
import fs from 'node:fs/promises';

type ProgressCallback = (event: ProgressEvent) => void;

function emitProgress(
  onProgress: ProgressCallback | undefined,
  stage: ProgressStage,
  message: string,
  company?: string,
  detail?: Record<string, unknown>
): void {
  onProgress?.({
    timestamp: new Date().toISOString(),
    stage,
    company,
    message,
    ...(detail ? { detail } : {}),
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Run stopped by user');
}

async function bufferResultLocally(result: CompanyResult, error: unknown): Promise<void> {
  const payload = {
    bufferedAt: new Date().toISOString(),
    error: (error as Error)?.message ?? String(error),
    result,
  };
  await fs.appendFile('results-buffer.jsonl', `${JSON.stringify(payload)}\n`, 'utf8');
}

async function executeAdaptiveSearch(
  serper: SerperClient,
  queries: SearchQuery[],
  companyName: string,
  companyDomain?: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const config = getConfig();
  const logger = getLogger();

  const byPriority = new Map<number, SearchQuery[]>();
  for (const q of queries) {
    byPriority.set(q.priority, [...(byPriority.get(q.priority) ?? []), q]);
  }

  const priorities = Array.from(byPriority.keys()).sort((a, b) => a - b);
  let all: SearchResult[] = [];

  for (const p of priorities) {
    throwIfAborted(signal);
    const batch = byPriority.get(p)!;
    emitProgress(onProgress, 'search', `Running priority ${p} ${batch[0]?.type ?? 'search'} queries`, companyName, {
      priority: p,
      queries: batch.map(q => q.query),
    });
    for (const q of batch) {
      throwIfAborted(signal);
      const results = await serper.search({ query: q.query, maxResults: config.maxSearchResults, queryType: q.type, signal });
      all = all.concat(results);
    }

    const deduped = deduplicateResults(all);
    const scored = scoreAndRank(deduped, companyName, companyDomain);
    const top = scored[0]?.score ?? 0;
    logger.debug('search.adaptive.progress', { priority: p, deduped: deduped.length, topScore: top });
    emitProgress(onProgress, 'search', `Collected ${deduped.length} unique ${batch[0]?.type ?? 'search'} candidates`, companyName, {
      topScore: top,
    });
    if (top > 80) break;
  }

  return deduplicateResults(all);
}

async function crawlCandidates(
  browserPool: BrowserPool,
  candidates: ScoredCandidate[],
  context: {
    companyName: string;
    type: 'event' | 'webinar';
    assetDir?: string;
    assetBaseUrl?: string;
    onProgress?: ProgressCallback;
    progressStart: number;
    progressEnd: number;
    signal?: AbortSignal;
  }
): Promise<PageAnalysis[]> {
  const analyses: PageAnalysis[] = new Array(candidates.length);

  for (let idx = 0; idx < candidates.length; idx++) {
    throwIfAborted(context.signal);
    const c = candidates[idx]!;
    const browser: Browser = await browserPool.acquire();
    const progressRange = context.progressEnd - context.progressStart;
    const progressPercent =
      candidates.length === 0
        ? context.progressEnd
        : Math.round(context.progressStart + (progressRange * idx) / candidates.length);
    const screenshotName = `${safeFilePart(context.companyName)}-${context.type}-${idx + 1}.png`;
    const screenshotPath = context.assetDir ? `${context.assetDir}/${screenshotName}` : undefined;
    const screenshotUrl = context.assetBaseUrl ? `${context.assetBaseUrl}/${screenshotName}` : undefined;

    emitProgress(context.onProgress, 'browser', `Opening ${context.type} candidate ${idx + 1}/${candidates.length}`, context.companyName, {
      url: c.url,
      candidateRank: idx + 1,
      candidateType: context.type,
      progressPercent,
    });

    try {
      analyses[idx] = await analyzePage(browser, c.url, { screenshotPath, screenshotUrl, signal: context.signal });
      emitProgress(context.onProgress, 'browser', `Captured ${context.type} page view`, context.companyName, {
        url: analyses[idx]!.finalUrl,
        title: analyses[idx]!.title,
        screenshotUrl: analyses[idx]!.screenshotUrl,
        candidateRank: idx + 1,
        candidateType: context.type,
        progressPercent: Math.min(
          context.progressEnd,
          Math.round(context.progressStart + (progressRange * (idx + 1)) / candidates.length)
        ),
      });
    } catch (error) {
      analyses[idx] = {
        url: c.url,
        finalUrl: c.url,
        statusCode: 0,
        title: '',
        metaDescription: '',
        htmlContent: '',
        scripts: [],
        stylesheets: [],
        networkRequests: [],
        cookies: [],
        formActions: [],
        iframeUrls: [],
        registrationTargets: [],
        globalVariables: [],
        loadTimeMs: 0,
        redirectChain: [],
        ...(screenshotUrl ? { screenshotUrl } : {}),
        error: (error as Error).message ?? String(error),
      };
      emitProgress(context.onProgress, 'browser', `Unable to crawl ${context.type} candidate ${idx + 1}`, context.companyName, {
        url: c.url,
        candidateRank: idx + 1,
        candidateType: context.type,
        error: (error as Error).message ?? String(error),
        progressPercent,
      });
    } finally {
      browserPool.release(browser);
    }
  }

  return analyses;
}

async function crawlRegistrationTargets(
  browserPool: BrowserPool,
  analyses: PageAnalysis[],
  context: {
    companyName: string;
    assetDir?: string;
    assetBaseUrl?: string;
    onProgress?: ProgressCallback;
    signal?: AbortSignal;
  }
): Promise<Array<PageAnalysis | null>> {
  const registrationAnalyses: Array<PageAnalysis | null> = [];

  for (let idx = 0; idx < analyses.length; idx++) {
    throwIfAborted(context.signal);
    const analysis = analyses[idx]!;
    const target = selectRegistrationTarget(analysis);
    if (!target) {
      registrationAnalyses[idx] = null;
      continue;
    }

    const browser = await browserPool.acquire();
    const screenshotName = `${safeFilePart(context.companyName)}-registration-${idx + 1}.png`;
    const screenshotPath = context.assetDir ? `${context.assetDir}/${screenshotName}` : undefined;
    const screenshotUrl = context.assetBaseUrl ? `${context.assetBaseUrl}/${screenshotName}` : undefined;

    emitProgress(context.onProgress, 'browser', `Opening registration target: ${target.text}`, context.companyName, {
      url: target.url,
      candidateRank: idx + 1,
      candidateType: 'registration',
      progressPercent: 74,
    });

    try {
      registrationAnalyses[idx] = await analyzePage(browser, target.url, {
        screenshotPath,
        screenshotUrl,
        signal: context.signal,
      });
      emitProgress(context.onProgress, 'browser', 'Captured registration page source and network evidence', context.companyName, {
        url: registrationAnalyses[idx]!.finalUrl,
        title: registrationAnalyses[idx]!.title,
        screenshotUrl: registrationAnalyses[idx]!.screenshotUrl,
        candidateRank: idx + 1,
        candidateType: 'registration',
        progressPercent: 75,
      });
    } catch (error) {
      registrationAnalyses[idx] = {
        url: target.url,
        finalUrl: target.url,
        statusCode: 0,
        title: '',
        metaDescription: '',
        htmlContent: '',
        scripts: [],
        stylesheets: [],
        networkRequests: [],
        cookies: [],
        formActions: [],
        iframeUrls: [],
        registrationTargets: [],
        globalVariables: [],
        loadTimeMs: 0,
        redirectChain: [],
        ...(screenshotUrl ? { screenshotUrl } : {}),
        error: (error as Error).message ?? String(error),
      };
    } finally {
      browserPool.release(browser);
    }
  }

  return registrationAnalyses;
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'company';
}

function selectRegistrationTarget(analysis: PageAnalysis): { text: string; url: string; source: string } | null {
  const pageUrl = safeUrl(analysis.finalUrl);
  const targets = analysis.registrationTargets
    .filter(target => {
      const targetUrl = safeUrl(target.url);
      if (!targetUrl) return false;
      if (!['http:', 'https:'].includes(targetUrl.protocol)) return false;
      if (pageUrl && targetUrl.href.replace(/#.*$/, '') === pageUrl.href.replace(/#.*$/, '')) return false;
      return true;
    })
    .sort((a, b) => scoreRegistrationTarget(b) - scoreRegistrationTarget(a));

  return targets[0] ?? null;
}

function scoreRegistrationTarget(target: { text: string; url: string }): number {
  const haystack = `${target.text} ${target.url}`.toLowerCase();
  let score = 0;
  if (/zuddl/.test(haystack)) score += 100;
  if (/register|registration/.test(haystack)) score += 60;
  if (/login|log in|sign in/.test(haystack)) score += 40;
  if (/ticket|attend|save my seat/.test(haystack)) score += 25;
  return score;
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function detectTechnologyWithRegistration(
  pageAnalysis: PageAnalysis,
  registrationAnalysis: PageAnalysis | null
): Promise<TechDetectionResult> {
  const pageTech = await detectTechnology(pageAnalysis);
  if (!registrationAnalysis) return pageTech;

  const registrationTech = await detectTechnology(registrationAnalysis);
  if (pageTech.platform === registrationTech.platform && pageTech.platform !== 'Unknown') {
    return {
      ...pageTech,
      confidence: Math.max(pageTech.confidence, registrationTech.confidence),
      evidence: [...pageTech.evidence, ...registrationTech.evidence],
    };
  }

  if (registrationTech.isKnownPlatform) return registrationTech;
  return pageTech;
}

function selectBestCandidate(
  candidates: ScoredCandidate[],
  registrations: Array<Awaited<ReturnType<typeof detectRegistration>>>,
  tech: Array<Awaited<ReturnType<typeof detectTechnology>>>,
  analyses: PageAnalysis[]
): number {
  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const r = registrations[i]!;
    const t = tech[i]!;
    const a = analyses[i]!;

    let score = c.score;
    if (isBlogLike(c, a)) score -= 100;
    if (isEventLandingLike(c, a)) score += 30;
    if (r.found) score += 30;
    if (!r.found) score -= 25;
    if (r.futureDate) score += 15;
    if (r.registrationButtons.length > 0) score += 15;
    if (r.registrationForms > 0) score += 10;
    score += (r.agendaFound ? 5 : 0) + (r.speakersFound ? 5 : 0) + (r.sponsorsFound ? 5 : 0);
    if (t.isKnownPlatform) score += 10;
    if (a.statusCode >= 400) score -= 10;
    if (a.statusCode === 0) score -= 5;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function isBlogLike(candidate: ScoredCandidate, analysis: PageAnalysis): boolean {
  const text = `${candidate.url} ${candidate.title} ${analysis.finalUrl} ${analysis.title}`.toLowerCase();
  return /\/(blog|blogs|news|press|resources|articles?|insights?)\//i.test(text) ||
    /\b(blog|article|press release|newsroom|recap|takeaways|highlights)\b/i.test(text);
}

function isEventLandingLike(candidate: ScoredCandidate, analysis: PageAnalysis): boolean {
  const text = `${candidate.url} ${candidate.title} ${analysis.finalUrl} ${analysis.title}`.toLowerCase();
  return /\/(events?|event|conference|summit|forum|register|registration)\b/i.test(text) ||
    /\b(register now|agenda|speakers|sponsors|venue|tickets|save my seat)\b/i.test(analysis.htmlContent.slice(0, 100_000));
}

export async function processCompany(
  company: CompanyInput,
  deps: {
    browserPool: BrowserPool;
    onProgress?: ProgressCallback;
    assetDir?: string;
    assetBaseUrl?: string;
    signal?: AbortSignal;
    credentials?: RuntimeCredentials;
  }
): Promise<CompanyResult> {
  const startTime = Date.now();
  const logger = getLogger();
  const config = getConfig();
  const serper = new SerperClient(deps.credentials?.serperApiKey);
  const hasLlmKey = Boolean(
    deps.credentials?.nvidiaApiKey ||
      deps.credentials?.anthropicApiKey ||
      config.nvidiaApiKey ||
      config.anthropicApiKey
  );

  logger.info('company.start', { company: company.name });
  throwIfAborted(deps.signal);
  emitProgress(deps.onProgress, 'queued', `Started ${company.name}`, company.name, { progressPercent: 0 });

  const eventQueries = generateEventQueries(company.name, company.domain);
  const webinarQueries = generateWebinarQueries(company.name, company.domain);

  const eventResults = await executeAdaptiveSearch(serper, eventQueries, company.name, company.domain, deps.onProgress, deps.signal);
  emitProgress(deps.onProgress, 'search', 'Event search complete', company.name, { progressPercent: 18 });
  const webinarResults = await executeAdaptiveSearch(serper, webinarQueries, company.name, company.domain, deps.onProgress, deps.signal);
  emitProgress(deps.onProgress, 'search', 'Webinar search complete', company.name, { progressPercent: 30 });
  throwIfAborted(deps.signal);

  emitProgress(deps.onProgress, 'scoring', 'Scoring and ranking candidates', company.name, {
    eventResults: eventResults.length,
    webinarResults: webinarResults.length,
    progressPercent: 35,
  });
  const scoredEvents = scoreAndRank(eventResults, company.name, company.domain);
  const scoredWebinars = scoreAndRank(webinarResults, company.name, company.domain);

  const topEventCandidates = scoredEvents.slice(0, 5);
  const topWebinarCandidates = scoredWebinars.slice(0, 2);

  emitProgress(deps.onProgress, 'crawl', 'Crawling top event and webinar candidates', company.name, {
    events: topEventCandidates.map(c => c.url),
    webinars: topWebinarCandidates.map(c => c.url),
    progressPercent: 40,
  });
  const eventAnalyses = await crawlCandidates(deps.browserPool, topEventCandidates, {
    companyName: company.name,
    type: 'event',
    assetDir: deps.assetDir,
    assetBaseUrl: deps.assetBaseUrl,
    onProgress: deps.onProgress,
    progressStart: 40,
    progressEnd: 62,
    signal: deps.signal,
  });
  const webinarAnalyses = await crawlCandidates(deps.browserPool, topWebinarCandidates, {
    companyName: company.name,
    type: 'webinar',
    assetDir: deps.assetDir,
    assetBaseUrl: deps.assetBaseUrl,
    onProgress: deps.onProgress,
    progressStart: 62,
    progressEnd: 72,
    signal: deps.signal,
  });

  throwIfAborted(deps.signal);
  const eventRegistrationPages = await crawlRegistrationTargets(deps.browserPool, eventAnalyses, {
    companyName: company.name,
    assetDir: deps.assetDir,
    assetBaseUrl: deps.assetBaseUrl,
    onProgress: deps.onProgress,
    signal: deps.signal,
  });

  emitProgress(deps.onProgress, 'registration', 'Detecting registration signals', company.name, { progressPercent: 76 });
  const eventRegistrations = await Promise.all(eventAnalyses.map(a => detectRegistration(a)));
  const webinarRegistrations = await Promise.all(webinarAnalyses.map(a => detectRegistration(a)));

  emitProgress(deps.onProgress, 'technology', 'Detecting event and webinar platforms', company.name, { progressPercent: 84 });
  const [eventTech, webinarTech] = await Promise.all([
    Promise.all(eventAnalyses.map((a, index) => detectTechnologyWithRegistration(a, eventRegistrationPages[index] ?? null))),
    Promise.all(webinarAnalyses.map(a => detectTechnology(a))),
  ]);

  let bestEventIdx = selectBestCandidate(topEventCandidates, eventRegistrations, eventTech, eventAnalyses);
  const bestWebinarIdx = selectBestCandidate(topWebinarCandidates, webinarRegistrations, webinarTech, webinarAnalyses);

  let confidence: { score: number; class: 'high' | 'medium' | 'review' } = {
    score: 0,
    class: 'review',
  };
  let aiUsed = false;

  if (bestEventIdx >= 0) {
    emitProgress(deps.onProgress, 'confidence', 'Calculating confidence score', company.name, { progressPercent: 92 });
    confidence = calculateConfidence({
      urlScore: topEventCandidates[bestEventIdx]!.score,
      registration: eventRegistrations[bestEventIdx]!,
      techDetection: eventTech[bestEventIdx]!,
      pageAnalysis: eventAnalyses[bestEventIdx]!,
    });

    if (confidence.score < 60 && hasLlmKey) {
      emitProgress(deps.onProgress, 'ai', 'Low confidence result; asking LLM to resolve ambiguity', company.name, {
        score: confidence.score,
        progressPercent: 94,
      });
      aiUsed = true;
      const aiResult = await aiResolveAmbiguity(company.name, topEventCandidates, eventAnalyses, deps.credentials);
      const aiIdx = topEventCandidates.findIndex(c => c.url === aiResult.selectedUrl);
      if (aiIdx >= 0) bestEventIdx = aiIdx;
    }
  }

  const result = buildResult(
    company,
    bestEventIdx >= 0 ? topEventCandidates[bestEventIdx]! : null,
    bestEventIdx >= 0 ? eventAnalyses[bestEventIdx]! : null,
    bestEventIdx >= 0 ? eventRegistrations[bestEventIdx]! : null,
    bestEventIdx >= 0 ? eventTech[bestEventIdx]! : null,
    bestWebinarIdx >= 0 ? topWebinarCandidates[bestWebinarIdx]! : null,
    bestWebinarIdx >= 0 ? webinarAnalyses[bestWebinarIdx]! : null,
    bestWebinarIdx >= 0 ? webinarTech[bestWebinarIdx]! : null,
    confidence,
    aiUsed,
    Date.now() - startTime
  );

  logger.info('company.complete', {
    company: company.name,
    eventFound: Boolean(result.eventUrl),
    technology: result.eventTechnology,
    confidence: result.confidenceScore,
    aiUsed: result.aiUsed,
    processingTimeMs: result.processingTimeMs,
  });
  emitProgress(deps.onProgress, 'complete', `Completed ${company.name}`, company.name, {
    eventUrl: result.eventUrl,
    eventTechnology: result.eventTechnology,
    confidenceScore: result.confidenceScore,
    result,
    progressPercent: 100,
  });

  return result;
}

export async function processBatch(params: {
  companies: CompanyInput[];
  dryRun: boolean;
  outputPath?: string;
  assetDir?: string;
  assetBaseUrl?: string;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  credentials?: RuntimeCredentials;
}): Promise<{ results: CompanyResult[] }> {
  const logger = getLogger();
  const config = getConfig();
  const serperApiKey = params.credentials?.serperApiKey ?? config.serperApiKey;
  if (!serperApiKey) throw new Error('Serper API key not configured');

  const excelClient = params.dryRun ? null : new ExcelClient(params.outputPath ?? config.excelOutputPath);

  const browserPool = new BrowserPool(1);
  await browserPool.initialize();

  const results: CompanyResult[] = [];

  try {
    for (let index = 0; index < params.companies.length; index++) {
      throwIfAborted(params.signal);
      const company = params.companies[index]!;
      emitProgress(params.onProgress, 'queued', `Company ${index + 1}/${params.companies.length}: ${company.name}`, company.name, {
        batchIndex: index + 1,
        batchTotal: params.companies.length,
        progressPercent: 0,
      });
      try {
        const result = await processCompany(company, {
          browserPool,
          onProgress: params.onProgress,
          assetDir: params.assetDir,
          assetBaseUrl: params.assetBaseUrl,
          signal: params.signal,
          credentials: { ...params.credentials, serperApiKey },
        });
        results.push(result);
        if (excelClient) {
          excelClient.appendResult(result);
          emitProgress(params.onProgress, 'output', 'Wrote result to Excel workbook', company.name, {
            outputPath: params.outputPath ?? config.excelOutputPath,
            result,
            progressPercent: 100,
          });
        }
      } catch (error) {
        const result = buildFailedResult(company, error);
        results.push(result);
        emitProgress(params.onProgress, 'error', `Failed ${company.name}`, company.name, {
          error: (error as Error).message ?? String(error),
          progressPercent: 100,
        });
        try {
          if (excelClient) excelClient.appendResult(result);
          emitProgress(params.onProgress, 'output', 'Wrote failed result to Excel workbook', company.name, {
            outputPath: params.outputPath ?? config.excelOutputPath,
            result,
            progressPercent: 100,
          });
        } catch (writeError) {
          logger.warn('excel.append.failed', { company: company.name, error: (writeError as Error).message ?? String(writeError) });
          await bufferResultLocally(result, writeError);
        }
      }
    }
  } finally {
    await browserPool.shutdown();
  }

  logger.info('batch.complete', { companies: params.companies.length, results: results.length });
  return { results };
}

function buildFailedResult(company: CompanyInput, error: unknown): CompanyResult {
  return {
    companyName: company.name,
    companyDomain: company.domain ?? '',
    eventName: null,
    eventUrl: null,
    registrationUrl: null,
    eventDate: null,
    eventType: 'unknown',
    eventTechnology: null,
    eventTechnologySource: 'No result; company failed before platform detection',
    eventTechEvidence: '[]',
    eventTechConfidence: 0,
    eventSelectionSource: 'No result; company failed before event selection',
    registrationFound: false,
    agendaFound: false,
    speakerPageFound: false,
    sponsorPageFound: false,
    webinarName: null,
    webinarUrl: null,
    webinarTechnology: null,
    webinarTechnologySource: 'No result; company failed before webinar detection',
    webinarTechEvidence: '[]',
    confidenceScore: 0,
    confidenceClass: 'review',
    lastUpdated: new Date().toISOString(),
    researchStatus: 'failed',
    processingTimeMs: 0,
    aiUsed: false,
    errorNotes: (error as Error).message ?? String(error),
  };
}
