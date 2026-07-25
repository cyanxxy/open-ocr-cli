<!-- markdownlint-disable MD013 -->

# Open OCR CLI

**Agent-first, provider-neutral document extraction for the command line.**

Open OCR CLI extracts text and structured data from images, PDFs, and public
URLs. It runs against Gemini, Kimi K3, Meta Muse Spark 1.1, OpenRouter, or any
OpenAI-compatible endpoint — directly or through Cloudflare AI Gateway — behind
one consistent extraction contract. Every capability is available through a
versioned machine protocol, a stdio MCP server, a packaged agent skill, and a
GitHub Action, so the same pipeline works for humans, scripts, CI, and coding
agents.

[**npm**](https://www.npmjs.com/package/open-ocr-cli)
· [**Latest release**](https://github.com/cyanxxy/gemini-ocr/releases/latest)
· [**Issues**](https://github.com/cyanxxy/gemini-ocr/issues)

[![CI](https://github.com/cyanxxy/gemini-ocr/actions/workflows/ci.yml/badge.svg)](https://github.com/cyanxxy/gemini-ocr/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/open-ocr-cli?logo=npm&label=open-ocr-cli)](https://www.npmjs.com/package/open-ocr-cli)
[![Release](https://img.shields.io/github/v/release/cyanxxy/gemini-ocr?display_name=tag)](https://github.com/cyanxxy/gemini-ocr/releases)
[![Node.js](https://img.shields.io/badge/Node.js-20.19%2B-43853d?logo=node.js&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-0f766e.svg)](LICENSE)

> [!NOTE]
> `open-ocr-cli` is the primary executable and npm package; the previous
> `gemini-ocr` executable and configuration paths remain fully compatible.
> This repository also contains the original Gemini-powered React web
> application ([see below](#web-application)); provider-neutral support
> applies to the CLI.

## Highlights

- **Five extraction modes** — simple text, template presets (invoices,
  receipts, resumes, business cards), custom JSON Schema output, iterative
  agentic OCR, and grounded Web OCR from public URLs.
- **Provider-neutral** — Gemini, Kimi, Muse, OpenRouter, and arbitrary
  OpenAI-compatible endpoints share one contract for schemas, retries,
  batching, usage accounting, and output semantics.
- **Agent-first interface** — a versioned request/response protocol with
  published JSON Schemas, ordered JSONL lifecycle events, typed error codes,
  and a stdio MCP server over the same job engine.
- **Pipeline-grade reliability** — resumable fingerprinted batches, output
  locking, preflight collision checks, cost ceilings, rate limits, and
  fail-closed handling of truncated or invalid model responses.
- **Credential hygiene** — API keys come only from environment variables;
  raw keys are never accepted as flags or written to configuration.

## Quick start

Requirements: Node.js **20.19+**, **22.13+**, or **24+**, and a key for at
least one supported provider (`--dry-run` needs no credentials).

```bash
npm install --global open-ocr-cli

export GEMINI_API_KEY="your-key"
open-ocr-cli extract invoice.pdf
```

Or use a different provider:

```bash
export MOONSHOT_API_KEY="your-key"
open-ocr-cli extract invoice.pdf --provider kimi

export OPENROUTER_API_KEY="your-key"
open-ocr-cli extract invoice.pdf --provider openrouter --model moonshotai/kimi-k3
```

Running `open-ocr-cli` with no arguments always prints help and never prompts,
so scripts and CI stay deterministic. Launch the guided menu explicitly with
`open-ocr-cli interactive`, create a validated project configuration with
`open-ocr-cli init`, and diagnose a setup with `open-ocr-cli doctor`
(add `--check-credentials` for a minimal live endpoint probe).

Credentials load from the environment or a project-local `.env`. The CLI never
accepts a raw API key as a flag or configuration value.

### Docker and GitHub Actions

```bash
docker run --rm -v "$PWD:/work" \
  -e GEMINI_API_KEY \
  ghcr.io/cyanxxy/open-ocr-cli:latest \
  extract /work/invoice.pdf --output /work/results
```

```yaml
- uses: cyanxxy/gemini-ocr@v2
  with:
    inputs: invoices
    provider: openrouter
    model: moonshotai/kimi-k3
    format: all
    output: ocr-results
    # Set dry-run: true to validate a workflow without secrets or API calls.
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

Tagged releases publish the npm tarball with provenance, a multi-architecture
container image, and a generated `open-ocr-cli.rb` Homebrew formula.
Maintainers can follow the [release checklist](docs/releasing.md) and the
[launch playbook](docs/launch-playbook.md).

## Commands

| Command | Purpose |
| --- | --- |
| `extract <inputs...>` | Extract files, directories, globs, or binary stdin (`-`) |
| `web <urls...>` | Grounded extraction from up to 20 public HTTP(S) URLs |
| `run --request <file>` | Execute a versioned machine-protocol request (JSON or JSONL response) |
| `mcp` | Serve OCR tools over the Model Context Protocol stdio transport |
| `capabilities` | Advertise providers, modes, limits, schemas, and error codes |
| `schema <name>` | Print a bundled protocol JSON Schema |
| `interactive` | Guided command menu (requires a TTY) |
| `init` | Create a project or global configuration and validate credentials |
| `doctor` | Check configuration; `--check-credentials` probes the endpoint |
| `status [output]` | Audit a completed or interrupted batch |
| `presets` · `models` · `providers` | Discover templates, model IDs, and provider profiles |

Common examples:

```bash
# Recursive, resumable batch
open-ocr-cli extract ./documents --output ./results --concurrency 4 --resume

# Structured invoice artifacts (markdown + JSON + CSV)
open-ocr-cli extract ./invoices --preset invoice --format all --output ./invoice-results

# Custom structured output validated against your schema
open-ocr-cli extract invoice.pdf --schema examples/invoice.schema.json --output invoice.json

# Iterative agentic OCR for difficult documents
open-ocr-cli extract dense-scan.png --mode agentic --progress detailed

# Public-URL extraction
open-ocr-cli web https://example.com/report.pdf --format markdown

# Validate the full plan without credentials, API calls, or writes
open-ocr-cli extract ./documents --dry-run

# Audit results
open-ocr-cli status ./results --json
```

Progress and diagnostics go to `stderr`; extracted content and JSONL events
stay on `stdout`, so every command is safe to compose in pipelines. Use
`--no-config` or `OPEN_OCR_NO_CONFIG=1` for a hermetic run that ignores
configuration files and the project `.env`.

For the complete flag reference, configuration keys, batch semantics, and exit
codes, see the [CLI package guide](packages/cli/README.md).

## For coding agents

The CLI is designed to be driven by agents. Three equivalent entry points wrap
the same job engine:

### Machine protocol

```bash
open-ocr-cli capabilities --json
open-ocr-cli run --request request.json --response-format jsonl
```

`run` executes a versioned request (protocol v2 current; v1 remains a
compatibility contract) validated against published Draft 2020-12 JSON
Schemas. Responses are a single typed result object or an ordered JSONL event
stream (`run.started`, `document.progress`, `document.completed`, …) with
stable sequence numbers, typed error codes with recovery hints, and
reference-first delivery: large OCR bodies land in `.open-ocr-results/<runId>`
artifacts instead of flooding the transcript. URL inputs are part of the
protocol, so Web OCR is available to agents through the same interface.

### MCP server

`open-ocr-cli mcp` starts a stdio Model Context Protocol server exposing
`ocr_extract`, `ocr_run_agentic`, and `ocr_web`, plus an
`open-ocr://capabilities` resource:

```json
{
  "mcpServers": {
    "open-ocr": {
      "command": "open-ocr-cli",
      "args": ["mcp"]
    }
  }
}
```

Stdout carries only MCP transport messages. OCR lifecycle events surface as
progress notifications, cancellation is honored, and tool results default to
referenced artifacts so large documents do not fill the client context.

### Agent skill

A validated skill for Claude Code, Codex, and compatible agents ships in
[`integrations/open-ocr/skills/open-ocr/SKILL.md`](integrations/open-ocr/skills/open-ocr/SKILL.md)
and is included in the npm package under `skills/open-ocr/`.

## Extraction modes

| Mode | CLI | Best for |
| --- | --- | --- |
| Simple | `extract --mode simple` | General text, layout, equations, image descriptions |
| Template | `extract --preset <id>` | Invoices, receipts, resumes, business cards |
| Custom schema | `extract --schema <file>` | Your own validated JSON structure |
| Agentic | `extract --mode agentic` | Iterative field recovery and targeted region re-OCR |
| Web | `web <urls...>` | Grounded extraction from public URLs |

Template presets produce normalized records and, where applicable, table data
for line items. Custom schemas are validated locally — both the schema itself
and the returned value — before any result is persisted.

Agentic OCR uses a two-loop design: an outer document loop evaluates
confidence and coverage, while an inner interaction loop lets the model
request one tool (structure analysis, batch field extraction, or region
re-OCR), inspect its result, and decide the next action. The document is sent
once; Gemini uses stored interaction chaining, and compatible providers use a
local transcript that preserves Kimi `reasoning_content` and OpenRouter
`reasoning_details` across tool continuations.

## Providers and gateways

| Provider profile | Default model | Documents | Structured output | Agent tools |
| --- | --- | --- | --- | --- |
| `gemini` | `gemini-3.5-flash` | Images and native PDFs | Yes | Native Interactions API |
| `kimi` | `kimi-k3` | Images; PDFs through Kimi file extraction | Yes | OpenAI-compatible tool calls |
| `muse` | `muse-spark-1.1` | PNG, JPEG, WebP, GIF images and PDFs | Yes | OpenAI-compatible tool calls |
| `openrouter` | `google/gemini-3.5-flash` | Model-dependent images and PDFs | Model-dependent | Model-dependent |
| `openai-compatible` | Required | Images; PDF capability is not assumed | Endpoint-dependent | Endpoint-dependent |

Named profiles supply endpoints, credential variable names, and multimodal
wire formats. `openrouter` and `openai-compatible` accept arbitrary upstream
model IDs. Muse Spark is a public-preview API, so `--base-url` remains
available if Meta changes its endpoint before general availability; Muse
agentic tool loops run on Chat Completions and do not carry private
chain-of-thought across turns for external API keys (prefer Gemini or Kimi
when deep multi-iteration reasoning continuity matters).

Structured extraction is fail-closed on every route. Direct Kimi requests use
Moonshot Flavoured JSON Schema strict mode; other named routes receive
`strict: true` only when the schema satisfies the narrower
all-properties-required dialect, and arbitrary endpoints are never falsely
claimed to support `strict`. In every case the CLI validates the returned
value against the original schema locally; invalid JSON or a schema mismatch
is never persisted as a successful extraction.

Reference documentation:
[Kimi K3 API](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart),
[Kimi model catalog](https://platform.kimi.ai/docs/models),
[Meta Muse Spark 1.1](https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/),
[OpenRouter multimodal files](https://openrouter.ai/docs/guides/overview/multimodal/pdfs),
[OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling),
[Cloudflare AI Gateway chat compatibility](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/).

### Cloudflare AI Gateway

Cloudflare is a route, not a model provider — the same OCR flow runs directly
or through a named gateway:

```bash
export GEMINI_API_KEY="your-key"
export CLOUDFLARE_AI_GATEWAY_TOKEN="gateway-token"

open-ocr-cli extract invoice.pdf \
  --provider gemini \
  --gateway cloudflare \
  --cloudflare-account-id "$CLOUDFLARE_ACCOUNT_ID" \
  --cloudflare-gateway-id "$CLOUDFLARE_AI_GATEWAY_ID"
```

OpenRouter uses Cloudflare's native OpenRouter route. Kimi, Muse, and generic
endpoints use a configured custom-provider slug (`--cloudflare-provider
moonshot`, with the upstream base configured before `/v1`, for example
`https://api.moonshot.ai`); the CLI forwards the remaining
`/v1/chat/completions` or `/v1/files` path through the custom route.

Add `--cloudflare-byok` when the provider key is stored in the gateway, and
optionally select it with `--cloudflare-byok-alias`. Unauthenticated gateways
need no token; when gateway authentication is enabled, set
`CLOUDFLARE_AI_GATEWAY_TOKEN` (or name another variable with
`--cloudflare-token-env`). BYOK gateways are authenticated by definition, so
the token is mandatory in BYOK mode. See Cloudflare's
[gateway authentication](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)
and [stored-key documentation](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/).

## Configuration

Configuration merges from lowest to highest priority:

1. `~/.config/gemini-ocr/config.json` (legacy)
2. `~/.config/open-ocr-cli/config.json`
3. `./.gemini-ocr.json` (legacy)
4. `./.open-ocr-cli.json`
5. `--config <path>`
6. Command-line flags

Configuration stores only the environment-variable *name* used for
credentials, never the key itself:

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k3",
  "gateway": "direct",
  "apiKeyEnv": "OPENROUTER_API_KEY",
  "concurrency": 4,
  "requestsPerMinute": 60,
  "resume": true
}
```

## Reliability by design

| Contract | Behavior |
| --- | --- |
| **Complete responses only** | Non-terminal streams, blocked responses, `MAX_TOKENS`, and unsuccessful interactions fail closed. |
| **Preflight before spend** | Inputs, schemas, output occupancy, and same-stem collisions are checked before extraction begins. |
| **No silent document loss** | Every discovered input receives a succeeded, partial, failed, or skipped result. |
| **Safe batch ownership** | An exclusive output lock prevents concurrent processes from racing manifest updates. |
| **Recoverable batches** | Fingerprinted manifests support `--resume`; `status` audits artifacts, usage, locks, and source drift. |
| **No-clobber output** | Existing artifacts require `--overwrite`; unsupported hard links fall back to exclusive writes. |
| **Bounded API use** | Request spacing, retries, timeouts, concurrency, estimated-cost ceilings, and abort signals share one policy. |
| **Pipeline-safe streams** | Machine-readable results use `stdout`; human diagnostics use `stderr`. |

Multi-artifact writes use staging and exception rollback. They are
deliberately documented as best-effort across process crashes or power loss,
not as an ACID filesystem transaction.

## Models, reasoning, and cost

Gemini model IDs are validated because their thinking and pricing contracts
are known. Other profiles accept upstream model IDs, with these recommended
defaults:

| Model | Project role | Thinking levels |
| --- | --- | --- |
| `gemini-3.5-flash` | Default; recommended for most documents | MINIMAL · LOW · MEDIUM · HIGH |
| `gemini-3.1-flash-lite` | Lower-cost, high-volume extraction | MINIMAL · LOW · MEDIUM · HIGH |
| `gemini-3-flash-preview` | Preview Flash option | MINIMAL · LOW · MEDIUM · HIGH |
| `gemini-3.1-pro-preview` | Highest-reasoning option | LOW · MEDIUM · HIGH |
| `kimi-k3` | Default Kimi multimodal and agentic route | LOW · HIGH · MAX |
| `kimi-k2.7-code` | Kimi coding/agent route; thinking always enabled | HIGH (no configurable effort) |
| `kimi-k2.7-code-highspeed` | Faster K2.7 Code route, same parameter contract | HIGH (no configurable effort) |
| `kimi-k2.6` | Legacy Kimi multimodal route | MINIMAL (instant) · HIGH (thinking) |
| `muse-spark-1.1` | Meta public-preview multimodal route | MINIMAL · LOW · MEDIUM · HIGH · XHIGH |
| `moonshotai/kimi-k3` | Kimi through OpenRouter | LOW · HIGH · MAX |
| Other OpenRouter models | Upstream model selected by ID | Model-dependent; the router accepts MINIMAL through MAX |

Defaults are model-aware: Gemini 3.5 Flash uses **MEDIUM**, Flash-Lite
**MINIMAL**, 3 Flash Preview and 3.1 Pro **HIGH**; Kimi K3 defaults to
**MAX**. Explicitly supported levels are preserved in agentic mode instead of
being silently increased. OpenRouter's unified reasoning interface maps an
effort to the closest level the selected model supports. Non-Gemini routes
accept `--max-tokens` up to the protocol ceiling of 1,048,576; an upstream
model can still enforce a smaller advertised maximum.

Use `--progress off|standard|detailed` (or `extraction.progress` in a
protocol v2 request) to choose observability: standard preserves model
output, provider thought summaries, and tool lifecycle metadata; detailed
additionally exposes provider reasoning and tool payloads. Reasoning state
needed for a tool continuation is always replayed to the provider regardless
of visibility. The deprecated `--include-thoughts` flag maps to standard
progress.

Built-in paid-tier estimates, USD per million tokens:

| Model | Input | Cached input | Output and reasoning |
| --- | ---: | ---: | ---: |
| `gemini-3.5-flash` | $1.50 | $0.15 | $9.00 |
| `gemini-3.1-flash-lite` | $0.25 | $0.025 | $1.50 |
| `gemini-3-flash-preview` | $0.50 | $0.05 | $3.00 |
| `gemini-3.1-pro-preview` | $2.00 / $4.00 above 200K input tokens | $0.20 / $0.40 | $12.00 / $18.00 |
| `kimi-k3` | $3.00 | $0.30 | $15.00 |
| `kimi-k2.7-code` | $0.95 | $0.19 | $4.00 |
| `kimi-k2.7-code-highspeed` | $1.90 | $0.38 | $8.00 |
| `kimi-k2.6` | $0.95 | $0.16 | $4.00 |

OpenRouter-reported cost is used when present. Provider prices change, so
verify the linked provider pages before budgeting a large run. For an unknown
or custom model — or Muse Spark while its public-preview pricing is not in
public primary documentation — set both `--input-price` and `--output-price`
if `--max-cost` must be enforceable.

## Inputs, outputs, and limits

| Constraint | Current limit |
| --- | --- |
| Local formats | PNG · JPEG · WebP · GIF · HEIC · HEIF · PDF |
| Image input | 70 MB raw |
| PDF input | 50 MB and up to 1,000 pages |
| Batch defaults | 1,000 files and 5,120 MB total; configurable |
| Concurrency | 2 by default; configurable 1–16 |
| Web OCR | Up to 20 public HTTP(S) URLs per request |
| Output | Markdown · JSON · CSV · JSONL · agent audit steps |

Video is outside the input contract: files such as MP4 are rejected even when
the selected foundation model has broader video capability. HEIC and HEIF are
sent natively through Gemini; the named Kimi, Muse, and OpenRouter profiles
accept PNG, JPEG, WebP, and GIF, and reject HEIC/HEIF locally with a
conversion hint rather than speculating about an undocumented transport
format. Agents can discover the CLI/provider intersection from each profile's
`inputImageMimeTypes` field in `open-ocr-cli capabilities --json`.

Web OCR rejects credentials in URLs, localhost, private network ranges, and
common tunnel hosts. Gemini uses verified URL Context metadata; other
providers use the CLI's bounded downloader, which rejects non-public IPv4 and
IPv6 addresses (including IPv4-mapped IPv6), pins DNS across redirects, and
stops sockets after 30 seconds without network activity. HTML is converted
with a structure-aware text parser before retrieved content reaches the model.

## Security and privacy

- There is no application backend and no telemetry. CLI documents are sent to
  the selected provider or gateway; the web app sends them to Gemini.
- The CLI reads credentials from the environment and never serializes the raw
  key into configuration or batch metadata.
- Agentic mode uses stored Gemini Interactions so later rounds can reference
  the original document; those interactions follow Google's
  [data-retention policy](https://ai.google.dev/gemini-api/docs/interactions).
  One-shot Web OCR explicitly disables interaction storage.
- File signatures, MIME types, sizes, PDF page counts, URL schemes, and
  custom schemas are validated before use.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Web application

The repository includes the original Gemini-powered React application with
the same five workflows (Simple, Templates, Bulk, Web, and Agentic OCR),
light/dark/AMOLED themes, and local browser settings:

```bash
git clone https://github.com/cyanxxy/gemini-ocr.git
cd gemini-ocr
npm ci
npm run dev
```

Open `http://localhost:5173`, choose **Settings**, and add your Gemini API
key. The bulk queue supports 200 files and 500 MB per batch.

> [!IMPORTANT]
> The browser stores the API key in `localStorage` with light obfuscation,
> not strong encryption. Anyone with access to that browser profile can
> recover it. Use a trusted profile, rotate exposed keys, and prefer a
> backend proxy when deploying with organization-owned credentials.

`npm run build` produces a static application in `dist/`; deployment
configuration is included for Netlify and Vercel, and production builds omit
source maps and ship CSP hardening headers. Release tags attach a production
build archive to the corresponding
[GitHub release](https://github.com/cyanxxy/gemini-ocr/releases).

## Development

```bash
npm run typecheck   # Browser, Node, and CLI TypeScript projects
npm run lint        # ESLint
npm test            # Vitest suite
npm run build       # Production web build
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run cli -- extract …` | Run the TypeScript CLI locally |
| `npm run cli:smoke` | Build and smoke-test the packaged executable |
| `npm run cli:pack` | Create the standalone npm tarball |
| `npm run cli:install-smoke` | Install the packed tarball in a clean directory and test both executables |
| `npm run test:coverage` | Run tests with coverage thresholds |
| `npm run evals:validate` | Validate evaluation cases and corpus metadata |
| `npm run evals:canary` | Run the small live evaluation suite for the configured provider |
| `npm run evals` | Run the complete live provider evaluation suite |
| `npm run evals:matrix -- --suite canary` | Compare the provider matrix from `evals/providers.example.json` |

Pull-request CI runs typechecking, linting, tests with coverage, dependency
auditing, evaluation-fixture validation, and the production build. Version
tags rerun the release gates before publishing, and optional repository
secrets enable live Gemini, Kimi, and OpenRouter canaries.

### Project layout

```text
src/
  components/     Reusable UI from atoms through page-level organisms
  pages/          Simple, Templates, Web, Bulk, and Agentic workflows
  lib/
    gemini/       Native Gemini client, extraction, and Interactions
    providers/    Registry, routing, compatible transport, agent, usage, policy
    templates/    Structured extraction presets and rendering
    agent*.ts     Agent loop, tools, prompts, memory, and audit steps
  store/          Zustand settings and workflow stores
evals/            Reproducible OCR quality and regression evaluations
packages/cli/     Publishable Open OCR CLI package (schemas, skill, dist)
  src/            Commands, machine protocol, MCP server, job service, artifacts
integrations/     Source-of-truth agent skill and integration assets
```

### Evaluations

The evaluation suite measures character and word error rates, edit
similarity, coverage, structured-field precision/recall/F1, critical-field
exact match, table-cell F1, latency, and per-mode breakdowns:

```bash
npm run evals:fixtures && npm run evals:setup && npm run evals:validate
EVAL_PROVIDER=gemini GEMINI_API_KEY=your_key npm run evals:canary
npm run evals:matrix -- --suite canary
npm run evals:report
```

The committed [latest report](evals/reports/latest.md) is a historical
snapshot; see [evals/README.md](evals/README.md) for datasets, scoring, and
reproduction steps.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md),
follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and include tests or
evaluation evidence for behavior changes.

- [Open issues](https://github.com/cyanxxy/gemini-ocr/issues)
- [Release history](CHANGELOG.md)
- [Security policy](SECURITY.md)

## License

Released under the [MIT License](LICENSE).
