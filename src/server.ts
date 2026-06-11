import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.js';
import { processBatch } from './orchestrator.js';
import { RESULT_HEADERS, resultToRow } from './output/result-columns.js';
import { GmailClient } from './email/gmail-client.js';
import type { CompanyInput, CompanyResult, ProgressEvent, RuntimeCredentials, WebinarRegistrationProfile } from './types.js';
import { normalizeDomain } from './utils/url-utils.js';

interface Job {
  id: string;
  status: 'running' | 'complete' | 'failed' | 'stopped';
  events: ProgressEvent[];
  results: CompanyResult[];
  outputPath: string;
  clients: Set<express.Response>;
  abortController: AbortController;
}

const app = express();
const jobs = new Map<string, Job>();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const CONNECTED_GMAIL_EMAIL = 'admin-tools@zuddl.com';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

app.get('/api/sample-data', async (_req, res) => {
  const samplePath = path.resolve(process.cwd(), 'data/sample-companies.csv');
  try {
    const csv = await fs.readFile(samplePath, 'utf8');
    res.json({ csv, count: parseCompanyInput(csv).length });
  } catch {
    res.status(404).json({ error: 'Sample CSV not found' });
  }
});

app.get('/api/gmail/auth-url', (_req, res) => {
  try {
    res.json({ url: GmailClient.getOAuthAuthorizationUrl() });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message ?? String(error) });
  }
});

app.get('/oauth/gmail/callback', async (req, res) => {
  const code = String(req.query.code ?? '');
  if (!code) {
    res.status(400).send('Missing OAuth code.');
    return;
  }

  try {
    const refreshToken = await GmailClient.exchangeOAuthCode(code);
    await upsertEnvValue('GMAIL_OAUTH_REFRESH_TOKEN', refreshToken);
    res.type('html').send('<h1>Gmail connected</h1><p>You can close this tab and return to the Event Intelligence Engine.</p>');
  } catch (error) {
    res.status(500).send(`Gmail OAuth failed: ${escapeHtml((error as Error).message ?? String(error))}`);
  }
});

app.post('/api/run', async (req, res) => {
  const companies = parseCompanyInput(String(req.body?.companies ?? ''));
  if (companies.length === 0) {
    res.status(400).json({ error: 'Add at least one company name.' });
    return;
  }

  const config = getConfig();
  const credentials = parseRuntimeCredentials(req.body);
  const webinarRegistrationProfile = parseWebinarRegistrationProfile(req.body);
  if (!credentials.serperApiKey && !config.serperApiKey) {
    res.status(400).json({ error: 'Add a Serper API key to start the run.' });
    return;
  }
  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const outputPath = buildRunOutputPath(config.excelOutputPath, jobId);
  const assetDir = path.resolve(publicDir, 'run-assets', jobId);
  const assetBaseUrl = `/run-assets/${jobId}`;
  const abortController = new AbortController();
  const job: Job = {
    id: jobId,
    status: 'running',
    events: [],
    results: [],
    outputPath,
    clients: new Set(),
    abortController,
  };
  jobs.set(jobId, job);
  await fs.mkdir(assetDir, { recursive: true });

  res.json({ jobId, outputPath });

  processBatch({
    companies,
    dryRun: false,
    outputPath,
    assetDir,
    assetBaseUrl,
    signal: abortController.signal,
    credentials,
    webinarRegistrationProfile,
    onProgress: event => publish(job, event),
  })
    .then(({ results }) => {
      job.results = results;
      job.status = 'complete';
      publish(job, {
        timestamp: new Date().toISOString(),
        stage: 'complete',
        message: `Batch complete. Wrote ${results.length} rows to Excel.`,
        detail: { outputPath },
      });
      closeClients(job);
    })
    .catch(error => {
      if (abortController.signal.aborted) {
        job.status = 'stopped';
        publish(job, {
          timestamp: new Date().toISOString(),
          stage: 'stopped',
          message: 'Run stopped by user.',
          detail: { outputPath },
        });
        closeClients(job);
        return;
      }
      job.status = 'failed';
      publish(job, {
        timestamp: new Date().toISOString(),
        stage: 'error',
        message: (error as Error).message ?? String(error),
      });
      closeClients(job);
    });
});

app.post('/api/jobs/:jobId/stop', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status !== 'running') {
    res.json({ status: job.status });
    return;
  }
  job.abortController.abort();
  job.status = 'stopped';
  publish(job, {
    timestamp: new Date().toISOString(),
    stage: 'stopped',
    message: 'Stop requested. Finishing cancellation...',
  });
  res.json({ status: 'stopped' });
});

app.get('/api/events/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  job.clients.add(res);
  for (const event of job.events) {
    writeSse(res, event);
  }

  req.on('close', () => {
    job.clients.delete(res);
  });
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    outputPath: job.outputPath,
    results: job.results,
  });
});

