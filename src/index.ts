import { Command } from 'commander';
import fs from 'node:fs/promises';
import { getLogger } from './utils/logger.js';
import type { CompanyInput } from './types.js';
import { processBatch } from './orchestrator.js';
import { getConfig } from './config.js';
import { normalizeDomain } from './utils/url-utils.js';

async function parseCompaniesFromCsv(filePath: string): Promise<CompanyInput[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = lines[0]!.split(',').map(s => s.trim().toLowerCase());
  const nameIdx = findHeaderIndex(header, ['company_name', 'company', 'account name', 'account_name', 'name']);
  const domainIdx = findHeaderIndex(header, ['domain', 'website', 'url', 'company domain']);
  if (nameIdx < 0) throw new Error('CSV must include a company column, such as company_name or Account Name');

  const companies: CompanyInput[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map(s => s.trim());
    const name = cols[nameIdx];
    if (!name) continue;
    const domain = domainIdx >= 0 ? normalizeDomain(cols[domainIdx]) : undefined;
    companies.push({ name, ...(domain ? { domain } : {}) });
  }
  return companies;
}

function findHeaderIndex(header: string[], candidates: string[]): number {
  return header.findIndex(value => candidates.includes(value));
}

function dedupeCompanies(companies: CompanyInput[]): CompanyInput[] {
  const seen = new Set<string>();
  const out: CompanyInput[] = [];
  for (const c of companies) {
    const key = c.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

const program = new Command();

program.name('event-intel').description('Event Intelligence Engine');

program
  .command('run')
  .option('-c, --company <name>', 'Single company name')
  .option('-f, --file <path>', 'CSV file with company names (column: company_name, optional: domain)')
  .option('-o, --output <path>', 'Excel output path')
  .option('--dry-run', 'Run without writing to Excel', false)
  .option('--verbose', 'Enable debug logging', false)
  .action(async (options: { company?: string; file?: string; output?: string; dryRun: boolean; verbose: boolean }) => {
    if (!options.company && !options.file) throw new Error('Provide --company or --file');

    if (options.verbose) process.env.LOG_LEVEL = 'debug';

    const logger = getLogger();

    const companies: CompanyInput[] = options.file
      ? await parseCompaniesFromCsv(options.file)
      : [{ name: options.company! }];

    const deduped = dedupeCompanies(companies);

    if (!options.dryRun) {
      const config = getConfig();
      const outputPath = options.output ?? config.excelOutputPath;
      const { results } = await processBatch({ companies: deduped, dryRun: false, outputPath });
      logger.info('run.complete', { companies: deduped.length, written: results.length, outputPath });
      return;
    }

    const { results } = await processBatch({ companies: deduped, dryRun: true });
    await fs.writeFile('dry-run-results.json', JSON.stringify(results, null, 2));
    logger.info('run.complete', { companies: deduped.length, written: 0, outputFile: 'dry-run-results.json' });
  });

program.parseAsync(process.argv).catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
