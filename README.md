# Event Intelligence Engine

Discovers a company’s flagship event + active webinar pages, detects the underlying event/webinar platform (Cvent, RainFocus, ON24, etc.), and writes evidence-backed results to an Excel workbook.

## Setup

```bash
pnpm install
npx playwright install chromium
cp .env.example .env
```

Required for CLI runs, or as server-side fallback keys:

- `SERPER_API_KEY` for search
- `EXCEL_OUTPUT_PATH` for workbook output

Optional:

- `NVIDIA_API_KEY` and `NVIDIA_MODEL` for low-confidence LLM fallback
- `PORT` for the local frontend server

## Frontend

```bash
pnpm start
```

Open the configured local URL, currently `http://localhost:3333`, and paste companies as either one per line or CSV rows:

```csv
company_name,domain
Snowflake,snowflake.com
HubSpot,hubspot.com
```

The frontend processes one company at a time end-to-end. It shows the current stage, per-company progress, Playwright page screenshots from the crawler, live result rows, and source/evidence fields for event selection and platform detection.

Frontend users can enter their own Serper key and NVIDIA LLM key before starting a run. Those keys are sent only with the run request, are not written to project files, and override any server-side fallback keys for that run.

## Run

Single company:

```bash
npx tsx src/index.ts run --company "Snowflake" --verbose
```

CSV batch:

```bash
npx tsx src/index.ts run --file companies.csv
```

Dry run (no Excel write):

```bash
npx tsx src/index.ts run --company "Snowflake" --dry-run
```

Custom Excel path:

```bash
npx tsx src/index.ts run --file companies.csv --output outputs/my-run.xlsx
```

## Tests

```bash
pnpm test
```
