# Open Gemini OCR CLI

Production-oriented batch OCR for images, PDFs, and public URLs using Google
Gemini. It supports recursive discovery, globs, binary stdin, structured
presets, agentic OCR, bounded concurrency, resumable manifests, and JSONL
pipeline output.

## Install

Node.js 20.19+, 22.13+, or 24+ is required.

```bash
npm install --global open-gemini-ocr
export GEMINI_API_KEY="your-key"
gemini-ocr extract ./documents --output ./results --concurrency 4
```

The API key is read from `GEMINI_API_KEY`; it is never accepted as a command-line
argument or raw configuration value. Use `apiKeyEnv` in a config file when a
different environment variable is required.

## Examples

```bash
# Extract one document to stdout
gemini-ocr extract invoice.pdf

# Process a recursive folder while preserving its directory structure
gemini-ocr extract ./documents --output ./results --concurrency 4

# Structured invoice extraction with every available artifact
gemini-ocr extract ./invoices --preset invoice --format all --output ./results

# Iterative field recovery for a difficult scan
gemini-ocr extract scan.pdf --mode agentic --format json --max-iterations 6

# Validate files without credentials, API calls, or output writes
gemini-ocr extract ./documents --dry-run

# Emit machine-readable document events and a final summary
gemini-ocr extract ./documents --jsonl --quiet --output ./results

# Read binary image data from stdin
cat scan.png | gemini-ocr extract - --stdin-name scan.png --format json

# Grounded extraction from a public URL
gemini-ocr web https://example.com/report.pdf --format markdown
```

Supported local formats are PNG, JPEG, WebP, HEIC, HEIF, and PDF. PDFs are
limited to 50 MB and 1,000 pages; images are limited to 70 MB raw. CLI batches
default to 1,000 files, 5,120 MB total, and concurrency 2. Safety budgets and
concurrency are configurable.

## Batch behavior

The default batch output directory is `./gemini-ocr-output`. It contains one or
more artifacts per document, `.gemini-ocr-manifest.json`, and
`batch-summary.json`.

- Existing output is never replaced without `--overwrite`.
- Resume skips unchanged successful and partial agentic jobs when all recorded
  artifacts still exist.
- Use `--overwrite` to intentionally rerun and replace a partial result.
- Dry runs always validate every document regardless of manifest state.
- Invalid documents are reported individually; other jobs continue unless
  `--fail-fast` is set.
- Unstarted fail-fast remainder is represented explicitly as skipped jobs.
- Progress is written to stderr; extracted content and JSONL are written to
  stdout.

Exit status is `0` for a successful or cleanly resumed batch, `1` for failed or
partial document jobs, `2` for command/configuration errors, and `130` when
interrupted.

## Configuration and discovery

Configuration is merged from:

1. `~/.config/gemini-ocr/config.json`
2. `./.gemini-ocr.json`
3. `--config <path>`
4. CLI flags

Unknown configuration keys are ignored with a warning and are not echoed by
`doctor --json`.

```bash
gemini-ocr presets
gemini-ocr models
gemini-ocr doctor
gemini-ocr extract --help
gemini-ocr web --help
```

The package sends document contents directly to the Gemini API using the key
supplied through your environment. It does not use an application backend or
telemetry service.

Full source and web-app documentation are available in the
[project README](https://github.com/cyanxxy/gemini-ocr#command-line-interface).
