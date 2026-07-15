# Open OCR CLI

Open-source document extraction for images, PDFs, and public URLs, powered by
Google Gemini. It supports recursive discovery, globs, binary stdin, structured
presets, arbitrary JSON schemas, agentic OCR, bounded concurrency, resumable
manifests, cost/rate controls, and JSONL pipeline output.

## Install

Node.js 20.19+, 22.13+, or 24+ is required.

```bash
npm install --global open-ocr-cli
export GEMINI_API_KEY="your-key"
open-ocr-cli extract ./documents --output ./results --concurrency 4
```

`open-ocr-cli` is the primary executable. The existing `gemini-ocr` executable
remains available as a backwards-compatible alias.

## Set the API key

The CLI reads `GEMINI_API_KEY` from the environment or a project-local `.env`
file. It never accepts secrets as command-line flags, where shell history and
process listings could expose them.

```bash
# macOS / Linux — current shell
export GEMINI_API_KEY="your-key"

# PowerShell — current shell
$env:GEMINI_API_KEY="your-key"

# Or add this line to ./.env (keep the file out of version control)
GEMINI_API_KEY=your-key

# Confirm the CLI can see it
open-ocr-cli doctor
```

Use `apiKeyEnv` in a config file when a different environment variable is
required. `open-ocr-cli init` prints the exact setup commands when that variable
is missing.

## Examples

```bash
# Create a project config and validate credentials
open-ocr-cli init

# Extract one document to stdout
open-ocr-cli extract invoice.pdf

# Process a recursive folder while preserving its directory structure
open-ocr-cli extract ./documents --output ./results --concurrency 4

# Structured invoice extraction with every available artifact
open-ocr-cli extract ./invoices --preset invoice --format all --output ./results

# Arbitrary structured output, validated against the schema before and after the request
open-ocr-cli extract invoice.pdf --schema invoice.schema.json --output invoice.json

# Rate-limit requests and stop scheduling around a $5 paid-tier estimate
open-ocr-cli extract ./documents --requests-per-minute 60 --max-cost 5 --output ./results

# Iterative field recovery for a difficult scan
open-ocr-cli extract scan.pdf --mode agentic --format json --max-iterations 6

# Validate files without credentials, API calls, or output writes
open-ocr-cli extract ./documents --dry-run

# Emit machine-readable document events and a final summary
open-ocr-cli extract ./documents --jsonl --quiet --output ./results

# Inspect the last run, failures, usage, and missing artifacts
open-ocr-cli status ./results
open-ocr-cli status ./results --json

# Read binary image data from stdin
cat scan.png | open-ocr-cli extract - --stdin-name scan.png --format json

# Grounded extraction from a public URL
open-ocr-cli web https://example.com/report.pdf --format markdown
```

Supported local formats are PNG, JPEG, WebP, HEIC, HEIF, and PDF. PDFs are
limited to 50 MB and 1,000 pages; images are limited to 70 MB raw. CLI batches
default to 1,000 files, 5,120 MB total, and concurrency 2. Safety budgets and
concurrency are configurable.

Custom schemas use Gemini's supported JSON Schema subset. `--schema` is limited
to simple mode, implies JSON output, and rejects unsupported schema keywords or
responses that fail local validation.

## Batch behavior

The default batch output directory is `./gemini-ocr-output`. It contains one or
more artifacts per document, `.gemini-ocr-manifest.json`, and
`batch-summary.json`. Summaries include aggregate tokens and estimated paid-tier
cost.

- Existing output is never replaced without `--overwrite`.
- Every possible destination for a non-resumed document, including optional
  `--format all` artifacts, is checked before any worker can call Gemini.
- A batch takes an exclusive `.gemini-ocr.lock` on its output directory before
  making API requests, preventing concurrent processes from losing manifest
  updates. After a forcibly killed local process, `--force-unlock` recovers the
  lock only when its owner metadata is valid, its hostname matches, and its PID
  is no longer alive. Cross-host or invalid locks still require manual review.
- Output path collisions are rejected before an API request is made, and
  multi-artifact writes are staged with exception rollback. Hard-link commits
  are atomic where supported; network/FUSE or non-NTFS filesystems fall back to
  an exclusive no-clobber write. A kill or power loss can still leave `.tmp` or
  `.bak` recovery files, so this is not a crash-atomic/ACID transaction.
- Collision checks are case-insensitive on every platform for portable output
  across Linux, macOS, and Windows filesystems.
- Resume skips unchanged successful and partial agentic jobs when all recorded
  artifacts still exist. Manifest JSON and every entry are validated before
  resume state is trusted.
- Use `--overwrite` to intentionally rerun and replace a partial result.
- Dry runs always validate every document regardless of manifest state and show
  each planned artifact destination (or stdout).
- Invalid documents are reported individually; other jobs continue unless
  `--fail-fast` is set.
- Unstarted fail-fast remainder is represented explicitly as skipped jobs.
- Progress is written to stderr; extracted content and JSONL are written to
  stdout.
- A max-cost limit stops new documents from being scheduled. Concurrent requests
  already in flight finish, so the final estimate can be slightly higher. Once
  recorded usage reaches the limit, the next request in an agentic or other
  multi-request flow is also blocked; a single in-flight request cannot be
  stopped using token metadata that is only available afterward.
- Request-rate limits evenly space request starts rather than allowing bursts,
  and queued waits abort immediately on timeout or Ctrl-C.

`open-ocr-cli status` prefers the latest run totals from `batch-summary.json` and
marks cost-limited, cancelled, fail-fast, partial, and failed runs as requiring
attention. It also reports the PID, host, and start time for a live or stale
batch lock instead of presenting the prior summary as healthy. Missing or moved
source documents are reported as source drift, but do not make intact successful
artifacts unhealthy.

`MAX_TOKENS` is a hard failure because truncated OCR must not be persisted as a
success. For unusually long documents, retry with a larger `--max-tokens` value
(up to `65536`) or lower `--thinking` to leave more of the output budget for OCR.

Exit status is `0` for successful work, `1` for extraction/Web runtime failures
or partial document jobs, `2` for command/configuration errors, `130` for
SIGINT, and `143` for SIGTERM.

## Configuration and discovery

Configuration is merged from:

1. `~/.config/gemini-ocr/config.json`
2. `./.gemini-ocr.json`
3. `--config <path>`
4. CLI flags

Unknown configuration keys are ignored with a warning and are not echoed by
`doctor --json`.

Use `open-ocr-cli init` for guided project setup or `open-ocr-cli init --global`
for user-wide defaults. The generated configuration stores an
environment-variable name, never a raw API key. Configuration supports
`schema`, `maxCostUsd`, and `requestsPerMinute` in addition to the extraction
options.

```bash
open-ocr-cli presets
open-ocr-cli models
open-ocr-cli doctor
open-ocr-cli status ./results
open-ocr-cli init --help
open-ocr-cli extract --help
open-ocr-cli web --help
```

The package sends document contents directly to the Gemini API using the key
supplied through your environment. It does not use an application backend or
telemetry service.

Full source and web-app documentation are available in the
[project README](https://github.com/cyanxxy/gemini-ocr#command-line-interface).
