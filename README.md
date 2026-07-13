<div align="center">

# Open Gemini OCR

**OCR for images, PDFs, URLs, and automated document pipelines — powered by Google Gemini.**

[![CI](https://github.com/cyanxxy/gemini-ocr/actions/workflows/ci.yml/badge.svg)](https://github.com/cyanxxy/gemini-ocr/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cyanxxy/gemini-ocr?display_name=tag)](https://github.com/cyanxxy/gemini-ocr/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-43853d.svg)](package.json)
[![React](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](https://vite.dev/)

</div>

---

## Overview

Open Gemini OCR is an open-source web app and batch CLI for extracting text and structured data from documents. Files remain local except for direct requests to the Gemini API using **your** API key.

Unlike many OCR tools, it does not invent content when a URL cannot be retrieved. Web OCR fails closed when grounding cannot be verified.

| | |
| --- | --- |
| **Stack** | React 19 · TypeScript · Vite 7 · Zustand · Tailwind · `@google/genai` |
| **Deployment** | Static SPA (Netlify / Vercel configs included) |
| **License** | [MIT](LICENSE) |

---

## Features

- **Five modes** — plain OCR, structured templates, bulk batches, grounded URL extraction, and an iterative agent for difficult documents
- **Model choice** — Gemini 3.5 Flash (default), 3.1 Flash-Lite, 3 Flash Preview, and 3.1 Pro, with configurable reasoning depth
- **Structured artifacts** — Markdown, JSON, and CSV from template extractions (invoices, receipts, resumes, business cards)
- **Grounded Web OCR** — Gemini URL context with per-URL verification; no fabricated text on failed retrieval
- **Themes** — light, dark, and AMOLED; KaTeX-aware Markdown via `streamdown`
- **Built-in evals** — assertion-based suite under [`evals/`](evals)
- **Automation-ready CLI** — recursive batches, globs, concurrency, resumable manifests, JSONL, and agentic OCR
- **Privacy-minded** — no app backend, no telemetry; only outbound traffic is to Gemini with your key

---

## Modes

| Mode | Route | Best for | Output |
| --- | --- | --- | --- |
| **Simple** | `/` | Single image or PDF | Markdown |
| **Templates** | `/templates` | Invoices, receipts, resumes, business cards | Markdown · JSON · CSV |
| **Bulk** | `/advanced` | Multi-file jobs | Combined Markdown |
| **Web** | `/web` | Public URL extraction (grounded) | Markdown |
| **Agent** | `/agentic` | Iterative recovery on harder documents | Structured fields |

---

## Quick start

### Requirements

- Node.js **20.19+**, **22.13+**, or **24+**
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### Install and run

```bash
git clone https://github.com/cyanxxy/gemini-ocr.git
cd gemini-ocr
npm ci
npm run dev
```

Open `http://localhost:5173`, set your API key under **Settings**, then choose a mode.

- Structured documents → **Templates**
- Plain text extraction → **Simple**

## Command-line interface

The CLI uses the same extraction engine, templates, models, and agent loop as
the web application. It is intended for large document folders, data pipelines,
CI jobs, and shell automation.

### Run from the repository

```bash
npm ci
export GEMINI_API_KEY="your-key"
npm run cli -- extract invoice.pdf
```

Build and invoke the distributable command:

```bash
npm run cli:build
node packages/cli/dist/index.js extract invoice.pdf
```

After installing the package globally, the executable is `gemini-ocr`:

```bash
npm install --global open-ocr-cli
gemini-ocr extract invoice.pdf
```

### Common workflows

```bash
# Create ./.gemini-ocr.json and validate GEMINI_API_KEY
gemini-ocr init

# One document to stdout
gemini-ocr extract document.pdf

# Recursive directory batch; outputs keep the input directory structure
gemini-ocr extract ./documents --output ./results --concurrency 4

# Shell glob with exclusions and resumable processing
gemini-ocr extract '**/*.{pdf,png,jpg}' \
  --exclude '**/archive/**' \
  --output ./results \
  --resume

# Invoice fields plus Markdown, JSON, and CSV artifacts
gemini-ocr extract ./invoices \
  --preset invoice \
  --format all \
  --output ./invoice-results

# Extract arbitrary structured JSON and validate it against your schema
gemini-ocr extract invoice.pdf \
  --schema examples/invoice.schema.json \
  --output invoice.json

# Bound request starts and stop scheduling when estimated cost reaches $5
gemini-ocr extract ./documents \
  --requests-per-minute 60 \
  --max-cost 5 \
  --output ./results

# Agentic extraction for difficult scans
gemini-ocr extract difficult-scan.pdf \
  --mode agentic \
  --format json \
  --max-iterations 6

# Machine-readable event stream for another process
gemini-ocr extract ./documents --jsonl --quiet --output ./results

# Grounded extraction from public URLs
gemini-ocr web https://example.com/report.pdf --format markdown
gemini-ocr web --file urls.txt --analysis comparison --output comparison.md

# Binary stdin
cat scan.png | gemini-ocr extract - --stdin-name scan.png --format json

# Validate discovery, MIME signatures, PDF page counts, and budgets without API calls
gemini-ocr extract ./documents --dry-run
```

`extract` accepts any mixture of files, directories, and glob patterns. Directory
inputs are recursive. Supported local formats are PNG, JPEG, WebP, HEIC, HEIF,
and PDF.

| CLI mode | Select with | Best for | Available output |
| --- | --- | --- | --- |
| Simple | `--mode simple` (default) | General text and layout extraction | Markdown · JSON |
| Template | `--preset <id>` | Invoices, receipts, resumes, and business cards | Markdown · JSON · CSV · all |
| Agentic | `--mode agentic` | Difficult scans that benefit from iterative field recovery | Markdown · JSON · all |
| Web | `gemini-ocr web` | Grounded extraction from public URLs | Markdown · JSON |

`--schema <path>` is available in simple mode and implies JSON output. The CLI
validates the schema before making a request, sends it as Gemini structured-output
configuration, then validates every response locally. Schemas use the supported
JSON Schema subset; unsupported keywords fail early with a path-specific error.

Use `gemini-ocr presets` to list the installed structured presets and
`gemini-ocr models` to list accepted model IDs.

For batches, the default output directory is `./gemini-ocr-output`. It contains:

- One artifact per input document, preserving relative directory structure
- `.gemini-ocr-manifest.json` for safe `--resume` processing
- `batch-summary.json` with statuses, latency, model, aggregate token usage, and
  estimated paid-tier cost

Existing artifacts are never replaced unless `--overwrite` is provided. Batch
processing continues after per-document failures unless `--fail-fast` is used.
Progress and errors go to stderr; document content and JSONL events go to stdout,
so shell pipelines remain clean.

Resume treats both successful jobs and partial agentic jobs as complete when the
input/config fingerprint still matches and every recorded artifact exists. This
avoids repeating model work or colliding with useful partial output; use
`--overwrite` to intentionally rerun and replace it. `--dry-run` always validates
every discovered document and ignores resume state. Empty, oversized, spoofed,
or otherwise invalid documents are reported as individual job failures, while
batch-wide file-count and total-size safety budgets still stop discovery early.

Every batch summary contains one result for every discovered input. When
`--fail-fast` stops scheduling work, the remainder is recorded as `skipped`
with zero attempts instead of disappearing from the summary.

`--requests-per-minute` evenly spaces Gemini request starts across the active
command; it is not a burst-capable sliding window. Queued waits remain immediately
abortable on timeout or Ctrl-C. `--max-cost` stops scheduling new batch documents
and blocks the next request in a multi-request or agentic flow once recorded
paid-tier usage reaches the limit. A single request and already-running concurrent
requests cannot be stopped based on post-response token metadata, so the final
estimate can exceed the limit. Estimates use current list prices and reported
input totals—which already include tool-use input—so separately reported tool
tokens are not billed twice. Estimates are guidance rather than billing records.

### Configuration

Configuration is merged in this order:

1. `~/.config/gemini-ocr/config.json`
2. `./.gemini-ocr.json`
3. A file passed with `--config`
4. CLI flags

Example:

```json
{
  "model": "gemini-3.5-flash",
  "thinking": "MEDIUM",
  "concurrency": 4,
  "retries": 3,
  "timeoutSeconds": 180,
  "maxFiles": 5000,
  "maxTotalMb": 20480,
  "maxCostUsd": 5,
  "requestsPerMinute": 60,
  "resume": true,
  "format": "json",
  "exclude": ["**/archive/**", "**/.*/**"]
}
```

The API key is read from `GEMINI_API_KEY` by default. To use a different
environment variable, set `"apiKeyEnv": "YOUR_VARIABLE"` in the config. Raw API
keys should not be committed to configuration files. Configuration is
allowlisted: unknown keys are ignored with a warning and are not included in
`doctor --json` output.

Run `gemini-ocr init` for guided project configuration, or
`gemini-ocr init --global` for the user configuration. The command stores only
the environment-variable name, never the API key. Use `--yes` for recommended
non-interactive defaults and `--skip-validation` to avoid the credential check.

Supported configuration keys are `model`, `thinking`, `includeThoughts`,
`mode`, `preset`, `format`, `output`, `concurrency`, `retries`,
`timeoutSeconds`, `maxFiles`, `maxTotalMb`, `resume`, `overwrite`, `failFast`,
`hidden`, `exclude`, `instructions`, `detectImages`, `detectMath`, `maxTokens`,
`maxIterations`, `confidenceThreshold`, and `apiKeyEnv`.
It also accepts `schema`, `maxCostUsd`, and `requestsPerMinute`.

Useful discovery commands:

```bash
gemini-ocr presets
gemini-ocr models
gemini-ocr doctor
gemini-ocr init --help
gemini-ocr extract --help
gemini-ocr web --help
```

Exit status is `0` when all scheduled documents succeed or resume cleanly, `1`
when one or more document jobs fail, agentic extraction finishes partially, or
a configured cost limit is reached,
`2` for command/configuration errors, and `130` when interrupted. Partial
agentic artifacts are still written and retain their explicit stop reason.

---

## Models and reasoning

| Model ID | Status | Thinking levels | Notes |
| --- | --- | --- | --- |
| `gemini-3.5-flash` | Stable | MINIMAL · LOW · MEDIUM · HIGH | Default; recommended for most work |
| `gemini-3.1-flash-lite` | Stable | MINIMAL · LOW · MEDIUM · HIGH | Lowest cost / high volume |
| `gemini-3-flash-preview` | Preview¹ | MINIMAL · LOW · MEDIUM · HIGH | Preview Flash |
| `gemini-3.1-pro-preview` | Preview¹ | LOW · MEDIUM · HIGH | Highest reasoning |

¹ Preview models may change or be retired without notice.

**Thinking depth** is set in Settings (app default: **MEDIUM**).

- Pro does not support `MINIMAL` (clamped to supported levels).
- Agentic mode raises `MINIMAL` to `MEDIUM` for extraction quality.
- Unset levels follow model defaults (Flash-Lite → minimal, 3.5 Flash → medium, 3 Flash Preview/Pro → high).

---

## Limits

| Constraint | Value |
| --- | --- |
| Image upload | **70 MB raw** (keeps base64 plus prompt/JSON below the 100 MB inline-payload ceiling) |
| PDF upload | **50 MB**, up to **1,000 pages** |
| Web-app bulk batch | Up to **200** files, **500 MB** total |
| CLI batch default | Up to **1,000** files, **5,120 MB** total; configurable with safety flags |
| CLI concurrency | **2** by default; configurable from **1–16** |
| Local formats | `png`, `jpg`/`jpeg`, `webp`, `heic`, `heif`, `pdf` |
| Web OCR URLs | Up to **20** per request |

### Web OCR rules

- Only public `http`/`https` URLs; credentials in URLs, localhost, private ranges, and tunnel hosts (e.g. ngrok) are rejected
- Duplicates are de-duplicated; in-progress runs can be cancelled
- Retrieval metadata is verified per URL; failure or unverifiable grounding surfaces an error instead of guessed content

---

## Development

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm run cli -- extract …` | Run the CLI directly from TypeScript |
| `npm run cli:build` | Build the distributable Node CLI |
| `npm run cli:smoke` | Build the CLI and verify its command surface |
| `npm run cli:pack` | Create the publishable standalone CLI package |
| `npm run lint` | ESLint |
| `npm test` | Vitest (single run) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run evals:validate` | Static checks on eval cases/corpus |
| `npm run evals:fixtures` | Rebuild local PDFs plus deterministic raster/degraded fixtures |
| `npm run evals:setup` | Download pinned CORD and OmniDocBench subsets into the ignored cache |
| `npm run evals:canary` | Small live Gemini eval (`GEMINI_API_KEY` required) |
| `npm run evals` | Full local and public-dataset live eval (`GEMINI_API_KEY` required) |
| `npm run evals:benchmark` | Public benchmark subset only (`GEMINI_API_KEY` required) |
| `npm run evals:stability` | Public benchmark subset repeated three times |
| `npm run evals:report` | Render latest eval report as Markdown |

### Quality gates

CI (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push and pull request:

- Type-check · Lint · Tests + coverage thresholds · Dependency audit · Eval fixture validation · Production build

Before opening a PR:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

### Project layout

```text
src/
  cli/            Node CLI discovery, orchestration, outputs, and native rasterization
  components/     UI (atoms → molecules → organisms, layout, modals)
  pages/          One screen per mode
  lib/
    gemini/       Client, Interactions API helpers, extraction, URL ops
    templates/    Structured extraction presets
    agent*.ts     Agentic OCR loop, tools, memory
  store/          Zustand stores (settings + one per mode)
  hooks/          Shared hooks
  design/         Theme tokens
evals/            Assertion-based AI eval suite
packages/cli/     Standalone npm package metadata and distributable build
```

### AI evals

```bash
npm run evals:fixtures
npm run evals:setup
npm run evals:validate
GEMINI_API_KEY=your_key npm run evals:canary
GEMINI_API_KEY=your_key npm run evals
npm run evals:report
```

The evaluator reports CER, normalized CER, WER, edit similarity, text coverage,
unsupported-text rate, field precision/recall/F1, critical-field exact match,
table-cell F1, latency, and mode/tag breakdowns. Public dataset files and
timestamped raw outputs remain local and untracked. See [`evals/README.md`](evals/README.md)
for dataset terms, scoring details, and suite composition.

| Path | Contents |
| --- | --- |
| [`evals/cases`](evals/cases) | Assertions and fixtures |
| [`evals/corpus`](evals/corpus) | Input documents |
| [`evals/references`](evals/references) | Versioned text and structured ground truth |
| [`evals/reports/latest.md`](evals/reports/latest.md) | Last committed Markdown report |
| [`evals/reports/latest.json`](evals/reports/latest.json) | Last committed JSON summary |

`latest.md` / `latest.json` are snapshots from the last manual run (see the report timestamp). They may lag the current code or case set until you re-run evals.

---

## Security and privacy

- API keys are stored in `localStorage` with **light obfuscation only** — anyone with access to the browser profile can recover them.
- Prefer trusted, private devices. For production, proxy Gemini through a backend instead of embedding long-lived keys in the client.
- Files are read in the browser and sent only to the Gemini API; no other third-party data path.
- Netlify/Vercel configs set hardening headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`) plus the in-document CSP. HSTS omits `preload` by design.
- Production builds omit source maps by default.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

---

## Contributing

Contributions are welcome.

- Setup and PR checklist: [CONTRIBUTING.md](CONTRIBUTING.md)
- User-facing release history: [CHANGELOG.md](CHANGELOG.md)
- Community standards: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

---

## License

[MIT](LICENSE)
