import 'dotenv/config';
import { z } from 'zod';

const DEFAULT_NVIDIA_MODEL = 'openai/gpt-oss-120b';

const BooleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform(v => {
    if (typeof v === 'boolean') return v;
    const normalized = v.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    return Boolean(v);
  });

export const ConfigSchema = z.object({
  serperApiKey: z.string().min(1).optional(),
  googleSheetsId: z.string().min(1).optional(),
  googleServiceAccountEmail: z.string().email().optional(),
  googleServiceAccountKey: z.string().min(1).optional(),
  gmailServiceAccountEmail: z.string().email().optional(),
  gmailServiceAccountKey: z.string().min(1).optional(),
  gmailImpersonateEmail: z.string().email().optional(),
  gmailOAuthClientId: z.string().min(1).optional(),
  gmailOAuthClientSecret: z.string().min(1).optional(),
  gmailOAuthRedirectUri: z.string().url().optional(),
  gmailOAuthRefreshToken: z.string().min(1).optional(),
  gmailPollTimeoutMs: z.coerce.number().int().min(10_000).max(600_000).default(120_000),
  gmailPollIntervalMs: z.coerce.number().int().min(2_000).max(60_000).default(5_000),
  anthropicApiKey: z.string().min(1).optional(),
  nvidiaApiKey: z.string().min(1).optional(),
  nvidiaModel: z.string().min(1).default(DEFAULT_NVIDIA_MODEL),
  excelOutputPath: z.string().min(1).default('outputs/event-intelligence-results.xlsx'),
  serverPort: z.coerce.number().int().min(1).max(65_535).default(3000),
  concurrency: z.coerce.number().int().min(1).max(10).default(1),
  maxSearchResults: z.coerce.number().int().min(5).max(20).default(10),
  pageLoadTimeout: z.coerce.number().int().default(30000),
  networkIdleWait: z.coerce.number().int().default(5000),
  headless: BooleanFromEnv.default(true),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type Config = z.infer<typeof ConfigSchema>;

export function getConfig(options?: { requireSheets?: boolean; requireSerper?: boolean }): Config {
  const parsed = ConfigSchema.safeParse({
    serperApiKey: process.env.SERPER_API_KEY || undefined,
    googleSheetsId: process.env.GOOGLE_SHEETS_ID,
    googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    googleServiceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    gmailServiceAccountEmail: process.env.GMAIL_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    gmailServiceAccountKey: process.env.GMAIL_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    gmailImpersonateEmail: process.env.GMAIL_IMPERSONATE_EMAIL,
    gmailOAuthClientId: process.env.GMAIL_OAUTH_CLIENT_ID,
    gmailOAuthClientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET,
    gmailOAuthRedirectUri: process.env.GMAIL_OAUTH_REDIRECT_URI,
    gmailOAuthRefreshToken: process.env.GMAIL_OAUTH_REFRESH_TOKEN,
    gmailPollTimeoutMs: process.env.GMAIL_POLL_TIMEOUT_MS,
    gmailPollIntervalMs: process.env.GMAIL_POLL_INTERVAL_MS,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    nvidiaApiKey: process.env.NVIDIA_API_KEY || undefined,
    nvidiaModel: DEFAULT_NVIDIA_MODEL,
    excelOutputPath: process.env.EXCEL_OUTPUT_PATH,
    serverPort: process.env.PORT,
    concurrency: process.env.CONCURRENCY,
    maxSearchResults: process.env.MAX_SEARCH_RESULTS,
    pageLoadTimeout: process.env.PAGE_LOAD_TIMEOUT,
    networkIdleWait: process.env.NETWORK_IDLE_WAIT,
    headless: process.env.HEADLESS,
    logLevel: process.env.LOG_LEVEL
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (options?.requireSerper && !parsed.data.serperApiKey) {
    throw new Error('Missing SERPER_API_KEY');
  }
  if (options?.requireSheets) {
    if (!parsed.data.googleSheetsId) throw new Error('Missing GOOGLE_SHEETS_ID (required unless --dry-run)');
    if (!parsed.data.googleServiceAccountEmail) {
      throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL (required unless --dry-run)');
    }
    if (!parsed.data.googleServiceAccountKey) {
      throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY (required unless --dry-run)');
    }
  }
  return parsed.data;
}