app.get('/api/jobs/:jobId/results.csv', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const csv = toCsv([RESULT_HEADERS, ...job.results.map(resultToRow)]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvFileName(job)}"`);
  res.send(`\uFEFF${csv}`);
});

function publish(job: Job, event: ProgressEvent): void {
  const result = event.detail?.result;
  if (isCompanyResult(result)) {
    upsertJobResult(job, result);
  }

  job.events.push(event);
  for (const client of job.clients) {
    writeSse(client, event);
  }
}

function upsertJobResult(job: Job, result: CompanyResult): void {
  const index = job.results.findIndex(existing => existing.companyName === result.companyName);
  if (index >= 0) {
    job.results[index] = result;
    return;
  }
  job.results.push(result);
}

function isCompanyResult(value: unknown): value is CompanyResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CompanyResult>;
  return typeof candidate.companyName === 'string' && typeof candidate.researchStatus === 'string';
}

function writeSse(res: express.Response, event: ProgressEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function closeClients(job: Job): void {
  for (const client of job.clients) {
    client.end();
  }
  job.clients.clear();
}

function parseCompanyInput(raw: string): CompanyInput[] {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const hasHeader =
    lines[0]!.toLowerCase().includes('company_name') ||
    lines[0]!.toLowerCase().includes('company') ||
    lines[0]!.toLowerCase().includes('account name');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const companies: CompanyInput[] = [];
  const seen = new Set<string>();

  for (const line of dataLines) {
    const [nameRaw, domainRaw] = line.split(',').map(part => part?.trim());
    if (!nameRaw) continue;
    const key = nameRaw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const domain = normalizeDomain(domainRaw);
    companies.push({ name: nameRaw, ...(domain ? { domain } : {}) });
  }

  return companies;
}

function parseRuntimeCredentials(body: unknown): RuntimeCredentials {
  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const nvidiaApiKey = normalizedSecret(payload.nvidiaApiKey) ?? normalizedSecret(payload.llmApiKey);
  return {
    ...(nvidiaApiKey ? { nvidiaApiKey } : {}),
  };
}

function parseWebinarRegistrationProfile(body: unknown): WebinarRegistrationProfile | undefined {
  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const rawProfile =
    payload.webinarRegistrationProfile && typeof payload.webinarRegistrationProfile === 'object'
      ? (payload.webinarRegistrationProfile as Record<string, unknown>)
      : payload;
  const profile: WebinarRegistrationProfile = {
    ...(normalizedText(rawProfile.fullName) ? { fullName: normalizedText(rawProfile.fullName) } : {}),
    ...(normalizedText(rawProfile.firstName) ? { firstName: normalizedText(rawProfile.firstName) } : {}),
    ...(normalizedText(rawProfile.lastName) ? { lastName: normalizedText(rawProfile.lastName) } : {}),
    email: CONNECTED_GMAIL_EMAIL,
    ...(normalizedText(rawProfile.company) ? { company: normalizedText(rawProfile.company) } : {}),
    ...(normalizedText(rawProfile.title) ? { title: normalizedText(rawProfile.title) } : {}),
    ...(normalizedText(rawProfile.phone) ? { phone: normalizedText(rawProfile.phone) } : {}),
    ...(normalizedText(rawProfile.country) ? { country: normalizedText(rawProfile.country) } : {}),
  };
  return Object.keys(profile).length > 0 ? profile : undefined;
}

function normalizedSecret(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildRunOutputPath(configuredPath: string, jobId: string): string {
  const resolved = path.resolve(configuredPath);
  const parsed = path.parse(resolved);
  const safeJobId = jobId.replace(/[^a-zA-Z0-9-]/g, '');
  return path.join(parsed.dir, `${parsed.name}-${safeJobId}${parsed.ext || '.xlsx'}`);
}

function toCsv(rows: unknown[][]): string {
  return rows.map(row => row.map(escapeCsvCell).join(',')).join('\n');
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvFileName(job: Job): string {
  const safeJobId = job.id.replace(/[^a-zA-Z0-9-]/g, '');
  return `event-intelligence-results-${safeJobId}.csv`;
}

async function upsertEnvValue(key: string, value: string): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env');
  let env = '';
  try {
    env = await fs.readFile(envPath, 'utf8');
  } catch {
    // create file
  }
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  env = pattern.test(env) ? env.replace(pattern, line) : `${env.replace(/\s*$/, '')}\n${line}\n`;
  await fs.writeFile(envPath, env);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const config = getConfig();
app.listen(config.serverPort, () => {
  // eslint-disable-next-line no-console
  console.log(`Event Intelligence Engine running at http://localhost:${config.serverPort}`);
});
