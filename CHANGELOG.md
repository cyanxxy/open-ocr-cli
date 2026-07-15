# Changelog

## 1.6.0 - 2026-07-15

### Open OCR CLI identity

- Added `open-ocr-cli` as the primary executable so the npm package, install
  command, help output, and documented command share one identity.
- Retained `gemini-ocr` as a backwards-compatible executable alias, including
  alias-aware usage and error output.

### Gemini response correctness

- Reject incomplete, budget-exceeded, or otherwise unsuccessful Agentic
  Interactions instead of treating them as completed OCR turns.
- Reject `MAX_TOKENS` output across plain, structured-template, streaming, and
  region re-OCR paths so truncated content cannot be persisted as a success.
- Require streamed generateContent paths to observe a terminal `STOP` across
  the full stream, while allowing a later usage-only chunk.
- Require Web OCR's server-side URL-context interaction to complete, surface
  model-output errors, and document the stored-interaction retention behavior
  required by Agent mode.

### Safer CLI batch operations

- Added `open-ocr-cli status` for human-readable and JSON audits of batch health,
  failures, usage, source availability, and missing artifacts. Status now uses
  last-run summary totals and flags cost-limited or incomplete runs.
- Made dry runs report planned destinations and skip reasons, and reject
  same-stem output collisions before paid extraction begins.
- Preflight every possible non-resumed artifact destination before starting
  workers, while retaining race-safe no-clobber commits as a backstop.
- Stage multi-artifact writes with exception rollback, preserving prior output
  if a commit fails and surfacing rollback failures. Crash/power-loss recovery
  remains best-effort rather than ACID.
- Fall back from atomic hard-link commits to portable exclusive no-clobber writes
  on filesystems that report hard links as unsupported.
- Made collision detection portably case-insensitive and resume events retain
  their manifest-recorded artifact paths.
- Reserved manifest, summary, and lock destinations so document stems cannot
  collide with or be replaced by batch metadata.
- Made batch-summary replacement atomic, staged Web outputs with portable
  no-clobber behavior, preflighted Web destinations before API spend, and
  distinguished runtime failures and SIGTERM exit codes.
- Added exclusive batch-output ownership before API spend and strict shared
  manifest validation so concurrent or malformed resume state cannot lose or
  corrupt completed-work records.
- Report live or stale batch-lock ownership in `status`, add guarded same-host
  dead-PID recovery through `--force-unlock`, and treat archived sources as
  non-fatal drift when artifacts remain intact.
- Added clear macOS/Linux, PowerShell, and project `.env` API-key setup guidance
  to CLI errors, `init`, `doctor`, and documentation.

[Full comparison](https://github.com/cyanxxy/gemini-ocr/compare/v1.5.0...v1.6.0)

## 1.5.0 - 2026-07-13

### CLI extraction controls

- Added custom JSON Schema extraction with local schema and result validation.
- Added `gemini-ocr init` for safe configuration setup and optional credential validation.
- Added paid-tier cost estimates, batch cost ceilings, and configurable Gemini request-rate limits.
- Hardened queued-request cancellation, multi-request cost ceilings, local-only
  schema references, conflicting option validation, and non-interactive setup feedback.

[Full comparison](https://github.com/cyanxxy/gemini-ocr/compare/v1.4.0...v1.5.0)

## 1.4.0 - 2026-07-13

### Batch command-line interface

- Added the `gemini-ocr` TypeScript CLI for files, recursive directories, globs,
  binary stdin, and grounded public URLs using the same simple, template, Web,
  bulk, and agentic engines as the web app.
- Added bounded concurrency, transient retries, per-document timeouts, safety
  budgets, resumable manifests, collision-safe output, dry runs, and fail-fast mode.
- Added Markdown, JSON, CSV, combined artifact, and JSONL pipeline output with
  aggregate token usage and machine-readable batch summaries.
- Added native Node image/PDF region rasterization so agentic re-OCR works outside
  the browser without changing the shared agent loop.
- Added user/project configuration files, environment-based credentials, model and
  preset discovery, diagnostics, npm executable packaging, and CLI test coverage.
- Hardened partial-result resume, dry-run validation, fail-fast accounting,
  configuration allowlisting, per-document input failures, and native PDF global
  isolation before release.

[Full comparison](https://github.com/cyanxxy/gemini-ocr/compare/v1.3.0...v1.4.0)

## 1.3.0 - 2026-07-13

### Current Gemini model and API support

- Gemini 3.5 Flash is now the recommended default model, with updated thinking
  defaults and model-specific reasoning controls.
- Agentic OCR now follows the stateful Interactions API continuation protocol,
  preserves server interaction IDs, and sends documented function-result
  content blocks without retransmitting the original document.
- Retry handling can resume pending user or tool-result input after transient
  Gemini failures without duplicating completed work.

### Safer document processing and better extraction

- Inline image uploads are capped at 70 MB raw so base64 expansion and request
  metadata remain below Gemini's 100 MB request ceiling.
- PDFs are validated against the 50 MB and 1,000-page document limits before
  processing when local page inspection is available.
- Template extraction now uses JSON response schemas, improved typed field
  normalization, and complete usage accounting for streamed responses.

### Interface improvements

- Mobile navigation now uses a dedicated full-width row with accessible touch
  targets and no horizontal overflow.
- Template selection is compact on small screens so the upload action remains
  visible without scrolling through four full-size cards.
- Settings expose reasoning controls earlier, use consistent icons, and provide
  a larger close target.
- Page titles now match their navigation labels: Simple OCR, Template OCR, Web
  OCR, Bulk OCR, and Agentic OCR.

### Upgrade notes

No application settings or stored OCR results need to be migrated.

[Full comparison](https://github.com/cyanxxy/gemini-ocr/compare/v1.2.0...v1.3.0)

## 1.2.0 - 2026-07-13

### More trustworthy OCR quality checks

- OCR quality is now measured against complete ground truth instead of relying
  only on a handful of expected words.
- New quality scores cover character and word accuracy, missing text,
  unsupported text, structured fields, critical fields, and table cells.
- Clean PDFs are now tested alongside text-layer-free page images and
  automatically degraded scans, giving future OCR changes a more realistic
  safety net.

### Real-world benchmark support

- A single setup command prepares reproducible subsets of CORD receipts and
  OmniDocBench pages without committing downloaded documents to the project.
- Canary, full, benchmark, and repeated stability runs make it easier to check
  a quick change or compare OCR behavior more thoroughly.
- Reports now include per-mode quality, latency, Gemini token usage, optional
  cost estimates, variation across repeated runs, and raw outputs for failed
  cases.

### Fixture correction

- The sample business card is now correctly generated as one page instead of
  splitting its contact information across two pages.

### Upgrade notes

No application settings or stored OCR results need to be migrated. Public
benchmark downloads are optional; the bundled local evaluation suite works on
its own.

[Full comparison](https://github.com/cyanxxy/gemini-ocr/compare/v1.1.0...v1.2.0)
