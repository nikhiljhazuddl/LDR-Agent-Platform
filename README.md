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

- `NVIDIA_API_KEY` for low-confidence LLM fallback; the model is fixed server-side as `openai/gpt-oss-120b`
- `GMAIL_SERVICE_ACCOUNT_EMAIL`, `GMAIL_SERVICE_ACCOUNT_KEY`, and `GMAIL_IMPERSONATE_EMAIL` for unattended webinar email link retrieval
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

Frontend users only enter their NVIDIA LLM key before starting a run. The Serper search key and NVIDIA model are configured server-side and are not exposed in the frontend.

For webinar pages, users can also enter a webinar registration profile. The registration email is fixed to `admin-tools@zuddl.com` because Gmail polling is connected to that inbox. The crawler will fill detected webinar forms, submit them, inspect the post-registration page, and if the page says an email link was sent, poll Gmail for the matching message and crawl the emailed watch/join link before detecting the webinar platform.

The engine also searches for company-hosted field events such as roadshows, workshops, meetups, user groups, training sessions, customer events, and local/community events. It ranks candidates by year priority, accessibility, hosted-vs-participating evidence, registration availability, and platform evidence. Sponsor/exhibitor/speaker pages where the company is merely attending are excluded from hosted field-event results.

## Gmail Automation

Unattended Gmail access requires Google Workspace domain-wide delegation:

1. Create a Google Cloud service account.
2. Enable Gmail API for the project.
3. In Google Workspace Admin, authorize the service account client ID for the scope `https://www.googleapis.com/auth/gmail.readonly`.
4. Set `GMAIL_SERVICE_ACCOUNT_EMAIL`, `GMAIL_SERVICE_ACCOUNT_KEY`, and `GMAIL_IMPERSONATE_EMAIL=admin-tools@zuddl.com`.

The app only reads recent matching webinar emails. It does not send, delete, archive, or modify Gmail messages.

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
